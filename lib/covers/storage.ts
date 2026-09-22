// SÓLO SERVIDOR. Adaptador sobre el bucket privado `covers` (service_role).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CoverStore } from "./types";

const BUCKET = "covers";

/**
 * `upload` nunca sobrescribe (`upsert: false`): si el objeto ya existe, otra importación ganó
 * la carrera y devuelve `'exists'` para que el llamador adopte lo ya guardado (research.md R6).
 */
export function createCoverStorage(admin: SupabaseClient = createAdminClient()): CoverStore {
  const bucket = () => admin.storage.from(BUCKET);

  return {
    async upload(id, bytes, contentType) {
      const { error } = await bucket().upload(id, bytes, { contentType, upsert: false });
      if (!error) return "created";
      // Supabase Storage devuelve 409/"The resource already exists" cuando upsert:false choca
      if (error.message.toLowerCase().includes("already exists")) return "exists";
      throw new Error(`covers storage upload: ${error.message}`);
    },

    async download(id) {
      const { data, error } = await bucket().download(id);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
