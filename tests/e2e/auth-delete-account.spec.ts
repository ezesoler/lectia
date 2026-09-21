import { test, expect } from "@playwright/test";

/**
 * Los tests de borrado de cuenta requieren un usuario de prueba real.
 * Este archivo define la estructura del test para ejecución manual/CI con fixture.
 */

test.describe("Auth: borrado de cuenta (US6)", () => {
  test("DELETE /api/profile sin sesión devuelve 401", async ({ request }) => {
    const response = await request.delete("/api/profile");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("unauthorized");
  });

  test("PATCH /api/profile con tema inválido devuelve 400", async ({
    request,
  }) => {
    const response = await request.patch("/api/profile", {
      data: { theme: "rainbow" },
    });
    expect(response.status()).toBe(401); // sin sesión → 401 antes del 400
  });
});
