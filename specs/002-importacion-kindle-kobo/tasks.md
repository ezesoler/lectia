# Tasks: Importación de Resaltados desde Kindle y Kobo

**Input**: Design documents from `specs/002-importacion-kindle-kobo/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Pruebas**: incluidas. La constitución (VI) las exige: unitarias para parsers y normalización,
integración para las rutas de importación y e2e del flujo crítico "importar". Cada prueba va en
el mismo commit que el código que cubre (Flujo de trabajo, punto 4); dentro de cada historia las
pruebas se escriben primero y deben fallar antes de implementar.

**Organización**: por historia de usuario del spec (US1–US5). El enriquecimiento de metadatos
(FR-014–FR-019, FR-027) no pertenece a una sola historia: tiene su propia fase con etiqueta `[ENR]`.

**Revisión 2026-09-21**: se incorporan (a) los archivos reales de `docs/files imports/`, (b) los
mockups de `mockups/estados-importar/` y (c) las decisiones del usuario: los marcadores sin texto
cuentan como descartados con desglose por motivo; el mensaje de error es fiel a lo persistido;
se agregan código de error y detalle técnico plegado; **"Descargar el detalle" queda fuera**.

## Format: `- [ ] [ID] [P?] [Story?] Descripción con ruta de archivo`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[US1]–[US5]**: historia del spec · **[ENR]**: enriquecimiento transversal
- Rutas relativas a la raíz del repo. Convenciones del repo: TypeScript strict (sin `any` implícito ni
  `@ts-ignore` sin comentario), alias `@/` para la raíz, textos de UI en español rioplatense (voseo),
  tokens de `app/globals.css` (nunca colores nuevos), acceso a env con `process.env["NOMBRE"]`.
- Las pruebas de parsers/crypto/sql.js llevan `// @vitest-environment node` (el `vitest.config.ts` usa jsdom).
- Referencias de diseño: `mockups/mobile/02-importar.html` (idle/done),
  `mockups/estados-importar/01-error-formato.html`, `02-error-generico.html`,
  `03-importacion-parcial.html` (cada uno con versión desktop, mobile y notas de implementación).

---

## Phase 1: Setup (infraestructura compartida)

**Propósito**: dependencias, configuración y compuertas previas.

- [X] T001 **Compuerta Principio VIII** — Mockups de los estados de fallo entregados por el usuario en `mockups/estados-importar/` (error de formato, error genérico, importación parcial). Quedan **sin mockup** y se registran como desviaciones en `plan.md` ("Fidelidad al mockup"): el estado `parsing` y el estado abierto de "Dónde está el archivo".
- [X] T002 Archivos reales aportados en `docs/files imports/` (`My Clippings.txt`: 215 entradas, 8 libros; `KoboReader.sqlite`: 519 filas en `Bookmark`, 10 libros). Ya validados contra `research.md` R4/R5; los resultados esperados están documentados ahí y se usan en T023 y T036.
- [X] T003 Instalar `sql.js` y `@types/sql.js` (dev) con `npm install sql.js && npm install -D @types/sql.js` en `package.json`
- [X] T004 [P] Actualizar `next.config.ts`: agregar `serverExternalPackages: ["sql.js"]` y `images.remotePatterns` para `covers.openlibrary.org` y `books.google.com` (https), conservando `lh3.googleusercontent.com`
- [X] T005 [P] Agregar a `.env.local.example` `GOOGLE_BOOKS_API_KEY` y `OPEN_LIBRARY_CONTACT` (opcional), con comentario "sólo servidor; nunca `NEXT_PUBLIC_`"
- [X] T006 [P] Configurar pruebas de integración: `supabase init` (crea `supabase/config.toml`, sin tocar las migraciones), `vitest.integration.config.ts` (entorno `node`, `include: ["tests/integration/**/*.test.ts"]`, alias `@`), script `"test:integration": "vitest run --config vitest.integration.config.ts"` en `package.json`, y helper `tests/integration/helpers.ts` que crea dos usuarios de prueba con `admin.auth.admin.createUser` y devuelve clientes autenticados + cliente `service_role` contra el Supabase local (`supabase start`)
- [X] T007 [P] **Proteger datos personales**: agregar `docs/files imports/` y `tests/fixtures/real/` a `.gitignore` (hoy `docs/files imports/` aparece sin ignorar y el `.sqlite` puede traer datos de cuenta); crear `tests/fixtures/README.md` explicando qué fixtures son sintéticos y que las pruebas "reales" (T023, T036) leen `docs/files imports/` y se omiten (`describe.skipIf`) si la carpeta no existe, como en CI

**Checkpoint**: `npm run build` sigue pasando; `supabase start` levanta el stack local.

---

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Propósito**: esquema, normalización, catálogo de errores, orquestador y rutas base que TODAS las historias usan.

**⚠️ CRÍTICO**: ninguna historia puede empezar hasta completar esta fase.

- [X] T008 Crear `supabase/migrations/002_core_schema.sql` (con `create ... if not exists` donde aplique): enums `source_kind` (`kindle`,`kobo`,`manual`), `note_kind`, `import_state`; tablas `imports`, `books`, `highlights` en ese orden con las columnas de `docs/modelo-de-datos.md`, `unique (user_id, title_key, author_key)` en `books`, `unique (user_id, book_id, text_key, location)` en `highlights` con `location text not null default ''`, índices del doc y RLS `"own rows"` (`auth.uid() = user_id`, `for all`, `with check`) en las tres. Sin `list_items` (otra feature).
- [X] T009 Crear `supabase/migrations/003_import_catalog.sql` parte 1 según `data-model.md`: en `imports` las columnas `entries_total`, `entries_done`, `updated_at`, `discard_breakdown jsonb not null default '{}'`, `error_code text`, `error_details jsonb`; índice único parcial `imports_one_active_per_source`; tabla `book_catalog` con índices únicos (`isbn` parcial, `title_key+author_key`), check `sources_valid`, RLS con política de lectura `for select to authenticated` y **sin** políticas de escritura; `books.catalog_id` (FK nullable, `on delete set null`); `highlights.hash text not null`, `highlights.chapter text`, índice único `highlights_user_hash (user_id, hash)`; bucket privado `imports` (`file_size_limit = 52428800`) sin políticas en `storage.objects`
- [X] T010 En `supabase/migrations/003_import_catalog.sql` (mismo archivo que T009) agregar la función `public.import_batch(p_import_id uuid, p_source source_kind, p_items jsonb) returns table (inserted int, duplicated int)`, `language plpgsql security invoker`: verifica que el import pertenece a `auth.uid()` y está en `parsing`; upsert de `books` con `on conflict (user_id, title_key, author_key) do update set title = books.title returning id`; `insert into highlights … on conflict do nothing returning id` con `user_id = auth.uid()`, `book_id`, `source`, `import_id` puestos por la función; suma `entries_done`, `highlights_new`, `highlights_dup`, `updated_at` en `imports` en la misma transacción
- [X] T011 [P] Crear `lib/supabase/admin.ts` exportando `createAdminClient()` (`@supabase/supabase-js` con `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, `auth: { persistSession: false }`) y `createUserTokenClient(accessToken: string)` (anon key + header `Authorization: Bearer`) para el trabajo en segundo plano (R1/R2). Comentario de cabecera: sólo servidor, prohibido importarlo desde componentes cliente
- [X] T012 [P] Crear `lib/import/types.ts` con `ParsedEntry`, `DiscardReason` (`bookmark_no_text` | `empty_text` | `truncated` | `no_title` | `unknown_type` | `orphan_volume`), `ParseResult` (con `discardBreakdown` y `linesRead?`), `ErrorDetails`, `ImportStatus`, `ImportSource = "kindle" | "kobo"`, `ImportState` y `ParserFn`, según `data-model.md` y `contracts/parser-contract.md`
- [X] T013 [P] Crear `lib/import/normalize.ts` (`normalize`, `buildKeys`, `hashHighlight`, `canonicalizeKindleAuthor`) según `research.md` R3/R4 — sólo quita diacríticos sobre letras latinas y conserva `\p{M}` de otros alfabetos; hash SHA-256 con `node:crypto` y separador `\u001f` incluyendo `kind` — y `tests/unit/normalize.test.ts` (`// @vitest-environment node`): acentos latinos, `が` no pierde la dakuten, árabe/devanagari conservan marcas, cadena vacía tras normalizar, colisión `"ab"+"c"` vs `"a"+"bc"` evitada, nota ≠ subrayado con mismo texto/ubicación, `"García Márquez, Gabriel"` → `"Gabriel García Márquez"`, y el caso **real** `"William Irwin;Mark T. Conard;Aeon J. Skoble"` (`;` sin espacio) → `"William Irwin Mark T. Conard Aeon J. Skoble"` con clave `"william irwin mark t conard aeon j skoble"`
- [X] T014 [P] Crear `lib/import/messages.ts` con el catálogo de errores de `research.md` R13: `ERROR_CATALOG` (`ERR_IMPORT_4001`…`4006`, `5001`, `5031`) con `kind: "format" | "generic"`, título y cuerpo en español rioplatense (textos de los mockups: "No pudimos leer este archivo", "Algo falló al importar"), `DISCARD_LABELS` (motivo → "marcadores sin texto", "registros truncados", "registros sin título de libro", …, con singular/plural) y `messageFor(code, { saved: boolean })`, que devuelve "No se guardó nada. Podés reintentar sin duplicar." si `saved = false` y "Lo que ya se guardó se conserva. Podés reintentar sin duplicar." si `saved = true`. Prueba `tests/unit/messages.test.ts`
- [X] T015 [P] Crear `lib/import/stale.ts` con `expireStaleImports(supabase, userId, source?)`: marca `error` (`error_code = "ERR_IMPORT_5031"`, `error_message = messageFor(..., { saved: highlights_new > 0 })`, `finished_at = now()`) los imports `parsing` con `updated_at` > 5 min o `queued` > 2 min, y borra su objeto de Storage con el cliente admin (R1). Prueba unitaria en `tests/unit/stale.test.ts` con cliente simulado
- [X] T016 Crear `tests/integration/import-batch.test.ts` contra Supabase local (depende de T006, T008–T010): (a) lote nuevo inserta libros y resaltados con `user_id` del token, no del payload; (b) reenviar el mismo lote → `inserted = 0`, `duplicated = N`; (c) duplicados dentro de un mismo lote cuentan una vez; (d) libro existente conserva `source` e `imported_at`; (e) usuario B no ve ni puede insertar sobre imports de A (RLS); (f) segundo import `queued`/`parsing` del mismo origen viola `imports_one_active_per_source`; (g) usuario `authenticated` puede leer `book_catalog` pero `insert`/`update` falla; (h) mismo texto y ubicación con `kind` distinto produce hashes distintos y ambos se guardan
- [X] T017 Crear `lib/import/run-import.ts` con `runImport({ importId, userId, accessToken, source, parsers, storage })` (dependencias inyectables): descarga el objeto, valida tamaño real ≤ 50 MB (`ERR_IMPORT_4006`) y firma (`SQLite format 3\0` / decodifica UTF-8 con separador `==========`), llama al parser, fija `entries_total`, `books_count`, `discarded` y `discard_breakdown`, envía lotes de 500 a `import_batch` cediendo el hilo entre lotes, y al final marca `done` o `error`. En `error` guarda `error_code`, `error_message = messageFor(code, { saved: highlights_new > 0 })` y, si el error es de formato, `error_details` (`linesRead`, `validRecords`, `expected`, `found` = primera línea no vacía truncada a 80 caracteres; **nunca** texto de resaltados). Un fallo de lote conserva lo ya persistido (FR-013) con `ERR_IMPORT_5031`. Todo en `try/finally` que **borra el objeto de Storage** (FR-004). Cliente de datos = `createUserTokenClient(accessToken)`. Prueba `tests/unit/run-import.test.ts` con parser y storage simulados: éxito con descartes, archivo inválido, parser que lanza, lote que falla a mitad (mensaje `saved = true`), fallo antes de guardar (`saved = false`), borrado del objeto en ambos caminos, `error_details` sin texto de resaltados
- [X] T018 Crear `app/api/imports/route.ts` — `POST` según `contracts/imports-api.md`: autentica (401), valida `source`/extensión/`fileSize` (400 `invalid_file` / `unsupported_source`), llama a `expireStaleImports`, inserta la fila `queued` (violación `23505` → 409 `import_in_progress` con `details.importId`), firma la subida con `admin.storage.from("imports").createSignedUploadUrl("{user.id}/{importId}")` y responde 201 `{ importId, upload: { bucket, path, token } }`. Ruta de Storage siempre armada en servidor
- [X] T019 Crear `lib/import/status.ts` (`toImportStatus(row): ImportStatus`, mapea columnas snake_case a camelCase incluyendo `discardBreakdown`, `errorCode`, `errorDetails`, `fileSize`) y `app/api/imports/[id]/route.ts`: `GET` (404 si no es del usuario; llama a `expireStaleImports`; devuelve `ImportStatus`) y `DELETE` (sólo `queued`: borra fila y objeto → 204; `parsing`/`done`/`error` → 409 `invalid_state`; 404)
- [X] T020 Corregir `app/api/profile/route.ts` (H6): la limpieza del bucket `imports` en `DELETE` debe usar `createAdminClient()` de `lib/supabase/admin.ts` (listar `user.id` y borrar) en vez del cliente del usuario

**Checkpoint**: migraciones aplicadas en local, `npm test` y `npm run test:integration` pasan; el usuario puede crear un import `queued` por API.

---

## Phase 3: US1 — Lector importa su Kindle por primera vez (P1) 🎯 MVP

**Goal**: arrastrar `My Clippings.txt` a la tarjeta Kindle, ver progreso y el resumen final; reimportar no duplica; un archivo incorrecto muestra error sin tocar nada.

**Independent Test**: escenarios 1, 2 y 3 de `quickstart.md`; `tests/e2e/import-kindle.spec.ts`.

### Pruebas — US1 (escribir primero, deben fallar)

- [X] T021 [P] [US1] Crear fixtures sintéticos `tests/fixtures/clippings-es.txt` y `tests/fixtures/clippings-en.txt` reproduciendo las rarezas del archivo real: `"La subrayado en la página"` / `"La nota en la página"`, autores con `;` sin espacio, un autor `Apellido, Nombre`, `\r\n`, BOM sólo en la primera línea, un marcador y una entrada con texto vacío; documentarlos en `tests/fixtures/README.md`
- [X] T022 [P] [US1] Crear `tests/unit/kindle-parser.test.ts` (`// @vitest-environment node`): título/autor con paréntesis dentro del título, autor invertido, varios autores con `;`, sin autor → `"Autor desconocido"`, tipo detectado por palabra clave sin importar el artículo, subrayado vs nota, página y ubicación opcionales (`location = ''` si falta), BOM y `\r\n`, marcador → `discarded` con `bookmark_no_text`, texto vacío → `empty_text`, `booksCount` correcto, entrada vacía → `entries = []`
- [X] T023 [P] [US1] Crear `tests/unit/kindle-parser.real.test.ts` (`describe.skipIf(!existsSync(ruta))`, ruta `docs/files imports/My Clippings.txt`): esperado `entries.length = 214`, `discarded = 1`, `booksCount = 8`, `entries.length + discarded = 215`
- [X] T024 [P] [US1] Crear `tests/integration/imports-api.test.ts`: 401 sin sesión; 404 sobre import de otro usuario; 400 por extensión/tamaño; flujo completo Kindle (POST → subir con `uploadToSignedUrl` → `parse` 202 → sondear GET hasta `done`) verificando filas en `books`/`highlights`, contadores y **objeto de Storage borrado**; un PDF subido como Kindle termina en `error` `ERR_IMPORT_4001` con `errorDetails` y no modifica datos previos; `parse` idempotente (2.ª llamada no lanza otro trabajo); `parse` sin objeto → 422 `file_missing`

### Implementación — US1

- [X] T025 [US1] Crear `lib/import/kindle-parser.ts` con `parseClippings(text: string): ParseResult` según `research.md` R4 (diccionario en/es en esta historia; estructura preparada para más idiomas en US4): quita BOM, divide por `==========`, extrae título/autor (último paréntesis; `;` → espacio; `Apellido, Nombre` → `Nombre Apellido`), tipo por palabra clave, página, ubicación, texto; fecha en mejor esfuerzo (nunca descarta); marcadores/recortes y entradas con texto vacío → `discarded` con su motivo; devuelve `linesRead` y `booksCount` (con `buildKeys`)
- [X] T026 [US1] Crear `lib/import/parsers.ts`: registro `{ kindle: parseClippings }` con la firma `ParserFn` (texto UTF-8 decodificado desde el buffer); Kobo se agrega en T039
- [X] T027 [US1] Crear `app/api/imports/[id]/parse/route.ts` (`export const maxDuration = 300`): autentica, verifica propiedad (404), estado (409 `invalid_state`), existencia del objeto (422 `file_missing`), transición atómica `queued → parsing` (`update … where state = 'queued'`; si ya está `parsing` responde 202 sin relanzar), captura `access_token` de la sesión, responde `202 { state: "parsing" }` y ejecuta `runImport` dentro de `after()` de `next/server`
- [X] T028 [P] [US1] Crear `components/import/use-import.ts` (cliente): `useImport(source, initial)` con máquina de estados `idle | uploading | parsing | done | error`; `start(file)` valida extensión/tamaño en cliente (mensaje inmediato), llama `POST /api/imports`, sube con `createClient().storage.from("imports").uploadToSignedUrl(path, token, file)` (`lib/supabase/client.ts`), llama `POST …/parse` y sondea `GET /api/imports/{id}` cada 1 s hasta `done`/`error`; si la subida falla llama `DELETE /api/imports/{id}`; `reset()`
- [X] T029 [P] [US1] Crear `components/import/source-card.tsx` (cliente): tarjeta por origen con estados `idle` (zona punteada, ícono de descarga, "Todavía sin archivo de {Kindle|Kobo}", botón "Elegir archivo" de 46 px, ayuda de carpeta: `.kobo` oculta / `documents`; arrastre con borde punteado→sólido en escritorio, sin arrastre en mobile), `parsing` (barra indeterminada mientras sube, luego determinada; `role="progressbar"`), `done` ("N libros · M resaltados" + "listo" en `--ok` + "Reemplazar archivo") y un `error` provisional (mensaje + "Reintentar") que US3/US4 reemplazan por las variantes de los mockups. Chips `--k-bg`/`--o-bg` con `My Clippings.txt` / `KoboReader.sqlite`. Estados anunciados con `aria-live="polite"`. Fiel a `mockups/mobile/02-importar.html` (radios 3–4 px, objetivos ≥ 44 px, sin emoji ni colores nuevos)
- [X] T030 [US1] Crear `components/import/import-screen.tsx` (cliente): cabecera "Importar" + "Paso 1 de 1", párrafo introductorio, dos `SourceCard` (Kindle, Kobo), botón "Ver mi biblioteca" (`/`, 52 px, `--ink`) **deshabilitado** (opacidad .55) salvo que alguna tarjeta esté en `done` (FR-023); grilla `minmax(min(100%, 292px), 1fr)` en escritorio
- [X] T031 [US1] Actualizar `app/(app)/importar/page.tsx` para renderizar `<ImportScreen initial={{ kindle: null, kobo: null }} />` debajo de `TopBar`, conservando la carga del perfil existente (la carga del estado inicial real llega en US3)
- [X] T032 [US1] Crear `tests/e2e/import-kindle.spec.ts` (Playwright, proyectos `chromium` y `mobile-chrome`): reutilizando el helper de sesión de los e2e de la feature 001, subir `clippings-es.txt` con `setInputFiles`, esperar `done` y el texto "N libros · M resaltados", verificar "Ver mi biblioteca" habilitado; subir un PDF → tarjeta en `error` con acción de reintento
- [X] T033 [US1] Verificación visual de `/importar` contra `mockups/mobile/02-importar.html` y luego `lectia-desktop.html?s=import`, claro y oscuro, estados `idle` y `done`; anotar desviaciones justificadas en `plan.md`

**Checkpoint**: US1 funcional y demostrable de punta a punta con Kindle (MVP).

---

## Phase 4: US2 — Lector importa su Kobo (P1)

**Goal**: subir `KoboReader.sqlite`, ver el resumen; libros comunes con Kindle se fusionan y cada resaltado conserva su origen.

**Independent Test**: escenarios 4 y 5 de `quickstart.md`; `tests/e2e/import-kobo.spec.ts`.

### Pruebas — US2

- [X] T034 [P] [US2] Crear `tests/fixtures/build-kobo.ts` (usa `sql.js`) que genera en `tests/fixtures/`: `kobo-valid.sqlite` (tablas `content` y `Bookmark` con el esquema real: `ContentType` como **texto** `'6'`/`'9'`, `Hidden = 'false'`, `highlight` con `Annotation` vacía, `note` con `Text` + `Annotation`, `markup` sin texto, un `highlight` con `Text` vacío, ISBN nulo, y un libro que coincide con `clippings-es.txt`), `kobo-empty.sqlite` (esquema sin anotaciones), `kobo-noschema.sqlite` (SQLite sin esas tablas) y `kobo-corrupt.sqlite` (bytes truncados); script `"fixtures:kobo"` en `package.json`. Rotular como sintéticos
- [X] T035 [P] [US2] Crear `tests/unit/kobo-parser.test.ts` (`// @vitest-environment node`): mapeo de `content`/`Bookmark`; `note` → `kind = note` con texto = `Annotation`; `location = StartContainerPath:StartOffset-EndOffset`; capítulo desde `content.Title` (o `null`); `markup`/`dogear` → `bookmark_no_text`; `highlight` sin texto → `empty_text`; fila sin libro → `orphan_volume`; ISBN devuelto si existe; `KoboFileError` con `not_sqlite`/`corrupt`/`unsupported_schema`/`empty`
- [X] T036 [P] [US2] Crear `tests/unit/kobo-parser.real.test.ts` (`describe.skipIf`, ruta `docs/files imports/KoboReader.sqlite`): esperado `entries.length = 504` (501 highlights + 3 notas), `discarded = 15` (`bookmark_no_text: 12`, `empty_text: 3`), `booksCount = 9` (10 volúmenes en `Bookmark`, uno sólo con filas descartadas), `entries.length + discarded = 519`
- [X] T037 [P] [US2] Crear `tests/integration/merge-sources.test.ts`: importar `clippings-es.txt` y luego `kobo-valid.sqlite` → un único registro en `books` para el libro común (autor Kindle `Apellido, Nombre` vs Kobo `Nombre Apellido`), resaltados con `source` `kindle`/`kobo` respectivos y `books.source` sin cambios (SC-006, FR-011/FR-012); el orden inverso da el mismo resultado (FR-024)

### Implementación — US2

- [X] T038 [US2] Crear `lib/import/kobo-parser.ts` con `parseKobo(buffer: Uint8Array): Promise<ParseResult>` según `research.md` R5: inicializa `sql.js` con `locateFile` apuntando al `.wasm` de `node_modules/sql.js/dist`, abre desde el buffer en memoria, une `Bookmark.VolumeID` con `content.ContentID` **comparando `ContentType = '6'` como texto**, construye entradas y desglose de descartes, y lanza `KoboFileError` tipado
- [X] T039 [US2] Registrar `kobo: parseKobo` en `lib/import/parsers.ts`; mapear `KoboFileError.code` a códigos `ERR_IMPORT_4002`–`4005` en `lib/import/run-import.ts`; ejecutar T036 contra el archivo real y ajustar el parser si difiere
- [X] T040 [US2] Verificar en `components/import/source-card.tsx` la tarjeta Kobo (ayuda "Está en la carpeta oculta `.kobo` del lector", chip `KoboReader.sqlite`, `accept=".sqlite"`) y que los dos orígenes se importan de forma independiente y en cualquier orden (FR-024)
- [X] T041 [US2] Crear `tests/e2e/import-kobo.spec.ts`: subir `kobo-valid.sqlite` → `done`; subir `kobo-empty.sqlite` → tarjeta en `error`; importar Kindle y Kobo en ambos órdenes

**Checkpoint**: US1 y US2 funcionan solas y juntas.

---

## Phase 5: US3 — Progreso en tiempo real, resumen final y error genérico (P2)

**Goal**: barra con porcentaje y recuento parcial; resumen exacto (libros, nuevos, duplicados, descartados); reanudar al volver a la página; bloquear importaciones simultáneas del mismo origen; fallo de procesamiento mostrado como error genérico con código copiable.

**Independent Test**: escenarios 8, 9 y 14 de `quickstart.md`; `tests/e2e/import-progress.spec.ts`.

### Pruebas — US3

- [X] T042 [P] [US3] Crear `tests/unit/use-import.test.tsx` (Testing Library + temporizadores falsos): el sondeo avanza `entriesDone/entriesTotal`, se detiene en `done`/`error`, retrocede a 3 s tras error de red, retoma si `initial.state = "parsing"`, `409 import_in_progress` produce el mensaje de importación en curso sin interrumpir la activa; **FR-030**: `retry()` reutiliza el `File` en memoria y crea un import nuevo; tras un estado inicial de servidor (recarga) `retry` no está disponible y sólo queda elegir otro archivo
- [X] T043 [P] [US3] Crear `tests/unit/source-card.test.tsx`: barra determinada con porcentaje y "N resaltados encontrados"; barra indeterminada cuando `entriesTotal = 0`; `done` muestra "N libros · M resaltados" y "listo"; error genérico (código `ERR_IMPORT_5xxx`) muestra "Algo falló al importar", código, fecha, archivo · tamaño, "Reintentar" como acción primaria y "Elegir otro archivo"; "Copiar código" llama a `navigator.clipboard.writeText` con el código y anuncia "Código copiado" (`aria-live`); el texto "no se guardó nada" sólo aparece si el mensaje del servidor lo dice
- [X] T044 [P] [US3] Crear `tests/integration/import-lifecycle.test.ts`: `entries_done` crece entre sondeos durante un archivo grande; segundo `POST /api/imports` del mismo origen durante `parsing` → 409 y la activa termina; import `parsing` sin latido > 5 min pasa a `error` `ERR_IMPORT_5031` al hacer `GET` y libera el cupo (FR-025, R1); dos orígenes en paralelo no se afectan

### Implementación — US3

- [X] T045 [US3] Completar `components/import/source-card.tsx` con la barra determinada (porcentaje = `entriesDone / entriesTotal`, "N resaltados encontrados") y crear `components/import/error-generic-card.tsx` según `mockups/estados-importar/02-error-generico.html`: ícono de círculo (no triángulo), título "Algo falló al importar", `errorMessage` del servidor, código `ERR_IMPORT_xxxx` + fecha (`finishedAt`) + `fileName · fileSize`, botón "Copiar código" (Clipboard API con fallback de selección de texto; feedback "Código copiado" con `aria-live`), "Reintentar" como acción **primaria** con el mismo archivo, "Elegir otro archivo" secundaria y el texto de soporte; sin colores nuevos (`--selection`, `--accent`, `--card`, `--hover-line`); el error reemplaza la zona punteada **dentro** de la tarjeta y no bloquea el otro origen
- [X] T046 [US3] Completar `components/import/use-import.ts`: retroceso del sondeo (1 s → 3 s tras fallos), reanudación desde estado inicial `queued`/`parsing`, conservar la referencia al `File` para `retry()` (FR-030) y descartarla al recargar, manejo de 409 con mensaje "Ya hay una importación en curso para {origen}. Esperá a que termine." sin cancelar la activa
- [X] T047 [US3] Actualizar `app/(app)/importar/page.tsx` (FR-026): consultar con RLS la última fila de `imports` por origen (`order by started_at desc`, una por `source`), llamar `expireStaleImports`, mapear con `toImportStatus` y pasarla como `initial` a `ImportScreen`; el cliente reanuda el sondeo si alguna está `parsing`
- [X] T048 [US3] Crear `tests/e2e/import-progress.spec.ts`: iniciar importación de un archivo grande generado en el test, cerrar la pestaña, reabrir `/importar` y verificar `parsing` reanudado o `done`; abrir una 2.ª pestaña y comprobar el rechazo por importación en curso

**Checkpoint**: el usuario ve el progreso, sobrevive a recargas y un fallo interno se ve como error genérico con código.

---

## Phase 6: US4 — Archivo parcialmente válido y error de formato (P2)

**Goal**: se guarda lo válido y se informa lo descartado por motivo (importación parcial); un archivo que no es del formato esperado se rechaza con detalle técnico plegado; un archivo 100 % inválido da `error`.

**Independent Test**: escenarios 6, 13 y 15 de `quickstart.md`; `tests/integration/partial-files.test.ts`.

### Pruebas — US4

- [X] T049 [P] [US4] Crear fixtures sintéticos en `tests/fixtures/`: `clippings-broken.txt` (100 entradas, 10 descartables: 6 marcadores, 2 truncadas, 1 sin título, 1 texto vacío), `clippings-all-invalid.txt` (con separadores pero ninguna entrada válida), `clippings-not-clippings.txt` (texto tipo "# Resaltados exportados", sin separadores; caso del mockup de error de formato) y `clippings-multilang.txt` (pt, fr, de, it, ja, ar)
- [X] T050 [P] [US4] Ampliar `tests/unit/kindle-parser.test.ts`: `clippings-broken.txt` → 90 válidas / `discarded = 10` con desglose `{ bookmark_no_text: 6, truncated: 2, no_title: 1, empty_text: 1 }`; `clippings-multilang.txt` → tipos y páginas por idioma, japonés/árabe tal cual, fecha ilegible → `highlightedAt = null` sin descartar; `clippings-not-clippings.txt` → `entries = []` y `linesRead` correcto; todo inválido → `entries = []`, `discarded = N`
- [X] T051 [P] [US4] Ampliar `tests/unit/kobo-parser.test.ts`: filas con `Text` nulo o `VolumeID` sin libro cuentan en `discarded` y no abortan
- [X] T052 [P] [US4] Crear `tests/integration/partial-files.test.ts`: archivo con 20 % descartable → `done`, válidas guardadas, `discarded` y `discard_breakdown` correctos (SC-005); invariante `highlights_new + highlights_dup + discarded = entries_total`; `clippings-not-clippings.txt` → `error` `ERR_IMPORT_4001` con `error_details = { linesRead, validRecords: 0, expected, found }`, `found` ≤ 80 caracteres y **sin** texto de resaltados; `clippings-all-invalid.txt` → `error` `ERR_IMPORT_4005` conservando `discarded`/`discard_breakdown`; `error_message` distingue `saved = false` de `saved = true` (lote fallido a mitad)
- [X] T053 [P] [US4] Ampliar `tests/unit/source-card.test.tsx`: importación parcial (`done` + `discarded > 0`) mantiene chip y "listo", muestra "N registros quedaron afuera" y el desglose siempre expandido con las etiquetas de `DISCARD_LABELS`, **no** muestra "Descargar el detalle"; error de formato (código 4xxx) muestra "No pudimos leer este archivo", nombre y tamaño, "Ver detalle" **plegado por defecto** (`<details>`), "Elegir otro archivo" y "Dónde está el archivo" (panel plegable); "Ver mi biblioteca" sigue deshabilitado si no hay ningún origen en `done`

### Implementación — US4

- [X] T054 [US4] Ampliar `lib/import/kindle-parser.ts`: diccionarios de tipo (pt/fr/de/it) y de meses para la fecha (`research.md` R4), motivos `truncated`/`no_title`/`unknown_type`; extraer las tablas a `lib/import/kindle-locales.ts` si el archivo supera ~300 líneas
- [X] T055 [US4] Ajustar `lib/import/run-import.ts`: si `entries.length = 0` → `error` con `ERR_IMPORT_4001` (sin separador / sin forma `Título (Autor)`) o `ERR_IMPORT_4005` (estructura válida pero todo descartado), **guardando `discarded` y `discard_breakdown`** y `error_details`; en `done` fijar `books_count`/`discarded`; asegurar el invariante de contadores
- [X] T056 [P] [US4] Crear `components/import/partial-notice.tsx` según `mockups/estados-importar/03-importacion-parcial.html`: panel de aviso dentro de la tarjeta `done` (fondo `--card-2`, filo de 2 px `--accent` a la izquierda, sin borde completo), título "N registros quedaron afuera", "El resto se importó sin problemas.", lista de motivos con conteo (`DISCARD_LABELS`) siempre expandida. **Sin** "Descargar el detalle" (fuera de alcance)
- [X] T057 [P] [US4] Crear `components/import/error-format-card.tsx` y `components/import/where-is-file.tsx` según `mockups/estados-importar/01-error-formato.html`: panel (fondo `--selection`, borde 1 px `--accent`, ícono `--accent`, etiquetas en `--ink` por contraste, botón secundario con fondo `--card` y borde `--hover-line`), título "No pudimos leer este archivo", `fileName` y tamaño, "Ver detalle" plegado con `linesRead`/`validRecords`/`expected`/`found`, "Elegir otro archivo", "No se guardó nada de este intento" sólo cuando `saved = false`; "Dónde está el archivo" abre un panel inline con la ruta del archivo en el lector (Kindle: carpeta `documents`, `My Clippings.txt`; Kobo: carpeta oculta `.kobo`, `KoboReader.sqlite`)
- [X] T058 [US4] Integrar `partial-notice`, `error-format-card` y `error-generic-card` en `components/import/source-card.tsx`: elegir la variante por `errorCode` (4xxx → formato, 5xxx → genérico) y por `discarded > 0` en `done`; el estado provisional de T029 se elimina
- [X] T059 [US4] Crear `tests/e2e/import-partial-and-format.spec.ts`: importar `clippings-broken.txt` → `done` con aviso parcial y "Ver mi biblioteca" habilitado; subir `clippings-not-clippings.txt` → error de formato con "Ver detalle" plegado y el otro origen sigue utilizable; subir un PDF → error de formato
- [X] T060 [US4] Verificación visual de las tres variantes contra `mockups/estados-importar/01`, `02`, `03` (mobile primero, luego desktop; claro y oscuro) y anotar desviaciones justificadas en `plan.md` (mensaje `saved = true`, estado abierto de "Dónde está el archivo")

**Checkpoint**: US1–US4 completas; un archivo roto nunca rompe la importación y cada fallo se explica.

---

## Phase 7: US5 — Reimportar tras leer más (P3)

**Goal**: la reimportación agrega sólo lo nuevo y nunca duplica ni borra.

**Independent Test**: escenario 7 de `quickstart.md`; `tests/integration/reimport.test.ts`.

### Pruebas — US5

- [X] T061 [P] [US5] Crear `tests/fixtures/clippings-es-plus10.txt` (= `clippings-es.txt` + 10 entradas nuevas, sintético)
- [X] T062 [P] [US5] Crear `tests/integration/reimport.test.ts`: mismo archivo dos veces → `highlights_new = 0`, `highlights_dup` = total, filas de `highlights` idénticas (SC-003); versión con 10 nuevas → `highlights_new = 10`, `highlights_dup = anterior`, total = anterior + 10 (US5-1); mismo texto en otra ubicación se guarda como distinto; el mismo resaltado importado desde Kindle y Kobo con ubicaciones distintas no se deduplica (limitación documentada); con el archivo real de Kindle (si existe) la 2.ª importación da `highlights_new = 0`
- [X] T063 [P] [US5] Crear `tests/e2e/import-reimport.spec.ts`: importar, "Reemplazar archivo", subir la versión ampliada y verificar el resumen con duplicados

### Implementación — US5

- [X] T064 [US5] Implementar en `components/import/source-card.tsx` y `use-import.ts` el flujo "Reemplazar archivo" desde `done`/`error` (vuelve a abrir el selector y crea un import nuevo; el resumen anterior se mantiene hasta que arranca el nuevo; botón ≥ 44 px)

**Checkpoint**: idempotencia verificada; US1–US5 completas.

---

## Phase 8: Enriquecimiento de metadatos [ENR] (FR-014–FR-019, FR-027)

**Goal**: tras `done`, cada libro obtiene portada, categoría y páginas desde `book_catalog`, Open Library o Google Books, sin retrasar la importación visible.

**Independent Test**: escenario 10 de `quickstart.md`; `tests/integration/catalog.test.ts`.

**Dependencias**: Foundational y US1 (necesita libros importados). Puede hacerse en paralelo con US3–US5, salvo T071 (toca `parse/route.ts` y `run-import.ts`). Nota real: los libros del Kobo de muestra no traen ISBN; la búsqueda es por título + autor.

### Pruebas — ENR

- [X] T065 [P] [ENR] Crear `tests/unit/enrich-book.test.ts` (`// @vitest-environment node`, `fetch`/`sleep`/cliente admin inyectados): acierto en catálogo sin llamar a APIs; Open Library completo; Open Library parcial + Google Books completa sólo los campos faltantes (merge, FR-016); resultado rechazado por título/autor que no coinciden (R9.4); reintentos con esperas 1 s/2 s/4 s ante red/429/5xx y respeto de `Retry-After` ≤ 10 s; agotados los reintentos → datos parciales; sin datos → `not_found` **sin** escribir en `book_catalog`; nunca se envía texto de resaltados en las URLs
- [X] T066 [P] [ENR] Crear `tests/integration/catalog.test.ts`: `authenticated` no puede insertar/actualizar `book_catalog`; `service_role` sí; `sources` vacío o inválido viola `sources_valid`; `done` se alcanza sin esperar el enriquecimiento; libro sin datos queda con `catalog_id = null` y guardado igualmente (FR-018)

### Implementación — ENR

- [X] T067 [P] [ENR] Crear `lib/enrichment/open-library.ts`: `searchOpenLibrary({ isbn?, title, author })` sobre `https://openlibrary.org/search.json` (`fields=key,title,author_name,cover_i,number_of_pages_median,subject,isbn`, `limit=3`), `User-Agent` con `OPEN_LIBRARY_CONTACT`, timeout 5 s, limitador global ~3 req/s; devuelve `{ title, authors, coverUrl, category, pages }` con `coverUrl = https://covers.openlibrary.org/b/id/{cover_i}-L.jpg`
- [X] T068 [P] [ENR] Crear `lib/enrichment/google-books.ts`: `searchGoogleBooks({ isbn?, title, author })` sobre `https://www.googleapis.com/books/v1/volumes` con `GOOGLE_BOOKS_API_KEY` (`process.env["GOOGLE_BOOKS_API_KEY"]`), `q=isbn:` o `intitle:`+`inauthor:`, `maxResults=3`, timeout 5 s; `imageLinks.thumbnail` forzado a `https`; `categories[0]`, `pageCount`
- [X] T069 [ENR] Crear `lib/enrichment/catalog.ts`: único punto de escritura a `book_catalog` (cliente admin): `findCatalog({ isbn?, titleKey, authorKey })` y `saveCatalog(entry)` que **rechaza** entradas con `sources` vacío y usa `on conflict do nothing` + re-lectura (índices únicos por ISBN y por claves)
- [X] T070 [ENR] Crear `lib/enrichment/enrich-book.ts` (`enrichBook(input, deps)` según `contracts/parser-contract.md`: catálogo → Open Library → Google Books para los campos faltantes → aceptación de resultado R9.4 → `saveCatalog` sólo si algún campo vino de una API; helper `withBackoff` con 3 reintentos a 1 s, 2 s, 4 s y `Retry-After`) y `lib/enrichment/enrich-import.ts` (`enrichImportBooks({ userId, accessToken, books })`: concurrencia máxima 4, presupuesto de tiempo, actualiza `books.catalog_id` con `createUserTokenClient`; un error por libro no interrumpe al resto)
- [X] T071 [ENR] Cablear el enriquecimiento: `runImport` devuelve la lista de libros únicos (título, autor, claves, `isbn?` de Kobo) al marcar `done`, y `app/api/imports/[id]/parse/route.ts` ejecuta `enrichImportBooks` en un **segundo** `after()` posterior, de modo que `done` no espera (FR-019)
- [X] T072 [ENR] Crear `scripts/check-enrichment.sql` (porcentaje de `books` del último import con `catalog_id` y con portada/categoría/páginas no nulas) y documentar en `quickstart.md`, escenario 10, cómo medir SC-008 importando una biblioteca de ~80 libros y consultando 30 s después de `done`. No se agrega vista de catálogo en la UI (fuera de alcance, H7)

**Checkpoint**: libros conocidos se enriquecen en segundo plano; el catálogo sólo lo escribe el servidor.

---

## Phase 9: Polish y transversales

- [X] T073 [P] Actualizar `docs/modelo-de-datos.md`: `parse` asincrónico (H2), normalización corregida (H4), fórmula del hash con separador y `kind` (R3), `book_catalog`, columnas nuevas de `imports` (progreso, `discard_breakdown`, `error_code`, `error_details`) / `highlights` / `books`, contratos de `/api/imports*`
- [X] T074 Cambios de documentos vigentes **aprobados y aplicados el 2026-09-21**: `spec.md` (FR-008, FR-009, FR-021, FR-022, FR-028–FR-030, SC-008, Assumptions, Clarifications) y `constitution.md` 1.1.1 (Principio VII). Falta sólo el commit con la justificación de la enmienda
- [X] T075 [P] Crear `tests/fixtures/gen-large.ts` y una prueba de rendimiento `tests/integration/perf-import.test.ts` (5 000 entradas Kindle y 3 000 Kobo): verificar < 60 s de `queued` a `done` (SC-001/SC-002) y feedback de progreso < 3 s (SC-007)
- [X] T076 Revisión de seguridad y privacidad: confirmar que `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_BOOKS_API_KEY` y `lib/supabase/admin.ts` no aparecen en el bundle cliente (`grep` sobre `.next/static` tras `npm run build`); que ninguna variable nueva lleva `NEXT_PUBLIC_`; que no se registran textos de resaltados en logs; y que `imports.error_details`/`discard_breakdown` nunca contienen texto de resaltados (prueba sobre los fixtures)
- [X] T077 Ejecutar `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:integration` y `npm run test:e2e`; corregir cualquier `any` implícito o `@ts-ignore` sin justificación (Constitución VI) **Resultado 2026-09-21**: `tsc --noEmit` limpio, `npm run build` OK (compila, tipos y lint de build), 141 unitarias y 49 de integración verdes, 45 e2e verdes. `npm run lint` no está configurado en el repo (`next lint` pide configurar ESLint de forma interactiva; preexistente, no se creó configuración). 9 e2e de la feature 001 (`auth-cancel`, `auth-delete-account` sin sesión, `auth-new-user`) fallan por causas ajenas a esta feature: el middleware redirige `/api/*` sin sesión a `/login` (200) en lugar de responder 401, y hay textos de la pantalla de login que no coinciden.
- [ ] T078 Ejecutar todos los escenarios de `specs/002-importacion-kindle-kobo/quickstart.md` (1–15) y las verificaciones SQL, incluyendo los archivos reales de `docs/files imports/`; repetir la verificación visual (T033, T060) para `parsing` en mobile y desktop, claro y oscuro **Estado**: escenarios 1–9, 11–13 y 15 verificados por pruebas automáticas (unit, integración contra Supabase local y e2e desktop+mobile); 14 (error genérico) verificado por unitarias, por la expiración real de un import muerto (`ERR_IMPORT_5031`) y por capturas visuales. **Pendiente**: escenario 10 con las APIs reales y la medición de SC-008 (requiere `GOOGLE_BOOKS_API_KEY` y una biblioteca de ~80 libros); Open Library se verificó contra la API real y Google Books no (sin clave).
- [X] T079 Verificar que la feature 001 no se rompió: correr `tests/e2e/auth-delete-account.spec.ts` (ahora con limpieza de Storage por `service_role`, T020) **Resultado**: la limpieza de Storage con `service_role` quedó cubierta por el nuevo `tests/e2e/import-account-cleanup.spec.ts` (borrado con sesión real: usuario, imports/books/highlights y archivo huérfano desaparecen). Los 2 tests de `auth-delete-account.spec.ts` (sin sesión → 401) ya fallaban por el redirect del middleware descrito en T077.

---

## Dependencias y orden de ejecución

### Dependencias entre fases

- **Setup (1)**: sin dependencias. T001 y T002 ya están resueltas.
- **Foundational (2)** depende de Setup y **bloquea todas las historias**.
- **US1 (3)** depende de Foundational. **US2 (4)** depende de Foundational y comparte `parsers.ts`/`source-card.tsx` con US1 (hacerla después de US1 evita conflictos).
- **US3 (5)** depende de la UI de US1 (`source-card`, `use-import`, `page`). **US4 (6)** depende de los parsers de US1/US2 y de `error-generic-card` (T045) para integrar las variantes en T058. **US5 (7)** depende de US1.
- **ENR (8)** depende de Foundational y US1; en paralelo con US3–US5 salvo T071.
- **Polish (9)** al final.

### Dentro de cada historia

Pruebas (deben fallar) → parser/lógica → rutas → UI → e2e → verificación visual.

### Dependencias entre tareas clave

- T009 → T010 (mismo archivo) → T016 · T012, T013, T014 → T017 → T018/T019 · T025 → T026 → T027
- T028/T029 en paralelo → T030 → T031 · T038 → T039 · T045 → T058 · T056/T057 → T058 · T069 → T070 → T071

## Oportunidades de paralelismo

```bash
# Setup
T004 T005 T006 T007            # archivos distintos

# Foundational (tras T008–T010)
T011 T012 T013 T014 T015       # módulos independientes

# US1 — pruebas y UI en paralelo
T021 T022 T023 T024            # fixtures + unit + real + integración
T028 T029                      # hook y tarjeta

# US2
T034 T035 T036 T037

# US4 — pruebas y componentes de UI
T049 T050 T051 T052 T053
T056 T057

# ENR (en paralelo con US3–US5)
T065 T066 T067 T068
```

## Estrategia de implementación

### MVP primero (US1)

1. Setup (T003–T007) → Foundational (T008–T020).
2. US1 (T021–T033): importar Kindle de punta a punta.
3. **Parar y validar** escenarios 1–3 del quickstart y el test con el archivo real (T023).

### Entrega incremental

1. + US2 (Kobo) → la propuesta de valor completa (ambos lectores).
2. + US3 y US4 (progreso, error genérico, parcial y error de formato) → experiencia confiable con archivos grandes o rotos.
3. + US5 (reimportación) y ENR (portadas y metadatos) → cierre.
4. Polish: docs, rendimiento, seguridad y validación final.

## Notas

- `[P]` = archivos distintos y sin dependencias pendientes. Commit por tarea o grupo lógico, con las pruebas en el mismo commit.
- La vista de biblioteca (`/`) queda fuera de alcance (H7): la verificación de "aparece en la biblioteca" se hace por consulta a la base en integración.
- Fuera de alcance por decisión del usuario: "Descargar el detalle" de descartes (mockup de importación parcial).
- Los fixtures sintéticos no sustituyen los archivos reales; éstos viven en `docs/files imports/` (ignorada en git, T007) y sus pruebas se omiten si no están.
