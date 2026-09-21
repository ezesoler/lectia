import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parsers } from "@/lib/import/parsers";
import { runImport, type RunImportDeps } from "@/lib/import/run-import";
import type { ImportSource } from "@/lib/import/types";

export const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
export const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
export const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

/** Las suites de integración se omiten si no hay Supabase local configurado. */
export const hasSupabase = Boolean(url && anonKey && serviceKey);

export function adminClient(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  client: SupabaseClient;
}

export async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient();
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@lectia.test`;
  const password = "lectia-test-password-1";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session) throw new Error(`signIn: ${signInError?.message}`);

  return { id: data.user.id, email, accessToken: session.session.access_token, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  const admin = adminClient();
  await admin.storage.from("imports").remove([`${user.id}/`]).catch(() => undefined);
  await admin.auth.admin.deleteUser(user.id);
}

/**
 * Importa un archivo de punta a punta (Storage real + runImport + import_batch real), sin pasar
 * por HTTP. Devuelve el resultado y la fila final de `imports`.
 */
export async function importFile(
  user: TestUser,
  source: ImportSource,
  bytes: Uint8Array,
  fileName: string,
  options: Partial<Pick<RunImportDeps, "batchSize" | "yieldFn">> = {}
) {
  const { data, error } = await user.client
    .from("imports")
    .insert({ user_id: user.id, source, state: "parsing", file_name: fileName, file_size: bytes.length })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message);
  const importId = data.id as string;

  const bucket = adminClient().storage.from("imports");
  const path = `${user.id}/${importId}`;
  const { error: uploadError } = await bucket.upload(path, new Blob([bytes as BlobPart]));
  if (uploadError) throw new Error(uploadError.message);

  const outcome = await runImport(
    { importId, userId: user.id, source },
    {
      db: user.client,
      parsers,
      ...options,
      storage: {
        async download(p) {
          const res = await bucket.download(p);
          if (res.error || !res.data) throw new Error("sin archivo");
          return new Uint8Array(await res.data.arrayBuffer());
        },
        async remove(p) {
          await bucket.remove([p]);
        },
      },
    }
  );
  const { data: row } = await user.client.from("imports").select("*").eq("id", importId).single();
  return { importId, outcome, row: row as Record<string, unknown> };
}
