import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogCoverDb } from "@/lib/covers/catalog-cover-db";
import { createCoverStorage } from "@/lib/covers/storage";
import { storeCover } from "@/lib/covers/store-cover";
import type { CatalogCoverRow } from "@/lib/covers/types";
import { adminClient, anonKey, createTestUser, deleteTestUser, hasSupabase, url, type TestUser } from "./helpers";

// La sesión sale del usuario de prueba en lugar de las cookies de Next (mismo patrón que imports-api.test.ts)
let currentClient: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

async function callGet(id: string, headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/covers/[id]/route");
  return GET(new Request(`http://localhost/api/covers/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe.skipIf(!hasSupabase)("GET /api/covers/{id}", () => {
  const admin = adminClient();
  let user: TestUser;
  let storedId: string;
  let storedSha256: string;

  beforeEach(async () => {
    user = await createTestUser("coversapi");
    currentClient = user.client;

    const { data, error } = await admin
      .from("book_catalog")
      .insert({
        title: "Superficiales",
        author: "Nicholas Carr",
        title_key: `coversapi-${Date.now()}`,
        author_key: "nicholas carr",
        sources: ["open_library"],
        cover_origin_url: "https://covers.openlibrary.org/b/id/13657666-L.jpg",
        cover_source: "open_library",
        cover_status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    storedId = data.id as string;

    const row: CatalogCoverRow = {
      id: storedId,
      cover_origin_url: "https://covers.openlibrary.org/b/id/13657666-L.jpg",
      cover_source: "open_library",
      cover_status: "pending",
      cover_attempts: 0,
      cover_checked_at: null,
    };
    await storeCover(row, { bucket: createCoverStorage(admin), db: createCatalogCoverDb(admin) });
    const { data: after } = await admin.from("book_catalog").select("cover_sha256").eq("id", storedId).single();
    storedSha256 = after!.cover_sha256 as string;
  }, 30_000);

  afterEach(async () => {
    await deleteTestUser(user);
    await admin.storage.from("covers").remove([storedId]).catch(() => undefined);
    await admin.from("book_catalog").delete().eq("id", storedId);
  });

  it("sin sesión → 401", async () => {
    currentClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const res = await callGet(storedId);
    expect(res.status).toBe(401);
  });

  it("con sesión y cover_status='stored' → 200, bytes idénticos, ETag y Cache-Control inmutable", async () => {
    const res = await callGet(storedId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${storedSha256}"`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(storedSha256);

    const stored = await createCoverStorage(admin).download(storedId);
    expect([...bytes]).toEqual([...stored!]);
  });

  it("If-None-Match con el ETag actual → 304 sin cuerpo", async () => {
    const res = await callGet(storedId, { "If-None-Match": `"${storedSha256}"` });
    expect(res.status).toBe(304);
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it("{id} que no es un uuid → 404 sin consultar la base", async () => {
    const res = await callGet("no-es-un-uuid");
    expect(res.status).toBe(404);
  });

  it("libro sin copia propia (pending) → 404", async () => {
    const { data } = await admin
      .from("book_catalog")
      .insert({
        title: "Sin portada",
        author: "Nadie",
        title_key: `coversapi-pending-${Date.now()}`,
        author_key: "nadie",
        sources: ["open_library"],
        cover_origin_url: "https://covers.openlibrary.org/b/id/1-L.jpg",
        cover_source: "open_library",
        cover_status: "pending",
      })
      .select("id")
      .single();
    const res = await callGet(data!.id as string);
    expect(res.status).toBe(404);
    await admin.from("book_catalog").delete().eq("id", data!.id as string);
  });

  it("libro sin ninguna portada (none) → 404", async () => {
    const { data } = await admin
      .from("book_catalog")
      .insert({
        title: "Sin origen",
        author: "Nadie",
        title_key: `coversapi-none-${Date.now()}`,
        author_key: "nadie",
        sources: ["open_library"],
      })
      .select("id")
      .single();
    const res = await callGet(data!.id as string);
    expect(res.status).toBe(404);
    await admin.from("book_catalog").delete().eq("id", data!.id as string);
  });

  it("un libro del catálogo compartido se lee igual con otro usuario (no es como /api/imports)", async () => {
    const other = await createTestUser("coversapi-b");
    try {
      currentClient = other.client;
      const res = await callGet(storedId);
      expect(res.status).toBe(200);
    } finally {
      await deleteTestUser(other);
    }
  });
});
