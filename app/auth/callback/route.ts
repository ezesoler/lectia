import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const next = searchParams.get("next") ?? "/";

  // Cancelación por parte del usuario en Google
  if (error === "access_denied") {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Error genérico del proveedor
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error("[auth/callback] exchange error:", exchangeError.message);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Determinar destino: /importar si no tiene libros, / si tiene
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { count } = await supabase
      .from("books")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const destination = (count ?? 0) === 0 ? "/importar" : next;
    return NextResponse.redirect(`${origin}${destination}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
