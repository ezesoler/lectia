import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createCatalogCoverDb } from "@/lib/covers/catalog-cover-db";
import { createCoverStorage } from "@/lib/covers/storage";
import { storeCover } from "@/lib/covers/store-cover";
import type { CatalogCoverRow } from "@/lib/covers/types";
import { adminClient, hasSupabase } from "./helpers";

/**
 * Contra la red real, con los mismos libros ya investigados en research.md (E1, E5/E6), para
 * probar FR-005/FR-007 de punta a punta: se guarda la mayor calidad disponible, con los bytes
 * intactos, y una imagen de reemplazo nunca se confunde con una portada real.
 */
describe.skipIf(!hasSupabase)("calidad de la portada guardada (US2)", () => {
  const admin = adminClient();
  const bucket = createCoverStorage(admin);
  const db = createCatalogCoverDb(admin);

  async function insertPendingBook(fields: {
    title: string;
    author: string;
    coverOrigin: string;
    coverSource: "open_library" | "google_books";
  }): Promise<string> {
    const key = `${fields.title.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await admin
      .from("book_catalog")
      .insert({
        title: fields.title,
        author: fields.author,
        title_key: key,
        author_key: fields.author.toLowerCase(),
        sources: [fields.coverSource],
        cover_origin_url: fields.coverOrigin,
        cover_source: fields.coverSource,
        cover_status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    return data.id as string;
  }

  afterEach(async () => {
    const filter = "title_key.ilike.dune-%,title_key.ilike.superficiales-gb-%";
    const { data } = await admin.from("book_catalog").select("id").or(filter);
    if (data?.length) await admin.storage.from("covers").remove(data.map((r) => r.id as string));
    await admin.from("book_catalog").delete().or(filter);
  });

  it("Open Library: guarda el original (2734×4650), no la miniatura -L (294×500) — FR-005", async () => {
    // research.md E1: Dune, id 6976407. La candidata sin sufijo es el archivo original.
    const id = await insertPendingBook({
      title: "Dune",
      author: "Frank Herbert",
      coverOrigin: "https://covers.openlibrary.org/b/id/6976407-L.jpg",
      coverSource: "open_library",
    });
    const row: CatalogCoverRow = {
      id,
      cover_origin_url: "https://covers.openlibrary.org/b/id/6976407-L.jpg",
      cover_source: "open_library",
      cover_status: "pending",
      cover_attempts: 0,
      cover_checked_at: null,
    };

    expect(await storeCover(row, { bucket, db })).toBe("stored");

    const { data } = await admin
      .from("book_catalog")
      .select("cover_width, cover_height, cover_format")
      .eq("id", id)
      .single();
    expect(data!.cover_format).toBe("jpeg");
    // La miniatura -L es 294×500; el original es notoriamente mayor (research.md: 2734×4650)
    expect(data!.cover_width).toBeGreaterThan(294);
    expect(data!.cover_height).toBeGreaterThan(500);
  }, 30_000);

  it("Google Books: descarta el reemplazo de zoom=0 y guarda la variante real — FR-009/FR-005", async () => {
    // research.md E5/E6: Superficiales (id Nm6REAAAQBAJ). zoom=0 es el "image not available"
    // (575×750, huella conocida); zoom=4 es la portada real (800×1153).
    const origin = "https://books.google.com/books/content?id=Nm6REAAAQBAJ&printsec=frontcover&img=1&zoom=1";
    const id = await insertPendingBook({
      title: "Superficiales-gb",
      author: "Nicholas Carr",
      coverOrigin: origin,
      coverSource: "google_books",
    });
    const row: CatalogCoverRow = {
      id,
      cover_origin_url: origin,
      cover_source: "google_books",
      cover_status: "pending",
      cover_attempts: 0,
      cover_checked_at: null,
    };

    expect(await storeCover(row, { bucket, db })).toBe("stored");

    const { data } = await admin
      .from("book_catalog")
      .select("cover_width, cover_height, cover_format, cover_sha256")
      .eq("id", id)
      .single();
    expect(data).toMatchObject({ cover_width: 800, cover_height: 1153, cover_format: "jpeg" });
    // Nunca la huella del reemplazo (lib/covers/placeholders.ts, mismo valor que research.md E5)
    expect(data!.cover_sha256).not.toBe(
      "3efa8c43e5b4348f303a528c81adf435f0111ea752fe9f0f6241478b60987fa6"
    );
  }, 30_000);

  it("el objeto guardado es idéntico byte a byte a lo descargado (FR-007)", async () => {
    const id = await insertPendingBook({
      title: "Dune",
      author: "Frank Herbert",
      coverOrigin: "https://covers.openlibrary.org/b/id/6976407-L.jpg",
      coverSource: "open_library",
    });
    const row: CatalogCoverRow = {
      id,
      cover_origin_url: "https://covers.openlibrary.org/b/id/6976407-L.jpg",
      cover_source: "open_library",
      cover_status: "pending",
      cover_attempts: 0,
      cover_checked_at: null,
    };
    await storeCover(row, { bucket, db });

    const { data } = await admin.from("book_catalog").select("cover_bytes, cover_sha256").eq("id", id).single();
    const stored = await bucket.download(id);
    expect(stored).not.toBeNull();
    expect(stored!.length).toBe(data!.cover_bytes);
    expect(createHash("sha256").update(stored!).digest("hex")).toBe(data!.cover_sha256);
  }, 30_000);
});
