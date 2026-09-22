// SÓLO SERVIDOR. Único punto de escritura de las columnas de portada en `book_catalog`.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CatalogCoverDb, CoverMeta } from "./types";

export function createCatalogCoverDb(admin: SupabaseClient = createAdminClient()): CatalogCoverDb {
  const table = () => admin.from("book_catalog");

  return {
    async markStored(id, meta) {
      // Condicionado a que nadie más lo haya marcado 'stored' ya (gana el primero, research.md R6)
      const { error } = await table()
        .update({
          cover_status: "stored",
          cover_path: meta.path,
          cover_format: meta.format,
          cover_width: meta.width,
          cover_height: meta.height,
          cover_bytes: meta.bytes,
          cover_sha256: meta.sha256,
          cover_source: meta.source,
          cover_stored_at: new Date().toISOString(),
        })
        .eq("id", id)
        .neq("cover_status", "stored");
      if (error) throw new Error(`markStored: ${error.message}`);
    },

    async markPending(id, attempts) {
      const { error } = await table()
        .update({ cover_status: "pending", cover_attempts: attempts, cover_checked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`markPending: ${error.message}`);
    },

    async markUnavailable(id) {
      const { error } = await table()
        .update({ cover_status: "unavailable", cover_checked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`markUnavailable: ${error.message}`);
    },
  };
}

export type { CoverMeta };
