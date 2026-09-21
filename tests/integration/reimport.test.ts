import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser, hasSupabase, importFile, type TestUser } from "./helpers";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures", name)));
const encode = (s: string) => new TextEncoder().encode(s);
const REAL_KINDLE = resolve(__dirname, "../../docs/files imports/My Clippings.txt");
const REAL_KOBO = resolve(__dirname, "../../docs/files imports/KoboReader.sqlite");

async function count(user: TestUser, table: "highlights" | "books") {
  const { count: n } = await user.client.from(table).select("id", { count: "exact", head: true });
  return n ?? 0;
}

describe.skipIf(!hasSupabase)("reimportación idempotente (US5, SC-003)", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser("reimport");
  });
  afterEach(async () => {
    await deleteTestUser(user);
  });

  it("el mismo archivo dos veces: cero nuevos, todos duplicados y la biblioteca no cambia", async () => {
    const first = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    expect(first.row).toMatchObject({ state: "done", highlights_new: 8, highlights_dup: 0 });
    const before = { highlights: await count(user, "highlights"), books: await count(user, "books") };

    const second = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    expect(second.row).toMatchObject({ state: "done", highlights_new: 0, highlights_dup: 8, discarded: 2 });

    expect({ highlights: await count(user, "highlights"), books: await count(user, "books") }).toEqual(before);
  });

  it("una versión con 10 resaltados nuevos: sólo esos 10 son nuevos (US5-1)", async () => {
    await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    const updated = await importFile(user, "kindle", fixture("clippings-es-plus10.txt"), "My Clippings.txt");

    expect(updated.row).toMatchObject({ state: "done", highlights_new: 10, highlights_dup: 8 });
    expect(await count(user, "highlights")).toBe(18);
    expect(await count(user, "books")).toBe(4);
  });

  it("el mismo texto en otra ubicación se guarda como un resaltado distinto", async () => {
    const entry = (loc: string) =>
      `Libro (Autor)\r\n- Your Highlight on page 1 | location ${loc} | Added on Monday, 3 March 2025 10:23:45 AM\r\n\r\nUna frase repetida en dos lugares\r\n==========\r\n`;
    await importFile(user, "kindle", encode(entry("10-11")), "My Clippings.txt");
    const second = await importFile(user, "kindle", encode(entry("10-11") + entry("90-91")), "My Clippings.txt");
    expect(second.row).toMatchObject({ highlights_new: 1, highlights_dup: 1 });
    expect(await count(user, "highlights")).toBe(2);
  });

  it("el mismo resaltado importado desde Kindle y Kobo (ubicaciones distintas) no se deduplica", async () => {
    // Limitación documentada: la clave incluye la ubicación, y cada lector usa la suya
    await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    await importFile(user, "kobo", fixture("kobo-valid.sqlite"), "KoboReader.sqlite");
    const { data } = await user.client
      .from("highlights")
      .select("source")
      .eq("text", "Los hábitos son el interés compuesto de la superación personal.");
    expect(data!.map((h) => h.source).sort()).toEqual(["kindle", "kobo"]);
  });

  it("una nota y un subrayado con el mismo texto y ubicación conviven", async () => {
    const meta = (kind: string) =>
      `- Your ${kind} on page 1 | location 5 | Added on Monday, 3 March 2025 10:23:45 AM`;
    const text = `Libro (Autor)\r\n${meta("Highlight")}\r\n\r\nMismo texto\r\n==========\r\nLibro (Autor)\r\n${meta("Note")}\r\n\r\nMismo texto\r\n==========\r\n`;
    const { row } = await importFile(user, "kindle", encode(text), "My Clippings.txt");
    expect(row).toMatchObject({ highlights_new: 2, highlights_dup: 0 });
  });
});

describe.skipIf(!hasSupabase || !existsSync(REAL_KINDLE) || !existsSync(REAL_KOBO))(
  "archivos reales del usuario: importar y reimportar (SC-003, SC-004)",
  () => {
    let user: TestUser;

    beforeEach(async () => {
      user = await createTestUser("real");
    });
    afterEach(async () => {
      await deleteTestUser(user);
    });

    it("Kindle: 214 válidos y 1 descartado; al reimportar no cambia nada", async () => {
      const bytes = new Uint8Array(readFileSync(REAL_KINDLE));
      const first = await importFile(user, "kindle", bytes, "My Clippings.txt");
      expect(first.row).toMatchObject({ state: "done", discarded: 1, books_count: 8 });
      // Los dos textos repetidos dentro del archivo cuentan como duplicados ya en la primera pasada
      expect((first.row["highlights_new"] as number) + (first.row["highlights_dup"] as number)).toBe(214);
      const stored = await count(user, "highlights");
      expect(stored).toBe(first.row["highlights_new"]);

      const second = await importFile(user, "kindle", bytes, "My Clippings.txt");
      expect(second.row).toMatchObject({ highlights_new: 0, highlights_dup: 214 });
      expect(await count(user, "highlights")).toBe(stored);
    });

    it("Kobo: 504 válidos, 15 descartados, 9 libros; al reimportar no cambia nada", async () => {
      const bytes = new Uint8Array(readFileSync(REAL_KOBO));
      const first = await importFile(user, "kobo", bytes, "KoboReader.sqlite");
      expect(first.row).toMatchObject({ state: "done", discarded: 15, books_count: 9 });
      expect((first.row["highlights_new"] as number) + (first.row["highlights_dup"] as number)).toBe(504);
      const stored = await count(user, "highlights");

      const second = await importFile(user, "kobo", bytes, "KoboReader.sqlite");
      expect(second.row).toMatchObject({ highlights_new: 0, highlights_dup: 504 });
      expect(await count(user, "highlights")).toBe(stored);
    });
  }
);
