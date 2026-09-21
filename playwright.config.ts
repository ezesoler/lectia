import { defineConfig, devices } from "@playwright/test";

// Con `.env.test.local` (Supabase local, ver vitest.integration.config.ts) los e2e corren contra
// un servidor propio en otro puerto y con otro directorio de build, para no pisar un `next dev`
// que ya esté abierto contra el proyecto real.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // sin Supabase local: se usa el servidor de desarrollo habitual
}
const localSupabase = Boolean(
  process.env["NEXT_PUBLIC_SUPABASE_URL"]?.startsWith("http://127.0.0.1") &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);
const port = localSupabase ? 3100 : 3000;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: localSupabase ? `npm run dev -- -p ${port}` : "npm run dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env["CI"],
    ...(localSupabase
      ? {
          env: {
            NEXT_PUBLIC_SUPABASE_URL: process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "",
            SUPABASE_SERVICE_ROLE_KEY: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
            NEXT_DIST_DIR: ".next-e2e",
            // Los e2e no deben llamar a Open Library / Google Books
            ENRICHMENT_DISABLED: "1",
          },
        }
      : {}),
  },
});
