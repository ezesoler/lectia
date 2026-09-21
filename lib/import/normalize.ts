import { createHash } from "node:crypto";
import type { NoteKind } from "./types";

/**
 * Clave de deduplicación: minúsculas, sin puntuación y sin diacríticos **sólo sobre letras
 * latinas**. Las marcas combinantes de otros alfabetos (dakuten japonesa, vocales árabes o
 * devanagari) se conservan: quitarlas cambia el significado y provoca colisiones.
 */
export function foldLatin(s: string): string {
  return s
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC");
}

export function normalize(s: string): string {
  return foldLatin(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildKeys(title: string, author: string): { titleKey: string; authorKey: string } {
  return { titleKey: normalize(title), authorKey: normalize(author) };
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/**
 * Kindle separa varios autores con `;` (a veces sin espacio) y suele escribir cada uno como
 * `Apellido, Nombre`. Se devuelve `Nombre Apellido, Nombre2 Apellido2`, que es el orden que
 * usa Kobo; sin esto el mismo libro importado desde los dos orígenes no se fusiona.
 */
export function canonicalizeKindleAuthor(raw: string): string {
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const pieces = part.split(",").map((p) => p.trim());
      const [last, first] = pieces;
      if (pieces.length === 2 && last && first && !NAME_SUFFIX.test(first)) {
        return `${first} ${last}`;
      }
      return part;
    })
    .join(", ");
}

export interface HashInput {
  titleKey: string;
  authorKey: string;
  kind: NoteKind;
  textKey: string;
  location: string;
}

/**
 * SHA-256 (hex) de título, autor, tipo, texto y ubicación normalizados. El separador U+001F
 * evita la colisión por concatenación ambigua y `kind` evita que una nota con el mismo texto
 * y ubicación que un subrayado se pierda (FR-009).
 */
export function hashHighlight(input: HashInput): string {
  return createHash("sha256")
    .update(
      [input.titleKey, input.authorKey, input.kind, input.textKey, input.location].join("\u001f")
    )
    .digest("hex");
}
