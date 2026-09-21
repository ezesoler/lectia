import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportedBook } from "@/lib/import/run-import";
import { enrichBook } from "./enrich-book";
import type { EnrichDeps, EnrichResult, EnrichStatus } from "./types";

export const CONCURRENCY = 4;
/** Presupuesto de tiempo: lo que no llegue queda con catalog_id null y se reintenta en el próximo import. */
export const DEFAULT_BUDGET_MS = 240_000;

export interface EnrichImportInput {
  userId: string;
  /** Cliente con el token del usuario: `books.catalog_id` se actualiza bajo RLS. */
  db: SupabaseClient;
  books: ImportedBook[];
  deps: EnrichDeps;
  concurrency?: number;
  budgetMs?: number;
  now?: () => number;
}

export type EnrichSummary = Record<EnrichStatus | "skipped" | "failed", number>;

const CHUNK = 100;

/** Libros del import que todavía no tienen `catalog_id` (los ya enlazados no consultan APIs). */
async function pendingBooks(db: SupabaseClient, userId: string, books: ImportedBook[]) {
  const linked = new Set<string>();
  for (let i = 0; i < books.length; i += CHUNK) {
    const keys = books.slice(i, i + CHUNK).map((b) => b.titleKey);
    const { data } = await db
      .from("books")
      .select("title_key, author_key, catalog_id")
      .eq("user_id", userId)
      .in("title_key", keys)
      .not("catalog_id", "is", null);
    for (const row of data ?? []) linked.add(`${row.title_key}\u001f${row.author_key}`);
  }
  return books.filter((b) => !linked.has(`${b.titleKey}\u001f${b.authorKey}`));
}

/**
 * Enriquecimiento asincrónico posterior al `done` (FR-019): no retrasa ni cambia el estado de la
 * importación. Un error en un libro no interrumpe al resto.
 */
export async function enrichImportBooks(input: EnrichImportInput): Promise<EnrichSummary> {
  const { userId, db, deps } = input;
  const now = input.now ?? Date.now;
  const deadline = now() + (input.budgetMs ?? DEFAULT_BUDGET_MS);
  const summary: EnrichSummary = {
    catalog_hit: 0,
    enriched: 0,
    partial: 0,
    not_found: 0,
    skipped: 0,
    failed: 0,
  };

  const queue = await pendingBooks(db, userId, input.books);
  summary.skipped = input.books.length - queue.length;

  async function worker() {
    for (;;) {
      const book = queue.shift();
      if (!book) return;
      if (now() > deadline) {
        summary.skipped += 1;
        continue;
      }
      let result: EnrichResult;
      try {
        result = await enrichBook(book, deps);
      } catch (err) {
        // Sólo el mensaje técnico: nunca datos del usuario en los logs
        console.error(`[enrich] falló un libro: ${(err as Error).message}`);
        summary.failed += 1;
        continue;
      }
      summary[result.status] += 1;
      if (result.catalogId) {
        const { error } = await db
          .from("books")
          .update({ catalog_id: result.catalogId })
          .eq("user_id", userId)
          .eq("title_key", book.titleKey)
          .eq("author_key", book.authorKey);
        if (error) {
          console.error(`[enrich] no se pudo enlazar el libro: ${error.message}`);
          summary.failed += 1;
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(input.concurrency ?? CONCURRENCY, queue.length) }, worker)
  );
  return summary;
}
