import { NextResponse } from "next/server";
import { createCoverStorage } from "@/lib/covers/storage";
import type { CoverFormat } from "@/lib/covers/types";
import { apiError, getAuthedContext, isUuid, unauthorized } from "@/lib/import/http";

type Params = { params: Promise<{ id: string }> };

const CONTENT_TYPE: Record<CoverFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const notFound = () => apiError(404, "not_found", "Este libro no tiene portada.");

/**
 * GET /api/covers/{id} — la portada propia de un libro del catálogo (contracts/covers-api.md).
 * Única vía de lectura: el bucket `covers` es privado y no tiene políticas para el usuario.
 * Nunca redirige ni sirve la imagen desde el servicio externo (FR-017): sin copia, es 404.
 */
export async function GET(request: Request, { params }: Params) {
  const ctx = await getAuthedContext();
  if (!ctx) return unauthorized();
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Lectura pública para cualquier autenticado (a diferencia de `imports`): sin filtro por dueño
  const { data, error } = await ctx.db
    .from("book_catalog")
    .select("cover_status, cover_path, cover_format, cover_bytes, cover_sha256")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(`[GET /api/covers/${id}] error: ${error.message}`);
    return apiError(500, "server_error", "No se pudo leer la portada.");
  }
  if (!data || data.cover_status !== "stored") return notFound();

  const etag = `"${data.cover_sha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const bytes = await createCoverStorage().download(data.cover_path!);
  if (!bytes) {
    // La fila dice 'stored' pero el objeto no está: incoherencia, no un caso de "sin portada"
    console.error(`[GET /api/covers/${id}] falta el objeto en Storage pese a cover_status='stored'`);
    return apiError(500, "server_error", "No se pudo leer la portada.");
  }

  return new NextResponse(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE[data.cover_format as CoverFormat],
      "Content-Length": String(data.cover_bytes),
      ETag: etag,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
