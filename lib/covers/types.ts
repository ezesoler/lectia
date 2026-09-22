export type CoverStatus = "none" | "pending" | "stored" | "unavailable";
export type CoverSource = "open_library" | "google_books";
export type CoverFormat = "jpeg" | "png" | "webp";

export interface ImageInfo {
  format: CoverFormat;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

/** Motivos por los que una imagen descargada no se guarda (FR-009, research.md R3/R4). */
export type InvalidReason = "not_image" | "truncated" | "too_large" | "too_small" | "placeholder";

/** Resultado de `inspectImage`: la información válida o el motivo del rechazo. */
export type ImageInspection =
  | ({ valid: true } & ImageInfo)
  | { valid: false; reason: InvalidReason };

export type FetchOutcome =
  | { kind: "ok"; bytes: Uint8Array; contentType: string | null }
  | { kind: "absent" }
  | { kind: "failed" };

export type StoreOutcome = "stored" | "pending" | "unavailable" | "skipped";

/** Adaptador sobre el bucket `covers` (siempre con service_role). */
export interface CoverStore {
  /** Sube el objeto sin sobrescribir; `'exists'` si otro proceso ya lo subió (adopción, R6). */
  upload(id: string, bytes: Uint8Array, contentType: string): Promise<"created" | "exists">;
  /** `null` si el objeto no existe. */
  download(id: string): Promise<Uint8Array | null>;
}

export interface CoverMeta {
  path: string;
  format: CoverFormat;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  source: CoverSource;
}

/** Fila mínima de `book_catalog` que necesita el pipeline de portadas. */
export interface CatalogCoverRow {
  id: string;
  cover_origin_url: string | null;
  cover_source: CoverSource | null;
  cover_status: CoverStatus;
  cover_attempts: number;
  cover_checked_at: string | null;
}

/** Único punto de escritura de las columnas de portada en `book_catalog`. */
export interface CatalogCoverDb {
  markStored(id: string, meta: CoverMeta): Promise<void>;
  markPending(id: string, attempts: number): Promise<void>;
  markUnavailable(id: string): Promise<void>;
}
