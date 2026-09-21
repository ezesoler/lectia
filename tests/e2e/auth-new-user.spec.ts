import { test, expect } from "@playwright/test";

/**
 * Escenarios del quickstart.md:
 * - Escenario 1: nuevo usuario entra con Google y llega a /importar
 * - Escenario 7: rutas internas sin sesión redirigen a /login
 */

test.describe("Auth: usuario sin sesión", () => {
  test("redirige a /login al acceder a ruta interna", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("la pantalla de login muestra un único botón de Google", async ({
    page,
  }) => {
    await page.goto("/login");
    const btn = page.getByRole("button", { name: /continuar con google/i });
    await expect(btn).toBeVisible();
    // No debe haber inputs de contraseña
    await expect(page.locator('input[type="password"]')).not.toBeVisible();
  });

  test("el botón de login se deshabilita mientras la auth está en curso", async ({
    page,
  }) => {
    await page.goto("/login");
    const btn = page.getByRole("button", { name: /continuar con google/i });

    // Interceptamos la navegación para verificar el estado del botón
    await page.route("**/auth/v1/authorize**", async (route) => {
      // El botón debe estar deshabilitado en este punto
      const isDisabled = await btn.isDisabled();
      expect(isDisabled).toBe(true);
      await route.abort();
    });

    await btn.click();
  });
});

test.describe("Auth: callback con error de provider", () => {
  test("error=auth_failed muestra mensaje y deja el botón operable", async ({
    page,
  }) => {
    await page.goto("/login?error=auth_failed");
    await expect(page.getByRole("alert")).toBeVisible();
    const btn = page.getByRole("button", { name: /continuar con google/i });
    await expect(btn).toBeEnabled();
  });
});
