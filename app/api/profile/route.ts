import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { resolveTheme, VALID_THEMES, type Theme } from "@/lib/theme";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// PATCH /api/profile — actualizar preferencia de tema
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sesión requerida." } },
      { status: 401 }
    );
  }

  let body: { theme?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_theme", message: "Cuerpo inválido." } },
      { status: 400 }
    );
  }

  const theme = resolveTheme(body.theme as string);
  if (!VALID_THEMES.includes(body.theme as Theme)) {
    return NextResponse.json(
      { error: { code: "invalid_theme", message: "Valor de tema no válido." } },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ theme })
    .eq("id", user.id);

  if (error) {
    console.error("[PATCH /api/profile] update error:", error.message);
    return NextResponse.json(
      { error: { code: "server_error", message: "No se pudo guardar el tema." } },
      { status: 500 }
    );
  }

  // Cookie para que el servidor pueda leer el tema en el primer SSR
  const cookieStore = await cookies();
  cookieStore.set("theme", theme, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ theme });
}

// DELETE /api/profile — borrado inmediato de cuenta y todos los datos
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sesión requerida." } },
      { status: 401 }
    );
  }

  try {
    // 1. Limpiar archivos de Storage del usuario
    const { data: files } = await supabase.storage
      .from("imports")
      .list(user.id);

    if (files && files.length > 0) {
      const paths = files.map((f) => `${user.id}/${f.name}`);
      await supabase.storage.from("imports").remove(paths);
    }

    // 2. Borrar el usuario (cascada borra profiles, books, highlights, etc.)
    const admin = createAdminClient(
      process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!
    );
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

    if (deleteError) {
      throw deleteError;
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/profile] error:", err);
    return NextResponse.json(
      {
        error: {
          code: "delete_failed",
          message: "No se pudo eliminar la cuenta. Intentá de nuevo.",
        },
      },
      { status: 500 }
    );
  }
}
