import { TopBar } from "@/components/top-bar";
import { createClient } from "@/lib/supabase/server";

export default async function ImportarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user!.id)
    .single();

  return (
    <div className="min-h-screen bg-paper">
      <TopBar displayName={profile?.display_name ?? null} />
      <main className="max-w-[1180px] mx-auto px-4 py-8">
        <h2
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "clamp(25px, 5vw, 32px)",
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "var(--ink)",
          }}
        >
          Importar
        </h2>
        <p style={{ color: "var(--ink-2)", marginTop: "8px", fontSize: "15px" }}>
          Paso 1 de 1 — Conectá tu lector o subí el archivo de resaltados.
        </p>
      </main>
    </div>
  );
}
