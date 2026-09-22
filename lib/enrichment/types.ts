import type { CatalogCoverDb, CoverSource, CoverStatus, CoverStore, StoreOutcome } from "@/lib/covers/types";

/** Libro a enriquecer (sale del import; sólo título, autor e ISBN viajan a las APIs externas). */
export interface BookQuery {
  title: string;
  author: string;
  titleKey: string;
  authorKey: string;
  isbn?: string;
}

/** Candidato devuelto por una API externa, ya normalizado. */
export interface ApiCandidate {
  title: string;
  authors: string[];
  isbn?: string;
  /** URL de procedencia de la portada en esta API; nunca se muestra directamente (feature 004). */
  coverOrigin?: string;
  /** Fija por módulo (open-library.ts siempre 'open_library', google-books.ts siempre 'google_books'). */
  coverSource: CoverSource;
  category?: string;
  pages?: number;
  /** true si se encontró buscando por ISBN: el ISBN es autoritativo y no exige coincidencia de título. */
  viaIsbn: boolean;
}

export type ApiSource = "open_library" | "google_books";

/** Fila de `book_catalog` tal como la maneja el enriquecimiento (incluye las columnas de portada). */
export interface CatalogEntry {
  id: string;
  isbn: string | null;
  title: string;
  author: string;
  title_key: string;
  author_key: string;
  /** Sólo procedencia (feature 004): nunca se usa para mostrar la imagen. */
  cover_origin_url: string | null;
  cover_status: CoverStatus;
  cover_source: CoverSource | null;
  cover_attempts: number;
  cover_checked_at: string | null;
  category: string | null;
  pages: number | null;
  sources: ApiSource[];
}

/** Al insertar, `cover_status` lo deriva `catalog.ts` de `cover_origin_url`; attempts/checked_at usan el default de la base. */
export type NewCatalogEntry = Omit<CatalogEntry, "id" | "cover_status" | "cover_attempts" | "cover_checked_at">;

/** Único punto de acceso a `book_catalog` (escritura sólo con service_role). */
export interface CatalogStore {
  find(query: Pick<BookQuery, "isbn" | "titleKey" | "authorKey">): Promise<CatalogEntry | null>;
  /** Devuelve el id de la fila creada (o de la que ganó una carrera por el índice único). */
  save(entry: NewCatalogEntry): Promise<string>;
}

export interface HttpDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Serializa las llamadas hacia una API con límite de tasa (Open Library). */
  schedule?: <T>(task: () => Promise<T>) => Promise<T>;
  /** Cabeceras extra (p. ej. User-Agent identificable para Open Library). */
  headers?: Record<string, string>;
}

export interface EnrichDeps extends HttpDeps {
  catalog: CatalogStore;
  /** Guardado de portadas (feature 004); ver lib/covers/store-cover.ts. */
  covers: { bucket: CoverStore; db: CatalogCoverDb };
}

export type EnrichStatus = "catalog_hit" | "enriched" | "partial" | "not_found";

export interface EnrichResult {
  status: EnrichStatus;
  catalogId?: string;
  /** `'none'` si el libro no tiene (ni tuvo nunca) una portada candidata. */
  cover: StoreOutcome | "none";
}
