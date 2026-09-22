import { defineConfig } from "vite";
import { resolve } from "path";

// Sólo para `vite-node` (scripts de CLI como scripts/backfill-covers.ts y
// tests/fixtures/*/make-fixtures.ts): resuelve el alias @/ igual que tsconfig.json y los
// vitest.*.config.ts. Next.js no lee este archivo (usa su propio bundler).
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
