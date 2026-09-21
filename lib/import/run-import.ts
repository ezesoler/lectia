import type { SupabaseClient } from "@supabase/supabase-js";
import { ImportFailure, KOBO_ERROR_TO_CODE, KoboFileError } from "./errors";
import { messageFor, type ErrorCode } from "./messages";
import { buildKeys, hashHighlight, normalize } from "./normalize";
import {
  MAX_FILE_SIZE,
  type DiscardBreakdown,
  type ErrorDetails,
  type ImportSource,
  type ParsedEntry,
  type ParseResult,
  type ParserFn,
} from "./types";

export const BATCH_SIZE = 500;
const SQLITE_MAGIC = "SQLite format 3\u0000";
const FOUND_MAX = 80;

export interface ImportStorage {
  download(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

export interface RunImportDeps {
  /** Cliente con el token del usuario: las escrituras siguen bajo RLS. */
  db: SupabaseClient;
  storage: ImportStorage;
  parsers: Record<ImportSource, ParserFn>;
  batchSize?: number;
  /** Cede el hilo entre lotes; se inyecta para probar sin esperas. */
  yieldFn?: () => Promise<void>;
}

export interface RunImportInput {
  importId: string;
  userId: string;
  source: ImportSource;
}

/** Libro único del import, para el enriquecimiento posterior. */
export interface ImportedBook {
  title: string;
  author: string;
  titleKey: string;
  authorKey: string;
  isbn?: string;
}

export interface RunImportOutcome {
  state: "done" | "error";
  books: ImportedBook[];
}

interface BatchItem {
  title: string;
  author: string;
  title_key: string;
  author_key: string;
  kind: string;
  text: string;
  text_key: string;
  page: number | null;
  location: string;
  chapter: string | null;
  highlighted_at: string | null;
  hash: string;
}

const defaultYield = () => new Promise<void>((resolve) => setImmediate(resolve));

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function stripNul(s: string): string {
  return s.replace(/\u0000/g, "");
}

/** Falla temprano (antes de parsear) si el contenido no corresponde al origen (FR-003). */
function validateSignature(source: ImportSource, bytes: Uint8Array): void {
  if (bytes.length > MAX_FILE_SIZE) {
    throw new ImportFailure("ERR_IMPORT_4006");
  }
  if (source === "kobo") {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, SQLITE_MAGIC.length));
    if (head !== SQLITE_MAGIC) {
      throw new ImportFailure("ERR_IMPORT_4002", {
        expected: "Cabecera «SQLite format 3»",
        found: "La cabecera del archivo no es SQLite",
      });
    }
  }
}

/** Convierte las entradas parseadas en filas para import_batch; el texto vacío tras normalizar se descarta. */
export function prepareItems(entries: ParsedEntry[]): {
  items: BatchItem[];
  extraDiscarded: number;
} {
  const items: BatchItem[] = [];
  let extraDiscarded = 0;
  for (const entry of entries) {
    const text = stripNul(entry.text).trim();
    const textKey = normalize(text);
    if (textKey === "") {
      extraDiscarded += 1;
      continue;
    }
    const title = stripNul(entry.title).trim();
    const author = stripNul(entry.author).trim();
    const { titleKey, authorKey } = buildKeys(title, author);
    const location = stripNul(entry.location);
    items.push({
      title,
      author,
      title_key: titleKey,
      author_key: authorKey,
      kind: entry.kind,
      text,
      text_key: textKey,
      page: typeof entry.page === "number" && Number.isSafeInteger(entry.page) && entry.page < 2_147_483_647 ? entry.page : null,
      location,
      chapter: entry.chapter ? stripNul(entry.chapter) : null,
      highlighted_at: entry.highlightedAt ?? null,
      hash: hashHighlight({ titleKey, authorKey, kind: entry.kind, textKey, location }),
    });
  }
  return { items, extraDiscarded };
}

function collectBooks(entries: ParsedEntry[], items: BatchItem[]): ImportedBook[] {
  const seen = new Map<string, ImportedBook>();
  const isbnByKey = new Map<string, string>();
  for (const entry of entries) {
    if (entry.isbn) {
      const { titleKey, authorKey } = buildKeys(entry.title, entry.author);
      isbnByKey.set(`${titleKey}\u001f${authorKey}`, entry.isbn);
    }
  }
  for (const item of items) {
    const key = `${item.title_key}\u001f${item.author_key}`;
    if (seen.has(key)) continue;
    const isbn = isbnByKey.get(key);
    seen.set(key, {
      title: item.title,
      author: item.author,
      titleKey: item.title_key,
      authorKey: item.author_key,
      ...(isbn ? { isbn } : {}),
    });
  }
  return [...seen.values()];
}

function mergeBreakdown(breakdown: DiscardBreakdown, extra: number): DiscardBreakdown {
  if (extra === 0) return breakdown;
  return { ...breakdown, empty_text: (breakdown.empty_text ?? 0) + extra };
}

/** Detalle técnico de un error de formato (FR-029); `found` nunca contiene resaltados. */
function formatDetails(result: ParseResult | null, source: ImportSource): ErrorDetails {
  if (source === "kobo") {
    return { validRecords: 0, expected: "Anotaciones en la tabla Bookmark", found: "Sin anotaciones con texto" };
  }
  const details: ErrorDetails = {
    validRecords: 0,
    expected: "Título (Autor)",
  };
  if (result?.linesRead !== undefined) details.linesRead = result.linesRead;
  if (result?.firstLine) details.found = truncate(result.firstLine, FOUND_MAX);
  return details;
}

export async function runImport(
  input: RunImportInput,
  deps: RunImportDeps
): Promise<RunImportOutcome> {
  const { importId, userId, source } = input;
  const { db, storage, parsers } = deps;
  const batchSize = deps.batchSize ?? BATCH_SIZE;
  const yieldFn = deps.yieldFn ?? defaultYield;
  const path = `${userId}/${importId}`;

  let totalInserted = 0;
  let persistStarted = false;
  let parsed: ParseResult | null = null;
  let counters: { entriesTotal: number; discarded: number; breakdown: DiscardBreakdown } | null =
    null;

  try {
    let bytes: Uint8Array;
    try {
      bytes = await storage.download(path);
    } catch (err) {
      throw new ImportFailure("ERR_IMPORT_5001", undefined, `download: ${(err as Error).message}`);
    }

    validateSignature(source, bytes);

    try {
      parsed = await parsers[source](bytes);
    } catch (err) {
      if (err instanceof KoboFileError) {
        throw new ImportFailure(
          KOBO_ERROR_TO_CODE[err.code],
          err.code === "empty" ? formatDetails(null, source) : { found: err.message }
        );
      }
      throw new ImportFailure("ERR_IMPORT_5001", undefined, `parse: ${(err as Error).message}`);
    }

    const { items, extraDiscarded } = prepareItems(parsed.entries);
    const discarded = parsed.discarded + extraDiscarded;
    const breakdown = mergeBreakdown(parsed.discardBreakdown, extraDiscarded);
    counters = { entriesTotal: items.length + discarded, discarded, breakdown };

    if (items.length === 0) {
      // Sin separadores ni registros reconocibles → formato; con estructura pero todo descartado → 4005
      const code: ErrorCode =
        discarded === 0 && source === "kindle" ? "ERR_IMPORT_4001" : "ERR_IMPORT_4005";
      throw new ImportFailure(code, formatDetails(parsed, source));
    }

    const books = collectBooks(parsed.entries, items);

    // Los descartes ya están "procesados": el progreso arranca en `discarded`
    const { error: metaError } = await db
      .from("imports")
      .update({
        entries_total: counters.entriesTotal,
        entries_done: discarded,
        books_count: books.length,
        discarded,
        discard_breakdown: breakdown,
        updated_at: new Date().toISOString(),
      })
      .eq("id", importId);
    if (metaError) throw new ImportFailure("ERR_IMPORT_5031", undefined, metaError.message);

    persistStarted = true;
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const { data, error } = await db.rpc("import_batch", {
        p_import_id: importId,
        p_source: source,
        p_items: chunk,
      });
      if (error) throw new ImportFailure("ERR_IMPORT_5031", undefined, error.message);
      const row = (data as { inserted: number; duplicated: number }[] | null)?.[0];
      totalInserted += row?.inserted ?? 0;
      await yieldFn();
    }

    const now = new Date().toISOString();
    const { error: doneError } = await db
      .from("imports")
      .update({ state: "done", finished_at: now, updated_at: now })
      .eq("id", importId)
      .eq("state", "parsing");
    if (doneError) throw new ImportFailure("ERR_IMPORT_5031", undefined, doneError.message);

    return { state: "done", books };
  } catch (err) {
    const failure =
      err instanceof ImportFailure
        ? err
        : new ImportFailure("ERR_IMPORT_5001", undefined, (err as Error).message);
    // Sólo código y mensaje técnico: nunca texto de resaltados en los logs
    console.error(`[runImport] ${importId} ${failure.code}: ${failure.message}`);

    const saved = persistStarted && totalInserted > 0;
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      state: "error",
      error_code: failure.code,
      error_message: messageFor(failure.code, { saved, source }),
      finished_at: now,
      updated_at: now,
    };
    if (failure.details) update["error_details"] = failure.details;
    if (counters) {
      update["entries_total"] = counters.entriesTotal;
      update["discarded"] = counters.discarded;
      update["discard_breakdown"] = counters.breakdown;
    }
    await db.from("imports").update(update).eq("id", importId).eq("state", "parsing");
    return { state: "error", books: [] };
  } finally {
    await storage.remove(path).catch((err: unknown) => {
      console.error(`[runImport] ${importId} no se pudo borrar el archivo: ${(err as Error).message}`);
    });
  }
}
