import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { adminDb, hasLocalSupabase, signInContext, type E2EUser } from "./helpers";

const fixture = (name: string) => resolve(__dirname, "../fixtures", name);

test.skip(!hasLocalSupabase, "requiere Supabase local (.env.test.local)");

test.describe("Importar Kindle (US1)", () => {
  let user: E2EUser;

  test.beforeEach(async ({ context, baseURL }) => {
    user = await signInContext(context, baseURL!);
  });

  test.afterEach(async () => {
    await user.cleanup();
  });

  test("subir My Clippings.txt muestra el resumen y habilita la biblioteca", async ({ page }) => {
    await page.goto("/importar");

    const cta = page.getByTestId("cta-library");
    await expect(cta).toHaveAttribute("aria-disabled", "true");

    await page.getByTestId("file-input-kindle").setInputFiles(fixture("clippings-es.txt"));

    const card = page.getByTestId("card-kindle");
    await expect(card.getByTestId("summary-kindle")).toContainText("4 libros · 8 resaltados", {
      timeout: 30_000,
    });
    await expect(card.getByTestId("summary-kindle")).toContainText("listo");
    // 2 marcas descartadas (un marcador y un registro sin texto): aviso, no error
    await expect(card.getByTestId("partial-notice")).toContainText("2 registros quedaron afuera");
    await expect(card.getByTestId("error-format")).toHaveCount(0);

    await expect(cta).not.toHaveAttribute("aria-disabled", "true");
    await expect(cta).toHaveAttribute("href", "/");

    const { count } = await adminDb()
      .from("highlights")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count).toBe(8);
  });

  test("un archivo con otra extensión se rechaza antes de subir", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kindle").setInputFiles({
      name: "resaltados.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7"),
    });
    await expect(page.getByTestId("message-kindle")).toContainText("Buscá My Clippings.txt");
    await expect(page.getByTestId("card-kindle")).toHaveAttribute("data-phase", "idle");
  });

  test("un PDF renombrado a .txt termina en error de formato y no guarda nada", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kindle").setInputFiles({
      name: "notas.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"),
    });

    const card = page.getByTestId("card-kindle");
    const error = card.getByTestId("error-format");
    await expect(error).toContainText("No pudimos leer este archivo", { timeout: 30_000 });
    await expect(error).toContainText("notas.txt");
    await expect(page.getByTestId("cta-library")).toHaveAttribute("aria-disabled", "true");

    const { count } = await adminDb()
      .from("highlights")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count).toBe(0);
  });
});
