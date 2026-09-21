import { test, expect } from "@playwright/test";

test.describe("Auth: cancelación y errores (US4)", () => {
  test("error=auth_failed muestra mensaje en lenguaje claro y deja el botón operable", async ({
    page,
  }) => {
    await page.goto("/login?error=auth_failed");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/ups/i);
    await expect(alert).not.toContainText(/!/);
    const btn = page.getByRole("button", { name: /continuar con google/i });
    await expect(btn).toBeEnabled();
  });

  test("sin parámetro de error, /login no muestra alerta", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("alert")).not.toBeVisible();
  });
});
