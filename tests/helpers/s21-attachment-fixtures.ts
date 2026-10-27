/**
 * S21 test fixtures: generated in-test with zlib only (no binary files, nothing downloaded).
 */
import zlib from "node:zlib";

export interface ZipEntrySpec {
  name: string;
  data: Buffer | string;
  /** "deflate" (default) or "store". */
  method?: "deflate" | "store";
  /** Lie about the uncompressed size in both headers (decompression-bomb test). */
  declaredSize?: number;
  /** Set the general-purpose "encrypted" flag. */
  encrypted?: boolean;
}

function crc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0;
}

export function buildZip(entries: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const method = e.method === "store" ? 0 : 8;
    const comp = method === 0 ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const name = Buffer.from(e.name, "utf8");
    const flags = (e.encrypted ? 1 : 0) | 0x800;
    const usize = e.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(usize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface DocxBlock {
  kind: "p" | "h1" | "h2" | "table";
  text?: string;
  rows?: string[][];
}

export function buildDocx(blocks: DocxBlock[], extraEntries: ZipEntrySpec[] = []): Buffer {
  const body = blocks
    .map((b) => {
      if (b.kind === "table") {
        return `<w:tbl>${(b.rows ?? [])
          .map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`)
          .join("")}</w:tbl>`;
      }
      const style = b.kind === "h1" ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : b.kind === "h2" ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' : "";
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${esc(b.text ?? "")}</w:t></w:r></w:p>`;
    })
    .join("");
  return buildZip([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    { name: "word/document.xml", data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>` },
    ...extraEntries,
  ]);
}

export function buildXlsx(sheets: { name: string; rows: (string | number | null)[][] }[]): Buffer {
  const shared: string[] = [];
  const idx = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) i = shared.push(s) - 1;
    return i;
  };
  const colName = (i: number) => String.fromCharCode(65 + i);
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            if (v === null) return "";
            const ref = `${colName(ci)}${ri + 1}`;
            return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${idx(v)}</v></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  return buildZip([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`,
    },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
    { name: "xl/sharedStrings.xml", data: `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>` },
  ]);
}

const pdfEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export interface PdfOptions {
  /** Add an /Encrypt entry to the trailer. */
  encrypted?: boolean;
  /** Put the page objects in a compressed object stream (PDF 1.5 style). */
  objectStream?: boolean;
  /** Use TJ arrays with kerning instead of Tj. */
  tj?: boolean;
  /** Leave content streams uncompressed. */
  plain?: boolean;
}

/** Minimal valid-enough PDF: one content stream per page, Flate-compressed unless plain. */
export function buildPdf(pages: string[][], opts: PdfOptions = {}): Buffer {
  const objs: { num: number; body: Buffer }[] = [];
  const pageNums = pages.map((_, i) => 4 + i * 2);
  const content = (lines: string[]) => {
    const ops = lines
      .map((l, i) => (opts.tj ? `BT /F1 12 Tf 72 ${720 - i * 18} Td [(${pdfEsc(l.slice(0, 4))}) -250 (${pdfEsc(l.slice(4))})] TJ ET` : `BT /F1 12 Tf 72 ${720 - i * 18} Td (${pdfEsc(l)}) Tj ET`))
      .join("\n");
    return Buffer.from(ops, "latin1");
  };
  objs.push({ num: 1, body: Buffer.from("<< /Type /Catalog /Pages 2 0 R >>") });
  objs.push({ num: 2, body: Buffer.from(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`) });
  objs.push({ num: 3, body: Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>") });
  pages.forEach((lines, i) => {
    const pageNum = pageNums[i];
    const raw = content(lines);
    const data = opts.plain ? raw : zlib.deflateSync(raw);
    objs.push({ num: pageNum, body: Buffer.from(`<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNum + 1} 0 R >>`) });
    objs.push({
      num: pageNum + 1,
      body: Buffer.concat([Buffer.from(`<< ${opts.plain ? "" : "/Filter /FlateDecode "}/Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]),
    });
  });
  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  for (const o of objs) parts.push(Buffer.from(`${o.num} 0 obj\n`), o.body, Buffer.from("\nendobj\n"));
  parts.push(Buffer.from(`trailer\n<< /Root 1 0 R /Size ${4 + pages.length * 2}${opts.encrypted ? " /Encrypt 99 0 R" : ""} >>\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** A PDF whose text lives in 2-byte hex strings of an Identity-H font (unsupported: must be stored_only). */
export function buildCidPdf(): Buffer {
  const raw = Buffer.from("BT /F1 12 Tf 72 700 Td <00480065006C006C006F> Tj ET", "latin1");
  const data = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n4 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>\nendobj\n5 0 obj\n"),
    Buffer.from(`<< /Filter /FlateDecode /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"),
  ]);
}

export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
export const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(32, 3)]);
export const EXE_BYTES = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90)]);
