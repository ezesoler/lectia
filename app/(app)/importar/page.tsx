import { ImportScreen, type InitialImports } from "@/components/import/import-screen";
import { TopBar } from "@/components/top-bar";
import { removeImportObjects } from "@/lib/import/http";
import { expireStaleImports } from "@/lib/import/stale";
import { IMPORT_COLUMNS, toImportStatus, type ImportRow } from "@/lib/import/status";
import type { ImportSource, ImportStatus } from "@/lib/import/types";
import { createClient } from "@/lib/supabase/server";

// El estado de cada origen cambia con cada importación: nunca se cachea
export const dynamic = "force-dynamic";

async function latestImport(
  db: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  source: ImportSource
): Promise<ImportStatus | null> {
  const { data } = await db
    .from("imports")
    .select(IMPORT_COLUMNS)
    .eq("user_id", userId)
    .eq("source", source)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toImportStatus(data as unknown as ImportRow) : null;
}

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

  // FR-026: al entrar se muestra el último estado de cada origen; si un trabajo murió, se libera
  await expireStaleImports({ db: supabase, removeObjects: removeImportObjects }, user!.id);
  const [kindle, kobo] = await Promise.all([
    latestImport(supabase, user!.id, "kindle"),
    latestImport(supabase, user!.id, "kobo"),
  ]);
  const initial: InitialImports = { kindle, kobo };

  return (
    <div className="min-h-screen bg-paper">
      <TopBar displayName={profile?.display_name ?? null} />
      <main>
        <ImportScreen initial={initial} />
      </main>
    </div>
  );
}
