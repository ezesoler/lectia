import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/top-bar";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, theme")
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
          Inicio
        </h2>
      </main>
    </div>
  );
}
