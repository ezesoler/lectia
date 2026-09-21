# Implementation Plan: Importación de Resaltados desde Kindle y Kobo

**Branch**: `002-importacion-kindle-kobo` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-importacion-kindle-kobo/spec.md`

## Summary

El usuario sube `My Clippings.txt` (Kindle) o `KoboReader.sqlite` (Kobo) desde `/importar`. El
navegador sube el archivo directo a Supabase Storage (URL firmada, bucket privado); un Route
Handler lo parsea en segundo plano con `after()`, normaliza, calcula el hash SHA-256 de cada
resaltado y lo persiste por lotes mediante una función SQL transaccional (`import_batch`, con
RLS). El progreso vive en la fila `imports` y el cliente lo sondea cada segundo. Terminado el
import (`done`), un segundo paso asincrónico enriquece cada libro (portada, categoría, páginas)
desde Open Library con complemento de Google Books y lo guarda en `book_catalog`, una tabla
compartida que sólo escribe el servidor. Ver [research.md](research.md) para las decisiones y
las correcciones al spec (H1–H10). Los estados de fallo (error de formato, error genérico,
importación parcial) siguen los mockups de `mockups/estados-importar/`: código de error
copiable, detalle técnico plegado y desglose de descartes por motivo.

## Technical Context

**Language/Version**: TypeScript 5.x strict (sin `any` implícito), Node 22

**Primary Dependencies**: Next.js 15.5 (App Router, `after()`), `@supabase/supabase-js` +
`@supabase/ssr` (ya presentes), Tailwind v4 con tokens de `docs/guia-de-estilo.md`.
**Nueva**: `sql.js` (SQLite→WASM para leer `KoboReader.sqlite`) + `@types/sql.js` (dev) — justificada en [research.md R5](research.md#r5-parser-de-kobo-koboreadersqlite).
`node:crypto` para SHA-256 y `fetch` nativo para las APIs externas: sin más dependencias.

**Storage**: Supabase Postgres (`imports`, `books`, `highlights`, `book_catalog`, RLS) +
Supabase Storage (bucket privado `imports`, sólo transitorio)

**Testing**: Vitest (parsers, normalización, hash, enriquecimiento); integración de rutas y de
`import_batch` contra Supabase local; Playwright (importar Kindle, Kobo, reimportar; mobile + desktop)

**Target Platform**: Web, mobile 390 px mínimo y escritorio hasta 1 180 px

**Project Type**: Aplicación web fullstack (Next.js App Router), un solo proyecto

**Performance Goals**: ≤ 60 s para 5 000 resaltados (Kindle) / 3 000 (Kobo) (SC-001/002);
feedback de progreso < 3 s (SC-007); enriquecimiento del 80 % en 30 s (SC-008, con la
salvedad de R9)

**Constraints**: archivo ≤ 50 MB; el archivo original no se retiene; parseo sólo en servidor;
`GOOGLE_BOOKS_API_KEY` y `service_role` jamás en el cliente; a las APIs externas sólo viajan
título/autor/ISBN

**Scale/Scope**: MVP; una pantalla (`/importar`), 4 rutas API, 2 parsers, 1 módulo de
enriquecimiento, 2 migraciones

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Nota |
|---|---|---|
| I. Las notas son del lector | ✅ | Importación aditiva e idempotente (`on conflict do nothing`, hash único por usuario). El hash incluye `kind` y usa separador para que ninguna nota/subrayado se pierda por colisión (R3). Borrar cuenta ya cascada; se corrige la limpieza de Storage (H6). |
| II. Importar es trivial | ✅ | Sin credenciales ni extensiones; dos orígenes independientes; archivo malformado nunca aborta el lote (`discarded`); archivo original se elimina en `finally`. |
| III. Una sola voz visual | ✅ | Sólo tokens de `app/globals.css`/guía de estilo; sin emoji, gradientes ni iconos de relleno; claro y oscuro. |
| IV. El texto del lector manda | ✅ | No hay resaltados en esta pantalla. Objetivos táctiles ≥ 44 px (botones de 44/46/52 px del mockup). |
| V. Spec antes que código | ✅ | Spec aprobado y sin `[NEEDS CLARIFICATION]`. Los refinamientos a FR-009 (separador, `kind`), SC-008 y los nuevos FR-028–FR-030 ya están reflejados en el spec (2026-09-21); no quedan sólo en el código. |
| VI. Calidad verificable | ✅ | Strict; unitarias de parsers con casos rotos; integración de rutas; e2e de "importar". Hay archivos reales en `docs/files imports/` (pruebas que se omiten si no están) más fixtures sintéticos rotulados (R12). |
| VII. Privacidad por defecto | ✅ (con enmienda 1.1.1) | `book_catalog` es tabla compartida de datos públicos; la constitución se enmendó a 1.1.1 ("toda tabla **de datos de usuario** lleva `user_id`"; tablas compartidas con RLS, lectura autenticada y escritura sólo del servidor). RLS en todas las tablas de usuario; escrituras masivas con el token del usuario; el desglose de descartes y el detalle de errores no guardan texto del usuario; sin analítica; sin secretos en el cliente. |
| VIII. Fidelidad al mockup | ⚠️ parcial | Cubiertos: `idle`, `done`, error de formato, error genérico, importación parcial (mobile + desktop). Falta el estado `parsing` en mockup (se deriva de `docs/funcionalidades.md`, registrado como desviación) y el estado abierto de "Dónde está el archivo". Ver "Fidelidad al mockup". |

**Resultado del gate**: sin violaciones injustificadas. Pendiente no bloqueante: mockup del
estado `parsing` (T001 lo registra como desviación si no se agrega) y verificación visual de
desktop al implementar (T033).

**Re-evaluación post-diseño (Phase 1)**: sin cambios. El diseño agregó una sola dependencia
(justificada), una tabla compartida (justificada) y no introdujo nuevos riesgos de privacidad:
las escrituras a tablas de usuario siguen bajo RLS y `service_role` queda acotado a Storage y
`book_catalog`.

### Fidelidad al mockup (Principio VIII)

Orden de revisión: mobile primero, luego desktop.

| Elemento | Mockup | Plan |
|---|---|---|
| Cabecera "Importar · Paso 1 de 1", intro, dos tarjetas (Kindle, Kobo), CTA "Ver mi biblioteca" | `mobile/02-importar.html` | Implementar tal cual (tokens, radios de 3–4 px, chips `--k-bg`/`--o-bg`, botón de 52 px). |
| Estado `done` (chip `--chip`, "N libros · M resaltados", "listo" en `--ok`, "Reemplazar archivo") | `mobile/02-importar.html` | Fiel. |
| Importación parcial: `done` + panel de aviso (fondo `--card-2`, filo de 2 px `--accent` a la izquierda, desglose por motivo siempre expandido, chip y "listo" se mantienen, "Ver mi biblioteca" habilitado) | `estados-importar/03-importacion-parcial.html` | Fiel, **sin** "Descargar el detalle" (decisión del usuario: fuera de alcance). El botón se omite del render; no se deja deshabilitado. |
| Estado `idle` (zona punteada, ícono de descarga, "Elegir archivo", ayuda de `.kobo`) | Sólo la tarjeta Kobo | Kindle usa el mismo patrón ("Todavía sin archivo de Kindle") con la ayuda de la carpeta `documents`. |
| Estado `parsing` (barra + porcentaje + recuento parcial) | **No está** | Descrito en `docs/funcionalidades.md`. Pista `--track`, relleno `--accent`, altura 4 px, texto en Space Grotesk. Barra indeterminada mientras sube. Desviación registrada; conviene agregarlo al mockup. |
| Error de formato ("No pudimos leer este archivo", nombre + tamaño, "Ver detalle" plegado, "Elegir otro archivo", "Dónde está el archivo", "No se guardó nada de este intento") | `estados-importar/01-error-formato.html` | Fiel: fondo `--selection`, borde 1 px `--accent`, ícono `--accent`, sin rojo; etiquetas en `--ink` (no `--ink-2`, contraste); botón secundario con fondo `--card` y borde `--hover-line`; reemplaza la zona punteada **dentro** de la tarjeta y no bloquea el otro origen. El detalle técnico nunca incluye texto de resaltados. |
| Error genérico ("Algo falló al importar", círculo, `ERR_IMPORT_xxxx` + fecha + archivo/tamaño, "Copiar código", "Reintentar" primario, "Elegir otro archivo", texto de soporte) | `estados-importar/02-error-generico.html` | Fiel, con **una desviación justificada**: el mockup siempre dice "No se guardó nada"; si el fallo ocurre a mitad (FR-013), el texto pasa a "Lo que ya se guardó se conserva. Podés reintentar sin duplicar." (Principio I). |
| "Dónde está el archivo" abierto | Sólo el botón | Panel plegable inline con la ruta del archivo en el lector; estado abierto **sin mockup** (desviación a registrar; usar tokens existentes). |
| "Ver mi biblioteca" deshabilitado | `01-error-formato` (opacidad .55) | Fiel a FR-023. |

**Verificación visual (T033/T060, 2026-09-21)** — capturas con Playwright (mobile 390 y desktop 1180, claro y oscuro) de `idle`, `parsing`, `done` + aviso parcial, error de formato (con detalle y ayuda abiertos) y error genérico. Desviaciones **implementadas y justificadas**:

| Desviación | Motivo |
|---|---|
| Se conserva la `TopBar` existente (feature 001) también en mobile y no se dibuja la barra propia del mockup mobile ("‹ Importar · Paso 1 de 1"); el encabezado "Paso 1 de 1 · Importar / Traé tus resaltados" del mockup desktop se usa en ambos anchos. | El shell mobile (barra inferior de cinco destinos y cabecera por pantalla) es de otra feature; quitar la `TopBar` dejaría sin acceso al cierre de sesión y al tema. |
| Los botones de texto ("Ver detalle", "Copiar código") miden ≥ 44 px de alto; en el mockup son enlaces de ~14 px. | Constitución IV: objetivos táctiles de 44 px como mínimo. |
| Se agrega una línea "N nuevos · M ya estaban" bajo el chip `done`. | FR-021 exige mostrar nuevos y duplicados; el mockup sólo trae "N libros · M resaltados". |
| Estado `parsing`: barra de 4 px con `--track`/`--accent`, nombre y tamaño del archivo, "Procesando · N %" y "N resaltados encontrados". | No existe mockup; se deriva de `docs/funcionalidades.md`. |
| "Dónde está el archivo" abre un panel inline (`--card`, `--line`) dentro del panel de error. | El mockup sólo muestra el botón, no su estado abierto. |
| Mensaje "Lo que ya se guardó se conserva…" cuando el fallo ocurre tras guardar algún lote. | FR-013 / Principio I; el mockup siempre dice "No se guardó nada". |
| El aviso de importación parcial omite "Descargar el detalle". | Decisión del usuario: fuera de alcance. |

| Arrastre (desktop) con borde punteado→sólido al pasar | Desktop (bundle) | Verificar en `lectia-desktop.html?s=import`. En mobile no hay arrastre: sólo "Elegir archivo" (FR-002). |
| Marco de teléfono, barra de estado 9:41, home indicator | Mockup | Artefactos del mockup; no se implementan. |

## Project Structure

### Documentation (this feature)

```text
specs/002-importacion-kindle-kobo/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── imports-api.md
│   └── parser-contract.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks — no lo crea /speckit-plan
```

### Source Code (repository root)

```text
supabase/migrations/
├── 002_core_schema.sql            # enums + imports + books + highlights + RLS (H1)
└── 003_import_catalog.sql         # book_catalog, columnas nuevas, bucket, import_batch

app/
├── (app)/importar/page.tsx        # Server Component: último import por origen (FR-026)
└── api/imports/
    ├── route.ts                   # POST  crear + firmar subida
    └── [id]/
        ├── route.ts               # GET estado · DELETE cancelar (queued)
        └── parse/route.ts         # POST  202 + after(); maxDuration = 300

components/import/
├── import-screen.tsx              # cliente: dos tarjetas + CTA, estado inicial del servidor
├── source-card.tsx                # idle · parsing · done · error
└── use-import.ts                  # subida (uploadToSignedUrl) + polling 1 s

lib/
├── supabase/admin.ts              # service_role (sólo servidor): Storage y book_catalog
├── import/
│   ├── types.ts
│   ├── normalize.ts               # normalize, claves, hash
│   ├── kindle-parser.ts
│   ├── kobo-parser.ts             # sql.js
│   ├── run-import.ts              # orquesta: descarga → valida → parsea → lotes → cierre → finally borra
│   └── messages.ts                # errores → español rioplatense
└── enrichment/
    ├── open-library.ts
    ├── google-books.ts
    ├── enrich-book.ts             # catálogo → OL → GB → merge → aceptación → backoff
    └── catalog.ts                 # único punto de escritura a book_catalog

tests/
├── fixtures/                      # clippings-*.txt, build-kobo.ts → kobo-*.sqlite
├── unit/                          # normalize, kindle-parser, kobo-parser, enrich-book
├── integration/                   # imports API + import_batch (Supabase local)
└── e2e/                           # import-kindle, import-kobo, reimport

Cambios en archivos existentes:
  app/api/profile/route.ts         # limpieza de Storage con service_role (H6)
  next.config.ts                   # serverExternalPackages: ['sql.js']; remotePatterns de portadas
  .env.local.example               # GOOGLE_BOOKS_API_KEY, OPEN_LIBRARY_CONTACT
  package.json                     # sql.js, @types/sql.js, script test:integration
  docs/modelo-de-datos.md          # H2 (parse asincrónico), H4 (normalización), FR-009, book_catalog
```

**Structure Decision**: proyecto único Next.js App Router, igual que la feature 001. La lógica
de dominio (parsers, normalización, enriquecimiento) vive en `lib/` como funciones puras con
dependencias inyectables para probarlas sin red ni base; los Route Handlers son finos y sólo
autentican, validan y delegan. Los componentes de pantalla quedan en `components/import/`.

## Complexity Tracking

| Violación | Por qué se necesita | Alternativa más simple descartada porque |
|---|---|---|
| ~~Principio VII: `book_catalog` sin `user_id`~~ — **resuelto** por la enmienda de redacción 1.1.1 (2026-09-21) | El spec (FR-014..017, Key Entities) exige un catálogo bibliográfico **compartido**: evita repetir llamadas a Open Library/Google Books y respeta sus límites de tasa. Sólo contiene datos bibliográficos públicos, **nunca contenido del usuario**. RLS activa: lectura para `authenticated`, sin políticas de escritura (sólo `service_role`). | Una copia por usuario multiplicaría las llamadas externas y rompería SC-008. |
| Dependencia nueva: `sql.js` | No hay forma de leer SQLite en Node sin una librería; es la única con WASM portátil (sin binarios nativos, sin disco). | `better-sqlite3` (nativo, requiere archivo en disco, frágil en serverless) y `node:sqlite` (experimental). Ver R5. |
| Función SQL `import_batch` (lógica en la base) | Atomicidad por lote, `user_id` fuera del alcance del cliente y no-op `do update` para recuperar `id` de libros existentes sin pisar `source`. | `upsert` de supabase-js: no devuelve ids de libros ya existentes, no es transaccional y exige lógica extra en el servidor. Ver R6. |

## Riesgos abiertos

1. ~~SC-008~~ acotado en el spec a bibliotecas de hasta 80 libros (aprobado 2026-09-21); en importaciones mayores el enriquecimiento sigue en segundo plano sin plazo.
2. ~~Esquema real de Kobo~~ validado con `docs/files imports/KoboReader.sqlite` (R5). Sigue sin cubrirse firmware anterior a 2018 (fuera de alcance) ni un Kobo con ISBN (el real no trae).
3. **Tope de duración serverless** del hosting elegido: `after()` + `maxDuration = 300` asume un plan que lo permita; con 60 s el margen de SC-001 es justo.
4. **Mockups**: falta el estado `parsing` y el estado abierto de "Dónde está el archivo" (desviaciones registradas arriba). Los archivos reales están en `docs/files imports/` sin ignorar en git (T007 lo corrige).
5. **Biblioteca `/`** es un stub (H7): el criterio "ver la biblioteca" (US1-2) depende de otra feature.
