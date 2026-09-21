import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Las pruebas de integración corren contra el Supabase local (`npx supabase start`).
// Copiar las claves de `npx supabase status -o env` a `.env.test.local` usando los nombres
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    env: loadEnv(mode === "development" ? "test" : mode, process.cwd(), ""),
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
}));
