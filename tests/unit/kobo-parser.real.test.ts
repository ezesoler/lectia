// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKobo } from "@/lib/import/kobo-parser";

// Archivo real del usuario (no versionado). Sin él la suite se omite, como en CI.
const REAL = resolve(__dirname, "../../docs/files imports/KoboReader.sqlite");

describe.skipIf(!existsSync(REAL))("parseKobo — KoboReader.sqlite real", () => {
  it("504 válidas (501 subrayados + 3 notas), 15 descartadas y 9 libros", async () => {
    const r = await parseKobo(new Uint8Array(readFileSync(REAL)));

    expect(r.entries).toHaveLength(504);
    expect(r.entries.filter((e) => e.kind === "note")).toHaveLength(3);
    expect(r.discarded).toBe(15);
    expect(r.discardBreakdown).toEqual({ bookmark_no_text: 12, empty_text: 3 });
    expect(r.booksCount).toBe(9);
    expect(r.entries.length + r.discarded).toBe(519);
  });

  it("las notas traen el texto de Annotation", async () => {
    const r = await parseKobo(new Uint8Array(readFileSync(REAL)));
    const notes = r.entries.filter((e) => e.kind === "note");
    expect(notes.every((n) => n.text.trim().length > 0)).toBe(true);
  });
});
