import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  anonKey,
  createTestUser,
  deleteTestUser,
  hasSupabase,
  url,
  type TestUser,
} from "./helpers";

// La sesión sale del usuario de prueba en lugar de las cookies de Next
let currentClient: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

// El enriquecimiento (APIs externas) se prueba aparte, con `fetch` simulado
vi.mock("@/lib/enrichment/enrich-import", () => ({ enrichImportBooks: vi.fn(async () => ({})) }));

// `after()` sólo existe dentro de una petición de Next: se reemplaza por una cola que la prueba espera
// Las tareas quedan en cola y la prueba decide cuándo correrlas (simula el trabajo de fondo)
const pending: (() => Promise<void> | void)[] = [];
const drain = async () => {
  await Promise.all(pending.splice(0).map((task) => task()));
};
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => Promise<void> | void) => {
      pending.push(task);
    },
  };
});

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name));

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/imports/route");
  return POST(new Request("http://localhost/api/imports", { method: "POST", body: JSON.stringify(body) }));
}
async function callGet(id: string) {
  const { GET } = await import("@/app/api/imports/[id]/route");
  return GET(new Request(`http://localhost/api/imports/${id}`), { params: Promise.resolve({ id }) });
}
async function callDelete(id: string) {
  const { DELETE } = await import("@/app/api/imports/[id]/route");
  return DELETE(new Request(`http://localhost/api/imports/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}
async function callParse(id: string) {
  const { POST } = await import("@/app/api/imports/[id]/parse/route");
  return POST(new Request(`http://localhost/api/imports/${id}/parse`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

async function createImport(source: "kindle" | "kobo", fileName: string, size: number) {
  const res = await callPost({ source, fileName, fileSize: size });
  return { res, json: (await res.json()) as Record<string, any> };
}

async function upload(path: string, token: string, bytes: Uint8Array) {
  const { error } = await adminClient()
    .storage.from("imports")
    .uploadToSignedUrl(path, token, new Blob([bytes as BlobPart]));
  expect(error).toBeNull();
}

async function objectExists(userId: string, importId: string) {
  const { data } = await adminClient().storage.from("imports").list(userId, { search: importId });
  return Boolean(data?.some((f) => f.name === importId));
}

async function runToCompletion(importId: string) {
  const res = await callParse(importId);
  await drain();
  return res;
}

describe.skipIf(!hasSupabase)("API /api/imports (Supabase local)", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    pending.length = 0;
    alice = await createTestUser("alice");
    bob = await createTestUser("bob");
    currentClient = alice.client;
  });

  afterEach(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it("401 sin sesión", async () => {
    currentClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const res = await callPost({ source: "kindle", fileName: "My Clippings.txt", fileSize: 10 });
    expect(res.status).toBe(401);
    expect((await callGet("00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });

  it("400 por extensión, tamaño y origen", async () => {
    const badExt = await createImport("kindle", "resaltados.pdf", 10);
    expect(badExt.res.status).toBe(400);
    expect(badExt.json["error"].details.reason).toBe("extension");

    const big = await createImport("kobo", "KoboReader.sqlite", 60 * 1024 * 1024);
    expect(big.res.status).toBe(400);
    expect(big.json["error"].details.reason).toBe("too_large");

    const empty = await createImport("kindle", "My Clippings.txt", 0);
    expect(empty.json["error"].details.reason).toBe("empty");

    const source = await callPost({ source: "manual", fileName: "x.txt", fileSize: 10 });
    expect(source.status).toBe(400);
  });

  it("404 sobre el import de otro usuario", async () => {
    const { json } = await createImport("kindle", "My Clippings.txt", 100);
    currentClient = bob.client;
    expect((await callGet(json["importId"])).status).toBe(404);
    expect((await callParse(json["importId"])).status).toBe(404);
    expect((await callDelete(json["importId"])).status).toBe(404);
  });

  it("flujo completo Kindle: sube, parsea, persiste y borra el archivo", async () => {
    const bytes = fixture("clippings-es.txt");
    const { res, json } = await createImport("kindle", "My Clippings.txt", bytes.length);
    expect(res.status).toBe(201);
    const importId = json["importId"] as string;
    expect(json["upload"].path).toBe(`${alice.id}/${importId}`);

    await upload(json["upload"].path, json["upload"].token, bytes);
    expect(await objectExists(alice.id, importId)).toBe(true);

    const parse = await runToCompletion(importId);
    expect(parse.status).toBe(202);

    const status = await (await callGet(importId)).json();
    expect(status).toMatchObject({
      state: "done",
      booksCount: 4,
      highlightsNew: 8,
      highlightsDup: 0,
      discarded: 2,
      discardBreakdown: { bookmark_no_text: 1, empty_text: 1 },
      entriesTotal: 10,
      entriesDone: 10,
      errorCode: null,
    });

    const { data: rows } = await alice.client.from("highlights").select("id, source, hash");
    expect(rows).toHaveLength(8);
    expect(new Set(rows!.map((r) => r.hash)).size).toBe(8);
    const { data: books } = await alice.client.from("books").select("id");
    expect(books).toHaveLength(4);

    // FR-004: el archivo original se elimina al terminar
    expect(await objectExists(alice.id, importId)).toBe(false);
  });

  it("un PDF subido como Kindle termina en error de formato y no toca datos previos", async () => {
    // Datos previos
    const first = await createImport("kindle", "My Clippings.txt", 10);
    const bytes = fixture("clippings-en.txt");
    await upload(first.json["upload"].path, first.json["upload"].token, bytes);
    await runToCompletion(first.json["importId"]);
    const { count: before } = await alice.client
      .from("highlights")
      .select("id", { count: "exact", head: true });

    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
    const second = await createImport("kindle", "My Clippings.txt", pdf.length);
    await upload(second.json["upload"].path, second.json["upload"].token, pdf);
    await runToCompletion(second.json["importId"]);

    const status = await (await callGet(second.json["importId"])).json();
    expect(status).toMatchObject({ state: "error", errorCode: "ERR_IMPORT_4001" });
    expect(status.errorDetails.found).toBe("%PDF-1.7");
    expect(status.errorDetails.validRecords).toBe(0);
    expect(status.errorMessage).toContain("No se guardó nada");

    const { count: after } = await alice.client
      .from("highlights")
      .select("id", { count: "exact", head: true });
    expect(after).toBe(before);
    expect(await objectExists(alice.id, second.json["importId"])).toBe(false);
  });

  it("parse es idempotente: la segunda llamada no lanza otro trabajo", async () => {
    const bytes = fixture("clippings-en.txt");
    const { json } = await createImport("kindle", "My Clippings.txt", bytes.length);
    await upload(json["upload"].path, json["upload"].token, bytes);

    const a = await callParse(json["importId"]);
    const b = await callParse(json["importId"]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(pending).toHaveLength(1);
    await drain();

    // ya terminado: no se puede volver a parsear
    expect((await callParse(json["importId"])).status).toBe(409);
  });

  it("422 si se pide parsear sin haber subido el archivo", async () => {
    const { json } = await createImport("kindle", "My Clippings.txt", 100);
    const res = await callParse(json["importId"]);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("file_missing");
  });

  it("409 import_in_progress si ya hay uno activo del mismo origen; el otro origen no se bloquea", async () => {
    const first = await createImport("kindle", "My Clippings.txt", 100);
    const second = await createImport("kindle", "My Clippings.txt", 100);
    expect(second.res.status).toBe(409);
    expect(second.json["error"].code).toBe("import_in_progress");
    expect(second.json["error"].details.importId).toBe(first.json["importId"]);

    const kobo = await createImport("kobo", "KoboReader.sqlite", 100);
    expect(kobo.res.status).toBe(201);
  });

  it("DELETE cancela un import en queued y falla si ya está en curso", async () => {
    const { json } = await createImport("kindle", "My Clippings.txt", 100);
    expect((await callDelete(json["importId"])).status).toBe(204);
    expect((await callGet(json["importId"])).status).toBe(404);

    const bytes = fixture("clippings-en.txt");
    const running = await createImport("kindle", "My Clippings.txt", bytes.length);
    await upload(running.json["upload"].path, running.json["upload"].token, bytes);
    await callParse(running.json["importId"]);
    const res = await callDelete(running.json["importId"]);
    expect(res.status).toBe(409);
    await drain();
  });
});
