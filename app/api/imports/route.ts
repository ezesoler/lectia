import { NextResponse } from "next/server";
import {
  apiError,
  getAuthedContext,
  IMPORTS_BUCKET,
  staleDeps,
  unauthorized,
} from "@/lib/import/http";
import { expireStaleImports } from "@/lib/import/stale";
import { MAX_FILE_SIZE, type ImportSource } from "@/lib/import/types";
import { createAdminClient } from "@/lib/supabase/admin";

const EXTENSIONS: Record<ImportSource, string> = { kindle: ".txt", kobo: ".sqlite" };

interface CreateBody {
  source?: unknown;
  fileName?: unknown;
  fileSize?: unknown;
}

function isSource(value: unknown): value is ImportSource {
  return value === "kindle" || value === "kobo";
}

// POST /api/imports — crea el import en `queued` y firma la subida directa a Storage
export async function POST(request: Request) {
  const ctx = await getAuthedContext();
  if (!ctx) return unauthorized();
  const { db, userId } = ctx;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return apiError(400, "invalid_file", "Cuerpo inválido.");
  }

  if (!isSource(body.source)) {
    return apiError(400, "unsupported_source", "Origen no soportado.");
  }
  const source = body.source;

  const { fileName, fileSize } = body;
  if (typeof fileName !== "string" || !fileName.toLowerCase().endsWith(EXTENSIONS[source])) {
    return apiError(
      400,
      "invalid_file",
      `El archivo de ${source === "kindle" ? "Kindle" : "Kobo"} tiene que ser ${
        source === "kindle" ? "My Clippings.txt" : "KoboReader.sqlite"
      }.`,
      { reason: "extension" }
    );
  }
  if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
    return apiError(400, "invalid_file", "El archivo está vacío.", { reason: "empty" });
  }
  if (fileSize > MAX_FILE_SIZE) {
    return apiError(400, "invalid_file", "El archivo supera el máximo de 50 MB.", {
      reason: "too_large",
    });
  }

  // Un trabajo muerto no debe bloquear la importación nueva (FR-025, research.md R1)
  await expireStaleImports(staleDeps(db), userId, source);

  const { data: created, error: insertError } = await db
    .from("imports")
    .insert({
      user_id: userId,
      source,
      state: "queued",
      file_name: fileName,
      file_size: Math.floor(fileSize),
    })
    .select("id")
    .single();

  if (insertError || !created) {
    // 23505: el índice único parcial impide dos imports activos del mismo origen
    if (insertError?.code === "23505") {
      const { data: active } = await db
        .from("imports")
        .select("id")
        .eq("user_id", userId)
        .eq("source", source)
        .in("state", ["queued", "parsing"])
        .maybeSingle();
      return apiError(
        409,
        "import_in_progress",
        "Ya hay una importación en curso para este origen. Esperá a que termine.",
        active ? { importId: active.id } : undefined
      );
    }
    console.error("[POST /api/imports] insert error:", insertError?.message);
    return apiError(500, "server_error", "No se pudo iniciar la importación.");
  }

  const importId = created.id as string;
  const path = `${userId}/${importId}`;
  const { data: signed, error: signError } = await createAdminClient()
    .storage.from(IMPORTS_BUCKET)
    .createSignedUploadUrl(path);

  if (signError || !signed) {
    console.error("[POST /api/imports] sign error:", signError?.message);
    await db.from("imports").delete().eq("id", importId).eq("state", "queued");
    return apiError(500, "server_error", "No se pudo preparar la subida del archivo.");
  }

  return NextResponse.json(
    { importId, upload: { bucket: IMPORTS_BUCKET, path, token: signed.token } },
    { status: 201 }
  );
}
