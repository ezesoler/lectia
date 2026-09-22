// Migra a copia propia las portadas del catálogo guardadas como dirección externa (US3).
// Uso: npm run covers:backfill -- [--limit N] [--dry-run] [--include-unavailable]
import { backfillCovers } from "../lib/covers/backfill";
import { createCatalogCoverDb } from "../lib/covers/catalog-cover-db";
import { createCoverStorage } from "../lib/covers/storage";
import { createAdminClient } from "../lib/supabase/admin";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin .env.local: se asume que las variables ya están en el entorno (CI, por ejemplo)
}

function parseArgs(argv: string[]) {
  const limitFlag = argv.find((a) => a.startsWith("--limit"));
  const limit = limitFlag
    ? Number(limitFlag.includes("=") ? limitFlag.split("=")[1] : argv[argv.indexOf(limitFlag) + 1])
    : undefined;
  return {
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    dryRun: argv.includes("--dry-run"),
    includeUnavailable: argv.includes("--include-unavailable"),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const admin = createAdminClient();
  const bucket = createCoverStorage(admin);
  const coverDb = createCatalogCoverDb(admin);

  console.log(
    `[covers:backfill] arrancando${opts.dryRun ? " (dry-run)" : ""}` +
      (opts.limit !== undefined ? ` — límite: ${opts.limit}` : "") +
      (opts.includeUnavailable ? " — incluye 'unavailable'" : "")
  );

  const summary = await backfillCovers(opts, { admin, bucket, coverDb });

  console.log(
    `[covers:backfill] procesadas=${summary.processed} guardadas=${summary.stored} ` +
      `pendientes=${summary.pending} no-disponibles=${summary.unavailable} omitidas=${summary.skipped}`
  );

  // Señal de que todo falló: hubo trabajo pero ninguna terminó guardada ni quedó para reintentar
  const allFailed = summary.processed > 0 && summary.stored === 0 && summary.pending === 0;
  process.exit(allFailed ? 1 : 0);
}

void main();
