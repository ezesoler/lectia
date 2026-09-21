import { buildKoboDb, HABITOS_VOLUME, JOBS_VOLUME } from "./kobo-builder";

const encode = (s: string) => new TextEncoder().encode(s);

/** My Clippings.txt sintético con `n` resaltados válidos y distintos, repartidos en 40 libros. */
export function bigClippings(n: number): Uint8Array {
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(
      `Libro ${i % 40} (Autor ${i % 40})\r\n- Your Highlight on page ${i} | location ${i}-${i + 1} | Added on Monday, 3 March 2025 10:23:45 AM\r\n\r\nFrase número ${i} de prueba para medir el rendimiento de la importación.\r\n==========\r\n`
    );
  }
  return encode(parts.join(""));
}

/** KoboReader.sqlite sintético con `n` subrayados válidos y distintos (2 libros). */
export async function bigKobo(n: number): Promise<Uint8Array> {
  const rows = Array.from({ length: n }, (_, i) => [
    i % 2 === 0 ? HABITOS_VOLUME : JOBS_VOLUME,
    "OEBPS/Text/capitulo.xhtml",
    `span#kobo\.${i}\.1`,
    0,
    i + 10,
    `Subrayado número ${i} de un libro de Kobo para medir el rendimiento.`,
    "",
    "2026-03-05T16:13:34.709",
    "highlight",
  ]) as Parameters<typeof buildKoboDb>[0];
  return buildKoboDb(rows);
}
