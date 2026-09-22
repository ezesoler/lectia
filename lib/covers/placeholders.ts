/**
 * Huellas de imágenes de "portada no disponible" observadas en producción (research.md E5,
 * feature 004): Google Books las devuelve con `200` y a veces con tamaño normal, no sólo como
 * miniatura, así que el mínimo de resolución (FR-009) no alcanza para descartarlas.
 */
export const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "3efa8c43e5b4348f303a528c81adf435f0111ea752fe9f0f6241478b60987fa6", // Google Books, zoom=0, 575×750
  "e3f8c414b288cbdf4e6d1e00eb6d3826157d10a5b5628b9318f726ea490eca12", // Google Books, zoom=1, 128×170
]);

export function isKnownPlaceholder(sha256: string): boolean {
  return KNOWN_PLACEHOLDERS.has(sha256);
}

/**
 * Heurística de reserva para reemplazos aún no catalogados: una portada real tiene bastante
 * detalle (texto, ilustración); un "image not available" es casi plano. El reemplazo conocido de
 * 575×750×9103 B da ~0,021 bytes/píxel; una portada real ronda 0,10–0,20. Umbral con margen.
 */
export const MIN_BYTES_PER_PIXEL = 0.03;

export function isNearEmpty(bytes: number, width: number, height: number): boolean {
  const pixels = width * height;
  if (pixels <= 0) return true;
  return bytes / pixels < MIN_BYTES_PER_PIXEL;
}
