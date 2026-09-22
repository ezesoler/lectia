import { NextResponse, after } from "next/server";
import {
  apiError,
  createImportStorage,
  getAuthedContext,
  importObjectExists,
  isUuid,
  notFound,
  unauthorized,
} from "@/lib/import/http";
import { createCatalogCoverDb } from "@/lib/covers/catalog-cover-db";
import { createCoverStorage } from "@/lib/covers/storage";
import { createCatalogStore } from "@/lib/enrichment/catalog";
import { enrichImportBooks } from "@/lib/enrichment/enrich-import";
import { parsers } from "@/lib/import/parsers";
import { runImport } from "@/lib/import/run-import";
import type { ImportSource } from "@/lib/import/types";
import { createUserTokenClient } from "@/lib/supabase/admin";

// Vercel: el trabajo corre en segundo plano (after) y necesita margen más allá del 202
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// POST /api/imports/{id}/parse — inicia el procesamiento (202) y sigue en segundo plano
export async function POST(_request: Request, { params }: Params) {
  const ctx = await getAuthedContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const { db, userId } = ctx;

  const { data: current } = await db
    .from("imports")
    .select("state, source")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!current) return notFound();

  // Idempotente: si ya está en curso no se lanza otro trabajo
  if (current.state === "parsing") return NextResponse.json({ state: "parsing" }, { status: 202 });
  if (current.state !== "queued") {
    return apiError(409, "invalid_state", "Esta importación ya terminó.");
  }

  if (!(await importObjectExists(userId, id))) {
    return apiError(422, "file_missing", "No encontramos el archivo subido. Volvé a intentarlo.");
  }

  // Transición atómica queued → parsing: si otra petición ganó la carrera, no se relanza
  const now = new Date().toISOString();
  const { data: moved } = await db
    .from("imports")
    .update({ state: "parsing", updated_at: now })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("state", "queued")
    .select("id");
  if (!moved || moved.length === 0) {
    return NextResponse.json({ state: "parsing" }, { status: 202 });
  }

  // La tarea de fondo no tiene cookies: se captura el token del usuario para seguir bajo RLS
  const {
    data: { session },
  } = await db.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return unauthorized();

  const source = current.source as ImportSource;
  after(async () => {
    const userDb = createUserTokenClient(accessToken);
    const outcome = await runImport(
      { importId: id, userId, source },
      { db: userDb, storage: createImportStorage(), parsers }
    );

    // FR-019: el enriquecimiento va después del `done` y no lo retrasa ni lo cambia. Un fallo
    // acá nunca afecta a la importación ya visible para el usuario. Esto también cubre el
    // guardado de portadas (feature 004): enrichBook ya atrapa los errores de storeCover antes
    // de devolver su resultado (nunca lanza por eso), y este try/catch es la segunda red de
    // contención por si algo más falla (verificado T039/T040).
    // ENRICHMENT_DISABLED=1: para los e2e, que no deben salir a Open Library/Google Books
    const enrichmentOff = process.env["ENRICHMENT_DISABLED"] === "1";
    if (outcome.state === "done" && outcome.books.length > 0 && !enrichmentOff) {
      try {
        await enrichImportBooks({
          userId,
          db: userDb,
          books: outcome.books,
          deps: {
            catalog: createCatalogStore(),
            covers: { bucket: createCoverStorage(), db: createCatalogCoverDb() },
          },
        });
      } catch (err) {
        console.error(`[enrich] ${id}: ${(err as Error).message}`);
      }
    }
  });

  return NextResponse.json({ state: "parsing" }, { status: 202 });
}
