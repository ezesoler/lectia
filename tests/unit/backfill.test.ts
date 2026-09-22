// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { backfillCovers } from "@/lib/covers/backfill";
import type { CatalogCoverDb, CatalogCoverRow, CoverStore, StoreOutcome } from "@/lib/covers/types";

function row(id: string, over: Partial<CatalogCoverRow> = {}): CatalogCoverRow {
  return {
    id,
    cover_origin_url: `https://covers.openlibrary.org/b/id/${id}-L.jpg`,
    cover_source: "open_library",
    cover_status: "pending",
    cover_attempts: 0,
    cover_checked_at: null,
    ...over,
  };
}

/** Simula `book_catalog`: .eq('cover_status','pending').order(...).range(...) y el update de reactivación. */
function fakeAdmin(rows: CatalogCoverRow[]) {
  const reactivated: string[] = [];
  // Se recalcula en cada consulta: refleja las reactivaciones hechas por `update()` mientras tanto.
  const byStatus = (value: string) =>
    rows
      .filter((r) => r.cover_status === value)
      .sort((a, b) => {
        if (a.cover_checked_at === b.cover_checked_at) return 0;
        if (a.cover_checked_at === null) return -1;
        if (b.cover_checked_at === null) return 1;
        return a.cover_checked_at.localeCompare(b.cover_checked_at);
      });

  const admin = {
    from: () => ({
      select: () => ({
        eq: (_col: string, value: string) => ({
          order: () => ({
            range: async (start: number, end: number) => ({
              data: byStatus(value).slice(start, end + 1),
              error: null,
            }),
          }),
        }),
      }),
      update: (patch: Partial<CatalogCoverRow>) => ({
        eq: async (_col: string, value: string) => {
          if (value === "unavailable") {
            for (const r of rows) {
              if (r.cover_status === "unavailable") {
                Object.assign(r, patch);
                reactivated.push(r.id);
              }
            }
          }
          return { error: null };
        },
      }),
    }),
  };
  return { admin: admin as unknown as SupabaseClient, reactivated };
}

function fakeCoverDb(): CatalogCoverDb {
  return {
    markStored: vi.fn(async () => undefined),
    markPending: vi.fn(async () => undefined),
    markUnavailable: vi.fn(async () => undefined),
  };
}

function fakeBucket(): CoverStore {
  return {
    upload: vi.fn(async (): Promise<"created" | "exists"> => "created"),
    download: vi.fn(async () => null),
  };
}

describe("backfillCovers", () => {
  it("procesa las filas pending ordenadas por cover_checked_at (nulls first) y suma el resumen", async () => {
    const rows = [
      row("a", { cover_checked_at: "2026-09-20T00:00:00Z" }),
      row("b", { cover_checked_at: null }),
      row("c", { cover_checked_at: "2026-09-21T00:00:00Z" }),
    ];
    const { admin } = fakeAdmin(rows);
    const order: string[] = [];
    const storeCover = vi.fn(async (r: CatalogCoverRow) => {
      order.push(r.id);
      return (r.id === "a" ? "stored" : r.id === "b" ? "unavailable" : "pending") as StoreOutcome;
    });

    const summary = await backfillCovers(
      { concurrency: 1 },
      { admin, bucket: fakeBucket(), coverDb: fakeCoverDb(), storeCoverFn: storeCover }
    );

    expect(order).toEqual(["b", "a", "c"]); // null primero, después por fecha ascendente
    expect(summary).toEqual({ processed: 3, stored: 1, pending: 1, unavailable: 1, skipped: 0 });
  });

  it("respeta 'limit'", async () => {
    const rows = [row("a"), row("b"), row("c")];
    const { admin } = fakeAdmin(rows);
    const storeCover = vi.fn(async () => "stored" as StoreOutcome);

    const summary = await backfillCovers(
      { limit: 2, concurrency: 1 },
      { admin, bucket: fakeBucket(), coverDb: fakeCoverDb(), storeCoverFn: storeCover }
    );

    expect(summary.processed).toBe(2);
    expect(storeCover).toHaveBeenCalledTimes(2);
  });

  it("dryRun: no llama a storeCover y sólo reporta lo que haría", async () => {
    const rows = [row("a"), row("b")];
    const { admin } = fakeAdmin(rows);
    const storeCover = vi.fn(async () => "stored" as StoreOutcome);

    const summary = await backfillCovers(
      { dryRun: true },
      { admin, bucket: fakeBucket(), coverDb: fakeCoverDb(), storeCoverFn: storeCover }
    );

    expect(summary).toEqual({ processed: 2, stored: 0, pending: 0, unavailable: 0, skipped: 0 });
    expect(storeCover).not.toHaveBeenCalled();
  });

  it("includeUnavailable reactiva (attempts=0, pending) antes de procesar", async () => {
    const rows = [
      row("a", { cover_status: "unavailable", cover_attempts: 5, cover_checked_at: "2026-09-20T00:00:00Z" }),
      row("b", { cover_status: "pending" }),
    ];
    const { admin, reactivated } = fakeAdmin(rows);
    const storeCover = vi.fn(async () => "stored" as StoreOutcome);

    const summary = await backfillCovers(
      { includeUnavailable: true, concurrency: 1 },
      { admin, bucket: fakeBucket(), coverDb: fakeCoverDb(), storeCoverFn: storeCover }
    );

    expect(reactivated).toEqual(["a"]);
    expect(summary.processed).toBe(2); // a (reactivada) + b
    const reactivatedRow = rows.find((r) => r.id === "a")!;
    expect(reactivatedRow.cover_status).toBe("pending");
    expect(reactivatedRow.cover_attempts).toBe(0);
  });

  it("dryRun + includeUnavailable no reactiva nada (un dry run nunca escribe)", async () => {
    const rows = [row("a", { cover_status: "unavailable" })];
    const { admin, reactivated } = fakeAdmin(rows);
    const storeCover = vi.fn(async () => "stored" as StoreOutcome);

    const summary = await backfillCovers(
      { includeUnavailable: true, dryRun: true },
      { admin, bucket: fakeBucket(), coverDb: fakeCoverDb(), storeCoverFn: storeCover }
    );

    expect(reactivated).toEqual([]);
    expect(summary.processed).toBe(0); // 'a' sigue unavailable, no entra en el listado pending
  });

  it("un fallo en un libro no detiene la migración del resto", async () => {
    const rows = [row("a"), row("b")];
    const { admin } = fakeAdmin(rows);
    const storeCover = vi.fn(async (r: CatalogCoverRow) => {
      if (r.id === "a") throw new Error("boom");
      return "stored" as StoreOutcome;
    });

    const summary = await backfillCovers(
      { concurrency: 1 },
      { admin, bucket: fakeBucket(), coverDb: fakeCoverDb(), storeCoverFn: storeCover }
    );

    expect(summary).toEqual({ processed: 2, stored: 1, pending: 0, unavailable: 0, skipped: 1 });
  });
});
