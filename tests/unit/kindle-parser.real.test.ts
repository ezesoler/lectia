// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClippings } from "@/lib/import/kindle-parser";

// Archivo real del usuario (no versionado). Sin él la suite se omite, como en CI.
const REAL = resolve(__dirname, "../../docs/files imports/My Clippings.txt");

describe.skipIf(!existsSync(REAL))("parseClippings — My Clippings.txt real", () => {
  const result = parseClippings(readFileSync(REAL, "utf-8"));

  it("214 resaltados válidos, 1 descartado y 8 libros", () => {
    expect(result.entries).toHaveLength(214);
    expect(result.discarded).toBe(1);
    expect(result.discardBreakdown).toEqual({ empty_text: 1 });
    expect(result.booksCount).toBe(8);
    expect(result.entries.length + result.discarded).toBe(215);
  });

  it("los autores con ';' sin espacio se separan bien", () => {
    const simpsons = result.entries.find((e) => e.title.startsWith("Los Simpson"));
    expect(simpsons?.author).toBe("William Irwin, Mark T. Conard, Aeon J. Skoble");
  });
});
