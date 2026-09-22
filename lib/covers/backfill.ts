import type { SupabaseClient } from "@supabase/supabase-js";
import { storeCover, type StoreCoverDeps } from "./store-cover";
import type { CatalogCoverDb, CatalogCoverRow, CoverStore, StoreOutcome } from "./types";

export interface BackfillOptions {
  /** Tope de filas a procesar en esta corrida; sin límite recorre todo lo `pending`. */
  limit?: number;
  /** Tamaño de cada página de consulta (no afecta el resultado, sólo cuánto se pide de una vez). */
  batchSize?: number;
  concurrency?: number;
  /** Reactiva las filas `unavailable` (attempts=0) antes de procesar. No aplica si `dryRun`. */
  includeUnavailable?: boolean;
  /** Sólo cuenta lo que se haría; no reactiva ni llama a `storeCover`. */
  dryRun?: boolean;
}

export type BackfillSummary = Record<StoreOutcome, number> & { processed: number };

export interface BackfillDeps extends Omit<StoreCoverDeps, "bucket" | "db"> {
  /** service_role: lista y reactiva filas directamente sobre `book_catalog`. */
  admin: SupabaseClient;
  bucket: CoverStore;
  coverDb: CatalogCoverDb;
  /** Inyectable para pruebas unitarias; por defecto usa el `storeCover` real. */
  storeCoverFn?: (row: CatalogCoverRow, deps: StoreCoverDeps) => Promise<StoreOutcome>;
}

const ROW_COLUMNS = "id, cover_origin_url, cover_source, cover_status, cover_attempts, cover_checked_at";

async function fetchPendingRows(
  admin: SupabaseClient,
  limit: number | undefined,
  batchSize: number
): Promise<CatalogCoverRow[]> {
  const rows: CatalogCoverRow[] = [];
  let offset = 0;
  for (;;) {
    if (limit !== undefined && rows.length >= limit) break;
    const pageSize = limit !== undefined ? Math.min(batchSize, limit - rows.length) : batchSize;
    const { data, error } = await admin
      .from("book_catalog")
      .select(ROW_COLUMNS)
      .eq("cover_status", "pending")
      .order("cover_checked_at", { ascending: true, nullsFirst: true })
      .range(offset, offset + pageSize - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as CatalogCoverRow[]));
    offset += data.length;
    if (data.length < pageSize) break; // no hay más filas pending
  }
  return rows;
}

/**
 * Migra a copia propia las portadas guardadas como dirección externa (US3): recorre
 * `book_catalog` en `pending` y llama a `storeCover` por cada una, con concurrencia acotada.
 * Idempotente y reanudable: cada corrida vuelve a listar el estado actual, así que repetirla o
 * retomarla tras una interrupción no repite descargas ni duplica copias (research.md R7).
 */
export async function backfillCovers(opts: BackfillOptions, deps: BackfillDeps): Promise<BackfillSummary> {
  const batchSize = opts.batchSize ?? 50;
  const summary: BackfillSummary = { processed: 0, stored: 0, pending: 0, unavailable: 0, skipped: 0 };

  // Un dry run nunca escribe nada, ni siquiera la reactivación de 'unavailable'
  if (opts.includeUnavailable && !opts.dryRun) {
    await deps.admin
      .from("book_catalog")
      .update({ cover_status: "pending", cover_attempts: 0, cover_checked_at: null })
      .eq("cover_status", "unavailable");
  }

  const rows = await fetchPendingRows(deps.admin, opts.limit, batchSize);

  if (opts.dryRun) {
    summary.processed = rows.length;
    return summary;
  }

  const queue = [...rows];
  const storeCoverDeps: StoreCoverDeps = {
    bucket: deps.bucket,
    db: deps.coverDb,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  };
  const doStore = deps.storeCoverFn ?? storeCover;

  async function worker() {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      summary.processed += 1;
      try {
        const outcome = await doStore(row, storeCoverDeps);
        summary[outcome] += 1;
      } catch (err) {
        // Un libro roto no debe detener la migración del resto
        console.error(`[backfill] portada de ${row.id}: ${(err as Error).message}`);
        summary.skipped += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, queue.length) }, worker));
  return summary;
}
