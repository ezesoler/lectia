import { expect, test } from "@playwright/test";
import { adminDb, hasLocalSupabase, signInContext, type E2EUser } from "./helpers";

test.skip(!hasLocalSupabase, "requiere Supabase local (.env.test.local)");

function bigClippings(n: number): Buffer {
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(
      `Libro ${i % 20} (Autor ${i % 20})\r\n- Your Highlight on page ${i} | location ${i}-${i + 1} | Added on Monday, 3 March 2025 10:23:45 AM\r\n\r\nFrase número ${i} de prueba\r\n==========\r\n`
    );
  }
  return Buffer.from(parts.join(""));
}

test.describe("Progreso, reanudación y concurrencia (US3)", () => {
  let user: E2EUser;

  test.beforeEach(async ({ context, baseURL }) => {
    user = await signInContext(context, baseURL!);
  });
  test.afterEach(async () => {
    await user.cleanup();
  });

  test("un archivo grande termina con el recuento exacto y separador de miles", async ({ page }) => {
    await page.goto("/importar");
    await page.getByTestId("file-input-kindle").setInputFiles({
      name: "My Clippings.txt",
      mimeType: "text/plain",
      buffer: bigClippings(3000),
    });
    // Feedback inmediato (SC-007): la tarjeta sale de idle en cuanto se elige el archivo
    await expect(page.getByTestId("card-kindle")).not.toHaveAttribute("data-phase", "idle", { timeout: 3000 });
    await expect(page.getByTestId("summary-kindle")).toContainText("20 libros · 3.000 resaltados", {
      timeout: 60_000,
    });
  });

  test("al volver a /importar con un trabajo en curso se reanuda el progreso y termina solo (FR-026)", async ({
    page,
  }) => {
    const db = adminDb();
    const { data } = await db
      .from("imports")
      .insert({
        user_id: user.id,
        source: "kobo",
        state: "parsing",
        file_name: "KoboReader.sqlite",
        file_size: 19_300_000,
        entries_total: 200,
        entries_done: 50,
        highlights_new: 50,
      })
      .select("id")
      .single();

    // "Cerró la pestaña y volvió": la página carga el estado de la última importación
    await page.goto("/importar");
    const card = page.getByTestId("card-kobo");
    await expect(card).toHaveAttribute("data-phase", "parsing");
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    await expect(card).toContainText("50");

    // El trabajo termina en el servidor: el sondeo lo refleja sin recargar
    await db
      .from("imports")
      .update({
        state: "done",
        entries_done: 200,
        highlights_new: 200,
        books_count: 5,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data!.id);
    await expect(card.getByTestId("summary-kobo")).toContainText("5 libros · 200 resaltados", {
      timeout: 15_000,
    });
  });

  test("un import terminado se muestra tal cual al volver a entrar", async ({ page }) => {
    await adminDb().from("imports").insert({
      user_id: user.id,
      source: "kindle",
      state: "done",
      file_name: "My Clippings.txt",
      books_count: 4,
      highlights_new: 59,
      finished_at: new Date().toISOString(),
    });
    await page.goto("/importar");
    await expect(page.getByTestId("summary-kindle")).toContainText("4 libros · 59 resaltados");
    await expect(page.getByTestId("cta-library")).toHaveAttribute("href", "/");
  });

  test("una segunda pestaña no puede iniciar otra importación del mismo origen (FR-025)", async ({ page }) => {
    await page.goto("/importar");
    await expect(page.getByTestId("card-kindle")).toHaveAttribute("data-phase", "idle");

    // Otra pestaña ya tiene una importación en curso para Kindle
    await adminDb().from("imports").insert({
      user_id: user.id,
      source: "kindle",
      state: "parsing",
      file_name: "My Clippings.txt",
      entries_total: 100,
      entries_done: 30,
      highlights_new: 30,
    });

    await page.getByTestId("file-input-kindle").setInputFiles({
      name: "My Clippings.txt",
      mimeType: "text/plain",
      buffer: bigClippings(5),
    });

    const card = page.getByTestId("card-kindle");
    await expect(card.getByTestId("message-kindle")).toContainText(
      "Ya hay una importación en curso para Kindle. Esperá a que termine."
    );
    // la importación activa no se interrumpe y pasa a verse en curso
    await expect(card).toHaveAttribute("data-phase", "parsing");
    const { data } = await adminDb()
      .from("imports")
      .select("state")
      .eq("user_id", user.id)
      .eq("source", "kindle");
    expect(data).toHaveLength(1);
    expect(data![0]!.state).toBe("parsing");
  });
});
