import type { ZipArchive } from './zip-reader';
import type { RawExtraction, Segment } from './types';
import { decodeXmlText, attr } from './xml-utils';
import { cleanText } from './chunker';

export const DOCX_MAIN_PART = 'word/document.xml';

/**
 * DOCX: paragraphs, headings (Heading N / Title styles become "#" lines) and tables (one line per row,
 * cells separated by " | "). Headers/footers, comments, footnotes and text boxes are not extracted.
 */
export function extractDocx(zip: ZipArchive, check: () => void, maxUnits = 20_000): RawExtraction {
  const xml = zip.readText(DOCX_MAIN_PART);
  const segments: Segment[] = [];
  let truncated = false;
  let n = 0;

  const tokenRe = /<(\/?)w:(p|tbl|tr|tc|t|tab|br|cr|pStyle)\b([^>]*?)(\/?)>|([^<]+)/g;
  let tblDepth = 0;
  let row: string[] | null = null;
  let cell: string[] | null = null;
  let para = '';
  let inPara = false;
  let inT = false;
  let heading = 0;
  let steps = 0;

  const pushUnit = (text: string) => {
    const t = cleanText(text);
    if (!t) return;
    n++;
    segments.push({ group: null, n, text: t });
  };

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml))) {
    if ((++steps & 0x3fff) === 0) check();
    if (segments.length >= maxUnits) {
      truncated = true;
      break;
    }
    if (m[5] !== undefined) {
      if (inT && inPara) para += decodeXmlText(m[5]);
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2];
    const selfClose = m[4] === '/';
    switch (name) {
      case 'p':
        if (closing) {
          if (inPara) {
            const text = cleanText(para);
            if (cell) {
              if (text) cell.push(text);
            } else if (text) {
              n++;
              segments.push({ group: null, n, text: heading > 0 ? `${'#'.repeat(Math.min(heading, 6))} ${text}` : text });
            }
          }
          inPara = false;
          para = '';
          heading = 0;
        } else if (!selfClose) {
          inPara = true;
          para = '';
          heading = 0;
        }
        break;
      case 'pStyle': {
        const val = attr(m[3], 'w:val') ?? '';
        const h = /^(?:heading|titre)\s*(\d)$/i.exec(val);
        if (h) heading = Number(h[1]);
        else if (/^title$/i.test(val)) heading = 1;
        break;
      }
      case 't':
        inT = !closing && !selfClose;
        break;
      case 'tab':
        if (inPara) para += '\t';
        break;
      case 'br':
      case 'cr':
        if (inPara) para += '\n';
        break;
      case 'tbl':
        tblDepth += closing ? -1 : 1;
        break;
      case 'tr':
        if (closing) {
          if (row) pushUnit(row.join(' | '));
          row = null;
        } else if (!selfClose) {
          row = [];
        }
        break;
      case 'tc':
        if (closing) {
          if (cell && row) row.push(cell.join(' '));
          cell = null;
        } else if (!selfClose) {
          cell = [];
        }
        break;
    }
  }
  void tblDepth;
  return { segments, unitLabel: 'paragraphs', truncated };
}
