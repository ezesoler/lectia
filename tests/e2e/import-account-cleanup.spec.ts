import { expect, test } from "@playwright/test";
import { adminDb, hasLocalSupabase, signInContext, type E2EUser } from "./helpers";

test.skip(!hasLocalSupabase, "requiere Supabase local (.env.test.local)");

// Feature 001 (borrado de cuenta) + 002: el bucket `imports` no tiene políticas para el usuario,
// así que la limpieza de archivos temporales debe ir con service_role (H6). Los datos importados
// desaparecen en cascada desde auth.users (Principio I).
test.describe("Borrado de cuenta con datos importados", () => {
  let user: E2EUser;

  test.beforeEach(async ({ context, baseURL }) => {
    user = await signInContext(context, baseURL!);
  });
  test.afterEach(async () => {
    await user.cleanup();
  });

  test("DELETE /api/profile borra el usuario, sus importaciones y el archivo huérfano", async ({
    context,
  }) => {
    const db = adminDb();
    const { data: imp } = await db
      .from("imports")
      .insert({ user_id: user.id, source: "kindle", state: "parsing", file_name: "My Clippings.txt" })
      .select("id")
      .single();
    const { data: book } = await db
      .from("books")
      .insert({ user_id: user.id, title: "T", author: "A", title_key: "t", author_key: "a", source: "kindle" })
      .select("id")
      .single();
    await db.from("highlights").insert({
      user_id: user.id, book_id: book!.id, text: "x", text_key: "x", source: "kindle", hash: "h", import_id: imp!.id,
    });
    await db.storage.from("imports").upload(`${user.id}/${imp!.id}`, new Blob(["huérfano"]));

    const res = await context.request.delete("/api/profile");
    expect(res.status()).toBe(204);

    const { data: files } = await db.storage.from("imports").list(user.id);
    expect(files ?? []).toHaveLength(0);
    for (const table of ["imports", "books", "highlights"] as const) {
      const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("user_id", user.id);
      expect(count).toBe(0);
    }
    const { data: users } = await db.auth.admin.listUsers();
    expect(users.users.some((u) => u.id === user.id)).toBe(false);
  });
});
