import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser, hasSupabase, importFile, type TestUser } from "./helpers";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures", name)));

async function habitosSummary(user: TestUser) {
  const { data: books } = await user.client
    .from("books")
    .select("id, source, title_key")
    .eq("title_key", "habitos atomicos");
  expect(books).toHaveLength(1);
  const { data: highlights } = await user.client
    .from("highlights")
    .select("source")
    .eq("book_id", books![0]!.id);
  const bySource = { kindle: 0, kobo: 0 };
  for (const h of highlights ?? []) bySource[h.source as "kindle" | "kobo"] += 1;
  return { bookSource: books![0]!.source as string, bySource };
}

describe.skipIf(!hasSupabase)("fusión de orígenes Kindle + Kobo (SC-006, FR-011/012/024)", () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser("merge");
  });
  afterEach(async () => {
    await deleteTestUser(user);
  });

  it("Kindle y luego Kobo: el libro común es uno solo y cada resaltado conserva su origen", async () => {
    const k = await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    expect(k.row["state"]).toBe("done");
    const o = await importFile(user, "kobo", fixture("kobo-valid.sqlite"), "KoboReader.sqlite");
    expect(o.row["state"]).toBe("done");
    expect(o.row).toMatchObject({ books_count: 2, highlights_new: 4, discarded: 4 });

    // 4 libros de Kindle + Steve Jobs; "Hábitos atómicos" (Clear, James / James Clear) se fusiona
    const { data: books } = await user.client.from("books").select("id");
    expect(books).toHaveLength(5);

    const habitos = await habitosSummary(user);
    expect(habitos.bookSource).toBe("kindle"); // el libro conserva el origen con el que nació
    expect(habitos.bySource).toEqual({ kindle: 2, kobo: 3 }); // 2 subrayados + 1 nota de Kobo
  });

  it("Kobo y luego Kindle da la misma fusión (cualquier orden)", async () => {
    await importFile(user, "kobo", fixture("kobo-valid.sqlite"), "KoboReader.sqlite");
    await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");

    const { data: books } = await user.client.from("books").select("id");
    expect(books).toHaveLength(5);
    const habitos = await habitosSummary(user);
    expect(habitos.bookSource).toBe("kobo");
    expect(habitos.bySource).toEqual({ kindle: 2, kobo: 3 });
  });

  it("los dos orígenes son independientes: reimportar uno no toca al otro", async () => {
    await importFile(user, "kindle", fixture("clippings-es.txt"), "My Clippings.txt");
    await importFile(user, "kobo", fixture("kobo-valid.sqlite"), "KoboReader.sqlite");
    const { count: before } = await user.client
      .from("highlights")
      .select("id", { count: "exact", head: true });

    const again = await importFile(user, "kobo", fixture("kobo-valid.sqlite"), "KoboReader.sqlite");
    expect(again.row).toMatchObject({ highlights_new: 0, highlights_dup: 4 });

    const { count: after } = await user.client
      .from("highlights")
      .select("id", { count: "exact", head: true });
    expect(after).toBe(before);
  });
});
