import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

/** Los e2e autenticados necesitan el Supabase local (`.env.test.local`): Google OAuth no se automatiza. */
export const hasLocalSupabase = Boolean(url.startsWith("http://127.0.0.1") && anonKey && serviceKey);

export interface E2EUser {
  id: string;
  email: string;
  cleanup: () => Promise<void>;
}

/**
 * Crea un usuario de prueba y deja la sesión en el contexto del navegador con las mismas cookies
 * (codificadas y fragmentadas) que escribe @supabase/ssr en la app.
 */
export async function signInContext(context: BrowserContext, baseURL: string): Promise<E2EUser> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@lectia.test`;
  const password = "lectia-e2e-password-1";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);

  const jar = new Map<string, string>();
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list: { name: string; value: string }[]) =>
        list.forEach((c) => jar.set(c.name, c.value)),
    },
  });
  const { error: signInError } = await ssr.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);

  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));

  const userId = data.user.id;
  return {
    id: userId,
    email,
    cleanup: async () => {
      await admin.storage.from("imports").remove([`${userId}/`]).catch(() => undefined);
      await admin.auth.admin.deleteUser(userId);
    },
  };
}

/** Consulta con service_role (verificaciones de base en los e2e). */
export function adminDb() {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
