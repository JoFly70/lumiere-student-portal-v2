/**
 * Tiny, valid, synthetic fixtures for the 8 chat-attachment formats, generated in code (documents) or embedded as
 * a few hundred bytes of base64 (images produced once with an image library, so they decode as real images).
 * No real student content. Generators come from tests/helpers/s21-attachment-fixtures.ts (zlib only, no binaries).
 */
import { createHash } from 'node:crypto';
import { buildDocx, buildPdf, buildXlsx } from '../../../tests/helpers/s21-attachment-fixtures';

export const JPEG_8X8 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooor1Tzj/9k=',
  'base64',
);
export const WEBP_8X8 = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvB8ABAAdQrXoUtP+BiOh/AAA=', 'base64');
export const PNG_8X8 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGOUi1rAgA0wYRUdtBIA3xYBKJ8tkFUAAAAASUVORK5CYII=', 'base64');

export interface Fixture {
  ext: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'jpg' | 'png' | 'webp';
  fileName: string;
  /** What a browser would send and what the app must store. */
  mimeType: string;
  bytes: Buffer;
  /** Text formats are indexed locally; images are stored only. */
  expectExtraction: 'indexed' | 'stored_only';
  /** A word that appears in the extracted text (undefined for images). */
  marker?: string;
}

export const sha256 = (b: Buffer | Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** `tag` makes the bytes unique per run (and per student) so SHA-256 de-duplication never hides a failure. */
export function attachmentFixtures(tag: string): Fixture[] {
  const word = (k: string) => `s22${k}${tag}`.toLowerCase();
  const pdfMarker = word('pdf');
  const docxMarker = word('docx');
  const xlsxMarker = word('xlsx');
  const csvMarker = word('csv');
  const txtMarker = word('txt');
  return [
    { ext: 'pdf', fileName: 's22-synthetic-notes.pdf', mimeType: 'application/pdf', bytes: buildPdf([[`S22 synthetic pdf ${pdfMarker}`, 'Second line of the synthetic pdf']]), expectExtraction: 'indexed', marker: pdfMarker },
    { ext: 'docx', fileName: 's22-synthetic-essay.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: buildDocx([{ kind: 'h1', text: 'S22 synthetic essay' }, { kind: 'p', text: `Body paragraph ${docxMarker}` }]), expectExtraction: 'indexed', marker: docxMarker },
    { ext: 'xlsx', fileName: 's22-synthetic-grades.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: buildXlsx([{ name: 'Sheet1', rows: [['Course', 'Credits'], [xlsxMarker, 1], ['Synthetic Art', 0.5]] }]), expectExtraction: 'indexed', marker: xlsxMarker },
    { ext: 'csv', fileName: 's22-synthetic-courses.csv', mimeType: 'text/csv', bytes: Buffer.from(`course,credits\n${csvMarker},1\nSynthetic Music,0.5\n`, 'utf8'), expectExtraction: 'indexed', marker: csvMarker },
    { ext: 'txt', fileName: 's22-synthetic-notes.txt', mimeType: 'text/plain', bytes: Buffer.from(`S22 synthetic note ${txtMarker}\nsecond line\n`, 'utf8'), expectExtraction: 'indexed', marker: txtMarker },
    { ext: 'jpg', fileName: 's22-synthetic-photo.jpg', mimeType: 'image/jpeg', bytes: JPEG_8X8, expectExtraction: 'stored_only' },
    { ext: 'png', fileName: 's22-synthetic-diagram.png', mimeType: 'image/png', bytes: PNG_8X8, expectExtraction: 'stored_only' },
    { ext: 'webp', fileName: 's22-synthetic-banner.webp', mimeType: 'image/webp', bytes: WEBP_8X8, expectExtraction: 'stored_only' },
  ];
}

/** A small valid PDF for ordinary Documents-page uploads (J9, J14, J18). Unique per `label`. */
export function documentPdf(label: string): Buffer {
  return buildPdf([[`S22 synthetic document ${label}`]]);
}

export const EXE_AS_PDF = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x90)]);
export const TEXT_AS_DOCX = Buffer.from('this is plain text pretending to be a word document', 'utf8');
export const SVG_AS_PNG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
export const OVERSIZE_PHOTO = Buffer.concat([PNG_8X8, Buffer.alloc(5 * 1024 * 1024 + 1, 7)]);
