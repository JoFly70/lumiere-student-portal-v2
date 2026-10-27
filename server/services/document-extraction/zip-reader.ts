/**
 * Bounded ZIP reader (OOXML containers). Built on zlib.inflateRawSync with maxOutputLength so a
 * decompression bomb can never allocate more than the declared, capped entry size. Nothing is ever
 * written to disk, so zip-slip is irrelevant, but hostile entry names are still rejected.
 *
 * Supported: stored (0) and deflate (8) entries, no ZIP64, no encryption, no multi-disk archives.
 */
import zlib from 'node:zlib';

export type ZipErrorCode =
  | 'not_zip'
  | 'encrypted'
  | 'too_many_entries'
  | 'too_large'
  | 'ratio'
  | 'corrupt'
  | 'unsupported'
  | 'unsafe_name';

export class ZipError extends Error {
  constructor(readonly code: ZipErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ZipError';
  }
}

export interface ZipLimits {
  /** Maximum number of central-directory entries. */
  maxEntries: number;
  /** Maximum declared uncompressed size of one entry. */
  maxEntryBytes: number;
  /** Maximum declared uncompressed size of the whole archive. */
  maxTotalUncompressed: number;
  /** Maximum uncompressed:compressed ratio (per entry and for the whole archive). */
  maxRatio: number;
  /** Maximum number of bytes this reader will actually inflate across all read() calls. */
  maxInflatedBudget: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 1000,
  maxEntryBytes: 24 * 1024 * 1024,
  maxTotalUncompressed: 120 * 1024 * 1024,
  maxRatio: 200,
  maxInflatedBudget: 64 * 1024 * 1024,
};

export interface ZipEntryInfo {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntryInfo[];
  has(name: string): boolean;
  hasPrefix(prefix: string): boolean;
  /** Inflate one entry (bounded). Throws ZipError. */
  read(name: string): Buffer;
  /** Inflate one entry as UTF-8 text (BOM stripped). */
  readText(name: string): string;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export function isZipSignature(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5) && (buf[3] === 4 || buf[3] === 6);
}

function unsafeName(name: string): boolean {
  if (name.length === 0 || name.length > 512) return true;
  if (name.startsWith('/') || name.includes('\\') || /[\x00-\x1F\x7F]/.test(name)) return true;
  return name.split('/').some((seg, i, arr) => seg === '..' || (seg === '' && i !== arr.length - 1));
}

export function openZip(buf: Buffer, overrides: Partial<ZipLimits> = {}): ZipArchive {
  const limits: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...overrides };
  if (!isZipSignature(buf) || buf.length < 22) throw new ZipError('not_zip');
  const eocd = findEocd(buf);
  if (eocd < 0) throw new ZipError('not_zip', 'End of central directory not found');

  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entriesThisDisk = buf.readUInt16LE(eocd + 8);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesThisDisk !== totalEntries) throw new ZipError('unsupported', 'multi-disk archive');
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('unsupported', 'zip64');
  if (totalEntries > limits.maxEntries) throw new ZipError('too_many_entries');
  if (cdOffset + cdSize > eocd || cdOffset > buf.length) throw new ZipError('corrupt', 'central directory out of range');

  const entries: ZipEntryInfo[] = [];
  const byName = new Map<string, ZipEntryInfo>();
  let pos = cdOffset;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) throw new ZipError('corrupt', 'bad central directory entry');
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen + extraLen + commentLen > buf.length) throw new ZipError('corrupt', 'central directory entry out of range');
    if (flags & 0x1 || flags & 0x40) throw new ZipError('encrypted');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('unsupported', 'zip64');
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', pos + 46, pos + 46 + nameLen);
    if (unsafeName(name)) throw new ZipError('unsafe_name', 'unsafe entry name');
    if (method !== 0 && method !== 8) throw new ZipError('unsupported', `compression method ${method}`);
    if (byName.has(name)) throw new ZipError('corrupt', 'duplicate entry name');
    if (uncompressedSize > limits.maxEntryBytes) throw new ZipError('too_large', `entry ${name} too large`);
    if (method === 0 && compressedSize !== uncompressedSize) throw new ZipError('corrupt', 'stored entry size mismatch');
    if (uncompressedSize > 1024 * 1024 && uncompressedSize / Math.max(1, compressedSize) > limits.maxRatio) {
      throw new ZipError('ratio', `entry ${name} compression ratio too high`);
    }
    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;
    if (totalUncompressed > limits.maxTotalUncompressed) throw new ZipError('too_large', 'archive expands too much');
    const info: ZipEntryInfo = { name, method, compressedSize, uncompressedSize, localOffset };
    entries.push(info);
    byName.set(name, info);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (totalUncompressed > 4 * 1024 * 1024 && totalUncompressed / Math.max(1, totalCompressed) > limits.maxRatio) {
    throw new ZipError('ratio', 'archive compression ratio too high');
  }

  let inflated = 0;
  const read = (name: string): Buffer => {
    const info = byName.get(name);
    if (!info) throw new ZipError('corrupt', `missing entry ${name}`);
    if (info.uncompressedSize === 0) return Buffer.alloc(0);
    if (inflated + info.uncompressedSize > limits.maxInflatedBudget) throw new ZipError('too_large', 'inflate budget exceeded');
    const lo = info.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== LOC_SIG) throw new ZipError('corrupt', 'bad local header');
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const end = start + info.compressedSize;
    if (end > buf.length) throw new ZipError('corrupt', 'entry data out of range');
    const raw = buf.subarray(start, end);
    let out: Buffer;
    if (info.method === 0) {
      out = Buffer.from(raw);
    } else {
      try {
        // maxOutputLength = declared size: a lying header (bomb) throws instead of allocating.
        out = zlib.inflateRawSync(raw, { maxOutputLength: info.uncompressedSize });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ERR_BUFFER_TOO_LARGE') throw new ZipError('ratio', `entry ${name} exceeds its declared size`);
        throw new ZipError('corrupt', `entry ${name} is not valid deflate data`);
      }
    }
    if (out.length !== info.uncompressedSize) throw new ZipError('corrupt', `entry ${name} size mismatch`);
    inflated += out.length;
    return out;
  };

  return {
    entries,
    has: (n) => byName.has(n),
    hasPrefix: (p) => entries.some((e) => e.name.startsWith(p)),
    read,
    readText(name) {
      const text = read(name).toString('utf8');
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    },
  };
}
