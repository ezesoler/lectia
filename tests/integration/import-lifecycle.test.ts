import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expireStaleImports } from "@/lib/import/stale";
import {
  adminClient,
  createTestUser,
  deleteTestUser,
  hasSupabase,
  importFile,
  type TestUser,
} from "./helpers";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures", name)));
const encode = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Kindle sintético de N entradas válidas (todas distintas). */
function bigClippings(n: number): Uint8Array {
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(
      `Libro ${i % 20} (Autor ${i % 20})\r\n- Your Highlight on page ${i} | location ${i}-${i + 1} | Added on Monday, 3 March 2025 10:23:45 AM\r\n\r\nFrase número ${i} de prueba\r\n==========\r\n`
    );
  }
  return encode(parts.join(""));
}

describe.skipIf(!hasSupabase)("ciclo de vida de un import (progreso, concurrencia, latido)", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser("lifecycle");
  });
  afterEach(async () => {
    await deleteTestUser(user);
  });

  it("entries_done crece entre sondeos durante un archivo grande y termina en entries_total", async () => {
    const seen: number[] = [];
    let polling = true;
    let importId: string | null = null;

    const poller = (async () => {
      while (polling) {
        const { data } = await user.client
          .from("imports")
          .select("id, entries_done, state")
          .in("state", ["parsing"])
          .maybeSingle();
        if (data) {
          importId = data.id as string;
          seen.push(data.entries_done as number);
        }
        await sleep(15);
      }
    })();

    const { row } = await importFile(user, "kindle", bigClippings(3000), "My Clippings.txt", {
      batchSize: 250,
      yieldFn: () => sleep(40), // deja ver el progreso entre lotes
    });
    polling = false;
    await poller;

    expect(importId).not.toBeNull();
    const distinct = [...new Set(seen)];
    expect(distinct.length).toBeGreaterThan(2);
    expect([...distinct].sort((a, b) => a - b)).toEqual(distinct); // nunca retrocede
    expect(row).toMatchObject({ state: "done", entries_total: 3000, entries_done: 3000, highlights_new: 3000 });
  });

  it("dos orígenes en paralelo no se afectan", async () => {
    const [k, o] = await Promise.all([
      importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt"),
      importFile(user, "kobo", fixture("kobo-valid.sqlite"), "KoboReader.sqlite"),
    ]);
    expect(k.row["state"]).toBe("done");
    expect(o.row["state"]).toBe("done");
    expect(k.row["highlights_new"]).toBe(8);
    expect(o.row["highlights_new"]).toBe(4);
  });

  it("un import sin latido por más de 5 min pasa a error 5031 y libera el cupo (FR-025)", async () => {
    const admin = adminClient();
    const { data } = await user.client
      .from("imports")
      .insert({ user_id: user.id, source: "kindle", state: "parsing", file_name: "My Clippings.txt", highlights_new: 0 })
      .select("id")
      .single();
    const id = data!.id as string;
    await admin
      .from("imports")
      .update({ updated_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      .eq("id", id);
    await admin.storage.from("imports").upload(`${user.id}/${id}`, new Blob(["huérfano"]));

    // Mientras esté "vivo" bloquea a un segundo import del mismo origen
    const blocked = await user.client
      .from("imports")
      .insert({ user_id: user.id, source: "kindle", state: "queued", file_name: "x.txt" });
    expect(blocked.error?.code).toBe("23505");

    const expired = await expireStaleImports(
      {
        db: user.client,
        removeObjects: async (paths) => {
          await admin.storage.from("imports").remove(paths);
        },
      },
      user.id
    );
    expect(expired).toBe(1);

    const { data: row } = await user.client
      .from("imports")
      .select("state, error_code, error_message, finished_at")
      .eq("id", id)
      .single();
    expect(row).toMatchObject({ state: "error", error_code: "ERR_IMPORT_5031" });
    expect(row!.error_message).toContain("No se guardó nada");
    expect(row!.finished_at).not.toBeNull();

    // Cupo liberado y objeto huérfano borrado
    const again = await user.client
      .from("imports")
      .insert({ user_id: user.id, source: "kindle", state: "queued", file_name: "My Clippings.txt" });
    expect(again.error).toBeNull();
    const { data: files } = await admin.storage.from("imports").list(user.id);
    expect(files?.some((f) => f.name === id)).toBe(false);
  });

  it("un import muerto que ya había guardado algo lo dice en el mensaje", async () => {
    const admin = adminClient();
    const { data } = await user.client
      .from("imports")
      .insert({ user_id: user.id, source: "kobo", state: "parsing", file_name: "KoboReader.sqlite", highlights_new: 40 })
      .select("id")
      .single();
    await admin
      .from("imports")
      .update({ updated_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      .eq("id", data!.id);

    await expireStaleImports({ db: user.client, removeObjects: async () => undefined }, user.id, "kobo");

    const { data: row } = await user.client.from("imports").select("error_message").eq("id", data!.id).single();
    expect(row!.error_message).toContain("Lo que ya se guardó se conserva");
  });

  it("un import activo con latido reciente no se toca", async () => {
    const { data } = await user.client
      .from("imports")
      .insert({ user_id: user.id, source: "kindle", state: "parsing", file_name: "My Clippings.txt" })
      .select("id")
      .single();
    const expired = await expireStaleImports(
      { db: user.client, removeObjects: async () => undefined },
      user.id
    );
    expect(expired).toBe(0);
    const { data: row } = await user.client.from("imports").select("state").eq("id", data!.id).single();
    expect(row!.state).toBe("parsing");
  });
});
