// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { KoboFileError } from "@/lib/import/errors";
import { prepareItems, runImport } from "@/lib/import/run-import";
import type { ParsedEntry, ParseResult, ParserFn } from "@/lib/import/types";

const IMPORT = { importId: "imp-1", userId: "user-1" };

function entry(n: number, extra: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    title: "Los Simpson y la filosofía",
    author: "William Irwin",
    kind: "highlight",
    text: `Texto secreto número ${n}`,
    location: `${n}-${n + 1}`,
    ...extra,
  };
}

function result(partial: Partial<ParseResult>): ParseResult {
  return { entries: [], discarded: 0, discardBreakdown: {}, booksCount: 0, ...partial };
}

interface FakeOptions {
  /** Devuelve error para el n-ésimo lote (1-based). */
  failBatch?: number;
}

function makeDb(options: FakeOptions = {}) {
  const updates: Record<string, unknown>[] = [];
  const rpcCalls: { p_items: unknown[] }[] = [];
  let batchNumber = 0;
  const db = {
    from: () => ({
      update(payload: Record<string, unknown>) {
        updates.push(payload);
        const chain = {
          eq: () => chain,
          then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
    rpc: async (_name: string, args: { p_items: unknown[] }) => {
      batchNumber += 1;
      rpcCalls.push(args);
      if (options.failBatch === batchNumber) {
        return { data: null, error: { message: "boom" } };
      }
      return { data: [{ inserted: args.p_items.length, duplicated: 0 }], error: null };
    },
  } as unknown as SupabaseClient;
  return { db, updates, rpcCalls };
}

function makeDeps(
  parser: ParserFn,
  bytes: Uint8Array = new TextEncoder().encode("contenido"),
  options: FakeOptions & { batchSize?: number; source?: "kindle" | "kobo" } = {}
) {
  const { db, updates, rpcCalls } = makeDb(options);
  const remove = vi.fn(async () => undefined);
  const parsers = { kindle: parser, kobo: parser };
  return {
    deps: {
      db,
      storage: { download: async () => bytes, remove },
      parsers,
      batchSize: options.batchSize ?? 500,
      yieldFn: async () => undefined,
    },
    updates,
    rpcCalls,
    remove,
  };
}

const lastUpdate = (updates: Record<string, unknown>[]) => updates[updates.length - 1]!;

describe("runImport", () => {
  it("guarda por lotes, cuenta descartes y termina en done", async () => {
    const parser: ParserFn = () =>
      result({
        entries: [entry(1), entry(2), entry(3)],
        discarded: 2,
        discardBreakdown: { bookmark_no_text: 2 },
        booksCount: 1,
      });
    const { deps, updates, rpcCalls, remove } = makeDeps(parser, undefined, { batchSize: 2 });

    const outcome = await runImport({ ...IMPORT, source: "kindle" }, deps);

    expect(outcome.state).toBe("done");
    expect(outcome.books).toHaveLength(1);
    expect(rpcCalls).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      entries_total: 5,
      entries_done: 2,
      discarded: 2,
      books_count: 1,
      discard_breakdown: { bookmark_no_text: 2 },
    });
    expect(lastUpdate(updates)).toMatchObject({ state: "done" });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("borra el archivo también cuando falla", async () => {
    const parser: ParserFn = () => {
      throw new Error("kaboom");
    };
    const { deps, updates, remove } = makeDeps(parser);

    const outcome = await runImport({ ...IMPORT, source: "kindle" }, deps);

    expect(outcome.state).toBe("error");
    expect(lastUpdate(updates)).toMatchObject({ state: "error", error_code: "ERR_IMPORT_5001" });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("rechaza sin parsear un archivo Kobo que no es SQLite", async () => {
    const parser = vi.fn<ParserFn>(() => result({}));
    const { deps, updates } = makeDeps(parser, new TextEncoder().encode("%PDF-1.7 ..."));

    await runImport({ ...IMPORT, source: "kobo" }, deps);

    expect(parser).not.toHaveBeenCalled();
    expect(lastUpdate(updates)).toMatchObject({ state: "error", error_code: "ERR_IMPORT_4002" });
  });

  it("traduce KoboFileError al código de formato correspondiente", async () => {
    const sqlite = new TextEncoder().encode("SQLite format 3\u0000 resto");
    const parser: ParserFn = () => {
      throw new KoboFileError("corrupt");
    };
    const { deps, updates } = makeDeps(parser, sqlite);

    await runImport({ ...IMPORT, source: "kobo" }, deps);

    expect(lastUpdate(updates)).toMatchObject({ error_code: "ERR_IMPORT_4003" });
  });

  it("un archivo sin registros reconocibles es error de formato con detalle truncado", async () => {
    const parser: ParserFn = () =>
      result({ linesRead: 1284, firstLine: `# Resaltados exportados ${"x".repeat(200)}` });
    const { deps, updates } = makeDeps(parser);

    await runImport({ ...IMPORT, source: "kindle" }, deps);

    const update = lastUpdate(updates);
    expect(update).toMatchObject({ error_code: "ERR_IMPORT_4001" });
    const details = update["error_details"] as { linesRead: number; found: string; validRecords: number };
    expect(details.linesRead).toBe(1284);
    expect(details.validRecords).toBe(0);
    expect(details.found.length).toBeLessThanOrEqual(80);
  });

  it("todo descartado es 4005 y conserva el desglose", async () => {
    const parser: ParserFn = () =>
      result({ discarded: 4, discardBreakdown: { truncated: 4 }, linesRead: 40 });
    const { deps, updates } = makeDeps(parser);

    await runImport({ ...IMPORT, source: "kindle" }, deps);

    expect(lastUpdate(updates)).toMatchObject({
      error_code: "ERR_IMPORT_4005",
      discarded: 4,
      discard_breakdown: { truncated: 4 },
      entries_total: 4,
    });
  });

  it("un lote que falla a mitad conserva lo guardado y lo dice", async () => {
    const parser: ParserFn = () => result({ entries: [entry(1), entry(2), entry(3)] });
    const { deps, updates } = makeDeps(parser, undefined, { batchSize: 2, failBatch: 2 });

    const outcome = await runImport({ ...IMPORT, source: "kindle" }, deps);

    expect(outcome.state).toBe("error");
    const update = lastUpdate(updates);
    expect(update).toMatchObject({ error_code: "ERR_IMPORT_5031" });
    expect(update["error_message"]).toContain("Lo que ya se guardó se conserva");
    expect(update["error_message"]).not.toContain("No se guardó nada");
  });

  it("si falla el primer lote afirma que no se guardó nada", async () => {
    const parser: ParserFn = () => result({ entries: [entry(1)] });
    const { deps, updates } = makeDeps(parser, undefined, { failBatch: 1 });

    await runImport({ ...IMPORT, source: "kindle" }, deps);

    expect(lastUpdate(updates)["error_message"]).toContain("No se guardó nada");
  });

  it("nunca vuelca texto de resaltados en los campos de error", async () => {
    const parser: ParserFn = () => result({ entries: [entry(1)] });
    const { deps, updates } = makeDeps(parser, undefined, { failBatch: 1 });

    await runImport({ ...IMPORT, source: "kindle" }, deps);

    expect(JSON.stringify(lastUpdate(updates))).not.toContain("Texto secreto");
  });
});

describe("prepareItems", () => {
  it("descarta el texto que queda vacío al normalizar y quita NUL", () => {
    const { items, extraDiscarded } = prepareItems([
      entry(1, { text: "¡¿ … !?" }),
      entry(2, { text: "Hola\u0000 mundo" }),
    ]);
    expect(extraDiscarded).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Hola mundo");
    expect(items[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("descarta páginas fuera de rango en vez de romper el lote", () => {
    const { items } = prepareItems([entry(1, { page: 99_999_999_999 }), entry(2, { page: 12 })]);
    expect(items[0]!.page).toBeNull();
    expect(items[1]!.page).toBe(12);
  });
});
