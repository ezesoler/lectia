import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los e2e contra Supabase local usan otro directorio de build (ver playwright.config.ts)
  distDir: process.env["NEXT_DIST_DIR"] ?? ".next",
  // sql.js carga su .wasm desde node_modules: no debe empaquetarse (parser de Kobo).
  serverExternalPackages: ["sql.js"],
  // El .wasm de sql.js se carga en tiempo de ejecución: hay que incluirlo en el despliegue de la ruta
  outputFileTracingIncludes: {
    "/api/imports/[id]/parse": ["./node_modules/sql.js/dist/sql-wasm.wasm"],
  },
  images: {
    // Las portadas se sirven desde el propio dominio (/api/covers/{id}, feature 004): ningún
    // host externo debe mostrar imágenes directamente (SC-005).
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
  },
};

export default nextConfig;
