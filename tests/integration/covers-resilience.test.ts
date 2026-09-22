import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogCoverDb } from "@/lib/covers/catalog-cover-db";
import { createCoverStorage } from "@/lib/covers/storage";
import { createCatalogStore } from "@/lib/enrichment/catalog";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import { enrichImportBooks } from "@/lib/enrichment/enrich-import";
import { adminClient, createTestUser, deleteTestUser, hasSupabase, importFile, type TestUser } from "./helpers";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures", name)));
const noSleep = { sleep: async () => undefined };

/** Portada real chica (research.md), reutilizada acá sólo para tener una URL de Open Library que existe de verdad. */
const REAL_COVER_ID = 13657666;

/** Metadatos válidos sólo para "Hábitos atómicos"; el resto de los libros no encuentra nada. */
function fetchImplWithFailingCover(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const host = new URL(url).hostname;
    if (host === "openlibrary.org") {
      if (decodeURIComponent(url).includes("Hábitos") || url.includes("Habitos")) {
        return new Response(
          JSON.stringify({
            docs: [
              {
                title: "Hábitos atómicos",
                author_name: ["James Clear"],
                cover_i: REAL_COVER_ID,
                number_of_pages_median: 320,
                subject: ["Self-help"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }
    if (host === "www.googleapis.com") {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (host === "covers.openlibrary.org") {
      // La fuente de portadas está caída: nunca responde bien
      return new Response(null, { status: 500 });
    }
    throw new Error(`URL inesperada en la prueba: ${url}`);
  }) as unknown as typeof fetch;
}

describe.skipIf(!hasSupabase)("resiliencia ante fallos de portada (US4)", () => {
  let user: TestUser;
  const admin = adminClient();

  beforeEach(async () => {
    user = await createTestUser("resilience");
    await admin.from("book_catalog").delete().ilike("title_key", "habitos atomicos");
  });
  afterEach(async () => {
    await deleteTestUser(user);
    const { data } = await admin.from("book_catalog").select("id").ilike("title_key", "habitos atomicos");
    if (data?.length) await admin.storage.from("covers").remove(data.map((r) => r.id as string));
    await admin.from("book_catalog").delete().ilike("title_key", "habitos atomicos");
  });

  it("una fuente de portada caída no rompe la importación ni el resto de los libros (FR-011)", async () => {
    const { row, outcome } = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    expect(row["state"]).toBe("done"); // la importación ya terminó antes de tocar ninguna portada
    expect(outcome.books).toHaveLength(4);

    const fetchImpl = fetchImplWithFailingCover();
    const summary = await enrichImportBooks({
      userId: user.id,
      db: user.client,
      books: outcome.books,
      deps: {
        catalog: createCatalogStore(admin),
        covers: { bucket: createCoverStorage(admin), db: createCatalogCoverDb(admin) },
        fetchImpl,
        ...noSleep,
      },
    });

    // Ningún libro queda marcado como 'failed': la portada caída del primero no contagia al resto
    expect(summary.failed).toBe(0);
    expect(summary.enriched).toBe(1); // Hábitos atómicos: metadatos completos, portada aparte
    expect(summary.not_found).toBe(3); // el resto no matchea con el mock, pero se procesan igual

    const { data: target } = await admin
      .from("book_catalog")
      .select("id, cover_status, cover_attempts")
      .eq("title_key", "habitos atomicos")
      .single();
    expect(target).toMatchObject({ cover_status: "pending", cover_attempts: 1 });
  }, 30_000);

  it("el libro que quedó pending se completa en el próximo paso por el catálogo (FR-012)", async () => {
    const { outcome } = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    const fetchImpl = fetchImplWithFailingCover();
    await enrichImportBooks({
      userId: user.id,
      db: user.client,
      books: outcome.books,
      deps: {
        catalog: createCatalogStore(admin),
        covers: { bucket: createCoverStorage(admin), db: createCatalogCoverDb(admin) },
        fetchImpl,
        ...noSleep,
      },
    });

    const target = outcome.books.find((b) => b.titleKey === "habitos atomicos")!;
    const { data: before } = await admin
      .from("book_catalog")
      .select("cover_status")
      .eq("title_key", "habitos atomicos")
      .single();
    expect(before!.cover_status).toBe("pending");

    // Simula que pasó más de 1 h (research.md R7): en la vida real el reintento llega en la
    // próxima importación o pasada de backfill, no en el segundo siguiente.
    await admin
      .from("book_catalog")
      .update({ cover_checked_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString() })
      .eq("title_key", "habitos atomicos");

    // Reintento: catalog_hit real, ahora con la red funcionando de verdad (sin mock)
    const retry = await enrichBook(target, {
      catalog: createCatalogStore(admin),
      covers: { bucket: createCoverStorage(admin), db: createCatalogCoverDb(admin) },
    });

    expect(retry).toMatchObject({ status: "catalog_hit", cover: "stored" });
    const { data: after } = await admin
      .from("book_catalog")
      .select("cover_status, cover_path")
      .eq("title_key", "habitos atomicos")
      .single();
    expect(after).toMatchObject({ cover_status: "stored" });
  }, 30_000);
});
