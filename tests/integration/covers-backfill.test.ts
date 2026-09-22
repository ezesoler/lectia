import { afterEach, describe, expect, it } from "vitest";
import { backfillCovers } from "@/lib/covers/backfill";
import { createCatalogCoverDb } from "@/lib/covers/catalog-cover-db";
import { createCoverStorage } from "@/lib/covers/storage";
import { adminClient, hasSupabase } from "./helpers";

// Tres portadas reales de Open Library, ya vistas en research.md (E1) y en covers-quality.test.ts.
const REAL_COVERS: { id: number; title: string }[] = [
  { id: 13657666, title: "Superficiales" }, // 317×500 (original ≈ -L)
  { id: 12374726, title: "Steve Jobs" }, // 347×500
  { id: 6976407, title: "Dune" }, // 2734×4650 (original bastante mayor que -L)
];

describe.skipIf(!hasSupabase)("migración de portadas existentes (US3)", () => {
  const admin = adminClient();
  const bucket = createCoverStorage(admin);
  const coverDb = createCatalogCoverDb(admin);
  const prefix = `backfill-${Date.now()}`;

  async function seedPendingRows(): Promise<string[]> {
    const ids: string[] = [];
    for (const [i, cover] of REAL_COVERS.entries()) {
      const { data, error } = await admin
        .from("book_catalog")
        .insert({
          title: cover.title,
          author: "Autor de prueba",
          title_key: `${prefix}-${i}`,
          author_key: "autor de prueba",
          sources: ["open_library"],
          cover_origin_url: `https://covers.openlibrary.org/b/id/${cover.id}-L.jpg`,
          cover_source: "open_library",
          cover_status: "pending",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message);
      ids.push(data.id as string);
    }
    return ids;
  }

  afterEach(async () => {
    const { data } = await admin.from("book_catalog").select("id").ilike("title_key", `${prefix}-%`);
    if (data?.length) await admin.storage.from("covers").remove(data.map((r) => r.id as string));
    await admin.from("book_catalog").delete().ilike("title_key", `${prefix}-%`);
  });

  it("migra las tres filas a copia propia; repetirlo no hace nada (idempotente)", async () => {
    await seedPendingRows();

    const first = await backfillCovers({ concurrency: 2 }, { admin, bucket, coverDb });
    expect(first).toMatchObject({ processed: 3, stored: 3, unavailable: 0 });

    const { data: afterFirst } = await admin
      .from("book_catalog")
      .select("cover_status")
      .ilike("title_key", `${prefix}-%`);
    expect(afterFirst!.every((r) => r.cover_status === "stored")).toBe(true);

    const { data: objects } = await admin.storage.from("covers").list("");
    const ourObjects = objects?.filter((o) => afterFirst && o) ?? [];
    expect(ourObjects.length).toBeGreaterThanOrEqual(3);

    // Repetir la migración: nada queda `pending`, no hay nada que hacer
    const second = await backfillCovers({ concurrency: 2 }, { admin, bucket, coverDb });
    expect(second).toEqual({ processed: 0, stored: 0, pending: 0, unavailable: 0, skipped: 0 });
  }, 60_000);

  it("interrumpida a la mitad (limit:1) y retomada sin límite, termina las tres sin duplicar", async () => {
    const ids = await seedPendingRows();

    const partial = await backfillCovers({ limit: 1, concurrency: 1 }, { admin, bucket, coverDb });
    expect(partial.processed).toBe(1);

    const { data: midway } = await admin
      .from("book_catalog")
      .select("id, cover_status")
      .ilike("title_key", `${prefix}-%`);
    const storedSoFar = midway!.filter((r) => r.cover_status === "stored");
    expect(storedSoFar).toHaveLength(1);

    // Se retoma sin límite: procesa lo que falta, sin repetir la que ya quedó `stored`
    const rest = await backfillCovers({ concurrency: 2 }, { admin, bucket, coverDb });
    expect(rest.processed).toBe(2);
    expect(rest.stored).toBe(2);

    const { data: final } = await admin
      .from("book_catalog")
      .select("cover_status")
      .in("id", ids);
    expect(final!.every((r) => r.cover_status === "stored")).toBe(true);

    // Un objeto por libro: nada quedó duplicado
    for (const id of ids) {
      const { data: files } = await admin.storage.from("covers").list("", { search: id });
      expect(files?.filter((f) => f.name === id)).toHaveLength(1);
    }
  }, 60_000);

  it("--dry-run no escribe nada", async () => {
    await seedPendingRows();

    const dry = await backfillCovers({ dryRun: true }, { admin, bucket, coverDb });
    expect(dry).toEqual({ processed: 3, stored: 0, pending: 0, unavailable: 0, skipped: 0 });

    const { data } = await admin.from("book_catalog").select("cover_status").ilike("title_key", `${prefix}-%`);
    expect(data!.every((r) => r.cover_status === "pending")).toBe(true);
  }, 30_000);
});
