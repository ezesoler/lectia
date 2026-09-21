import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { adminDb, hasLocalSupabase, signInContext, type E2EUser } from "./helpers";

const fixture = (name: string) => resolve(__dirname, "../fixtures", name);

test.skip(!hasLocalSupabase, "requiere Supabase local (.env.test.local)");

test.describe("Reimportar tras leer más (US5)", () => {
  let user: E2EUser;

  test.beforeEach(async ({ context, baseURL }) => {
    user = await signInContext(context, baseURL!);
  });
  test.afterEach(async () => {
    await user.cleanup();
  });

  test("'Reemplazar archivo' con una versión ampliada suma sólo los 10 nuevos", async ({ page }) => {
    await page.goto("/importar");
    const card = page.getByTestId("card-kindle");

    await page.getByTestId("file-input-kindle").setInputFiles(fixture("clippings-es.txt"));
    await expect(card.getByTestId("summary-kindle")).toContainText("4 libros · 8 resaltados", {
      timeout: 30_000,
    });

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      card.getByRole("button", { name: "Reemplazar archivo" }).click(),
    ]);
    await chooser.setFiles(fixture("clippings-es-plus10.txt"));

    await expect(card.getByTestId("summary-kindle")).toContainText("4 libros · 18 resaltados", {
      timeout: 30_000,
    });
    await expect(card).toContainText("10 nuevos · 8 ya estaban");

    const { count } = await adminDb()
      .from("highlights")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count).toBe(18);
  });

  test("subir exactamente el mismo archivo no agrega nada", async ({ page }) => {
    await page.goto("/importar");
    const card = page.getByTestId("card-kindle");
    await page.getByTestId("file-input-kindle").setInputFiles(fixture("clippings-es.txt"));
    await expect(card.getByTestId("summary-kindle")).toContainText("8 resaltados", { timeout: 30_000 });

    await page.getByTestId("file-input-kindle").setInputFiles(fixture("clippings-es.txt"));
    await expect(card).toContainText("0 nuevos · 8 ya estaban", { timeout: 30_000 });

    const { count } = await adminDb()
      .from("highlights")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count).toBe(8);
  });
});
