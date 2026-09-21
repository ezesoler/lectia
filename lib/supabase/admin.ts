// SÓLO SERVIDOR. Nunca importar este módulo desde componentes cliente: usa la service role key.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con `service_role` (ignora RLS). Uso permitido, y sólo ese (research.md R2):
 * firmar/leer/borrar objetos de Storage, escribir en `book_catalog` y limpiar Storage al
 * borrar una cuenta. Las tablas del usuario se escriben con `createUserTokenClient`.
 */
export function createAdminClient(): SupabaseClient {
  return createClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Cliente con el access_token del usuario para el trabajo en segundo plano, donde ya no hay
 * cookies. Las escrituras siguen bajo RLS.
 */
export function createUserTokenClient(accessToken: string): SupabaseClient {
  return createClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
}
