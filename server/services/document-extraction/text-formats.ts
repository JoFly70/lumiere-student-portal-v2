import type { ExtractionLimits, RawExtraction, Segment } from './types';

export function decodeUtf8(buf: Buffer): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectDelimiter(sample: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuote = false;
  for (const ch of sample.slice(0, 4000)) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch in counts) counts[ch]++;
    else if (!inQuote && ch === '\n') break;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/** RFC 4180 style CSV parse with row / column / cell caps. Each row is one segment "a | b | c". */
export function extractCsv(buf: Buffer, check: () => void, limits: ExtractionLimits): RawExtraction {
  const text = decodeUtf8(buf);
  const delim = detectDelimiter(text);
  const segments: Segment[] = [];
  let truncated = false;
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  let rowNo = 0;
  let i = 0;

  const endField = () => {
    if (row.length < limits.maxCsvCols) row.push(field.slice(0, 500).trim());
    else truncated = true;
    field = '';
  };
  const endRow = () => {
    endField();
    rowNo++;
    const line = row.join(' | ');
    if (line.replace(/[|\s]/g, '')) segments.push({ group: null, n: rowNo, text: line });
    row = [];
  };

  for (; i < text.length; i++) {
    if ((i & 0xffff) === 0) check();
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          if (field.length < 600) field += '"';
          i++;
        } else inQuote = false;
      } else if (field.length < 600) field += ch;
    } else if (ch === '"' && field === '') inQuote = true;
    else if (ch === delim) endField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      if (rowNo >= limits.maxCsvRows) {
        truncated = true;
        return { segments, unitLabel: 'rows', truncated };
      }
    } else if (field.length < 600) field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return { segments, unitLabel: 'rows', truncated };
}

/** Plain text: one segment per non-empty line, numbered by source line. */
export function extractTxt(buf: Buffer, check: () => void, limits: ExtractionLimits): RawExtraction {
  const text = decodeUtf8(buf);
  const segments: Segment[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  let truncated = false;
  for (let i = 0; i < lines.length; i++) {
    if ((i & 0x3fff) === 0) check();
    if (lines[i].trim() === '') continue;
    segments.push({ group: null, n: i + 1, text: lines[i] });
    if (segments.length > limits.maxTotalChars) {
      truncated = true;
      break;
    }
  }
  return { segments, unitLabel: 'lines', truncated };
}
