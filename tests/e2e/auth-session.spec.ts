import { test, expect } from "@playwright/test";

test.describe("Auth: sesión persistente (US2)", () => {
  test("rutas internas sin sesión redirigen a /login", async ({ page }) => {
    const protectedRoutes = ["/importar", "/busqueda"];
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });
});
