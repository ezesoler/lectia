import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { adminDb, hasLocalSupabase, signInContext, type E2EUser } from "./helpers";

const fixture = (name: string) => resolve(__dirname, "../fixtures", name);

test.skip(!hasLocalSupabase, "requiere Supabase local (.env.test.local)");

test.describe("Importar Kobo (US2)", () => {
  let user: E2EUser;

  test.beforeEach(async ({ context, baseURL }) => {
    user = await signInContext(context, baseURL!);
  });

  test.afterEach(async () => {
    await user.cleanup();
  });

  test("subir KoboReader.sqlite muestra el resumen con el desglose de descartes", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kobo").setInputFiles(fixture("kobo-valid.sqlite"));

    const card = page.getByTestId("card-kobo");
    await expect(card.getByTestId("summary-kobo")).toContainText("2 libros · 4 resaltados", {
      timeout: 30_000,
    });
    const notice = card.getByTestId("partial-notice");
    await expect(notice).toContainText("4 registros quedaron afuera");
    await expect(notice).toContainText("2 marcadores sin texto");
    await expect(page.getByTestId("cta-library")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("un Kobo sin anotaciones termina en error con mensaje específico", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kobo").setInputFiles(fixture("kobo-empty.sqlite"));

    const error = page.getByTestId("card-kobo").getByTestId("error-format");
    await expect(error).toContainText("No pudimos leer este archivo", { timeout: 30_000 });
    await expect(error).toContainText("ningún resaltado ni nota");
    await expect(error.getByRole("button", { name: "Elegir otro archivo" })).toBeVisible();
  });

  test("un archivo que no es SQLite se rechaza con el mensaje de formato", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kobo").setInputFiles({
      name: "KoboReader.sqlite",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("esto no es una base de datos"),
    });
    const error = page.getByTestId("card-kobo").getByTestId("error-format");
    await expect(error).toContainText("no es una base de datos de Kobo", { timeout: 30_000 });
    await error.getByRole("button", { name: "Ver detalle" }).click();
    await expect(error).toContainText("La cabecera del archivo no es SQLite");
  });

  test("Kindle y Kobo se importan en cualquier orden y el libro común se fusiona", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kobo").setInputFiles(fixture("kobo-valid.sqlite"));
    await expect(page.getByTestId("summary-kobo")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("file-input-kindle").setInputFiles(fixture("clippings-es.txt"));
    await expect(page.getByTestId("summary-kindle")).toBeVisible({ timeout: 30_000 });

    // El texto de estado sólo se ve en escritorio (en mobile queda oculto, como en el mockup)
    await expect(page.locator(".lec-imp-foot-status")).toHaveText("Kindle y Kobo listos");

    const { count } = await adminDb()
      .from("books")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count).toBe(5); // 4 de Kindle + Steve Jobs; "Hábitos atómicos" es uno solo
  });
});
