import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bigClippings, bigKobo } from "../fixtures/gen-large";
import { createTestUser, deleteTestUser, hasSupabase, importFile, type TestUser } from "./helpers";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasSupabase)("rendimiento (SC-001, SC-002, SC-007)", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser("perf");
  });
  afterEach(async () => {
    await deleteTestUser(user);
  });

  /** Mide el tiempo total y cuánto tarda en aparecer el primer progreso visible. */
  async function timed(source: "kindle" | "kobo", bytes: Uint8Array, name: string) {
    const start = Date.now();
    let firstProgress: number | null = null;
    let polling = true;
    const poller = (async () => {
      while (polling && firstProgress === null) {
        const { data } = await user.client
          .from("imports")
          .select("entries_total")
          .eq("source", source)
          .in("state", ["parsing"])
          .maybeSingle();
        if (data && (data.entries_total as number) > 0) firstProgress = Date.now() - start;
        await sleep(20);
      }
    })();
    const { row } = await importFile(user, source, bytes, name);
    polling = false;
    await poller;
    return { row, total: Date.now() - start, firstProgress };
  }

  it("Kindle con 5.000 resaltados en menos de 60 s, con progreso visible en < 3 s", async () => {
    const { row, total, firstProgress } = await timed("kindle", bigClippings(5000), "My Clippings.txt");
    console.log(`[perf] Kindle 5000: total ${total} ms, primer progreso ${firstProgress} ms`);
    expect(row).toMatchObject({ state: "done", highlights_new: 5000, entries_total: 5000 });
    expect(total).toBeLessThan(60_000);
    expect(firstProgress).not.toBeNull();
    expect(firstProgress!).toBeLessThan(3000);
  });

  it("Kobo con 3.000 resaltados en menos de 60 s, con progreso visible en < 3 s", async () => {
    const { row, total, firstProgress } = await timed("kobo", await bigKobo(3000), "KoboReader.sqlite");
    console.log(`[perf] Kobo 3000: total ${total} ms, primer progreso ${firstProgress} ms`);
    expect(row).toMatchObject({ state: "done", highlights_new: 3000, entries_total: 3000 });
    expect(total).toBeLessThan(60_000);
    expect(firstProgress).not.toBeNull();
    expect(firstProgress!).toBeLessThan(3000);
  });
});
