import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    // e2e (Playwright) e integración (Supabase local) tienen sus propios runners
    // .kilo/** es el worktree de otra herramienta (Kilo Code), con su propia copia del repo
    exclude: ["**/node_modules/**", "tests/e2e/**", "tests/integration/**", ".kilo/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
