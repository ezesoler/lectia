// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichBook, isAcceptableMatch, pickPages } from "@/lib/enrichment/enrich-book";
import { googleBooksUrl } from "@/lib/enrichment/google-books";
import { openLibraryUrl } from "@/lib/enrichment/open-library";
import type { ApiCandidate, BookQuery, CatalogEntry, CatalogStore, NewCatalogEntry } from "@/lib/enrichment/types";
import type { CatalogCoverDb, CoverStore } from "@/lib/covers/types";
import { buildKeys } from "@/lib/import/normalize";

function query(title: string, author: string, isbn?: string): BookQuery {
  const { titleKey, authorKey } = buildKeys(title, author);
  return { title, author, titleKey, authorKey, ...(isbn ? { isbn } : {}) };
}

const HABITOS = query("Hábitos atómicos", "James Clear");

function fakeCatalog(existing: CatalogEntry | null = null) {
  const saved: NewCatalogEntry[] = [];
  const store: CatalogStore = {
    find: vi.fn(async () => existing),
    save: vi.fn(async (entry: NewCatalogEntry) => {
      saved.push(entry);
      return "cat-1";
    }),
  };
  return { store, saved };
}

const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });

const olDoc = (over: Record<string, unknown> = {}) => ({
  docs: [
    {
      title: "Hábitos atómicos",
      author_name: ["James Clear"],
      cover_i: 12345,
      number_of_pages_median: 320,
      subject: ["Self-help"],
      ...over,
    },
  ],
});
const gbItem = (over: Record<string, unknown> = {}) => ({
  items: [
    {
      volumeInfo: {
        title: "Hábitos atómicos",
        authors: ["James Clear"],
        categories: ["Self-Help / General"],
        pageCount: 306,
        imageLinks: { thumbnail: "http://books.google.com/cover.jpg" },
        ...over,
      },
    },
  ],
});

/**
 * Fake de lib/covers/*: estas pruebas cubren la fusión de metadatos, no el guardado de
 * portadas (eso lo cubre tests/unit/store-cover.test.ts). markUnavailable/markStored no
 * tocan nada real.
 */
function fakeCovers() {
  const bucket: CoverStore = {
    upload: vi.fn(async (): Promise<"created" | "exists"> => "created"),
    download: vi.fn(async () => null),
  };
  const db: CatalogCoverDb = {
    markStored: vi.fn(async () => undefined),
    markPending: vi.fn(async () => undefined),
    markUnavailable: vi.fn(async () => undefined),
  };
  return { bucket, db };
}

type Route = (url: string) => Response | Promise<Response>;
function makeDeps(routes: { ol?: Route; gb?: Route }, catalog: CatalogStore) {
  const sleeps: number[] = [];
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const host = new URL(url).hostname;
    if (host === "openlibrary.org") return (routes.ol ?? (() => json({ docs: [] })))(url);
    if (host === "www.googleapis.com") return (routes.gb ?? (() => json({})))(url);
    // Descarga de portada (lib/covers/candidates.ts): sin fixture propia, "no disponible" por
    // defecto. Cubrir el guardado real es tarea de store-cover.test.ts, no de este archivo.
    if (host === "covers.openlibrary.org" || host === "books.google.com") {
      return new Response(null, { status: 404 });
    }
    throw new Error(`URL inesperada ${url}`);
  }) as unknown as typeof fetch;
  return {
    deps: {
      catalog,
      covers: fakeCovers(),
      fetchImpl,
      sleep: async (ms: number) => void sleeps.push(ms),
      schedule: <T>(task: () => Promise<T>) => task(),
    },
    sleeps,
    urls,
    fetchImpl,
  };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("enrichBook — flujo", () => {
  it("acierto en el catálogo: no llama a ninguna API", async () => {
    const { store } = fakeCatalog({ id: "cat-9" } as CatalogEntry);
    const { deps, fetchImpl } = makeDeps({}, store);

    expect(await enrichBook(HABITOS, deps)).toEqual({ status: "catalog_hit", catalogId: "cat-9", cover: "none" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Open Library completo: guarda con esa fuente y no consulta Google Books", async () => {
    const { store, saved } = fakeCatalog();
    const { deps, urls } = makeDeps({ ol: () => json(olDoc()) }, store);

    const result = await enrichBook(HABITOS, deps);

    expect(result).toEqual({ status: "enriched", catalogId: "cat-1", cover: "unavailable" });
    expect(saved[0]).toMatchObject({
      title: "Hábitos atómicos",
      title_key: "habitos atomicos",
      author_key: "james clear",
      cover_origin_url: "https://covers.openlibrary.org/b/id/12345-L.jpg",
      category: "Self-help",
      pages: 320,
      sources: ["open_library"],
    });
    expect(urls.some((u) => u.includes("googleapis.com"))).toBe(false);
  });

  it("merge: Google Books completa sólo los campos que Open Library no trajo (FR-016)", async () => {
    const { store, saved } = fakeCatalog();
    const { deps } = makeDeps(
      {
        ol: () => json(olDoc({ number_of_pages_median: undefined, subject: undefined })),
        gb: () => json(gbItem()),
      },
      store
    );

    const result = await enrichBook(HABITOS, deps);

    expect(result.status).toBe("enriched");
    expect(saved[0]).toMatchObject({
      cover_origin_url: "https://covers.openlibrary.org/b/id/12345-L.jpg", // primera API que lo provee
      category: "Self-Help / General",
      pages: 306,
    });
    expect(saved[0]!.sources.sort()).toEqual(["google_books", "open_library"]);
  });

  it("varias ediciones de una misma API: cada campo sale de la primera que lo tiene", async () => {
    const { store, saved } = fakeCatalog();
    const { deps } = makeDeps(
      {
        ol: () =>
          json({
            docs: [
              { title: "Hábitos atómicos", author_name: ["James Clear"], number_of_pages_median: 328 },
              { title: "Hábitos atómicos", author_name: ["James Clear"], cover_i: 55, subject: ["Hábitos"], number_of_pages_median: 999 },
            ],
          }),
      },
      store
    );
    await enrichBook(HABITOS, deps);
    expect(saved[0]).toMatchObject({
      pages: 328,
      cover_origin_url: "https://covers.openlibrary.org/b/id/55-L.jpg",
      category: "Hábitos",
    });
  });

  it("sin GOOGLE_BOOKS_API_KEY no consulta Google Books (evita 7 s de reintentos por libro)", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");
    const { store } = fakeCatalog();
    const { deps, urls } = makeDeps({ ol: () => json({ docs: [] }) }, store);
    expect((await enrichBook(HABITOS, deps)).status).toBe("not_found");
    expect(urls.some((u) => u.includes("googleapis.com"))).toBe(false);
  });

  it("Google Books entrega la portada por https", async () => {
    const { store, saved } = fakeCatalog();
    const { deps } = makeDeps({ gb: () => json(gbItem()) }, store);
    await enrichBook(HABITOS, deps);
    expect(saved[0]!.cover_origin_url).toBe("https://books.google.com/cover.jpg");
    expect(saved[0]!.sources).toEqual(["google_books"]);
  });

  it("datos parciales: los campos que ninguna API dio quedan en null", async () => {
    const { store, saved } = fakeCatalog();
    const { deps } = makeDeps(
      { ol: () => json(olDoc({ number_of_pages_median: undefined, subject: undefined })) },
      store
    );
    const result = await enrichBook(HABITOS, deps);
    expect(result.status).toBe("partial");
    expect(saved[0]).toMatchObject({ pages: null, category: null });
  });

  it("sin datos en ninguna API: not_found y NO se escribe en book_catalog (FR-018)", async () => {
    const { store } = fakeCatalog();
    const { deps } = makeDeps({}, store);
    expect(await enrichBook(HABITOS, deps)).toEqual({ status: "not_found", cover: "none" });
    expect(store.save).not.toHaveBeenCalled();
  });

  it("un resultado sin ninguno de los tres campos no crea una fila vacía", async () => {
    const { store } = fakeCatalog();
    const { deps } = makeDeps(
      { ol: () => json(olDoc({ cover_i: undefined, number_of_pages_median: undefined, subject: undefined })) },
      store
    );
    expect((await enrichBook(HABITOS, deps)).status).toBe("not_found");
    expect(store.save).not.toHaveBeenCalled();
  });

  it("un resultado que no es el libro pedido se rechaza en ambas APIs", async () => {
    const { store } = fakeCatalog();
    const { deps } = makeDeps(
      {
        ol: () => json(olDoc({ title: "Cocina fácil", author_name: ["Otra Persona"] })),
        gb: () => json(gbItem({ title: "Hábitos atómicos", authors: ["Alguien Distinto"] })),
      },
      store
    );
    expect((await enrichBook(HABITOS, deps)).status).toBe("not_found");
    expect(store.save).not.toHaveBeenCalled();
  });

  it("por ISBN el resultado es autoritativo", async () => {
    const { store, saved } = fakeCatalog();
    const withIsbn = query("Título distinto en el archivo", "Alguien", "9780735211292");
    const { deps, urls } = makeDeps({ ol: () => json(olDoc({ title: "Atomic Habits", author_name: ["James Clear"] })) }, store);

    expect((await enrichBook(withIsbn, deps)).status).toBe("enriched");
    expect(urls[0]).toContain("q=isbn%3A9780735211292");
    expect(saved[0]!.isbn).toBe("9780735211292");
  });

  it("nunca envía a las APIs otra cosa que título, autor e ISBN", async () => {
    const { store } = fakeCatalog();
    const { deps, urls } = makeDeps({}, store);
    await enrichBook(HABITOS, deps);
    for (const url of urls) {
      const params = new URL(url).searchParams;
      const sent = [...params.keys()].filter((k) => !["fields", "limit", "maxResults", "key"].includes(k));
      expect(sent.every((k) => ["title", "author", "q"].includes(k))).toBe(true);
    }
  });
});

describe("enrichBook — un fallo al guardar la portada nunca rompe el resultado (FR-011, US4)", () => {
  it("una excepción dentro de storeCover se atrapa: el libro sigue devolviendo su estado normal con cover:'none'", async () => {
    const { store, saved } = fakeCatalog();
    const { deps } = makeDeps({ ol: () => json(olDoc()) }, store);
    // Simula un fallo al escribir el resultado de la portada (p. ej. la base cayó justo ahí)
    (deps.covers.db.markUnavailable as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB caída")
    );

    const result = await enrichBook(HABITOS, deps);

    expect(result.status).toBe("enriched"); // el merge de metadatos no se vio afectado
    expect(result.cover).toBe("none"); // el fallo al guardar la portada se absorbe, no se propaga
    expect(saved[0]).toBeDefined(); // el catálogo sí se guardó igual
  });
});

describe("enrichBook — reintentos con backoff (FR-027)", () => {
  it("ante 503 reintenta con esperas de 1 s y 2 s y luego funciona", async () => {
    const { store } = fakeCatalog();
    let calls = 0;
    const { deps, sleeps } = makeDeps(
      { ol: () => (++calls <= 2 ? new Response(null, { status: 503 }) : json(olDoc())) },
      store
    );
    expect((await enrichBook(HABITOS, deps)).status).toBe("enriched");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("agotados los reintentos usa esperas 1 s → 2 s → 4 s y devuelve not_found", async () => {
    const { store } = fakeCatalog();
    const { deps, sleeps, fetchImpl } = makeDeps(
      { ol: () => new Response(null, { status: 500 }), gb: () => new Response(null, { status: 500 }) },
      store
    );
    expect((await enrichBook(HABITOS, deps)).status).toBe("not_found");
    // 4 intentos por API: la 1.ª espera 1 s, 2 s, 4 s; la 2.ª igual
    expect(sleeps).toEqual([1000, 2000, 4000, 1000, 2000, 4000]);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("respeta Retry-After (≤ 10 s) en un 429", async () => {
    const { store } = fakeCatalog();
    let calls = 0;
    const { deps, sleeps } = makeDeps(
      {
        ol: () =>
          ++calls === 1
            ? new Response(null, { status: 429, headers: { "Retry-After": "3" } })
            : json(olDoc()),
      },
      store
    );
    await enrichBook(HABITOS, deps);
    expect(sleeps[0]).toBe(3000);
  });

  it("ignora un Retry-After absurdo y usa el backoff normal", async () => {
    const { store } = fakeCatalog();
    let calls = 0;
    const { deps, sleeps } = makeDeps(
      {
        ol: () =>
          ++calls === 1
            ? new Response(null, { status: 429, headers: { "Retry-After": "3600" } })
            : json(olDoc()),
      },
      store
    );
    await enrichBook(HABITOS, deps);
    expect(sleeps[0]).toBe(1000);
  });

  it("un error de red también se reintenta", async () => {
    const { store } = fakeCatalog();
    let calls = 0;
    const { deps } = makeDeps(
      {
        ol: () => {
          if (++calls === 1) throw new Error("ECONNRESET");
          return json(olDoc());
        },
      },
      store
    );
    expect((await enrichBook(HABITOS, deps)).status).toBe("enriched");
  });

  it("un 404 no se reintenta", async () => {
    const { store } = fakeCatalog();
    const { deps, sleeps } = makeDeps({ ol: () => new Response(null, { status: 404 }) }, store);
    await enrichBook(HABITOS, deps);
    expect(sleeps).toEqual([]);
  });

  it("si Google Books se agota pero Open Library dio algo, se guardan los datos parciales", async () => {
    const { store, saved } = fakeCatalog();
    const { deps } = makeDeps(
      {
        ol: () => json(olDoc({ number_of_pages_median: undefined, subject: undefined })),
        gb: () => new Response(null, { status: 503 }),
      },
      store
    );
    const result = await enrichBook(HABITOS, deps);
    expect(result.status).toBe("partial");
    expect(saved[0]).toMatchObject({ sources: ["open_library"], pages: null });
  });
});

describe("pickPages — páginas robustas entre ediciones", () => {
  const withPages = (...pages: (number | undefined)[]): ApiCandidate[] =>
    pages.map((p) => ({ title: "T", authors: [], viaIsbn: false, coverSource: "open_library" as const, ...(p !== undefined ? { pages: p } : {}) }));

  it("toma la mediana y no la edición atípica (caso real: 980 / 398 / 398)", () => {
    expect(pickPages(withPages(980, 398, 398))).toBe(398);
  });

  it("con cantidad par usa la mediana inferior, que evita la edición inflada (980 / 398)", () => {
    expect(pickPages(withPages(980, 398))).toBe(398);
  });

  it("con un solo valor plausible lo usa, aunque sea chico", () => {
    expect(pickPages(withPages(52))).toBe(52);
  });

  it("ignora ceros y valores absurdos", () => {
    expect(pickPages(withPages(0, 3, 250_000, 320))).toBe(320);
    expect(pickPages(withPages(0, 3, 250_000))).toBeUndefined();
  });

  it("ignora candidatos sin páginas y devuelve undefined si no hay ninguno", () => {
    expect(pickPages(withPages(undefined, 300, undefined))).toBe(300);
    expect(pickPages(withPages(undefined))).toBeUndefined();
    expect(pickPages([])).toBeUndefined();
  });
});

describe("enrichBook — páginas", () => {
  it("guarda la mediana de las ediciones de Google Books en lugar de la primera", async () => {
    const { store, saved } = fakeCatalog();
    const gbEditions = (...pages: number[]) => ({
      items: pages.map((pageCount, i) => ({
        volumeInfo: {
          title: "Hábitos atómicos",
          authors: ["James Clear"],
          categories: i === 0 ? ["Self-Help"] : undefined,
          pageCount,
          imageLinks: i === 0 ? { thumbnail: "http://books.google.com/c.jpg" } : undefined,
        },
      })),
    });
    const { deps } = makeDeps({ gb: () => json(gbEditions(980, 398, 398)) }, store);
    await enrichBook(HABITOS, deps);
    expect(saved[0]).toMatchObject({ pages: 398, category: "Self-Help", sources: ["google_books"] });
  });

  it("una edición con páginas absurdas no llega al catálogo", async () => {
    const { store, saved } = fakeCatalog();
    const { deps } = makeDeps({ ol: () => json(olDoc({ number_of_pages_median: 2 })) }, store);
    await enrichBook(HABITOS, deps);
    expect(saved[0]!.pages).toBeNull();
  });
});

describe("isAcceptableMatch", () => {
  const cand = (title: string, authors: string[], viaIsbn = false): ApiCandidate => ({ title, authors, viaIsbn, coverSource: "open_library" });

  it("acepta un título con subtítulo si tiene al menos 2 palabras", () => {
    const q = query("Steve Jobs: Lecciones de liderazgo", "Walter Isaacson");
    expect(isAcceptableMatch(q, cand("Steve Jobs", ["Walter Isaacson"]))).toBe(true);
  });

  it("no confunde 'Dune' con 'Dune Messiah' (títulos de una palabra exigen igualdad)", () => {
    const q = query("Dune", "Frank Herbert");
    expect(isAcceptableMatch(q, cand("Dune Messiah", ["Frank Herbert"]))).toBe(false);
    expect(isAcceptableMatch(q, cand("Dune", ["Frank Herbert"]))).toBe(true);
  });

  it("exige que el autor coincida", () => {
    expect(isAcceptableMatch(HABITOS, cand("Hábitos atómicos", ["Otra Persona"]))).toBe(false);
    expect(isAcceptableMatch(HABITOS, cand("Hábitos atómicos", ["J. Clear"]))).toBe(true);
  });

  it("con autor desconocido sólo acepta un título idéntico", () => {
    const q = query("Un libro", "Autor desconocido");
    expect(isAcceptableMatch(q, cand("Un libro", ["Cualquiera"]))).toBe(true);
    expect(isAcceptableMatch(q, cand("Un libro largo de verdad", ["Cualquiera"]))).toBe(false);
  });
});

describe("URLs de las APIs", () => {
  it("Google Books agrega la clave sólo si está configurada", () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");
    expect(googleBooksUrl(HABITOS)).not.toContain("key=");
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "abc123");
    expect(googleBooksUrl(HABITOS)).toContain("key=abc123");
  });

  it("buscan por ISBN cuando lo hay y por título + autor si no", () => {
    expect(openLibraryUrl({ title: "T", author: "A", isbn: "978" })).toContain("q=isbn%3A978");
    expect(openLibraryUrl({ title: "T", author: "A" })).toContain("title=T");
    expect(decodeURIComponent(googleBooksUrl({ title: "T", author: "A" }).replace(/\+/g, " "))).toContain(
      'intitle:"T" inauthor:"A"'
    );
  });
});
