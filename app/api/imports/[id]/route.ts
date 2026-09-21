import { NextResponse } from "next/server";
import {
  apiError,
  getAuthedContext,
  isUuid,
  notFound,
  removeImportObjects,
  staleDeps,
  unauthorized,
} from "@/lib/import/http";
import { expireStaleImports } from "@/lib/import/stale";
import { IMPORT_COLUMNS, toImportStatus, type ImportRow } from "@/lib/import/status";

type Params = { params: Promise<{ id: string }> };

// GET /api/imports/{id} — estado y progreso (sondeo del cliente)
export async function GET(_request: Request, { params }: Params) {
  const ctx = await getAuthedContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  await expireStaleImports(staleDeps(ctx.db), ctx.userId);

  const { data, error } = await ctx.db
    .from("imports")
    .select(IMPORT_COLUMNS)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/imports/{id}] error:", error.message);
    return apiError(500, "server_error", "No se pudo leer la importación.");
  }
  if (!data) return notFound();

  return NextResponse.json(toImportStatus(data as unknown as ImportRow));
}

// DELETE /api/imports/{id} — cancelar antes de subir (sólo `queued`)
export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await getAuthedContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const { data: current } = await ctx.db
    .from("imports")
    .select("state")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!current) return notFound();

  // Una importación en curso o terminada nunca se interrumpe ni se borra (FR-025)
  const { data: deleted } = await ctx.db
    .from("imports")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("state", "queued")
    .select("id");

  if (!deleted || deleted.length === 0) {
    return apiError(409, "invalid_state", "Esa importación ya no se puede cancelar.");
  }

  await removeImportObjects([`${ctx.userId}/${id}`]).catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}
