# Implementation Plan: Portadas como recurso propio

**Branch**: `004-cover-image-storage` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-cover-image-storage/spec.md`

## Summary

Hoy el catálogo (`book_catalog`) guarda la URL de la miniatura de Open Library o Google Books. Esta
feature descarga la imagen, la guarda **byte a byte** en un bucket privado propio (una copia por
libro) y hace que el catálogo la referencie; la URL externa queda sólo como procedencia. La
calidad se resuelve al guardar: Open Library entrega el **archivo original** (no el `-L` de 500 px)
y Google Books, la mayor variante de contenido no reemplazada por "image not available".
Las copias se sirven por `GET /api/covers/{id}` (con sesión, cacheo inmutable). Corre dentro del
enriquecimiento posterior al `done` y, para lo ya importado, con un script de migración
idempotente y reanudable. Las decisiones y los hallazgos contra las APIs reales están en
[research.md](research.md) (E1–E6, R1–R10).

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node 22

**Primary Dependencies**: Next.js 15.5, `@supabase/supabase-js` (Storage con `service_role`),
`node:crypto` (SHA-256), `fetch` nativo. **Sin dependencias nuevas**: las dimensiones y la
validación de imágenes se resuelven con un módulo propio (R3).

**Storage**: Supabase Postgres (`book_catalog`, columnas nuevas) + Supabase Storage (bucket
privado `covers`, permanente, un objeto por libro)

**Testing**: Vitest (validación de imágenes, candidatas, descarga con backoff, `storeCover`,
`enrichBook`); integración contra Supabase local (Storage real, concurrencia, ruta, migración);
prueba de humo manual contra las APIs reales

**Target Platform**: Web (servidor Next.js); sin cambios de pantalla

**Project Type**: Aplicación web fullstack (Next.js App Router), un solo proyecto

**Performance Goals**: ≥ 80 % de las portadas disponibles guardadas dentro de los 30 s
posteriores al `done` para importaciones de hasta 80 libros (SC-007); la copia propia se sirve sin
tocar servicios externos (SC-005)

**Constraints**: bytes idénticos a los recibidos (sin recompresión); imagen ≤ 10 MB, lado menor
≥ 100 px, sin reemplazos; lectura sólo con sesión, escritura sólo del servidor; a los servicios
externos viajan únicamente URLs públicas de portadas (ningún dato del usuario)

**Scale/Scope**: catálogo compartido de cientos a miles de libros; 1 migración SQL, 1 ruta API,
~8 módulos en `lib/covers/`, 1 script de migración

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Nota |
|---|---|---|
| I. Las notas son del lector | ✅ | Las portadas son datos bibliográficos públicos del catálogo, no notas del lector; no se borran con la cuenta y no afectan a la importación de resaltados. |
| II. Importar es trivial | ✅ | Un fallo de portada nunca rompe la importación (FR-011): se guarda en segundo plano, después del `done`. |
| III. Una sola voz visual | ✅ | Sin cambios de pantalla ni de estilos. |
| IV. El texto del lector manda | ✅ | No aplica (no hay resaltados en esta feature). |
| V. Spec antes que código | ✅ | Spec aprobado y sin `[NEEDS CLARIFICATION]`. Los ajustes que surgieron de la investigación (reemplazos de 575×750 en Google Books) se reflejan en el spec (FR-009 y Assumptions), no sólo en el código. |
| VI. Calidad verificable | ✅ | TypeScript strict; unitarias con imágenes reales pequeñas y casos rotos (truncada, reemplazo, no imagen); integración con Storage real; sin datos falsos. |
| VII. Privacidad por defecto | ✅ | Tabla compartida con RLS (lectura autenticada, sin políticas de escritura) y bucket privado sin políticas: sólo `service_role` escribe, y la lectura pasa por una ruta con sesión. Nada del usuario viaja a Open Library ni a Google. Sin secretos nuevos ni analítica. |
| VIII. Fidelidad al mockup | ✅ (no aplica) | No hay pantalla nueva ni modificada. |

**Resultado del gate**: sin violaciones. No se requiere Complexity Tracking.

**Re-evaluación post-diseño (Phase 1)**: sin cambios. El diseño no agrega dependencias (R3), no
abre Storage al cliente (R1) y mantiene las escrituras del catálogo en `service_role`.

## Project Structure

### Documentation (this feature)

```text
specs/004-cover-image-storage/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── covers-api.md
│   └── cover-pipeline.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks — no lo crea /speckit-plan
```

### Source Code (repository root)

```text
supabase/migrations/
└── 004_cover_storage.sql        # book_catalog.cover_*, bucket `covers`, marcado de filas existentes

lib/covers/
├── types.ts                     # CoverStatus, ImageInfo, FetchOutcome, StoreOutcome, CoverStore
├── image-info.ts                # JPEG/PNG/WebP: formato, dimensiones, truncamiento, SHA-256, validación
├── placeholders.ts              # KNOWN_PLACEHOLDERS (huellas) + umbral bytes/píxel
├── candidates.ts                # coverCandidates(origin, source): variantes de mayor a menor calidad
├── download.ts                  # getBinary: timeout, backoff 1/2/4 s, Retry-After, corte a 10 MB
├── storage.ts                   # CoverStore sobre Supabase Storage (upload sin upsert, adopción)
├── store-cover.ts               # storeCover: descargar → validar → guardar → marcar `stored`
├── backfill.ts                  # backfillCovers: lotes idempotentes y reanudables
└── href.ts                      # coverHref(catalogId) = /api/covers/{id}

app/api/covers/[id]/route.ts     # GET: sesión, ETag/304, Cache-Control inmutable, 404 sin copia

scripts/backfill-covers.ts       # CLI de la migración (npm run covers:backfill)

tests/
├── fixtures/covers/             # imágenes mínimas válidas y rotas (JPEG/PNG/WebP, truncadas, reemplazos)
├── unit/                        # image-info, candidates, download, store-cover, backfill, enrich-book
└── integration/                 # covers-storage, covers-api, covers-backfill

Cambios en archivos existentes:
  lib/enrichment/types.ts        # ApiCandidate.coverOrigin/coverSource; NewCatalogEntry.cover_origin_url + cover_status
  lib/enrichment/open-library.ts # coverOrigin desde cover_i
  lib/enrichment/google-books.ts # coverOrigin desde imageLinks.thumbnail (para extraer el id)
  lib/enrichment/enrich-book.ts  # llama a storeCover tras saveCatalog; reintenta pendientes en catalog_hit
  lib/enrichment/enrich-import.ts# propaga el resultado de portada
  lib/enrichment/catalog.ts      # cover_origin_url en find/save
  next.config.ts                 # se quitan los remotePatterns de covers.openlibrary.org y books.google.com
  package.json                   # script covers:backfill
  docs/modelo-de-datos.md        # book_catalog con las columnas de portada
  tests/unit/enrich-book.test.ts, tests/integration/catalog.test.ts  # cover_url → cover_origin_url
```

**Structure Decision**: mismo proyecto único Next.js. La lógica de portadas vive en `lib/covers/`
como funciones con dependencias inyectables (mismo criterio que `lib/enrichment/`), la ruta es fina
(autentica, lee, responde) y la migración es un script CLI reutilizable sobre la misma lógica.

## Complexity Tracking

Sin violaciones de la constitución; no se requiere justificación. Decisión de diseño a notar:
un módulo propio de ~150 líneas para leer cabeceras de imagen en lugar de una dependencia
(`sharp`, `image-size`), porque además de las dimensiones hay que detectar truncamiento y
reemplazos, y una librería de imágenes tienta a decodificar y recomprimir (R3).

## Riesgos abiertos

1. **Términos de uso de Google Books** sin verificar (Assumption del spec). Mitigado usándolo sólo como respaldo; revisar antes de publicar.
2. **`zoom` de Google Books no está documentado** (E3–E4): puede cambiar. Cubierto por validación, reintento y la prueba de humo del quickstart.
3. **Reemplazos de las fuentes** (E5): la lista `KNOWN_PLACEHOLDERS` y la heurística de densidad pueden necesitar ajuste si Google cambia su imagen.
4. **Costo de servir por una ruta propia**: cada usuario descarga cada portada una vez (cacheo inmutable en el navegador). Aceptable para el volumen previsto; si crece, se puede mover a un CDN o a un bucket público sin cambiar el contrato de `/api/covers`.
5. **Ajuste al spec**: FR-009 pasa a incluir "reemplazos conocidos de las fuentes" (el mínimo de 100 px no detecta el reemplazo de 575×750 de Google).
