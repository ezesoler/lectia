import type { CoverSource } from "./types";

/**
 * Deriva las URLs candidatas de una fuente, de mayor a menor calidad esperada (research.md R2).
 * Sirve tanto para portadas nuevas como para la migración: sólo necesita la URL de procedencia
 * (`cover_origin_url`), sin importar qué variante haya sido esa URL originalmente.
 */
export function coverCandidates(origin: string, source: CoverSource): string[] {
  if (source === "open_library") return openLibraryCandidates(origin);
  return googleBooksCandidates(origin);
}

const OL_ID_RE = /\/b\/id\/(\d+)(?:-[SML])?\.jpg/i;

/** El original (sin sufijo) supera a `-L`, topado en ~500 px de alto (research.md E1). */
function openLibraryCandidates(origin: string): string[] {
  const id = OL_ID_RE.exec(origin)?.[1];
  if (!id) return [];
  return [
    `https://covers.openlibrary.org/b/id/${id}.jpg?default=false`,
    `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`,
  ];
}

const GB_CONTENT_ID_RE = /[?&]id=([^&]+)/;

/**
 * Acepta tanto una URL de `books/content?id=…` como la `imageLinks.thumbnail` que devuelve la
 * API de búsqueda (`.../books?id=…&...`): en ambas el `id` del volumen va en el parámetro `id`.
 * `zoom=0` suele ser el original y `zoom=1` la miniatura de 128 px con `edge=curl`; se recorren
 * 0→4→3→2 porque `zoom=0` a veces es el reemplazo "image not available" (research.md E5/E6) y la
 * primera candidata válida gana en `store-cover.ts`, sin comparar tamaños entre sí.
 */
function googleBooksCandidates(origin: string): string[] {
  const id = GB_CONTENT_ID_RE.exec(origin)?.[1];
  if (!id) return [];
  return [0, 4, 3, 2].map(
    (zoom) => `https://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=${zoom}`
  );
}
