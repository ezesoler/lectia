export type ImportSource = "kindle" | "kobo";
export type ImportState = "queued" | "parsing" | "done" | "error";
export type NoteKind = "highlight" | "note";

/** Motivos por los que una entrada del archivo no se guarda (research.md R13). */
export type DiscardReason =
  | "bookmark_no_text"
  | "empty_text"
  | "truncated"
  | "no_title"
  | "unknown_type"
  | "orphan_volume";

/** Conteo por motivo. Sólo números: nunca texto ni ubicaciones del usuario. */
export type DiscardBreakdown = Partial<Record<DiscardReason, number>>;

export interface ParsedEntry {
  title: string;
  author: string;
  /** Sólo Kobo; se usa para el enriquecimiento y no se persiste. */
  isbn?: string;
  kind: NoteKind;
  text: string;
  page?: number;
  /** Ubicación cruda del lector; '' si el origen no la trae. */
  location: string;
  chapter?: string;
  /** ISO 8601 si se pudo interpretar; nunca causa un descarte. */
  highlightedAt?: string;
}

export interface ParseResult {
  entries: ParsedEntry[];
  discarded: number;
  discardBreakdown: DiscardBreakdown;
  /** Libros únicos (title_key + author_key) presentes en `entries`. */
  booksCount: number;
  /** Líneas leídas; alimenta el detalle técnico de los errores de formato. */
  linesRead?: number;
  /** Primera línea no vacía del archivo (sin truncar); sólo se usa en errores de formato. */
  firstLine?: string;
}

/** Detalle técnico plegado de un error de formato (FR-029). Nunca incluye texto de resaltados. */
export interface ErrorDetails {
  linesRead?: number;
  validRecords?: number;
  expected?: string;
  found?: string;
}

export interface ImportStatus {
  id: string;
  source: ImportSource;
  state: ImportState;
  fileName: string;
  fileSize: number | null;
  entriesTotal: number;
  entriesDone: number;
  booksCount: number;
  highlightsNew: number;
  highlightsDup: number;
  discarded: number;
  discardBreakdown: DiscardBreakdown;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetails: ErrorDetails | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Recibe el contenido crudo del archivo y devuelve las entradas normalizadas. */
export type ParserFn = (bytes: Uint8Array) => ParseResult | Promise<ParseResult>;

export const MAX_FILE_SIZE = 52_428_800; // 50 MB
