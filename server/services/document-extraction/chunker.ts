import { DEFAULT_EXTRACTION_LIMITS, type ExtractionLimits, type RawExtraction, type TextChunk, type UnitLabel } from './types';

const SINGULAR: Record<string, string> = { paragraphs: 'paragraph', rows: 'row', lines: 'line' };

/** Postgres text cannot hold NUL; also drop other control characters and collapse runaway whitespace. */
export function cleanText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function locationLabel(group: string | null, unitLabel: UnitLabel, first: number, last: number): string {
  let unit = '';
  if (unitLabel) unit = first === last ? `${SINGULAR[unitLabel]} ${first}` : `${unitLabel} ${first}-${last}`;
  if (group && unit) return `${group} ${unit}`;
  return group ?? unit ?? '';
}

/** Split an over-long unit on whitespace near the chunk size. */
function splitLong(text: string, size: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Group segments into ~chunkChars chunks with location labels, honouring total-char and chunk caps. */
export function chunkSegments(raw: RawExtraction, limits: ExtractionLimits = DEFAULT_EXTRACTION_LIMITS): { chunks: TextChunk[]; truncated: boolean } {
  const chunks: TextChunk[] = [];
  let truncated = raw.truncated;
  let total = 0;

  let curGroup: string | null | undefined;
  let curFirst = 0;
  let curLast = 0;
  let buf: string[] = [];
  let bufLen = 0;

  const flush = () => {
    if (buf.length === 0) return;
    chunks.push({ chunkIndex: chunks.length, location: locationLabel(curGroup ?? null, raw.unitLabel, curFirst, curLast), content: buf.join('\n') });
    buf = [];
    bufLen = 0;
  };

  outer: for (const seg of raw.segments) {
    const text = cleanText(seg.text);
    if (!text) continue;
    const pieces = text.length > limits.chunkChars ? splitLong(text, limits.chunkChars) : [text];
    for (const piece of pieces) {
      if (total + piece.length > limits.maxTotalChars || (chunks.length >= limits.maxChunks)) {
        truncated = true;
        break outer;
      }
      if (buf.length > 0 && (seg.group !== curGroup || bufLen + piece.length + 1 > limits.chunkChars)) flush();
      if (chunks.length >= limits.maxChunks) {
        truncated = true;
        break outer;
      }
      if (buf.length === 0) {
        curGroup = seg.group;
        curFirst = seg.n;
      }
      curLast = seg.n;
      buf.push(piece);
      bufLen += piece.length + 1;
      total += piece.length;
    }
  }
  flush();
  return { chunks, truncated };
}
