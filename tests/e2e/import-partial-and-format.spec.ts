import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { hasLocalSupabase, signInContext, type E2EUser } from "./helpers";

const fixture = (name: string) => resolve(__dirname, "../fixtures", name);

test.skip(!hasLocalSupabase, "requiere Supabase local (.env.test.local)");

test.describe("Importación parcial y error de formato (US4)", () => {
  let user: E2EUser;

  test.beforeEach(async ({ context, baseURL }) => {
    user = await signInContext(context, baseURL!);
  });
  test.afterEach(async () => {
    await user.cleanup();
  });

  test("un archivo con registros rotos termina en done con el aviso de importación parcial", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kindle").setInputFiles(fixture("clippings-broken.txt"));

    const card = page.getByTestId("card-kindle");
    await expect(card.getByTestId("summary-kindle")).toContainText("5 libros · 90 resaltados", {
      timeout: 30_000,
    });
    await expect(card.getByText("listo")).toBeVisible();

    const notice = card.getByTestId("partial-notice");
    await expect(notice).toContainText("10 registros quedaron afuera");
    await expect(notice).toContainText("6 marcadores sin texto");
    await expect(notice).toContainText("2 registros truncados");
    await expect(notice).toContainText("1 registro sin título de libro");
    await expect(notice).toContainText("1 registro sin texto");
    await expect(card.getByTestId("error-format")).toHaveCount(0);
    await expect(card.getByText("Descargar el detalle")).toHaveCount(0);

    await expect(page.getByTestId("cta-library")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("un archivo que no es un clippings muestra el detalle plegado y no bloquea el otro origen", async ({
    page,
  }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kindle").setInputFiles(fixture("clippings-not-clippings.txt"));

    const card = page.getByTestId("card-kindle");
    const error = card.getByTestId("error-format");
    await expect(error).toContainText("No pudimos leer este archivo", { timeout: 30_000 });
    await expect(error).toContainText("clippings-not-clippings.txt");
    await expect(card).toContainText("No se guardó nada de este intento");

    // El detalle arranca plegado
    await expect(error.getByText("líneas leídas")).toHaveCount(0);
    await error.getByRole("button", { name: "Ver detalle" }).click();
    await expect(error).toContainText("8 líneas leídas · 0 registros válidos");
    await expect(error).toContainText("se esperaba «Título (Autor)», se encontró «# Resaltados exportados»");
    await expect(error).toContainText("No se encontró ningún separador «==========»");

    // "Dónde está el archivo" abre la ayuda
    await error.getByRole("button", { name: "Dónde está el archivo" }).click();
    await expect(error).toContainText("carpeta documents");

    // El otro origen sigue utilizable y la biblioteca se habilita cuando termina bien
    await expect(page.getByTestId("cta-library")).toHaveAttribute("aria-disabled", "true");
    await page.getByTestId("file-input-kobo").setInputFiles(fixture("kobo-valid.sqlite"));
    await expect(page.getByTestId("summary-kobo")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("cta-library")).not.toHaveAttribute("aria-disabled", "true");
    await expect(card.getByTestId("error-format")).toBeVisible(); // el error de Kindle sigue ahí
  });

  test("un PDF renombrado a .txt es un error de formato", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kindle").setInputFiles({
      name: "resaltados.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"),
    });
    await expect(page.getByTestId("card-kindle").getByTestId("error-format")).toContainText(
      "No pudimos leer este archivo",
      { timeout: 30_000 }
    );
  });
});
