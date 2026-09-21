import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ImportStorage } from "./run-import";
import type { StaleDeps } from "./stale";

export const IMPORTS_BUCKET = "imports";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Formato de error del proyecto: { error: { code, message, details? } }. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export const unauthorized = () => apiError(401, "unauthorized", "Sesión requerida.");
export const notFound = () => apiError(404, "not_found", "No encontramos esa importación.");

export interface AuthedContext {
  db: SupabaseClient;
  userId: string;
}

/** Cliente con RLS del usuario + su id; null si no hay sesión. */
export async function getAuthedContext(): Promise<AuthedContext | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  return { db, userId: user.id };
}

export function removeImportObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return Promise.resolve();
  return createAdminClient()
    .storage.from(IMPORTS_BUCKET)
    .remove(paths)
    .then(() => undefined);
}

export function staleDeps(db: SupabaseClient): StaleDeps {
  return { db, removeObjects: removeImportObjects };
}

/** Adaptador de Storage (service_role) para runImport: descarga y borra el archivo temporal. */
export function createImportStorage(): ImportStorage {
  const bucket = () => createAdminClient().storage.from(IMPORTS_BUCKET);
  return {
    async download(path: string) {
      const { data, error } = await bucket().download(path);
      if (error || !data) throw new Error(error?.message ?? "archivo no encontrado");
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path: string) {
      await bucket().remove([path]);
    },
  };
}

/** ¿Existe el objeto de este import en Storage? (para responder 422 antes de encolar el trabajo) */
export async function importObjectExists(userId: string, importId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .storage.from(IMPORTS_BUCKET)
    .list(userId, { search: importId });
  return Boolean(data?.some((f) => f.name === importId));
}
