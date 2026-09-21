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
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Portadas del enriquecimiento de metadatos (feature 002)
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "books.google.com" },
    ],
  },
};

export default nextConfig;
