import type { SupabaseClient } from "@supabase/supabase-js";
import { messageFor } from "./messages";
import type { ImportSource } from "./types";

/** Un import activo sin latido reciente se considera muerto (research.md R1). */
export const PARSING_TTL_MS = 5 * 60_000;
export const QUEUED_TTL_MS = 2 * 60_000;

interface ActiveImportRow {
  id: string;
  source: ImportSource;
  state: "queued" | "parsing";
  updated_at: string | null;
  started_at: string;
  highlights_new: number;
}

export function isStale(
  row: Pick<ActiveImportRow, "state" | "updated_at" | "started_at">,
  now: number
): boolean {
  const last = Date.parse(row.updated_at ?? row.started_at);
  if (Number.isNaN(last)) return false;
  const ttl = row.state === "queued" ? QUEUED_TTL_MS : PARSING_TTL_MS;
  return now - last > ttl;
}

export interface StaleDeps {
  /** Cliente con RLS del usuario (lee y actualiza sus imports). */
  db: SupabaseClient;
  /** Borra objetos del bucket `imports` (service_role). */
  removeObjects: (paths: string[]) => Promise<void>;
  now?: () => number;
}

/**
 * Marca como `error` los imports activos sin latido, libera el cupo de FR-025 y borra el objeto
 * huérfano. Es perezoso: se invoca desde POST/GET de imports y al cargar /importar.
 * Devuelve la cantidad de imports expirados.
 */
export async function expireStaleImports(
  deps: StaleDeps,
  userId: string,
  source?: ImportSource
): Promise<number> {
  let query = deps.db
    .from("imports")
    .select("id, source, state, updated_at, started_at, highlights_new")
    .eq("user_id", userId)
    .in("state", ["queued", "parsing"]);
  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error || !data) return 0;

  const now = (deps.now ?? Date.now)();
  const stale = (data as ActiveImportRow[]).filter((row) => isStale(row, now));

  let expired = 0;
  for (const row of stale) {
    const { data: updated } = await deps.db
      .from("imports")
      .update({
        state: "error",
        error_code: "ERR_IMPORT_5031",
        error_message: messageFor("ERR_IMPORT_5031", {
          saved: row.highlights_new > 0,
          source: row.source,
        }),
        finished_at: new Date(now).toISOString(),
      })
      .eq("id", row.id)
      .in("state", ["queued", "parsing"])
      .select("id");
    if (updated && updated.length > 0) {
      expired += 1;
      await deps.removeObjects([`${userId}/${row.id}`]).catch(() => undefined);
    }
  }
  return expired;
}
