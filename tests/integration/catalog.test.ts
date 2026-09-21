import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogStore } from "@/lib/enrichment/catalog";
import { enrichImportBooks } from "@/lib/enrichment/enrich-import";
import type { ImportedBook } from "@/lib/import/run-import";
import { adminClient, createTestUser, deleteTestUser, hasSupabase, importFile, type TestUser } from "./helpers";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures", name)));

/** La URL codifica los espacios como '+': se normaliza antes de buscar texto en ella. */
const decoded = (url: string) => decodeURIComponent(url.replace(/\+/g, " "));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Open Library sólo "conoce" Hábitos atómicos; el resto no devuelve resultados. */
function fakeApis() {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("openlibrary.org") && decoded(url).includes("Hábitos atómicos")) {
      return json({
        docs: [
          {
            title: "Hábitos atómicos",
            author_name: ["James Clear"],
            cover_i: 777,
            number_of_pages_median: 320,
            subject: ["Autoayuda"],
          },
        ],
      });
    }
    return json({ docs: [], items: [] });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

const noSleep = { sleep: async () => undefined, schedule: <T>(task: () => Promise<T>) => task() };

describe.skipIf(!hasSupabase)("book_catalog y enriquecimiento (FR-014..019, FR-027)", () => {
  let user: TestUser;
  const admin = adminClient();

  beforeEach(async () => {
    user = await createTestUser("catalog");
    await admin.from("book_catalog").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  });
  afterEach(async () => {
    await deleteTestUser(user);
    await admin.from("book_catalog").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  });

  it("un usuario autenticado lee el catálogo pero no puede escribirlo", async () => {
    await createCatalogStore(admin).save({
      isbn: null, title: "X", author: "Y", title_key: "x", author_key: "y",
      cover_url: null, category: "Cat", pages: null, sources: ["open_library"],
    });
    const { data } = await user.client.from("book_catalog").select("title");
    expect(data).toHaveLength(1);

    const insert = await user.client.from("book_catalog").insert({
      title: "Falso", author: "Nadie", title_key: "falso", author_key: "nadie", sources: ["open_library"],
    });
    expect(insert.error).not.toBeNull();
    const update = await user.client.from("book_catalog").update({ title: "Hack" }).eq("title_key", "x").select("id");
    expect(update.data ?? []).toHaveLength(0);
    const del = await user.client.from("book_catalog").delete().eq("title_key", "x").select("id");
    expect(del.data ?? []).toHaveLength(0);
  });

  it("sources vacío o inválido lo rechazan el store y el check de la base (FR-017)", async () => {
    const store = createCatalogStore(admin);
    const base = { isbn: null, title: "X", author: "Y", title_key: "x", author_key: "y", cover_url: null, category: null, pages: null };
    await expect(store.save({ ...base, sources: [] })).rejects.toThrow();
    const invalid = await admin.from("book_catalog").insert({ ...base, sources: ["mi_api"] });
    expect(invalid.error).not.toBeNull();
    const empty = await admin.from("book_catalog").insert({ ...base, sources: [] });
    expect(empty.error).not.toBeNull();
  });

  it("dos guardados del mismo libro convergen en una sola fila (índice único)", async () => {
    const store = createCatalogStore(admin);
    const entry = {
      isbn: "9780735211292", title: "Atomic Habits", author: "James Clear", title_key: "atomic habits",
      author_key: "james clear", cover_url: null, category: null, pages: 320, sources: ["open_library" as const],
    };
    const [a, b] = await Promise.all([store.save(entry), store.save(entry)]);
    expect(a).toBe(b);
    expect(await store.find({ isbn: "9780735211292", titleKey: "otro", authorKey: "otro" })).toMatchObject({ id: a });
    expect(await store.find({ titleKey: "atomic habits", authorKey: "james clear" })).toMatchObject({ id: a });
  });

  it("tras el done, enriquece los libros conocidos; el resto queda sin catalog_id pero guardado (FR-018/FR-019)", async () => {
    const { row, outcome } = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    // La importación ya está `done` ANTES de tocar ninguna API: no espera al enriquecimiento
    expect(row["state"]).toBe("done");
    expect(outcome.books).toHaveLength(4);

    const { fetchImpl } = fakeApis();
    const summary = await enrichImportBooks({
      userId: user.id,
      db: user.client,
      books: outcome.books,
      deps: { catalog: createCatalogStore(admin), fetchImpl, ...noSleep },
    });
    expect(summary).toMatchObject({ enriched: 1, not_found: 3, failed: 0 });

    const { data: books } = await user.client.from("books").select("title_key, catalog_id");
    expect(books).toHaveLength(4); // ningún libro se pierde por no encontrarse
    const linked = books!.filter((b) => b.catalog_id !== null);
    expect(linked.map((b) => b.title_key)).toEqual(["habitos atomicos"]);

    const { data: catalog } = await admin.from("book_catalog").select("*");
    expect(catalog).toHaveLength(1); // sin fila para los libros que ninguna API conoce
    expect(catalog![0]).toMatchObject({
      cover_url: "https://covers.openlibrary.org/b/id/777-L.jpg",
      category: "Autoayuda",
      pages: 320,
      sources: ["open_library"],
    });
  });

  it("un libro ya enlazado no vuelve a consultar las APIs; otro usuario reutiliza el catálogo", async () => {
    const first = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    const one = fakeApis();
    const deps = (f: typeof fetch) => ({ catalog: createCatalogStore(admin), fetchImpl: f, ...noSleep });
    await enrichImportBooks({ userId: user.id, db: user.client, books: first.outcome.books, deps: deps(one.fetchImpl) });

    // Reimportación del mismo usuario: todo lo enlazado se salta; sólo se reintentan los no encontrados
    const again = fakeApis();
    const summary = await enrichImportBooks({
      userId: user.id, db: user.client, books: first.outcome.books, deps: deps(again.fetchImpl),
    });
    expect(summary.skipped).toBe(1);
    expect(again.urls.some((u) => decoded(u).includes("Hábitos atómicos"))).toBe(false);

    // Otro usuario con el mismo libro: acierto en el catálogo compartido, sin llamar a ninguna API
    const other = await createTestUser("catalog-b");
    try {
      const imp = await importFile(other, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
      const none = fakeApis();
      const s = await enrichImportBooks({
        userId: other.id, db: other.client, books: imp.outcome.books, deps: deps(none.fetchImpl),
      });
      expect(s.catalog_hit).toBe(1);
      expect(none.urls.some((u) => decoded(u).includes("Hábitos atómicos"))).toBe(false);
      const { data } = await other.client.from("books").select("catalog_id").eq("title_key", "habitos atomicos");
      expect(data![0]!.catalog_id).not.toBeNull();
    } finally {
      await deleteTestUser(other);
    }
  });

  it("un fallo de las APIs no rompe nada: los libros se guardan igual", async () => {
    const { outcome } = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    const down = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const summary = await enrichImportBooks({
      userId: user.id, db: user.client, books: outcome.books,
      deps: { catalog: createCatalogStore(admin), fetchImpl: down, ...noSleep },
    });
    expect(summary).toMatchObject({ not_found: 4, failed: 0 });
    const { data: books } = await user.client.from("books").select("id");
    expect(books).toHaveLength(4);
    const { data: catalog } = await admin.from("book_catalog").select("id");
    expect(catalog).toHaveLength(0);
  });

  it("sin presupuesto de tiempo no se consulta nada y el resto se reintenta en la próxima importación", async () => {
    const { outcome } = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    const { fetchImpl } = fakeApis();
    const books: ImportedBook[] = outcome.books;
    const summary = await enrichImportBooks({
      userId: user.id, db: user.client, books, budgetMs: -1,
      deps: { catalog: createCatalogStore(admin), fetchImpl, ...noSleep },
    });
    expect(summary.skipped).toBe(4);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
