import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCatalogCoverDb } from "@/lib/covers/catalog-cover-db";
import { createCoverStorage } from "@/lib/covers/storage";
import { storeCover } from "@/lib/covers/store-cover";
import type { CatalogCoverRow } from "@/lib/covers/types";
import { adminClient, hasSupabase } from "./helpers";

// Portada real de Open Library (research.md E1: *Superficiales*, Nicholas Carr). Se usa contra
// la red real: el mismo caso que ya se verificó a mano en la investigación de la feature.
const REAL_COVER_ORIGIN = "https://covers.openlibrary.org/b/id/13657666-L.jpg";

describe.skipIf(!hasSupabase)("Storage real de portadas (US1)", () => {
  const admin = adminClient();
  const bucket = createCoverStorage(admin);
  const db = createCatalogCoverDb(admin);

  async function insertPendingBook(): Promise<string> {
    const { data, error } = await admin
      .from("book_catalog")
      .insert({
        title: "Superficiales",
        author: "Nicholas Carr",
        title_key: `superficiales-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        author_key: "nicholas carr",
        sources: ["open_library"],
        cover_origin_url: REAL_COVER_ORIGIN,
        cover_source: "open_library",
        cover_status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    return data.id as string;
  }

  afterEach(async () => {
    const { data } = await admin.from("book_catalog").select("id").ilike("title_key", "superficiales-%");
    if (data?.length) await admin.storage.from("covers").remove(data.map((r) => r.id as string));
    await admin.from("book_catalog").delete().ilike("title_key", "superficiales-%");
  });

  it("descarga la portada real, la guarda y la fila queda coherente con el objeto guardado", async () => {
    const id = await insertPendingBook();
    const row: CatalogCoverRow = {
      id,
      cover_origin_url: REAL_COVER_ORIGIN,
      cover_source: "open_library",
      cover_status: "pending",
      cover_attempts: 0,
      cover_checked_at: null,
    };

    const outcome = await storeCover(row, { bucket, db });
    expect(outcome).toBe("stored");

    const { data: after } = await admin
      .from("book_catalog")
      .select("cover_status, cover_path, cover_format, cover_width, cover_height, cover_bytes, cover_sha256")
      .eq("id", id)
      .single();
    expect(after).toMatchObject({ cover_status: "stored", cover_path: id, cover_format: "jpeg" });
    expect(after!.cover_width).toBeGreaterThanOrEqual(100);
    expect(after!.cover_height).toBeGreaterThanOrEqual(100);

    const stored = await bucket.download(id);
    expect(stored).not.toBeNull();
    expect(stored!.length).toBe(after!.cover_bytes);
    expect(createHash("sha256").update(stored!).digest("hex")).toBe(after!.cover_sha256);
  }, 30_000);

  it("dos guardados en paralelo del mismo libro dejan un solo objeto (adopción, research.md R6)", async () => {
    const id = await insertPendingBook();
    const row: CatalogCoverRow = {
      id,
      cover_origin_url: REAL_COVER_ORIGIN,
      cover_source: "open_library",
      cover_status: "pending",
      cover_attempts: 0,
      cover_checked_at: null,
    };

    const [a, b] = await Promise.all([storeCover(row, { bucket, db }), storeCover(row, { bucket, db })]);
    expect([a, b]).toEqual(["stored", "stored"]);

    const { data: files } = await admin.storage.from("covers").list("", { search: id });
    expect(files?.filter((f) => f.name === id)).toHaveLength(1);

    const { data: after } = await admin.from("book_catalog").select("cover_sha256").eq("id", id).single();
    expect(after!.cover_sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);
});
