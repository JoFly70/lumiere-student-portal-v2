import type { ZipArchive } from './zip-reader';
import type { ExtractionLimits, RawExtraction, Segment } from './types';
import { attr, decodeXmlText, textOfElements } from './xml-utils';

export const XLSX_WORKBOOK_PART = 'xl/workbook.xml';

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function parseSharedStrings(xml: string, maxChars: number, check: () => void): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let total = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(xml))) {
    if ((++i & 0x3fff) === 0) check();
    // Skip phonetic runs (<rPh>) so furigana does not pollute the text.
    const body = (m[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const s = textOfElements(body, 't');
    total += s.length;
    out.push(s);
    if (total > maxChars) break;
  }
  return out;
}

/** XLSX: sharedStrings + worksheets, row/col/sheet caps; each row becomes "A | B | C" with the sheet as group. */
export function extractXlsx(zip: ZipArchive, check: () => void, limits: ExtractionLimits): RawExtraction {
  const workbook = zip.readText(XLSX_WORKBOOK_PART);
  const rels = zip.has('xl/_rels/workbook.xml.rels') ? zip.readText('xl/_rels/workbook.xml.rels') : '';
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) relTarget.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/^xl\/xl\//, 'xl/'));
  }

  const sheets: { name: string; part: string; hidden: boolean }[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id');
    const part = rid ? relTarget.get(rid) : undefined;
    if (name && part) sheets.push({ name, part, hidden: /state\s*=\s*"(?:hidden|veryHidden)"/.test(m[0]) });
  }
  if (sheets.length === 0) {
    // Fall back to conventional part names.
    zip.entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).forEach((e, i) => sheets.push({ name: `Sheet${i + 1}`, part: e.name, hidden: false }));
  }

  const shared = zip.has('xl/sharedStrings.xml') ? parseSharedStrings(zip.readText('xl/sharedStrings.xml'), limits.maxTotalChars * 4, check) : [];

  const segments: Segment[] = [];
  let truncated = false;
  let sheetCount = 0;
  for (const sheet of sheets) {
    if (sheet.hidden) continue;
    if (!zip.has(sheet.part)) continue;
    if (++sheetCount > limits.maxSheets) {
      truncated = true;
      break;
    }
    const xml = zip.readText(sheet.part);
    let rows = 0;
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rm: RegExpExecArray | null;
    let seq = 0;
    while ((rm = rowRe.exec(xml))) {
      if ((++seq & 0xff) === 0) check();
      if (rows >= limits.maxSheetRows) {
        truncated = true;
        break;
      }
      const body = rm[2];
      if (!body) continue;
      const rowNo = Number(attr(rm[1], 'r')) || seq;
      const cells: string[] = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm: RegExpExecArray | null;
      let lastCol = -1;
      while ((cm = cellRe.exec(body))) {
        const cbody = cm[2];
        if (!cbody) continue;
        const ref = attr(cm[1], 'r') ?? '';
        const col = ref ? colIndex(ref) : lastCol + 1;
        lastCol = col;
        if (col >= limits.maxSheetCols) continue;
        const type = attr(cm[1], 't');
        let value = '';
        if (type === 'inlineStr') value = textOfElements(cbody, 't');
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(cbody);
          if (v) {
            const raw = decodeXmlText(v[1]);
            if (type === 's') value = shared[Number(raw)] ?? '';
            else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
            else value = raw;
          }
        }
        value = value.replace(/\s+/g, ' ').trim();
        if (!value) continue;
        while (cells.length < col) cells.push('');
        cells[col] = value.slice(0, 500);
      }
      const line = cells.join(' | ').trim();
      if (!line.replace(/[|\s]/g, '')) continue;
      rows++;
      segments.push({ group: sheet.name, n: rowNo, text: line });
    }
  }
  return { segments, unitLabel: 'rows', truncated };
}
