import { test, expect } from "@playwright/test";

/**
 * Nota: los tests de flujo autenticado requieren un usuario de prueba
 * configurado en playwright.config.ts con storageState.
 * Estos tests verifican la estructura de la UI de sign-out.
 */

test.describe("Auth: cierre de sesión (US5)", () => {
  test("sin sesión, la barra superior no es visible en /login", async ({
    page,
  }) => {
    await page.goto("/login");
    // El top-bar sólo aparece en rutas protegidas
    await expect(page.getByRole("banner")).not.toBeVisible();
  });
});
