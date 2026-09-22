// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, RETRY_WINDOW_MS, storeCover } from "@/lib/covers/store-cover";
import type { CatalogCoverDb, CatalogCoverRow, CoverMeta, CoverStore } from "@/lib/covers/types";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures/covers", name)));

function row(over: Partial<CatalogCoverRow> = {}): CatalogCoverRow {
  return {
    id: "book-1",
    cover_origin_url: "https://covers.openlibrary.org/b/id/999-L.jpg?default=false",
    cover_source: "open_library",
    cover_status: "pending",
    cover_attempts: 0,
    cover_checked_at: null,
    ...over,
  };
}

function fakeDb() {
  const calls: { markStored: CoverMeta[]; markPending: number[]; markUnavailable: number } = {
    markStored: [],
    markPending: [],
    markUnavailable: 0,
  };
  const db: CatalogCoverDb = {
    markStored: vi.fn(async (_id, meta) => void calls.markStored.push(meta)),
    markPending: vi.fn(async (_id, attempts) => void calls.markPending.push(attempts)),
    markUnavailable: vi.fn(async () => void (calls.markUnavailable += 1)),
  };
  return { db, calls };
}

function fakeBucket(uploadResult: "created" | "exists" = "created", existingBytes?: Uint8Array) {
  const uploaded: { id: string; bytes: Uint8Array; contentType: string }[] = [];
  const bucket: CoverStore = {
    upload: vi.fn(async (id, bytes, contentType) => {
      uploaded.push({ id, bytes, contentType });
      return uploadResult;
    }),
    download: vi.fn(async () => existingBytes ?? null),
  };
  return { bucket, uploaded };
}

function fetchReturning(routes: (() => Response | Promise<Response>)[]) {
  let call = 0;
  return vi.fn(async () => {
    const route = routes[Math.min(call, routes.length - 1)]!;
    call += 1;
    return route();
  }) as unknown as typeof fetch;
}

const okImage = (bytes: Uint8Array) => new Response(bytes as BodyInit, { status: 200, headers: { "Content-Type": "image/jpeg" } });
const notFound = () => new Response(null, { status: 404 });
const serverError = () => new Response(null, { status: 500 });

const noSleep = { sleep: async () => undefined };

describe("storeCover — casos ya terminados o sin nada que hacer", () => {
  it("cover_status='stored' → skipped, sin tocar Storage ni la base", async () => {
    const { db } = fakeDb();
    const { bucket } = fakeBucket();
    const fetchImpl = vi.fn();
    const r = await storeCover(row({ cover_status: "stored" }), { bucket, db, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.markStored).not.toHaveBeenCalled();
  });

  it("sin cover_origin_url (estado 'none') → skipped, sin escrituras", async () => {
    const { db } = fakeDb();
    const { bucket } = fakeBucket();
    const r = await storeCover(row({ cover_status: "none", cover_origin_url: null, cover_source: null }), {
      bucket,
      db,
    });
    expect(r).toBe("skipped");
    expect(db.markUnavailable).not.toHaveBeenCalled();
  });

  it("cover_status='unavailable' → skipped (terminal, no reintenta solo)", async () => {
    const { db } = fakeDb();
    const { bucket } = fakeBucket();
    const fetchImpl = vi.fn();
    const r = await storeCover(row({ cover_status: "unavailable" }), { bucket, db, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pending con 5 intentos ya agotados → skipped", async () => {
    const { db } = fakeDb();
    const { bucket } = fakeBucket();
    const fetchImpl = vi.fn();
    const r = await storeCover(row({ cover_attempts: MAX_ATTEMPTS }), { bucket, db, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pending revisado hace menos de 1 hora → skipped", async () => {
    const { db } = fakeDb();
    const { bucket } = fakeBucket();
    const fetchImpl = vi.fn();
    const now = () => Date.parse("2026-09-22T12:00:00Z");
    const r = await storeCover(row({ cover_checked_at: "2026-09-22T11:30:00Z" }), {
      bucket,
      db,
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pending revisado hace más de 1 hora sí se reintenta", async () => {
    const { db } = fakeDb();
    const { bucket } = fakeBucket();
    const now = () => Date.parse("2026-09-22T12:00:00Z");
    const checkedAt = new Date(now() - RETRY_WINDOW_MS - 1000).toISOString();
    const fetchImpl = fetchReturning([() => okImage(fixture("valid.jpg"))]);
    const r = await storeCover(row({ cover_checked_at: checkedAt }), { bucket, db, now, fetchImpl, ...noSleep });
    expect(r).toBe("stored");
  });
});

describe("storeCover — descarga y guarda", () => {
  it("con la mejor candidata válida, sube el archivo y marca 'stored'", async () => {
    const { db, calls } = fakeDb();
    const { bucket, uploaded } = fakeBucket("created");
    const bytes = fixture("valid.jpg");
    const fetchImpl = fetchReturning([() => okImage(bytes)]);

    const r = await storeCover(row(), { bucket, db, fetchImpl, ...noSleep });

    expect(r).toBe("stored");
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ id: "book-1", contentType: "image/jpeg" });
    expect(calls.markStored[0]).toMatchObject({
      path: "book-1",
      format: "jpeg",
      width: 400,
      height: 600,
      source: "open_library",
    });
  });

  it("si el objeto ya existe (carrera con otra importación), adopta lo existente sin volver a subir", async () => {
    const { db, calls } = fakeDb();
    const existing = fixture("valid.png");
    const { bucket, uploaded } = fakeBucket("exists", existing);
    const fetchImpl = fetchReturning([() => okImage(fixture("valid.jpg"))]);

    const r = await storeCover(row(), { bucket, db, fetchImpl, ...noSleep });

    expect(r).toBe("stored");
    expect(uploaded).toHaveLength(1); // se intentó subir una vez, pero no se sube dos veces
    // los metadatos guardados son los del objeto YA existente, no los de la descarga descartada
    expect(calls.markStored[0]).toMatchObject({ format: "png", width: 400, height: 600 });
  });

  it("todas las candidatas ausentes (404) → unavailable, sin tocar cover_attempts (FR-010)", async () => {
    const { db, calls } = fakeDb();
    const { bucket } = fakeBucket();
    const fetchImpl = fetchReturning([notFound, notFound]);

    const r = await storeCover(row(), { bucket, db, fetchImpl, ...noSleep });

    expect(r).toBe("unavailable");
    expect(calls.markUnavailable).toBe(1);
    expect(db.markPending).not.toHaveBeenCalled(); // markUnavailable no toca attempts: quedan como estaban
  });

  it("con cover_checked_at de hace 5 minutos (dentro de la ventana de 1 h) → skipped", async () => {
    const { db } = fakeDb();
    const { bucket } = fakeBucket();
    const fetchImpl = vi.fn();
    const now = () => Date.parse("2026-09-22T12:00:00Z");
    const r = await storeCover(row({ cover_checked_at: "2026-09-22T11:55:00Z" }), {
      bucket,
      db,
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sin candidatas (origen irreconocible) → unavailable sin llamar a fetch", async () => {
    const { db, calls } = fakeDb();
    const { bucket } = fakeBucket();
    const fetchImpl = vi.fn();
    const r = await storeCover(row({ cover_origin_url: "https://example.com/no-id-aqui" }), {
      bucket,
      db,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls.markUnavailable).toBe(1);
  });

  it("una candidata inválida (reemplazo) seguida de una válida: guarda la segunda, no la primera", async () => {
    const { db, calls } = fakeDb();
    const { bucket, uploaded } = fakeBucket("created");
    const fetchImpl = fetchReturning([
      () => okImage(fixture("google-placeholder-575x750.png")), // primera candidata: reemplazo
      () => okImage(fixture("valid.jpg")), // segunda: válida
    ]);

    const r = await storeCover(row({ cover_source: "google_books", cover_origin_url: "https://books.google.com/books/content?id=X&zoom=1" }), {
      bucket,
      db,
      fetchImpl,
      ...noSleep,
    });

    expect(r).toBe("stored");
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.contentType).toBe("image/jpeg"); // la segunda candidata, no el PNG del reemplazo
    expect(calls.markStored[0]).toMatchObject({ format: "jpeg", width: 400, height: 600 });
  });

  it("un fallo transitorio corta el recorrido (no sigue probando peores candidatas) y marca 'pending'", async () => {
    const { db, calls } = fakeDb();
    const { bucket } = fakeBucket();
    // La primera candidata falla de forma transitoria las 4 veces (1 intento + 3 reintentos)
    const fetchImpl = fetchReturning([serverError, serverError, serverError, serverError]);

    const r = await storeCover(row(), { bucket, db, fetchImpl, ...noSleep });

    expect(r).toBe("pending");
    expect(calls.markPending).toEqual([1]);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // nunca llegó a probar la segunda candidata
  });
});
