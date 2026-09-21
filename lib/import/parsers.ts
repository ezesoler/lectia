import { parseClippings } from "./kindle-parser";
import { parseKobo } from "./kobo-parser";
import type { ImportSource, ParserFn } from "./types";

/** Registro de parsers por origen. Cada uno recibe el contenido crudo del archivo. */
export const parsers: Record<ImportSource, ParserFn> = {
  kindle: (bytes) => parseClippings(new TextDecoder("utf-8").decode(bytes)),
  kobo: parseKobo,
};
