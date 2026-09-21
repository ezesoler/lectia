import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildKeys, hashHighlight, normalize } from "@/lib/import/normalize";
import {
  adminClient,
  createTestUser,
  deleteTestUser,
  hasSupabase,
  type TestUser,
} from "./helpers";

interface ItemOverrides {
  title?: string;
  author?: string;
  text?: string;
  kind?: "highlight" | "note";
  location?: string;
  [extra: string]: unknown;
}

export function makeItem(o: ItemOverrides = {}) {
  const title = o.title ?? "Hábitos atómicos";
  const author = o.author ?? "James Clear";
  const text = o.text ?? "Los hábitos son el interés compuesto de la superación personal.";
  const kind = o.kind ?? "highlight";
  const location = o.location ?? "10-11";
  const { titleKey, authorKey } = buildKeys(title, author);
  const textKey = normalize(text);
  const { title: _t, author: _a, text: _x, kind: _k, location: _l, ...extra } = o;
  return {
    title,
    author,
    title_key: titleKey,
    author_key: authorKey,
    kind,
    text,
    text_key: textKey,
    page: null,
    location,
    chapter: null,
    highlighted_at: null,
    hash: hashHighlight({ titleKey, authorKey, kind, textKey, location }),
    ...extra,
  };
}

describe.skipIf(!hasSupabase)("import_batch + esquema (Supabase local)", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    alice = await createTestUser("alice");
    bob = await createTestUser("bob");
  });

  afterAll(async () => {
    if (alice) await deleteTestUser(alice);
    if (bob) await deleteTestUser(bob);
  });

  async function newImport(user: TestUser, source: "kindle" | "kobo" = "kindle") {
    // Un solo import activo por origen: se cierra el anterior antes de abrir otro
    await user.client
      .from("imports")
      .update({ state: "done" })
      .eq("source", source)
      .in("state", ["queued", "parsing"]);
    const { data, error } = await user.client
      .from("imports")
      .insert({ user_id: user.id, source, state: "parsing", file_name: "x.txt", file_size: 10 })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    return data.id as string;
  }

  async function batch(
    user: TestUser,
    importId: string,
    items: unknown[],
    source: "kindle" | "kobo" = "kindle"
  ) {
    return user.client.rpc("import_batch", {
      p_import_id: importId,
      p_source: source,
      p_items: items,
    });
  }

  it("(a) inserta libros y resaltados con el user_id del token, no del payload", async () => {
    const importId = await newImport(alice);
    const { data, error } = await batch(alice, importId, [
      makeItem({ user_id: bob.id }),
      makeItem({ text: "Otra idea", location: "20" }),
    ]);
    expect(error).toBeNull();
    expect(data).toEqual([{ inserted: 2, duplicated: 0 }]);

    const { data: rows } = await alice.client.from("highlights").select("user_id, source");
    expect(rows).toHaveLength(2);
    expect(rows!.every((r) => r.user_id === alice.id && r.source === "kindle")).toBe(true);
    const { data: books } = await alice.client.from("books").select("id");
    expect(books).toHaveLength(1);
  });

  it("(b) reenviar el mismo lote no inserta nada", async () => {
    const importId = await newImport(alice);
    const { data } = await batch(alice, importId, [
      makeItem(),
      makeItem({ text: "Otra idea", location: "20" }),
    ]);
    expect(data).toEqual([{ inserted: 0, duplicated: 2 }]);
  });

  it("(c) los duplicados dentro de un mismo lote cuentan una sola vez", async () => {
    const importId = await newImport(alice, "kobo");
    const nuevo = makeItem({ text: "Frase repetida", location: "30" });
    const { data } = await batch(alice, importId, [nuevo, nuevo], "kobo");
    expect(data).toEqual([{ inserted: 1, duplicated: 1 }]);
  });

  it("(d) un libro existente conserva su source e imported_at", async () => {
    const { data: before } = await alice.client
      .from("books")
      .select("source, imported_at")
      .eq("title_key", "habitos atomicos")
      .single();
    expect(before?.source).toBe("kindle");

    const importId = await newImport(alice, "kobo");
    await batch(alice, importId, [makeItem({ text: "Desde Kobo", location: "x:0-4" })], "kobo");

    const { data: after } = await alice.client
      .from("books")
      .select("source, imported_at")
      .eq("title_key", "habitos atomicos")
      .single();
    expect(after).toEqual(before);
    const { data: kobo } = await alice.client
      .from("highlights")
      .select("source")
      .eq("text", "Desde Kobo")
      .single();
    expect(kobo?.source).toBe("kobo");
  });

  it("(e) el usuario B no ve ni puede usar los imports de A", async () => {
    const { data: seen } = await bob.client.from("imports").select("id");
    expect(seen).toEqual([]);

    const { data: aliceImports } = await alice.client.from("imports").select("id").limit(1);
    const foreign = aliceImports![0]!.id as string;
    const { error } = await batch(bob, foreign, [makeItem()]);
    expect(error?.message).toContain("import_not_found");

    const { data: bobHighlights } = await bob.client.from("highlights").select("id");
    expect(bobHighlights).toEqual([]);
  });

  it("(f) un segundo import activo del mismo origen viola el índice único parcial", async () => {
    await bob.client.from("imports").insert({
      user_id: bob.id,
      source: "kindle",
      state: "queued",
      file_name: "My Clippings.txt",
    });
    const { error } = await bob.client.from("imports").insert({
      user_id: bob.id,
      source: "kindle",
      state: "queued",
      file_name: "My Clippings.txt",
    });
    expect(error?.code).toBe("23505");

    const { error: otroOrigen } = await bob.client.from("imports").insert({
      user_id: bob.id,
      source: "kobo",
      state: "queued",
      file_name: "KoboReader.sqlite",
    });
    expect(otroOrigen).toBeNull();
  });

  it("(g) un usuario autenticado lee book_catalog pero no puede escribirlo", async () => {
    const admin = adminClient();
    const { error: adminError } = await admin.from("book_catalog").insert({
      title: "Hábitos atómicos",
      author: "James Clear",
      title_key: "habitos atomicos",
      author_key: "james clear",
      sources: ["open_library"],
    });
    expect(adminError).toBeNull();

    const { data } = await alice.client.from("book_catalog").select("title");
    expect(data!.length).toBeGreaterThan(0);

    const { error: insertError } = await alice.client.from("book_catalog").insert({
      title: "Falso",
      author: "Nadie",
      title_key: "falso",
      author_key: "nadie",
      sources: ["open_library"],
    });
    expect(insertError).not.toBeNull();

    const { data: updated } = await alice.client
      .from("book_catalog")
      .update({ title: "Hackeado" })
      .eq("title_key", "habitos atomicos")
      .select("id");
    expect(updated ?? []).toHaveLength(0);

    // sources vacío o inválido viola el check
    const { error: checkError } = await admin.from("book_catalog").insert({
      title: "X",
      author: "Y",
      title_key: "x",
      author_key: "y",
      sources: [],
    });
    expect(checkError).not.toBeNull();

    await admin.from("book_catalog").delete().eq("title_key", "habitos atomicos");
  });

  it("(h) misma cita y ubicación con kind distinto guarda las dos filas", async () => {
    const importId = await newImport(alice);
    const { data } = await batch(alice, importId, [
      makeItem({ text: "Cita compartida", location: "99", kind: "highlight" }),
      makeItem({ text: "Cita compartida", location: "99", kind: "note" }),
    ]);
    expect(data).toEqual([{ inserted: 2, duplicated: 0 }]);
  });

  it("actualiza los contadores del import en la misma transacción", async () => {
    const importId = await newImport(alice);
    await batch(alice, importId, [makeItem({ text: "Contador 1", location: "1" })]);
    await batch(alice, importId, [
      makeItem({ text: "Contador 1", location: "1" }),
      makeItem({ text: "Contador 2", location: "2" }),
    ]);
    const { data } = await alice.client
      .from("imports")
      .select("entries_done, highlights_new, highlights_dup")
      .eq("id", importId)
      .single();
    expect(data).toEqual({ entries_done: 3, highlights_new: 2, highlights_dup: 1 });
  });
});
