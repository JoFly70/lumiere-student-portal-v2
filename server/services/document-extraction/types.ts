export type ExtractionStatus = 'indexed' | 'stored_only' | 'failed';

/** One logical unit of source text (paragraph, table row, sheet row, CSV row, line, PDF page text). */
export interface Segment {
  /** Grouping label that never spans chunks (e.g. "page 3", "Sheet1"); null when the format has none. */
  group: string | null;
  /** 1-based position of the unit inside its group (paragraph number, row number, line number). */
  n: number;
  text: string;
}

export type UnitLabel = 'paragraphs' | 'rows' | 'lines' | null;

export interface RawExtraction {
  segments: Segment[];
  unitLabel: UnitLabel;
  /** True when a cap stopped extraction early. */
  truncated: boolean;
}

export interface TextChunk {
  chunkIndex: number;
  location: string;
  content: string;
}

export interface ExtractionResult {
  status: ExtractionStatus;
  chunks: TextChunk[];
  truncated: boolean;
  /** Short machine reason when status is not 'indexed'. */
  reason?: string;
}

export interface ExtractionLimits {
  /** Cap on total characters kept across all chunks. */
  maxTotalChars: number;
  maxChunks: number;
  chunkChars: number;
  /** Wall-clock budget for one extraction (ms). */
  timeBudgetMs: number;
  maxCsvRows: number;
  maxCsvCols: number;
  maxSheets: number;
  maxSheetRows: number;
  maxSheetCols: number;
  maxPdfPages: number;
}

export const DEFAULT_EXTRACTION_LIMITS: ExtractionLimits = {
  maxTotalChars: 200_000,
  maxChunks: 400,
  chunkChars: 1500,
  timeBudgetMs: 8_000,
  maxCsvRows: 5_000,
  maxCsvCols: 50,
  maxSheets: 20,
  maxSheetRows: 5_000,
  maxSheetCols: 50,
  maxPdfPages: 300,
};

export class DeadlineError extends Error {
  constructor() {
    super('extraction time budget exceeded');
    this.name = 'DeadlineError';
  }
}

export function makeDeadline(ms: number): () => void {
  const end = Date.now() + ms;
  return () => {
    if (Date.now() > end) throw new DeadlineError();
  };
}
