/**
 * Bounded local text extraction + chunking for chat attachments. No network, no OCR, no dependencies.
 * Extraction failures never reject an upload: the caller stores the file with extraction_status
 * 'stored_only' or 'failed'.
 */
import { chunkSegments } from './chunker';
import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { extractCsv, extractTxt } from './text-formats';
import { extractXlsx } from './xlsx';
import { openZip, ZipError } from './zip-reader';
import {
  DEFAULT_EXTRACTION_LIMITS,
  DeadlineError,
  makeDeadline,
  type ExtractionLimits,
  type ExtractionResult,
  type RawExtraction,
} from './types';

export type { ExtractionLimits, ExtractionResult, ExtractionStatus, TextChunk } from './types';
export { DEFAULT_EXTRACTION_LIMITS } from './types';
export { openZip, ZipError, DEFAULT_ZIP_LIMITS, type ZipArchive, type ZipLimits } from './zip-reader';
export { chunkSegments, cleanText } from './chunker';
export { extractPdf, textFromContentStream } from './pdf';

export type ExtractableExt = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'png' | 'jpg' | 'jpeg' | 'webp';

export function extractDocumentText(
  ext: string,
  buffer: Buffer,
  overrides: Partial<ExtractionLimits> = {},
): ExtractionResult {
  const limits: ExtractionLimits = { ...DEFAULT_EXTRACTION_LIMITS, ...overrides };
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    return { status: 'stored_only', chunks: [], truncated: false, reason: 'image_no_ocr' };
  }
  const check = makeDeadline(limits.timeBudgetMs);
  try {
    let raw: RawExtraction;
    switch (ext) {
      case 'docx':
        raw = extractDocx(openZip(buffer), check);
        break;
      case 'xlsx':
        raw = extractXlsx(openZip(buffer), check, limits);
        break;
      case 'csv':
        raw = extractCsv(buffer, check, limits);
        break;
      case 'txt':
        raw = extractTxt(buffer, check, limits);
        break;
      case 'pdf':
        raw = extractPdf(buffer, check, limits);
        break;
      default:
        return { status: 'stored_only', chunks: [], truncated: false, reason: 'unsupported_type' };
    }
    const { chunks, truncated } = chunkSegments(raw, limits);
    if (chunks.length === 0) {
      return { status: 'stored_only', chunks: [], truncated, reason: ext === 'pdf' ? 'no_readable_text' : 'empty' };
    }
    return { status: 'indexed', chunks, truncated };
  } catch (err) {
    if (err instanceof DeadlineError) return { status: ext === 'pdf' ? 'stored_only' : 'failed', chunks: [], truncated: false, reason: 'time_budget' };
    if (err instanceof ZipError) return { status: 'failed', chunks: [], truncated: false, reason: `zip_${err.code}` };
    return { status: ext === 'pdf' ? 'stored_only' : 'failed', chunks: [], truncated: false, reason: 'extract_error' };
  }
}
