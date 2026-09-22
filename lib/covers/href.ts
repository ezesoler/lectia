/** URL propia de la portada de un libro del catálogo. Nunca usar `cover_origin_url` para mostrar. */
export function coverHref(catalogId: string): string {
  return `/api/covers/${catalogId}`;
}
