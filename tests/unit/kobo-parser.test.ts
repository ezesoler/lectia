// @vitest-environment node
import { describe, expect, it } from "vitest";
import { KoboFileError } from "@/lib/import/errors";
import { parseKobo } from "@/lib/import/kobo-parser";
import {
  buildKoboCorrupt,
  buildKoboDb,
  buildKoboEmpty,
  buildKoboNoSchema,
  HABITOS_VOLUME,
} from "../fixtures/kobo-builder";

async function expectKoboError(bytes: Uint8Array, code: string) {
  await expect(parseKobo(bytes)).rejects.toMatchObject({ name: "KoboFileError", code });
}

describe("parseKobo — esquema real (fixture sintético)", () => {
  it("mapea libros y anotaciones: 4 válidas, 4 descartadas, 2 libros", async () => {
    const r = await parseKobo(await buildKoboDb());

    expect(r.entries).toHaveLength(4);
    expect(r.discarded).toBe(4);
    expect(r.booksCount).toBe(2);
    expect(r.entries.length + r.discarded).toBe(8);
  });

  it("descarta markup/dogear (bookmark_no_text), texto vacío y libros huérfanos, con motivo", async () => {
    const r = await parseKobo(await buildKoboDb());
    expect(r.discardBreakdown).toEqual({
      bookmark_no_text: 2,
      empty_text: 1,
      orphan_volume: 1,
    });
  });

  it("una nota usa Annotation como texto (Text es el fragmento anclado)", async () => {
    const r = await parseKobo(await buildKoboDb());
    const note = r.entries.find((e) => e.kind === "note");
    expect(note?.text).toBe("Interesante concepto como eje de una mirada nueva.");
    expect(r.entries.some((e) => e.text.includes("Fragmento anclado"))).toBe(false);
  });

  it("location = StartContainerPath:StartOffset-EndOffset y capítulo de content", async () => {
    const r = await parseKobo(await buildKoboDb());
    const first = r.entries[0]!;
    expect(first.location).toBe("span#kobo\\.2\\.1:0-13");
    expect(first.chapter).toBe("Capítulo 10");
    // el libro de Jobs no tiene fila de capítulo: chapter ausente
    expect(r.entries.find((e) => e.title.startsWith("Steve Jobs"))?.chapter).toBeUndefined();
  });

  it("título y autor salen de content (ContentType como texto '6'); fecha ISO interpretada como UTC", async () => {
    const r = await parseKobo(await buildKoboDb());
    expect(r.entries[0]).toMatchObject({
      title: "Hábitos atómicos",
      author: "James Clear",
      highlightedAt: "2026-03-05T16:13:34.709Z",
    });
    expect(r.entries[0]!.isbn).toBeUndefined();
  });

  it("devuelve el ISBN cuando el libro lo trae", async () => {
    const SQL = await (await import("sql.js")).default();
    const db = new SQL.Database(await buildKoboDb());
    db.run("update content set ISBN = '9780735211292' where ContentID = ?", [HABITOS_VOLUME]);
    const bytes = db.export();
    db.close();
    const r = await parseKobo(bytes);
    expect(r.entries.find((e) => e.title === "Hábitos atómicos")?.isbn).toBe("9780735211292");
  });
});

describe("parseKobo — errores tipados", () => {
  it("archivo que no es SQLite → corrupt (no puede abrirse)", async () => {
    await expectKoboError(new TextEncoder().encode("esto no es sqlite"), "corrupt");
  });

  it("SQLite de otro esquema → unsupported_schema", async () => {
    await expectKoboError(await buildKoboNoSchema(), "unsupported_schema");
  });

  it("esquema correcto sin anotaciones → empty", async () => {
    await expectKoboError(await buildKoboEmpty(), "empty");
  });

  it("archivo truncado → corrupt", async () => {
    await expectKoboError(await buildKoboCorrupt(), "corrupt");
  });

  it("los errores son instancias de KoboFileError", async () => {
    await expect(parseKobo(await buildKoboEmpty())).rejects.toBeInstanceOf(KoboFileError);
  });
});
