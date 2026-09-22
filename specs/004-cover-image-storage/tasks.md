# Tasks: Portadas como recurso propio

**Input**: Design documents from `specs/004-cover-image-storage/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Pruebas**: incluidas (Constitución VI). Cada prueba va en el mismo commit que el código que
cubre; dentro de cada historia las pruebas se escriben primero y deben fallar antes de implementar.

**Depende de**: feature 002 (`book_catalog`, enriquecimiento, migraciones 002/003) ya implementada
en este repo.

## Format: `- [ ] [ID] [P?] [Story?] Descripción con ruta de archivo`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[US1]–[US4]**: historia del spec
- TypeScript strict (sin `any` implícito ni `@ts-ignore` sin comentario), alias `@/`, acceso a
  env con `process.env["NOMBRE"]`. Sin dependencias nuevas (research.md R3).
- Los hallazgos E1–E6 de `research.md` vienen de pedidos reales a Open Library y Google Books
  (2026-09-21): úsense como base de los fixtures y los valores esperados en las pruebas.

---

## Phase 1: Setup (infraestructura compartida)

**Propósito**: fixtures de imágenes y configuración previa.

- [X] T001 [P] Crear `tests/fixtures/covers/README.md` explicando el origen de cada fixture (sintética vs. recorte real) y que ninguna contiene datos de usuario
- [X] T002 [P] Crear `tests/fixtures/covers/make-fixtures.ts` que genera y escribe con Node puro (sin dependencias de imagen): `valid.jpg` (JPEG mínimo válido, ~400×600, con marcador SOF0 y EOI), `valid.png` (PNG mínimo con `IHDR`/`IEND`, ~400×600), `valid.webp` (WebP `VP8X` mínimo, ~400×600), `truncated.jpg` (como `valid.jpg` sin los últimos bytes, sin `FFD9`), `tiny.jpg` (JPEG válido de 40×60, bajo el mínimo de 100 px), `not-image.bin` (HTML de error 404), `huge.jpg` (cabecera JPEG válida + relleno hasta superar 10 MB). Script `"fixtures:covers": "vite-node tests/fixtures/covers/make-fixtures.ts"` en `package.json`
- [X] T003 [P] Ejecutar `npm run fixtures:covers` y confirmar que los 7 archivos quedan en `tests/fixtures/covers/`
- [X] T004 [P] Guardar en `tests/fixtures/covers/google-placeholder-575x750.png` y `google-placeholder-128x170.png` los reemplazos reales de Google Books capturados en `research.md` (E5; SHA-256 `3efa8c43e5b4348f303a528c81adf435f0111ea752fe9f0f6241478b60987fa6` y `e3f8c414b288cbdf4e6d1e00eb6d3826157d10a5b5628b9318f726ea490eca12`) — pedirlos de nuevo a `https://books.google.com/books/content?id=AAAAAAAAAAAA&printsec=frontcover&img=1&zoom=0` y `zoom=1` y verificar que la huella coincide

**Checkpoint**: `npm run fixtures:covers` reproducible; fixtures listas para las pruebas unitarias.

---

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Propósito**: esquema, tipos, validación de imágenes y descarga — la base que usan las 4 historias.

**⚠️ CRÍTICO**: ninguna historia puede empezar hasta completar esta fase.

- [X] T005 Crear `supabase/migrations/004_cover_storage.sql` según `data-model.md`: `alter table book_catalog rename column cover_url to cover_origin_url`; agregar `cover_status` (`check in ('none','pending','stored','unavailable')`, default `'none'`), `cover_path`, `cover_format` (`check in ('jpeg','png','webp')`), `cover_width`, `cover_height`, `cover_bytes`, `cover_sha256`, `cover_source` (`check in ('open_library','google_books')`), `cover_attempts int not null default 0`, `cover_checked_at`, `cover_stored_at`; constraint `cover_stored_complete`; `update … set cover_status='pending', cover_source=case…` para las filas con `cover_origin_url`; índice `book_catalog_cover_pending`; bucket `covers` (privado, `file_size_limit=10485760`, `allowed_mime_types` jpeg/png/webp), sin políticas en `storage.objects`
- [X] T006 [P] Crear `lib/covers/types.ts` con `CoverStatus`, `CoverSource`, `ImageInfo`, `InvalidReason` (`'not_image'|'truncated'|'too_large'|'too_small'|'placeholder'`), `FetchOutcome`, `StoreOutcome`, `CoverStore`, `CatalogCoverRow` según `data-model.md` y `contracts/cover-pipeline.md`
- [X] T007 [P] Crear `lib/covers/placeholders.ts`: `KNOWN_PLACEHOLDERS` (Set con las huellas de T004), `MIN_DENSITY = 0.03` (bytes/píxel), `isKnownPlaceholder(sha256)`, `isNearEmpty(bytes, width, height)`
- [X] T008 [P] Crear `lib/covers/image-info.ts` con `inspectImage(bytes: Uint8Array): ImageInfo | InvalidReason` (research.md R3, contracts/cover-pipeline.md): detecta JPEG (marcadores `SOF0–SOF15` excepto `C4/C8/CC`, exige `FFD9` final), PNG (`IHDR`, exige `IEND`), WebP (`RIFF`/`WEBP`, exige que el tamaño declarado en el header `RIFF` coincida con `bytes.length`); aplica en orden: `not_image` → `truncated` → `too_large` (> 10 MB) → `too_small` (lado menor < 100 px) → `placeholder` (T007) → válido; calcula SHA-256 con `node:crypto` sobre los bytes recibidos
- [X] T009 Crear `tests/unit/image-info.test.ts` (`// @vitest-environment node`) usando los fixtures de T002–T004: `valid.jpg`/`.png`/`.webp` → `ImageInfo` con formato, ancho, alto, bytes y sha256 correctos; `truncated.jpg` → `'truncated'`; `not-image.bin` → `'not_image'`; `huge.jpg` → `'too_large'`; `tiny.jpg` → `'too_small'`; los dos placeholders de Google → `'placeholder'`; un JPEG válido de baja densidad simulado (relleno de ceros) → `'placeholder'` por `isNearEmpty`
- [X] T010 [P] Crear `lib/covers/candidates.ts` con `coverCandidates(origin: string, source: CoverSource): string[]` (research.md R2, contracts/cover-pipeline.md): Open Library → `[…/{id}.jpg?default=false, …/{id}-L.jpg?default=false]` extrayendo `{id}` de cualquier sufijo (`-S`,`-M`,`-L` o sin sufijo) en `covers.openlibrary.org/b/id/{id}...`; Google Books → `[…zoom=0, …zoom=4, …zoom=3, …zoom=2]` sobre `books.google.com/books/content?id={id}&printsec=frontcover&img=1`, quitando `edge=curl` y forzando `https`, extrayendo `{id}` tanto de una URL `books/content?id=…` como de una `imageLinks.thumbnail` de la API (`.../books?id={id}&...`); URL irreconocible → `[]`
- [X] T011 [P] [P] Crear `tests/unit/candidates.test.ts`: casos reales de `research.md` (E1: id 6976407 de *Dune*; E3/E4: id `Nm6REAAAQBAJ` de *Superficiales*) para ambas fuentes; una URL de Google con `edge=curl` da candidatas sin ese parámetro; URL de un host desconocido → `[]`
- [X] T012 Crear `lib/covers/download.ts` con `getBinary(url: string, deps): Promise<FetchOutcome>` (research.md R5, mismo esquema que `lib/enrichment/http.ts`): timeout 15 s por intento, hasta 3 reintentos con esperas 1/2/4 s ante red/timeout/429/5xx, respeta `Retry-After ≤ 10s`, corta la descarga si supera 10 MB (usa el `Content-Length` si está y si no cuenta bytes del stream), `404/410/403` → `{ kind: 'absent' }` sin reintentar, `2xx` → `{ kind: 'ok', bytes, contentType }`, reintentos agotados → `{ kind: 'failed' }`
- [X] T013 Crear `tests/unit/download.test.ts` (`// @vitest-environment node`, `fetch` simulado): éxito directo; 503 → reintenta con 1s/2s/4s y luego funciona; 404 → `absent` sin reintentar; agotados los reintentos → `failed`; respeta `Retry-After`; corta al superar 10 MB sin descargar todo el cuerpo

**Checkpoint**: `npm test` pasa con los módulos de validación y descarga; `supabase db reset` aplica la migración 004 sin errores.

---

## Phase 3: US1 — Las portadas de libros nuevos se guardan como recurso propio (P1) 🎯 MVP

**Goal**: al terminar el enriquecimiento de un libro nuevo, existe una copia propia en Storage y `book_catalog` la referencia; no se duplica entre importaciones simultáneas; el `done` de la importación no espera.

**Independent Test**: escenarios 1 y 3 de `quickstart.md`.

### Pruebas — US1

- [X] T014 [P] [US1] Crear `lib/covers/storage.ts` — interfaz mínima ya cubierta por T006; esta tarea sólo crea el archivo vacío con la firma `createCoverStorage(): CoverStore` para que T016 y sus pruebas puedan importar del módulo real (evita un mock circular)
- [X] T015 [P] [US1] Crear `tests/unit/store-cover.test.ts` (`// @vitest-environment node`, `bucket`/`db`/`fetchImpl` simulados): con `cover_status='pending'` y origen de Open Library, descarga la mejor candidata válida y guarda con `bucket.upload(id, bytes, 'image/jpeg')`; con `cover_status='stored'` → `'skipped'` sin llamar a `fetch`; con `cover_status` ausente en la fila (equivalente a `'none'`) no se invoca (lo decide el llamador, T021); `bucket.upload` devuelve `'exists'` → adopta el objeto con `bucket.download` y recalcula metadatos con `inspectImage`; el `update` de la fila usa `.eq('cover_status', 'pending')` o equivalente (verificar el filtro en el mock) para no pisar un `stored` concurrente

### Implementación — US1

- [X] T016 [US1] Completar `lib/covers/storage.ts`: `createCoverStorage(admin = createAdminClient()): CoverStore` con `upload(id, bytes, contentType)` → `supabase.storage.from('covers').upload(id, bytes, { contentType, upsert: false })`, mapea el error "already exists" a `'exists'` y cualquier otro error a excepción; `download(id)` → `arrayBuffer()` o `null` si no existe
- [X] T017 [US1] Crear `lib/covers/store-cover.ts` con `storeCover(row: CatalogCoverRow, deps): Promise<StoreOutcome>` (contracts/cover-pipeline.md): `stored` o reintento aún no vencido → `'skipped'`; `coverCandidates` vacío → `'unavailable'`; recorre candidatas con `getBinary` + `inspectImage`, la primera válida gana; alguna `failed` corta el recorrido → `'pending'` (marca `cover_attempts + 1`, `cover_checked_at = now()`); todas `absent`/inválidas sin ninguna `failed` → `'unavailable'`; al encontrar una válida: `storage.upload` (adopta si `'exists'`, T016) y `db.markStored(id, { path, ...meta, source })` condicionado a `cover_status <> 'stored'`
- [X] T018 [US1] Crear `lib/covers/catalog-cover-db.ts` con `createCatalogCoverDb(admin = createAdminClient())`: `markStored(id, meta)` (`update … set cover_status='stored', cover_path, cover_format, cover_width, cover_height, cover_bytes, cover_sha256, cover_stored_at=now() where id=$1 and cover_status <> 'stored'`), `markPending(id, attempts)`, `markUnavailable(id)`
- [X] T019 [US1] Modificar `lib/enrichment/types.ts`: `ApiCandidate.coverUrl` → `coverOrigin?: string`; `NewCatalogEntry.cover_url` → `cover_origin_url: string | null` + `cover_status: 'none' | 'pending'` + `cover_source?: CoverSource` (importado de `@/lib/covers/types`)
- [X] T020 [US1] Modificar `lib/enrichment/open-library.ts` y `lib/enrichment/google-books.ts`: renombrar el campo devuelto `coverUrl` → `coverOrigin` (mismo valor: la URL de portada tal como la entrega cada API, sin post-procesar) y agregar `coverSource: 'open_library' | 'google_books'` fijo por módulo
- [X] T021 [US1] Modificar `lib/enrichment/catalog.ts`: `find`/`save` usan `cover_origin_url` en vez de `cover_url`; `save` fija `cover_status = entry.cover_origin_url ? 'pending' : 'none'` y `cover_source = entry.cover_source ?? null`
- [X] T022 [US1] Modificar `lib/enrichment/enrich-book.ts`: `mergeFromApi`/`Merged` guardan `coverOrigin`/`coverSourceOf` en vez de `coverUrl`; tras `saveCatalog`, si la fila quedó `pending` (o ya estaba `pending`/`none` con `catalog_hit`), llamar `storeCover` (inyectado vía `deps.covers`) y devolver `cover: StoreOutcome | 'none'` en el resultado; un fallo de `storeCover` se atrapa y no cambia el `status` de `enrichBook` (FR-011)
- [X] T023 [US1] Modificar `lib/enrichment/enrich-import.ts`: propaga `cover` en el resumen (`EnrichSummary` gana un contador `stored`/`covers_pending`/`covers_unavailable`, sumando los resultados de `cover`); un error de `storeCover` no cuenta como `failed` del libro
- [X] T024 [US1] Actualizar `tests/unit/enrich-book.test.ts` y `tests/integration/catalog.test.ts` (de la feature 002): `cover_url` → `cover_origin_url` en los objetos de prueba; agregar caso: tras `saveCatalog` con portada, `storeCover` (simulado) se invoca una vez y su resultado aparece en `EnrichResult.cover`
- [X] T025 [US1] Crear `tests/integration/covers-storage.test.ts` contra Supabase local (Storage real): importar un libro con portada real de Open Library (usar `docs/files imports/` si existe, o insertar directo en `book_catalog` con `cover_origin_url` real) → tras `enrichBook`/`storeCover`, `cover_status='stored'`, existe el objeto `covers/{id}`, sus bytes tienen el mismo SHA-256 que `cover_sha256`; llamar `storeCover` dos veces en paralelo sobre la misma fila → un solo objeto en el bucket (sin duplicar), ambos resultados terminan en `'stored'`/`'skipped'`
- [X] T026 [US1] Modificar `next.config.ts`: quitar `covers.openlibrary.org` y `books.google.com` de `images.remotePatterns` (research.md R9; nada debe mostrar portadas desde hosts externos)

**Checkpoint**: importar un libro nuevo con portada deja una copia real en el bucket `covers`, sin duplicar entre importaciones simultáneas, sin retrasar el `done`.

---

## Phase 4: US2 — La portada se guarda con la mayor calidad disponible (P1)

**Goal**: se guarda la mayor resolución que ofrece la fuente elegida (Open Library primero), con los bytes idénticos a los descargados y sus metadatos de calidad registrados.

**Independent Test**: escenarios 4 y 5 de `quickstart.md`.

### Pruebas — US2

- [X] T027 [P] [US2] Ampliar `tests/unit/candidates.test.ts`: para un mismo `cover_i` de Open Library, la candidata original entra antes que `-L` (orden, no tamaño real — la resolución real se prueba en integración); para Google Books, `zoom=0` antes que `4/3/2`
- [X] T028 [P] [US2] Ampliar `tests/unit/store-cover.test.ts`: con un `fetchImpl` que devuelve una imagen inválida en la primera candidata (placeholder o `too_small`) y una válida en la segunda, `storeCover` guarda la **segunda** (nunca se conforma con la primera que responde `200`); los metadatos guardados (`cover_format/width/height/bytes/sha256`) corresponden exactamente a los bytes de la candidata elegida

### Implementación — US2

- [X] T029 [US2] Verificar (sin cambios de código esperados; ajustar si la prueba lo exige) que `storeCover` (T017) recorre las candidatas de `coverCandidates` **en orden** y se detiene en la primera válida — es el comportamiento ya implementado en T017/T010; esta tarea es la revisión explícita contra FR-005
- [X] T030 [US2] Crear `tests/integration/covers-quality.test.ts` (Supabase local + red real, `describe.skipIf(!hasSupabase)`): importar *Dune* (Open Library, `cover_i` real de `research.md` E1) → `cover_width/height` ≥ 317×500 (no el tamaño de `-L` cuando hay uno mayor); importar *Superficiales* sólo con origen de Google Books (`coverSource='google_books'`) → detecta y descarta el reemplazo de `zoom=0` (575×750) y guarda la variante válida (`zoom=4`, 800×1153 según E5); recalcular el SHA-256 del objeto descargado de `/api/covers` (o del bucket) y compararlo con `cover_sha256` — deben coincidir (FR-007)
- [X] T031 [US2] Documentar en `quickstart.md` (ya redactado en el plan; verificar que sigue vigente) el escenario 6 (reemplazo de Google) como prueba de humo manual además de T030

**Checkpoint**: portadas guardadas con la mayor calidad disponible por la fuente elegida; bytes verificablemente idénticos.

---

## Phase 5: US3 — Las portadas ya existentes se migran a recurso propio (P2)

**Goal**: las entradas del catálogo con `cover_origin_url` externo pasan a copia propia mediante un script idempotente y reanudable, sin intervención del lector.

**Independent Test**: escenarios 8 y 9 de `quickstart.md`.

### Pruebas — US3

- [X] T032 [P] [US3] Crear `tests/unit/backfill.test.ts` (`// @vitest-environment node`, `db`/`storeCover` simulados): procesa filas `pending` ordenadas por `cover_checked_at nulls first`; respeta `limit`; con `dryRun: true` no llama a `storeCover` y reporta lo que haría; con `includeUnavailable: true` reactiva primero las `unavailable` (`attempts = 0`, `cover_status = 'pending'`) antes de procesar; el resumen (`{ processed, stored, pending, unavailable, skipped }`) suma exactamente los resultados de cada `storeCover`
- [X] T033 [P] [US3] Crear `tests/integration/covers-backfill.test.ts` (Supabase local): sembrar 3 filas `pending` con `cover_origin_url` reales (Open Library) → `backfillCovers` las deja `stored` con objetos reales en el bucket; correrlo una segunda vez → `processed = 0` (nada que hacer, T032 cubre el conteo; acá se verifica contra la base real); interrumpir a mitad (procesar sólo 1 de 3 con `limit: 1`) y correr de nuevo sin `limit` → las 3 terminan `stored` sin duplicar objetos ni repetir la que ya estaba hecha

### Implementación — US3

- [X] T034 [US3] Crear `lib/covers/backfill.ts` con `backfillCovers(opts, deps): Promise<BackfillSummary>` (contracts/cover-pipeline.md): si `includeUnavailable`, reactiva esas filas primero; selecciona `cover_status = 'pending'` por `cover_checked_at nulls first` con `limit` opcional (`batchSize` por lote de consulta, `50` por defecto); concurrencia 4 sobre `storeCover`; `dryRun` sólo cuenta candidatos sin llamar a `storeCover`; nunca lanza por un libro individual
- [X] T035 [US3] Crear `scripts/backfill-covers.ts`: CLI que parsea `--limit`, `--dry-run`, `--include-unavailable`, carga `.env.local`, arma `deps` con `createAdminClient`, `createCoverStorage`, `createCatalogCoverDb` y llama a `backfillCovers`; imprime el resumen en una línea legible y sale con código `0` (o `1` si `processed > 0 && stored === 0 && pending === 0` — señal de que todo falló)
- [X] T036 [US3] Agregar el script `"covers:backfill": "vite-node scripts/backfill-covers.ts"` a `package.json`

**Checkpoint**: `npm run covers:backfill` migra las portadas existentes sin duplicar ni requerir reimportar nada.

---

## Phase 6: US4 — Una imagen que falla o no sirve nunca rompe la importación (P2)

**Goal**: errores de red, contenido inválido o imágenes de reemplazo se manejan sin afectar la importación ni el enriquecimiento de otros libros; un libro sin portada se reintenta más adelante.

**Independent Test**: escenario 7 de `quickstart.md`; casos ya cubiertos en parte por T009/T013/T028 (validación y descarga) — esta fase se enfoca en la integración end-to-end con la importación.

### Pruebas — US4

- [X] T037 [P] [US4] Ampliar `tests/unit/store-cover.test.ts`: todas las candidatas responden `absent` (404) → `'unavailable'`, `cover_attempts` sin cambios; una candidata `failed` tras reintentos agotados → `'pending'` con `cover_attempts + 1`; con `cover_attempts = 5` → `'skipped'` sin llamar a `fetch` (tope de reintentos, FR-010); con `cover_checked_at` de hace 5 minutos (dentro de la ventana de 1 h) → `'skipped'`
- [X] T038 [P] [US4] Crear `tests/integration/covers-resilience.test.ts` (Supabase local): importar un libro cuya única fuente de portada no responde (mock de red a nivel de `fetchImpl` inyectado en `enrichImportBooks`/`storeCover`, no en `fetch` global) → la importación completa termina en `done`, el resto de los libros del import se enriquecen igual, y ese libro queda `cover_status='pending'` con `cover_attempts=1`; reintentar el enriquecimiento del mismo libro (nueva llamada a `enrichBook` con `catalog_hit`) recién con `fetchImpl` funcionando → pasa a `stored`

### Implementación — US4

- [X] T039 [US4] Revisar `lib/enrichment/enrich-book.ts` y `enrich-import.ts` (ya implementado en T022/T023): confirmar explícitamente con una prueba dedicada que una excepción o resultado `'pending'`/`'unavailable'` de `storeCover` nunca marca el libro como `failed` en `EnrichSummary` ni interrumpe el `Promise.all` de los demás libros — agregar el caso si falta
- [X] T040 [US4] Verificar en `app/api/imports/[id]/parse/route.ts` (feature 002) que un error lanzado dentro de `enrichImportBooks` (que ahora incluye `storeCover`) sigue atrapado por el `try/catch` existente alrededor del enriquecimiento y no afecta el `state` de `imports` — sin cambios de código esperados; documentar el resultado de la verificación como comentario en el archivo si no está ya explicado

**Checkpoint**: fallos de portada, de cualquier tipo, quedan contenidos; US1–US4 completas.

---

## Phase 7: Ruta de acceso y transversales

**Propósito**: `GET /api/covers/{id}` (contrato de todas las historias), documentación y validación final.

- [X] T041 [P] Crear `lib/covers/href.ts` con `coverHref(catalogId: string): string` → `` `/api/covers/${catalogId}` ``
- [X] T042 [P] Crear `tests/integration/covers-api.test.ts` (Supabase local): `GET /api/covers/{id}` sin sesión → `401`; con sesión y `cover_status='stored'` → `200`, `Content-Type` correcto, `ETag` = `"<cover_sha256>"`, `Cache-Control: private, max-age=31536000, immutable`, cuerpo idéntico byte a byte al del bucket; con `If-None-Match` igual al `ETag` → `304` sin cuerpo; `{id}` que no es un uuid → `404` sin consultar la base; libro `none`/`pending`/`unavailable` → `404`; libro de otro catálogo con RLS de por medio → sigue siendo `200` (el catálogo es de lectura pública para autenticados, a diferencia de `imports`)
- [X] T043 Crear `app/api/covers/[id]/route.ts`: `GET` según `contracts/covers-api.md` — valida sesión (401), valida formato uuid de `{id}` (404 temprano), lee la fila con el cliente del usuario (`select cover_status, cover_path, cover_format, cover_bytes, cover_sha256 from book_catalog where id = $1`), `cover_status <> 'stored'` → 404 `not_found`; si `If-None-Match` coincide con `"<cover_sha256>"` → 304; si no, descarga el objeto con `service_role` (`createCoverStorage().download`), si falta pese a `stored` → 500 `server_error` (log sólo con el id) y responde con los bytes, `Content-Type`, `Content-Length`, `ETag`, `Cache-Control`
- [X] T044 [P] Actualizar `docs/modelo-de-datos.md`: `book_catalog.cover_url` → `cover_origin_url` + las columnas de portada de `data-model.md`; agregar el bucket `covers` y la ruta `GET /api/covers/{id}` a la tabla de contratos de API
- [X] T045 [P] Actualizar `specs/002-importacion-kindle-kobo/research.md` y `data-model.md`: anotar que `book_catalog.cover_url` fue renombrada a `cover_origin_url` por la feature 004 y que ya no se muestra directamente (referencia cruzada, sin reabrir esa feature)
- [X] T046 Ejecutar `npx tsc --noEmit`, `npm test`, `npm run test:integration`; corregir cualquier `any` implícito
- [X] T047 Ejecutar los 11 escenarios de `specs/004-cover-image-storage/quickstart.md` contra el Supabase local (con `GOOGLE_BOOKS_API_KEY` cargada) y las verificaciones SQL; registrar el resultado de la prueba de humo (parámetro `zoom` de Google Books) en `research.md` si algo cambió respecto de E3–E6
- [X] T048 Revisión de privacidad: confirmar que `app/api/covers/[id]/route.ts` y `lib/covers/*` no importan `lib/supabase/client.ts` desde ningún componente cliente, que ninguna URL externa (Open Library/Google Books) queda expuesta en las respuestas de `/api/covers` ni en `next.config.ts`, y que los logs de `store-cover.ts`/`backfill.ts` sólo incluyen ids y códigos, nunca URLs completas ni bytes de imagen

---

## Dependencias y orden de ejecución

### Dependencias entre fases

- **Setup (1)** → sin dependencias.
- **Foundational (2)** depende de Setup y **bloquea todas las historias**.
- **US1 (3)** depende de Foundational; es la base de la que dependen las demás historias porque crea `storeCover`, la integración con `enrich-book.ts` y el módulo de Storage.
- **US2 (4)** depende de US1 (usa `storeCover`/`coverCandidates` ya integrados; sólo agrega pruebas y una verificación explícita).
- **US3 (5)** depende de US1 (`storeCover`, `CoverStore`, `CatalogCoverDb`) pero es independiente de US2.
- **US4 (6)** depende de US1; en paralelo con US2/US3.
- **Ruta y transversales (7)** depende de US1 (necesita filas `stored` para tener algo que servir); en paralelo con US2–US4 salvo T045 (referencia cruzada a la 002, sin prerequisito técnico).

### Dentro de cada historia

Pruebas (deben fallar) → módulos puros → integración con `enrich-book.ts`/Storage → verificación end-to-end.

### Tareas clave

- T005 → (T019–T024, T034, T043 usan las columnas nuevas)
- T006 → T007, T008, T010, T012 → T009, T011, T013
- T016 → T017 → T018 → T021 → T022 → T023 → T024, T025
- T017/T010 → T029, T030 (US2) · T017 → T037, T038 (US4) · T017/T016/T018 → T034 (US3)
- T043 depende de T016 (Storage) y de filas `stored` producidas por US1

## Oportunidades de paralelismo

```bash
# Setup
T001 T002 T003 T004

# Foundational (tras T005)
T006 T007 T008 T010 T012          # módulos independientes
T009 T011 T013                    # sus pruebas, una vez escritos los módulos

# US1 — pruebas antes de implementar
T014 T015

# US2 / US3 / US4 en paralelo entre sí, todas tras US1
T027 T028                         # US2
T032 T033                         # US3
T037 T038                         # US4

# Transversales
T041 T042 T044 T045
```

## Estrategia de implementación

### MVP primero (US1)

1. Setup (T001–T004) → Foundational (T005–T013).
2. US1 (T014–T026): portadas nuevas guardadas como copia propia, sin duplicar, sin retrasar el `done`.
3. **Parar y validar**: escenarios 1 y 3 del quickstart, con un import real contra Supabase local.

### Entrega incremental

1. + Ruta `/api/covers` (T041–T043) → la copia propia ya se puede **ver** desde el propio dominio (SC-005).
2. + US2 (calidad verificada) → confianza en que se guarda la mejor resolución.
3. + US4 (resiliencia) → nada de lo anterior se rompe con fuentes fallando.
4. + US3 (migración) → el catálogo existente también queda con copia propia.
5. Transversales: docs y validación final.

## Notas

- `[P]` = archivos distintos y sin dependencias pendientes. Commit por tarea o grupo lógico, con las pruebas en el mismo commit.
- Ninguna pantalla se toca en esta feature (Assumption del spec): no hay tareas de UI.
- Las pruebas de integración que pegan contra Open Library/Google Books reales (T025, T030, T033, T047) requieren `.env.local`/`.env.test.local` con `GOOGLE_BOOKS_API_KEY`; si la red no está disponible se documentan como omitidas, igual que las `*.real.test.ts` de la feature 002.
