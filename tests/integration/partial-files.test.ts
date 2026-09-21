import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser, hasSupabase, importFile, type TestUser } from "./helpers";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures", name)));
const encode = (s: string) => new TextEncoder().encode(s);

async function highlightCount(user: TestUser) {
  const { count } = await user.client.from("highlights").select("id", { count: "exact", head: true });
  return count ?? 0;
}

describe.skipIf(!hasSupabase)("archivos parciales y errores de formato (US4)", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser("partial");
  });
  afterEach(async () => {
    await deleteTestUser(user);
  });

  it("10 % malformado: done, válidas guardadas y desglose de descartes", async () => {
    const { row } = await importFile(user, "kindle", fixture("clippings-broken.txt"), "My Clippings.txt");

    expect(row).toMatchObject({
      state: "done",
      error_code: null,
      highlights_new: 90,
      highlights_dup: 0,
      discarded: 10,
      entries_total: 100,
      discard_breakdown: { bookmark_no_text: 6, truncated: 2, no_title: 1, empty_text: 1 },
    });
    expect(await highlightCount(user)).toBe(90);
    // La fila de imports sólo guarda cifras y códigos: nunca texto de resaltados (Constitución VII)
    expect(JSON.stringify(row)).not.toContain("Frase válida");
  });

  it("20 % malformado (SC-005): se procesa sin error general", async () => {
    const valid = Array.from(
      { length: 80 },
      (_, i) =>
        `Libro ${i % 4} (Autor)\r\n- Your Highlight on page ${i} | location ${i} | Added on Monday, 3 March 2025 10:23:45 AM\r\n\r\nFrase ${i}\r\n==========\r\n`
    );
    const broken = Array.from({ length: 20 }, (_, i) => `Titulo cortado ${i} (Autor)\r\n==========\r\n`);
    const { row } = await importFile(user, "kindle", encode([...valid, ...broken].join("")), "My Clippings.txt");

    expect(row).toMatchObject({ state: "done", highlights_new: 80, discarded: 20 });
    expect(await highlightCount(user)).toBe(80);
  });

  it("el invariante new + dup + discarded = entries_total se cumple, también al reimportar", async () => {
    for (const file of ["clippings-broken.txt", "clippings-broken.txt", "clippings-es.txt"]) {
      const { row } = await importFile(user, "kindle", fixture(file), "My Clippings.txt");
      expect(row["state"]).toBe("done");
      expect(
        (row["highlights_new"] as number) + (row["highlights_dup"] as number) + (row["discarded"] as number)
      ).toBe(row["entries_total"]);
      expect(row["entries_done"]).toBe(row["entries_total"]);
    }
  });

  it("un archivo que no es clippings: ERR_IMPORT_4001 con detalle técnico y sin texto de resaltados", async () => {
    const { row } = await importFile(user, "kindle", fixture("clippings-not-clippings.txt"), "notas-kindle-backup.txt");

    expect(row).toMatchObject({ state: "error", error_code: "ERR_IMPORT_4001", highlights_new: 0 });
    const details = row["error_details"] as Record<string, unknown>;
    expect(details).toMatchObject({
      linesRead: 8,
      validRecords: 0,
      expected: "Título (Autor)",
      found: "# Resaltados exportados",
    });
    expect((details["found"] as string).length).toBeLessThanOrEqual(80);
    // Ninguna frase del archivo (ni del contenido subido) aparece en la fila
    expect(JSON.stringify(row)).not.toContain("interés compuesto");
    expect(row["error_message"]).toContain("No se guardó nada");
    expect(await highlightCount(user)).toBe(0);
  });

  it("todo descartado: ERR_IMPORT_4005 conservando descartes y desglose", async () => {
    const { row } = await importFile(user, "kindle", fixture("clippings-all-invalid.txt"), "My Clippings.txt");

    expect(row).toMatchObject({
      state: "error",
      error_code: "ERR_IMPORT_4005",
      discarded: 5,
      entries_total: 5,
      discard_breakdown: { truncated: 2, no_title: 1, bookmark_no_text: 1, unknown_type: 1 },
    });
    expect(await highlightCount(user)).toBe(0);
  });

  it("Kobo: SQLite vacío → 4005, otro esquema → 4004, truncado → 4003, no SQLite → 4002", async () => {
    const cases: [string, Uint8Array, string][] = [
      ["KoboReader.sqlite", fixture("kobo-empty.sqlite"), "ERR_IMPORT_4005"],
      ["KoboReader.sqlite", fixture("kobo-noschema.sqlite"), "ERR_IMPORT_4004"],
      ["KoboReader.sqlite", fixture("kobo-corrupt.sqlite"), "ERR_IMPORT_4003"],
      ["KoboReader.sqlite", encode("esto no es sqlite"), "ERR_IMPORT_4002"],
    ];
    for (const [name, bytes, code] of cases) {
      const { row } = await importFile(user, "kobo", bytes, name);
      expect(row).toMatchObject({ state: "error", error_code: code });
    }
    expect(await highlightCount(user)).toBe(0);
  });

  it("el archivo temporal se borra también en los errores", async () => {
    const { importId } = await importFile(user, "kindle", encode("no es un clippings"), "x.txt");
    const { adminClient } = await import("./helpers");
    const { data } = await adminClient().storage.from("imports").list(user.id, { search: importId });
    expect(data?.some((f) => f.name === importId)).toBeFalsy();
  });
});
