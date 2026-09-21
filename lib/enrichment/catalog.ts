// SÓLO SERVIDOR. Único punto de escritura a `book_catalog` (service_role).
// El catálogo es compartido y sin user_id: sólo puede crearse a partir de datos que una API
// externa respalda; nunca a partir de lo que envía un usuario (FR-017).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CatalogEntry, CatalogStore, NewCatalogEntry } from "./types";

const COLUMNS = "id, isbn, title, author, title_key, author_key, cover_url, category, pages, sources";

export function createCatalogStore(admin: SupabaseClient = createAdminClient()): CatalogStore {
  async function findByKeys(titleKey: string, authorKey: string) {
    const { data } = await admin
      .from("book_catalog")
      .select(COLUMNS)
      .eq("title_key", titleKey)
      .eq("author_key", authorKey)
      .maybeSingle();
    return (data as CatalogEntry | null) ?? null;
  }

  async function findByIsbn(isbn: string) {
    const { data } = await admin.from("book_catalog").select(COLUMNS).eq("isbn", isbn).maybeSingle();
    return (data as CatalogEntry | null) ?? null;
  }

  return {
    async find({ isbn, titleKey, authorKey }) {
      if (isbn) {
        const byIsbn = await findByIsbn(isbn);
        if (byIsbn) return byIsbn;
      }
      return findByKeys(titleKey, authorKey);
    },

    async save(entry: NewCatalogEntry) {
      // Defensa en profundidad: el check de la base también lo exige
      if (entry.sources.length === 0) {
        throw new Error("book_catalog: se necesita al menos una fuente externa");
      }
      const { data, error } = await admin.from("book_catalog").insert(entry).select("id").single();
      if (!error && data) return data.id as string;

      // 23505: otro import ganó la carrera por el índice único (ISBN o título+autor)
      if (error?.code === "23505") {
        const existing =
          (entry.isbn ? await findByIsbn(entry.isbn) : null) ??
          (await findByKeys(entry.title_key, entry.author_key));
        if (existing) return existing.id;
      }
      throw new Error(`book_catalog: ${error?.message ?? "no se pudo guardar"}`);
    },
  };
}
