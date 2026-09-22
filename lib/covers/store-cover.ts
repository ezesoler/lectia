import { coverCandidates } from "./candidates";
import { getBinary, type DownloadDeps } from "./download";
import { inspectImage } from "./image-info";
import type { CatalogCoverDb, CatalogCoverRow, CoverMeta, CoverStore, StoreOutcome } from "./types";

/** Tras 5 fallos transitorios, la fila pasa a `unavailable` (no reintenta sola; FR-010). */
export const MAX_ATTEMPTS = 5;
/** Ventana mínima entre reintentos de un `pending` (research.md R7). */
export const RETRY_WINDOW_MS = 60 * 60_000; // 1 hora

export interface StoreCoverDeps extends DownloadDeps {
  bucket: CoverStore;
  db: CatalogCoverDb;
  now?: () => number;
}

/**
 * Descarga, valida y guarda la portada de un libro del catálogo (research.md R2–R6,
 * contracts/cover-pipeline.md). Nunca lanza por causas de red o de contenido: siempre devuelve
 * un `StoreOutcome`. Un libro sin `cover_origin_url` (estado `none`) no tiene nada que intentar
 * y no genera escrituras (data-model.md: `none` sólo avanza cuando el enriquecimiento halla portada).
 */
export async function storeCover(row: CatalogCoverRow, deps: StoreCoverDeps): Promise<StoreOutcome> {
  if (row.cover_status === "stored") return "skipped";
  if (!row.cover_origin_url || !row.cover_source) return "skipped";
  // 'unavailable' es terminal: sólo un reset explícito (backfill --include-unavailable) lo reactiva
  if (row.cover_status === "unavailable") return "skipped";

  const now = deps.now ?? Date.now;
  if (row.cover_attempts >= MAX_ATTEMPTS) return "skipped";
  if (row.cover_checked_at) {
    const elapsed = now() - Date.parse(row.cover_checked_at);
    if (Number.isFinite(elapsed) && elapsed < RETRY_WINDOW_MS) return "skipped";
  }

  const candidates = coverCandidates(row.cover_origin_url, row.cover_source);
  if (candidates.length === 0) {
    await deps.db.markUnavailable(row.id);
    return "unavailable";
  }

  let sawTransientFailure = false;
  for (const url of candidates) {
    const outcome = await getBinary(url, deps);
    if (outcome.kind === "failed") {
      sawTransientFailure = true;
      break; // algo transitorio: cortar acá y reintentar más tarde, no seguir con peores candidatas
    }
    if (outcome.kind === "absent") continue;

    const inspection = inspectImage(outcome.bytes);
    if (!inspection.valid) continue; // reemplazo / demasiado chica / truncada: probar la siguiente

    const meta = await saveValidImage(row.id, row.cover_source, outcome.bytes, inspection, deps.bucket);
    await deps.db.markStored(row.id, meta);
    return "stored";
  }

  if (sawTransientFailure) {
    await deps.db.markPending(row.id, row.cover_attempts + 1);
    return "pending";
  }
  await deps.db.markUnavailable(row.id);
  return "unavailable";
}

async function saveValidImage(
  id: string,
  source: CoverMeta["source"],
  bytes: Uint8Array,
  inspection: Extract<ReturnType<typeof inspectImage>, { valid: true }>,
  bucket: CoverStore
): Promise<CoverMeta> {
  const contentType = `image/${inspection.format}`;
  const result = await bucket.upload(id, bytes, contentType);
  if (result === "created") {
    return {
      path: id,
      format: inspection.format,
      width: inspection.width,
      height: inspection.height,
      bytes: inspection.bytes,
      sha256: inspection.sha256,
      source,
    };
  }

  // 'exists': otra importación ganó la carrera; se adopta el objeto ya guardado (research.md R6)
  const existing = await bucket.download(id);
  if (!existing) throw new Error(`storeCover: el objeto ${id} desapareció justo después de reportarse existente`);
  const existingInspection = inspectImage(existing);
  if (!existingInspection.valid) {
    throw new Error(`storeCover: el objeto existente ${id} no es una imagen válida (${existingInspection.reason})`);
  }
  return {
    path: id,
    format: existingInspection.format,
    width: existingInspection.width,
    height: existingInspection.height,
    bytes: existingInspection.bytes,
    sha256: existingInspection.sha256,
    source,
  };
}
