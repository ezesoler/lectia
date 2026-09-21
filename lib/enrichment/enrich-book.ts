import { normalize } from "@/lib/import/normalize";
import { searchGoogleBooks } from "./google-books";
import { searchOpenLibrary } from "./open-library";
import type {
  ApiCandidate,
  ApiSource,
  BookQuery,
  EnrichDeps,
  EnrichResult,
  NewCatalogEntry,
} from "./types";

const UNKNOWN_AUTHOR_KEY = "autor desconocido";

const tokens = (key: string) => key.split(" ").filter((t) => t.length > 0);

function isSubset(small: string[], big: string[]): boolean {
  const set = new Set(big);
  return small.every((t) => set.has(t));
}

/**
 * Anti-envenenamiento del catálogo: un resultado sólo se acepta si corresponde al libro pedido.
 * - Por ISBN el resultado es autoritativo.
 * - Título: igual, o uno contenido en el otro (mínimo 2 palabras, para no confundir "Dune" con
 *   "Dune Messiah").
 * - Autor: al menos una palabra (≥ 3 letras) del autor pedido aparece entre los autores devueltos.
 *   Con autor desconocido sólo se acepta un título idéntico.
 */
export function isAcceptableMatch(
  query: Pick<BookQuery, "titleKey" | "authorKey">,
  candidate: ApiCandidate
): boolean {
  if (candidate.viaIsbn) return true;

  const candidateTitle = normalize(candidate.title);
  const titleEqual = candidateTitle === query.titleKey;
  const a = tokens(query.titleKey);
  const b = tokens(candidateTitle);
  const titleContained =
    Math.min(a.length, b.length) >= 2 &&
    (a.length <= b.length ? isSubset(a, b) : isSubset(b, a));
  if (!titleEqual && !titleContained) return false;

  if (query.authorKey === UNKNOWN_AUTHOR_KEY) return titleEqual;

  const candidateAuthors = new Set(tokens(normalize(candidate.authors.join(" "))));
  return tokens(query.authorKey).some((t) => t.length >= 3 && candidateAuthors.has(t));
}

interface Merged {
  coverUrl?: string;
  category?: string;
  pages?: number;
  title?: string;
  authors: string[];
  isbn?: string;
  sources: Set<ApiSource>;
}

function acceptedCandidates(query: BookQuery, candidates: ApiCandidate[] | null): ApiCandidate[] {
  return candidates?.filter((c) => isAcceptableMatch(query, c)) ?? [];
}

/** Rango razonable de páginas de un libro: descarta ceros y valores absurdos de las APIs. */
export const MIN_PAGES = 8;
export const MAX_PAGES = 3000;

/**
 * Las APIs devuelven varias ediciones con conteos de páginas muy distintos (una edición
 * "especial" de 980 páginas junto a una de 398). Se toma la mediana —la inferior si hay cantidad
 * par— de los valores plausibles, en lugar del primero que aparezca.
 */
export function pickPages(candidates: ApiCandidate[]): number | undefined {
  const values = candidates
    .map((c) => c.pages)
    .filter((n): n is number => n !== undefined && n >= MIN_PAGES && n <= MAX_PAGES)
    .sort((a, b) => a - b);
  return values.length > 0 ? values[Math.floor((values.length - 1) / 2)] : undefined;
}

/**
 * Toma de los candidatos de UNA API sólo los campos que todavía faltan (FR-016: cada campo sale
 * de la primera API que lo provea) y registra la fuente si aportó alguno. Portada y categoría
 * salen del primer candidato que las tenga; las páginas, de la mediana de los candidatos.
 */
function mergeFromApi(merged: Merged, candidates: ApiCandidate[], source: ApiSource): void {
  let contributed = false;
  let firstContributor: ApiCandidate | undefined;

  if (merged.coverUrl === undefined) {
    const c = candidates.find((x) => x.coverUrl);
    if (c) {
      merged.coverUrl = c.coverUrl;
      contributed = true;
      firstContributor ??= c;
    }
  }
  if (merged.category === undefined) {
    const c = candidates.find((x) => x.category);
    if (c) {
      merged.category = c.category;
      contributed = true;
      firstContributor ??= c;
    }
  }
  if (merged.pages === undefined) {
    const pages = pickPages(candidates);
    if (pages !== undefined) {
      merged.pages = pages;
      contributed = true;
      firstContributor ??= candidates.find((x) => x.pages !== undefined);
    }
  }

  if (contributed && firstContributor) {
    merged.sources.add(source);
    merged.title ??= firstContributor.title;
    if (merged.authors.length === 0) merged.authors = firstContributor.authors;
    merged.isbn ??= firstContributor.isbn;
  }
}

const missingFields = (m: Merged) =>
  m.coverUrl === undefined || m.category === undefined || m.pages === undefined;

/**
 * Catálogo → Open Library → Google Books (sólo para los campos que falten) → merge → catálogo.
 * El merge toma cada campo de la primera API que lo provea (FR-016). Sin ningún dato de una
 * API no se escribe nada en `book_catalog` (FR-017/FR-018). Nunca lanza por fallos de las APIs.
 */
export async function enrichBook(query: BookQuery, deps: EnrichDeps): Promise<EnrichResult> {
  const existing = await deps.catalog.find(query);
  if (existing) return { status: "catalog_hit", catalogId: existing.id };

  const merged: Merged = { authors: [], sources: new Set() };
  const search = { title: query.title, author: query.author, ...(query.isbn ? { isbn: query.isbn } : {}) };

  // Una misma API suele devolver varias ediciones: una sin portada y otra con ella
  mergeFromApi(merged, acceptedCandidates(query, await searchOpenLibrary(search, deps)), "open_library");
  if (missingFields(merged)) {
    mergeFromApi(merged, acceptedCandidates(query, await searchGoogleBooks(search, deps)), "google_books");
  }

  if (merged.sources.size === 0) return { status: "not_found" };

  const entry: NewCatalogEntry = {
    isbn: query.isbn ?? merged.isbn ?? null,
    title: merged.title ?? query.title,
    author: merged.authors.length > 0 ? merged.authors.join(", ") : query.author,
    title_key: query.titleKey,
    author_key: query.authorKey,
    cover_url: merged.coverUrl ?? null,
    category: merged.category ?? null,
    pages: merged.pages ?? null,
    sources: [...merged.sources],
  };
  const catalogId = await deps.catalog.save(entry);
  return { status: missingFields(merged) ? "partial" : "enriched", catalogId };
}
