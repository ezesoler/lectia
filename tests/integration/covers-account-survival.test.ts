import { describe, expect, it } from "vitest";
import { createCatalogCoverDb } from "@/lib/covers/catalog-cover-db";
import { createCoverStorage } from "@/lib/covers/storage";
import { storeCover } from "@/lib/covers/store-cover";
import type { CatalogCoverRow } from "@/lib/covers/types";
import { adminClient, createTestUser, deleteTestUser, hasSupabase, type TestUser } from "./helpers";

/**
 * Quickstart, escenario 11: las portadas son datos bibliográficos públicos del catálogo
 * compartido (Constitución I/VII), no notas del lector — `book_catalog` no tiene `user_id`, así
 * que la cascada de borrado de cuenta (desde `auth.users`) no puede alcanzarla.
 */
describe.skipIf(!hasSupabase)("las portadas sobreviven al borrado de la cuenta (escenario 11)", () => {
  const admin = adminClient();

  it("borrar la cuenta no borra la fila del catálogo ni el objeto guardado", async () => {
    const user: TestUser = await createTestUser("coversurvival");
    let deleted = false;
    try {
      const { data, error } = await admin
        .from("book_catalog")
        .insert({
          title: "Superficiales",
          author: "Nicholas Carr",
          title_key: `coversurvival-${Date.now()}`,
          author_key: "nicholas carr",
          sources: ["open_library"],
          cover_origin_url: "https://covers.openlibrary.org/b/id/13657666-L.jpg",
          cover_source: "open_library",
          cover_status: "pending",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message);
      const catalogId = data.id as string;

      const row: CatalogCoverRow = {
        id: catalogId,
        cover_origin_url: "https://covers.openlibrary.org/b/id/13657666-L.jpg",
        cover_source: "open_library",
        cover_status: "pending",
        cover_attempts: 0,
        cover_checked_at: null,
      };
      const outcome = await storeCover(row, {
        bucket: createCoverStorage(admin),
        db: createCatalogCoverDb(admin),
      });
      expect(outcome).toBe("stored");

      // Un libro de este usuario que referencia el catálogo (books.catalog_id, no book_catalog)
      const { data: book } = await admin
        .from("books")
        .insert({
          user_id: user.id,
          title: "Superficiales",
          author: "Nicholas Carr",
          title_key: `coversurvival-user-${Date.now()}`,
          author_key: "nicholas carr",
          source: "kindle",
          catalog_id: catalogId,
        })
        .select("id")
        .single();
      expect(book).toBeTruthy();

      await admin.auth.admin.deleteUser(user.id);
      deleted = true;

      // El libro del usuario sí desaparece (cascada desde auth.users, Constitución I)
      const { data: booksLeft } = await admin.from("books").select("id").eq("user_id", user.id);
      expect(booksLeft ?? []).toHaveLength(0);

      // La fila del catálogo compartido y la copia de la portada siguen intactas
      const { data: catalogAfter } = await admin
        .from("book_catalog")
        .select("cover_status, cover_path, cover_sha256")
        .eq("id", catalogId)
        .single();
      expect(catalogAfter).toMatchObject({ cover_status: "stored" });

      const stillStored = await createCoverStorage(admin).download(catalogId);
      expect(stillStored).not.toBeNull();

      await admin.storage.from("covers").remove([catalogId]);
      await admin.from("book_catalog").delete().eq("id", catalogId);
    } finally {
      if (!deleted) await deleteTestUser(user);
    }
  }, 30_000);
});
