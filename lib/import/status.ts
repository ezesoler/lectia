import type {
  DiscardBreakdown,
  ErrorDetails,
  ImportSource,
  ImportState,
  ImportStatus,
} from "./types";

export const IMPORT_COLUMNS =
  "id, source, state, file_name, file_size, entries_total, entries_done, books_count, highlights_new, highlights_dup, discarded, discard_breakdown, error_code, error_message, error_details, started_at, finished_at";

export interface ImportRow {
  id: string;
  source: ImportSource;
  state: ImportState;
  file_name: string;
  file_size: number | null;
  entries_total: number;
  entries_done: number;
  books_count: number;
  highlights_new: number;
  highlights_dup: number;
  discarded: number;
  discard_breakdown: DiscardBreakdown | null;
  error_code: string | null;
  error_message: string | null;
  error_details: ErrorDetails | null;
  started_at: string;
  finished_at: string | null;
}

export function toImportStatus(row: ImportRow): ImportStatus {
  return {
    id: row.id,
    source: row.source,
    state: row.state,
    fileName: row.file_name,
    fileSize: row.file_size,
    entriesTotal: row.entries_total,
    entriesDone: row.entries_done,
    booksCount: row.books_count,
    highlightsNew: row.highlights_new,
    highlightsDup: row.highlights_dup,
    discarded: row.discarded,
    discardBreakdown: row.discard_breakdown ?? {},
    errorCode: row.error_code,
    errorMessage: row.error_message,
    errorDetails: row.error_details,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
