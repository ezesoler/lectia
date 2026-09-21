# Research: Importación de Resaltados desde Kindle y Kobo

**Feature**: `002-importacion-kindle-kobo` | **Date**: 2026-09-21

El spec no tiene `[NEEDS CLARIFICATION]` abiertos. Esta investigación resuelve las decisiones
técnicas que el spec deja al plan, y deja explícitas las **correcciones al spec / docs** que
surgieron al cruzar el spec con el repositorio.

---

## Hallazgos que corrigen supuestos del spec

| # | Hallazgo | Consecuencia |
|---|---|---|
| H1 | El spec (Assumptions) dice que `imports` y los enums "ya existen". En el repo sólo existe `supabase/migrations/001_profiles.sql`. | Esta feature crea `books`, `highlights`, `imports` y los enums (migración 002), además de `book_catalog` y los cambios (migración 003). `list_items` queda para su propia feature. |
| H2 | `docs/modelo-de-datos.md` define `POST /api/imports/{id}/parse` como sincrónico y devuelve los contadores finales. El spec exige progreso, tolerar cerrar la pestaña y polling. | `parse` pasa a ser asincrónico (202) y el resultado se lee por `GET /api/imports/{id}`. Hay que actualizar el doc. |
| H3 | `imports` no tiene columnas de progreso (FR-020) ni forma de detectar un trabajo muerto (riesgo de bloquear para siempre por FR-025). | Se agregan `entries_total`, `entries_done`, `updated_at` y un índice único parcial (ver data-model). |
| H4 | La normalización del doc usa `\p{Diacritic}` sobre todo el texto. Eso quita la dakuten del japonés (が→か) y `[^\p{L}\p{N}\s]` elimina las marcas combinantes (`\p{M}`) del árabe/devanagari. Contradice la edge case del spec ("sólo letras latinas con diacríticos"). | Ver R3. Se corrige el doc. |
| H5 | Constitución VII: "toda tabla lleva `user_id`". `book_catalog` es compartida y no lo tiene. | Resuelto: constitución enmendada a 1.1.1 (2026-09-21); ver Complexity Tracking del plan. |
| H6 | `DELETE /api/profile` (feature 001) lista/borra el bucket `imports` con el cliente del usuario. Con un bucket sin políticas para el usuario eso no borra nada. | Se cambia a `service_role` para la limpieza de Storage (tarea en esta feature, porque acá nace el bucket). |
| H7 | La pantalla `/` es un stub y "Ver mi biblioteca" (US1-2, SC-004) asume una biblioteca que no existe. | Fuera de alcance: 002 deja los datos persistidos y el botón navega a `/`. La verificación de SC-004 en 002 se hace por consulta a la base en tests de integración; la vista de biblioteca es otra feature. |
| H8 | Los mockups de `/importar` no cubrían los estados de fallo. **Resuelto**: el usuario agregó `mockups/estados-importar/` (error de formato, error genérico, importación parcial; desktop + mobile + notas de implementación). | Se implementan fielmente (plan, "Fidelidad al mockup"). Aún no hay mockup del estado `parsing`; se deriva de `docs/funcionalidades.md`. |
| H9 | Los mockups nuevos exigen más que el spec: código de error copiable, detalle técnico plegado, desglose de descartes por motivo (los marcadores sin texto **cuentan** como descartados) y el mensaje "no se guardó nada" (contradice FR-013 si el fallo ocurre a mitad). | Decisiones del usuario (2026-09-21) volcadas al spec: FR-008, FR-021, FR-022, FR-028 a FR-030. "Descargar el detalle" queda fuera de alcance. Ver R13. |
| H10 | Los archivos reales (`docs/files imports/`) contradicen tres supuestos de R4/R5. | Parsers y fixtures ajustados (ver "Verificado con archivos reales" en R4 y R5). |

---

## R1. Cómo llega el archivo al servidor y dónde corre el parseo

**Decisión**: subida directa del navegador a Supabase Storage con URL firmada (bucket privado
`imports`, ruta `{user_id}/{import_id}`); luego `POST /api/imports/{id}/parse` responde `202` y
el trabajo corre en segundo plano con `after()` de `next/server` (estable en Next 15.5, versión
instalada). El cliente sondea `GET /api/imports/{id}` cada 1 s.

**Por qué**:
- Los Route Handlers en plataformas serverless tienen tope de cuerpo (~4,5 MB); un archivo de
  hasta 50 MB no puede pasar por Next. La URL firmada evita ese límite y sigue cumpliendo
  "parseo en servidor; el cliente sólo sube y escucha" (Constitución, Restricciones técnicas).
- `after()` permite responder ya y seguir trabajando; el estado vive en `imports`, no en la
  conexión, así que cerrar la pestaña no afecta el trabajo (edge case del spec).
- `export const maxDuration = 300` en el handler de `parse`. SC-001/SC-002 piden < 60 s, con lo
  que hay margen incluso en planes con tope de 60 s.

**Alternativas descartadas**:
- Subir el archivo por multipart a Next: choca con el límite de cuerpo y duplica memoria.
- Cola externa (Inngest, QStash, Supabase Edge Function + pgmq): agrega infraestructura y una
  dependencia sin necesidad demostrada para <60 s de trabajo. Se reevalúa si SC-001 no se cumple.
- Trabajo sincrónico dentro de `parse`: no permite mostrar progreso ni sobrevive a cerrar la pestaña.

**Trabajo muerto**: si la función muere a mitad de camino la fila queda en `parsing`/`queued` y
FR-025 bloquearía al usuario para siempre. Regla: un import activo sin `updated_at` nuevo en
los últimos 5 min (`queued`: 2 min) se marca `error` ("La importación se interrumpió") de forma
perezosa, en `POST /api/imports` y `GET /api/imports/{id}`. El parseo actualiza `updated_at` en
cada lote (latido).

**Cierre de sesión durante el trabajo**: la tarea de fondo no puede depender de cookies. Se
crea un cliente Supabase con el `access_token` del usuario capturado al arrancar
(`Authorization: Bearer …`), de modo que las escrituras a `books`/`highlights`/`imports` siguen
bajo RLS. El token dura 1 h, mucho más que el trabajo.

## R2. Qué cliente de Supabase escribe qué

**Decisión**:
- Tablas del usuario (`imports`, `books`, `highlights`): cliente con el token del usuario (RLS activa).
- `service_role` (`lib/supabase/admin.ts`, sólo servidor) únicamente para: (a) firmar la URL
  de subida y leer/borrar el objeto de Storage, (b) escribir en `book_catalog`, (c) limpieza
  de Storage al borrar cuenta.
- La ruta de Storage siempre se arma en el servidor con `user.id` de la sesión; el cliente
  nunca la propone.

**Por qué**: Constitución VII (privacidad por defecto) y la aclaración del spec de que sólo el
servidor escribe en `book_catalog`. Mantener RLS en las escrituras masivas es defensa en
profundidad frente a un bug que mezcle usuarios.

## R3. Normalización y claves (corrige H4)

**Decisión**: `lib/import/normalize.ts` exporta:

```
normalize(s) =
  s.normalize('NFD')
   .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')   // sólo diacríticos sobre letras latinas
   .normalize('NFC')
   .toLowerCase()
   .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')         // conserva marcas de otros alfabetos
   .replace(/\s+/g, ' ')
   .trim()
```

- `title_key = normalize(title)`, `author_key = normalize(author)`, `text_key = normalize(text)`.
- Para `text_key` la puntuación (incluidas comillas tipográficas) se elimina, así que la
  "unificación de comillas" del doc queda cubierta sin paso extra.
- Un texto que normaliza a cadena vacía (p. ej. sólo signos) se descarta (`empty_text`, R13).

**Hash (FR-009)**: `sha256_hex(title_key + '\u001f' + author_key + '\u001f' + kind + '\u001f' + text_key + '\u001f' + (location ?? ''))`
con `node:crypto`. Dos refinamientos sobre la fórmula literal del spec, ambos por Constitución I
("nunca se pierde un resaltado"):
1. Separador `U+001F` entre campos: la concatenación pelada es ambigua (`"ab"+"c"` = `"a"+"bc"`).
2. Se incluye `kind`: una nota con el mismo texto y ubicación que un subrayado no debe
   colisionar con él.
Ambos refinamientos ya están reflejados en FR-009 del spec (aprobado 2026-09-21).

**Alternativas**: `unaccent` de Postgres (no es `immutable`, y dependería de la extensión);
descartada porque las claves se calculan en el servidor y se reusan en el hash.

## R4. Parser de Kindle (`My Clippings.txt`)

**Decisión**: parser propio en TypeScript, sin dependencias, en `lib/import/kindle-parser.ts`.

- Decodificar como UTF-8 y quitar BOM (`U+FEFF`) al inicio y en títulos. Normalizar `\r\n`.
- Dividir por líneas `==========`. Cada entrada: línea 1 = `Título (Autor)`; línea 2 = metadatos;
  línea vacía; resto = texto.
- **Título/autor**: el último grupo entre paréntesis de la línea 1 es el autor; el resto es el
  título (los títulos pueden contener paréntesis). Sin paréntesis final → autor
  `"Autor desconocido"` (`books.author` es `not null`).
- **Varios autores**: Kindle los separa con `;` **sin espacio** (real: `William Irwin;Mark T. Conard;Aeon J. Skoble`). Se parte por `;` y se une con espacio antes de calcular la clave; sin esto `normalize` produciría `irwinmark`.
- **Autor en formato `Apellido, Nombre`**: el parser de Kindle lo invierte a `Nombre Apellido`
  (varios autores separados por `;`, cada uno por separado). Sólo se aplica a Kindle, cuya
  convención es esa; Kobo entrega `Nombre Apellido`. Sin esto SC-006 (mismo libro desde ambos
  orígenes bajo un solo registro) no se cumple en la práctica.
- **Metadatos independientes del idioma**: dividir por `|`. El tipo se detecta por la **palabra clave**, nunca por el artículo que la precede (el archivo real dice `"La subrayado en la página"`, no `"Tu subrayado"`), con un
  diccionario por idioma (en, es, pt, fr, de, it):
  - subrayado: highlight / subrayado / destaque / surlignement / markierung / evidenziazione
  - nota: note / nota / notiz
  - marcador y recorte (bookmark / marcador / clip / recorte…): **no se guardan y suman a
    `discarded`** con motivo `bookmark_no_text` (decisión del usuario, alineada con el mockup de
    importación parcial: "9 marcadores sin texto").
- **Página**: primer entero de la sección que contiene "page/página/pagina/seite/…"; opcional.
  **Ubicación**: rango tal como viene (`345-346`), guardado crudo; opcional.
- **Fecha**: mejor esfuerzo con diccionario de meses en los mismos idiomas; si no se puede
  interpretar, `highlighted_at = null`. Una fecha ilegible **nunca** descarta la entrada.
- **Descartada** (cuenta en `discarded`, con motivo; ver R13): `bookmark_no_text` (marcador/recorte),
  `empty_text` (subrayado o nota con texto vacío tras `trim` o `text_key` vacío), `truncated`
  (falta la línea de metadatos o el registro está cortado), `no_title` (sin línea de título) y
  `unknown_type` (palabra clave no reconocida).
- Las notas van como filas `kind = 'note'` propias (Kindle las exporta como entradas separadas).

**Verificado con archivos reales** (`docs/files imports/My Clippings.txt`: 215 entradas, 8 libros, 214 subrayados + 1 nota, 1 con texto vacío): esperado `entries = 214`, `discarded = 1` (`empty_text`), `booksCount = 8`; dos textos aparecen repetidos (se cuentan como `highlights_dup` en la primera importación).

**Limitación conocida (fuera de alcance)**: Kindle guarda un subrayado ampliado como dos
entradas superpuestas; se importan ambas. Se anota para una feature futura.

**Alternativa**: librerías npm de clippings — descartadas: poco mantenidas, sin cobertura de
idiomas y sin control del conteo de descartados.

## R5. Parser de Kobo (`KoboReader.sqlite`)

**Decisión**: `sql.js` (SQLite compilado a WASM) en `lib/import/kobo-parser.ts`. Es la única
dependencia de runtime nueva de esta feature.

**Justificación (Constitución, Restricciones técnicas)**:
- Sin binario nativo: funciona igual en desarrollo (Windows), CI y serverless.
- Abre desde un `Buffer` en memoria, sin escribir a disco ni depender de `/tmp`. El archivo ya
  es una copia subida, así que el "archivo bloqueado" del edge case ocurre en el lector, no
  acá; si el archivo está corrupto/truncado, `sql.js` lanza y se informa error específico.
- Kobo suele pesar 1–50 MB; cargarlo en memoria es aceptable con el tope de 50 MB.
- Requiere `serverExternalPackages: ['sql.js']` en `next.config.ts` y resolver el `.wasm` con
  `locateFile`.

**Alternativas**: `better-sqlite3` (binario nativo, necesita archivo en disco, frágil en
serverless); `node:sqlite` (experimental en Node 22); descartadas.

**Esquema a leer** (firmware ≥ 2018), a validar contra archivos reales antes de cerrar:
- Libro: `content` con `ContentType = 6` → `ContentID`, `Title`, `Attribution` (autor), `ISBN`.
- Anotaciones: `Bookmark` → `VolumeID` (une con `content.ContentID` del libro), `ContentID`
  (capítulo), `Type`, `Text`, `Annotation`, `StartContainerPath`, `StartOffset`, `EndOffset`, `DateCreated`.
- `Type = 'highlight'` con `Text` → `kind = highlight`, texto = `Text`.
- `Type = 'note'` → `kind = note`, texto = **`Annotation`** (en `note`, `Text` es el fragmento
  anclado y no se guarda). Nota con `Annotation` vacía → `empty_text`.
- `Type` ∈ {`markup`, `dogear`} (marcas a mano, marcadores) → descartadas, `bookmark_no_text`.
- `highlight` con `Text` vacío → descartada, `empty_text`. Fila sin libro en `content` → `orphan_volume`.
- `location` = `StartContainerPath:StartOffset-EndOffset` (estable entre reimportaciones; es lo
  que entra al hash). El título del capítulo (`content.Title` del `ContentID`) se guarda en
  `highlights.chapter` (columna nueva, FR-006).
- Archivo sin tabla `Bookmark`/`content` o con cero anotaciones → `error` con mensaje específico
  (SQLite vacío/otro esquema).

**Verificado con archivos reales** (`docs/files imports/KoboReader.sqlite`, inspeccionado con `sqlite3` de Python):
- `Bookmark`: 519 filas = 504 `highlight` (3 con `Text` vacío), 12 `markup` (vacías) y 3 `note` (con `Annotation`); ningún `highlight` trae `Annotation`. `Hidden` es `'false'` (texto) en todas.
- Esperado: `entries = 504` (501 highlights + 3 notas), `discarded = 15` (12 `bookmark_no_text` + 3 `empty_text`), `booksCount = 9` (10 volúmenes; uno sólo con filas descartadas).
- `content.ContentType` es **texto** (`'6'`, `'9'`, `'899'`): comparar contra `'6'`. Todos los `VolumeID` (`file:///mnt/onboard/…epub`, libros sideloaded) tienen fila `ContentType = '6'`.
- `ISBN` es `NULL` en todos: el enriquecimiento va por título + autor (`Attribution`, orden natural `Nombre Apellido`).
- `Bookmark.ContentID` coincide con una fila de `content` (capítulo, tipo `'9'`) en 407 de 519 filas: `chapter` es de mejor esfuerzo (`null` si no hay fila).
- 34 grupos comparten `(VolumeID, StartContainerPath, StartOffset)`: por eso `location` incluye también `EndOffset`; el hash además incluye el texto, así que no se pierden resaltados.

## R6. Persistencia y deduplicación

**Decisión**: una función SQL `public.import_batch(...)`, `security invoker` (RLS aplica),
invocada con `supabase.rpc` por lotes de ~500 resaltados.

Entrada: `p_import_id uuid`, `p_source source_kind`, `p_items jsonb` (cada ítem trae los datos
del libro + del resaltado, incluido el `hash` calculado en TypeScript). Dentro:
1. `user_id := auth.uid()` (jamás del payload).
2. `insert into books … on conflict (user_id, title_key, author_key) do update set title = books.title returning id, title_key, author_key`
   — el no-op preserva `source`, `imported_at` y demás campos del libro existente (FR-011/FR-012)
   y devuelve siempre el `id`.
3. `insert into highlights … on conflict do nothing returning id`; `inserted = count(returning)`,
   `duplicated = total − inserted`. Cubre duplicados contra la base y dentro del mismo lote.
4. Actualiza `imports` (`entries_done`, `highlights_new`, `highlights_dup`, `updated_at`) en la misma transacción.

Cada lote es una transacción: si el proceso muere, lo ya confirmado se conserva y `imports`
queda en `error` (FR-013). `books_count`, `discarded` y `entries_total` los calcula el parser
(libros únicos del archivo, no del lote).

**Por qué RPC y no supabase-js suelto**: es atómico por lote, evita 3 viajes por lote, permite
el no-op `do update` (que supabase-js `upsert` no permite sin pisar campos) y mantiene
`user_id` fuera del control del cliente.

**Alternativa**: `upsert` de supabase-js con `ignoreDuplicates` — devuelve sólo las filas nuevas
(sirve para resaltados) pero no el `id` de libros ya existentes; requeriría un `select` extra y
no es transaccional.

**Restricciones únicas**: se usa `unique (user_id, book_id, kind, text_key, location)` (con `kind`, ver prueba (h) de import-batch) en lugar de la del doc base
y se agrega `unique (user_id, hash)` (FR-009). `on conflict do nothing` sin objetivo cubre ambas.
`location` se guarda como `''` cuando el origen no la trae (no `null`), para que la restricción
funcione.

## R7. Progreso

**Decisión**: el parser primero recorre todo el archivo y calcula `entries_total`; el persistidor
actualiza `entries_done` por lote (dentro de `import_batch`). El cliente muestra
`entries_done / entries_total` como porcentaje y `entries_done` como "recuento parcial".
Mientras dura la subida (antes de `parsing` en servidor) la tarjeta muestra la barra
indeterminada, para cumplir SC-007 (feedback en < 3 s). Polling cada 1 s, con retroceso a 3 s
tras errores de red; se detiene en `done`/`error`.

## R8. Validación de archivos (FR-003, FR-004)

- **Cliente** (feedback inmediato, no autoritativo): extensión (`.txt` / `.sqlite`) y tamaño ≤ 50 MB.
- **Servidor en `POST /api/imports`**: `source` válido, extensión y `fileSize` ≤ 52 428 800.
- **Servidor en `parse`**: tamaño real del objeto en Storage; Kobo → cabecera `SQLite format 3\0`;
  Kindle → decodifica como UTF-8 y contiene al menos un separador `==========`. Un PDF cae
  acá con `invalid_file` y la tarjeta pasa a `error` (US1-4).
- El bucket se crea con `file_size_limit = 52428800`.
- **Borrado**: el objeto se elimina en un `finally` al terminar el trabajo (éxito o error). Un
  objeto huérfano (función muerta) se elimina al marcar el import como interrumpido.

## R9. Enriquecimiento de metadatos (FR-014 a FR-019, FR-027)

**Decisión**: paso asincrónico posterior, dentro de un segundo `after()`, disparado **después**
de marcar el import `done` (FR-019). Módulos en `lib/enrichment/`.

1. Por cada libro único del import: buscar en `book_catalog` (ISBN si hay; si no
   `(title_key, author_key)`). Hallado → `books.catalog_id = catalog.id` y listo.
2. No hallado → **Open Library** (`search.json`, sin clave): por ISBN (`q=isbn:…`) o por
   `title` + `author`; campos `cover_i` (→ `https://covers.openlibrary.org/b/id/{id}-L.jpg`),
   `number_of_pages_median`, `subject[0]`. Header `User-Agent` identificable (3 req/s permitidos
   frente a 1 req/s anónimo).
3. Por cada campo faltante → **Google Books** (`volumes?q=isbn:` o `intitle:`+`inauthor:`,
   con `GOOGLE_BOOKS_API_KEY`): `imageLinks.thumbnail` (forzado a `https`), `categories[0]`,
   `pageCount`. Merge: cada campo de la primera API que lo provea (FR-016).
4. **Aceptación del resultado (anti-envenenamiento del catálogo)**: sólo se toma un resultado
   si `normalize(título_api) == title_key` (o lo contiene/está contenido con ≥ 80 % de tokens)
   **y** algún token del `author_key` aparece en los autores devueltos. Sin coincidencia → se
   trata como "no encontrado". Consistente con la aclaración del spec: la protección es por
   origen de datos, no sólo por RLS.
5. Se escribe en `book_catalog` sólo si al menos un campo salió de una API (FR-017/FR-018);
   luego `books.catalog_id` se actualiza con el cliente del usuario. Sin datos → no hay fila
   en catálogo y el libro queda sin `catalog_id`.
6. **Reintentos (FR-027)**: fallos de red, timeout (5 s por request), `429` o `5xx` → 3 reintentos
   con esperas de 1 s, 2 s, 4 s (4 intentos en total; el spec enumera tres esperas). Se respeta
   `Retry-After` si es ≤ 10 s. Agotados los reintentos se conservan los datos parciales.
7. **Concurrencia y límite**: un limitador global de ~3 req/s hacia Open Library y concurrencia
   máxima de 4 libros. El presupuesto de tiempo es el resto de `maxDuration`; lo que no llegue a
   procesarse queda con `catalog_id = null` y se reintenta en la próxima importación.
8. **Privacidad**: a las APIs sólo viajan título, autor e ISBN. Nunca texto de resaltados
   (Constitución VII).

**Riesgo sobre SC-008** (80 % en 30 s): con el límite de Open Library (~3 req/s) el catálogo
frío alcanza ~90 libros en 30 s. Para bibliotecas grandes el objetivo sólo se cumple a medida
que el catálogo compartido se calienta. Se documenta; se recomienda acotar SC-008 a
"bibliotecas de hasta ~80 libros" o aceptar el incumplimiento en importaciones grandes iniciales.

**Decisiones menores**:
- `books.cover_url/pages/genre` no se rellenan; se lee vía `catalog_id` (evita dos fuentes de
  verdad). Esas columnas quedan para libros manuales (feature de búsqueda).
- Una entrada de catálogo parcial no se reconsulta en importaciones siguientes (v1).
- `next.config.ts` debe permitir `covers.openlibrary.org` y `books.google.com` en `images.remotePatterns`.
- La categoría es el primer `subject`/`categories[0]` tal cual; el mapeo a géneros es de la
  feature de estadísticas.

## R10. Bloqueo de importación concurrente (FR-025)

**Decisión**: índice único parcial `imports_one_active_per_source on imports (user_id, source) where state in ('queued','parsing')`.
`POST /api/imports` intenta insertar y traduce la violación `23505` a `409 import_in_progress`.
Es atómico (sin carrera entre dos pestañas). Si la subida falla, el cliente llama
`DELETE /api/imports/{id}` (sólo válido en `queued`) para liberar el cupo sin esperar el timeout.

## R11. Estado inicial de `/importar` (FR-026)

**Decisión**: `app/(app)/importar/page.tsx` (Server Component) consulta con RLS la última fila
de `imports` por origen (`order by started_at desc`) y se la pasa al componente cliente como
estado inicial. Si alguna está en `parsing`, el cliente arranca el polling. No hace falta un
endpoint de "últimas importaciones".

## R12. Pruebas (Constitución VI)

- **Unitarias (Vitest)**: `normalize`, `hash`, parser de Kindle, parser de Kobo, enriquecimiento
  (merge, aceptación, backoff con temporizadores falsos, `fetch` simulado).
- **Fixtures** en `tests/fixtures/`: `clippings-es.txt`, `clippings-en.txt`,
  `clippings-broken.txt` (entradas truncadas, sin página, otro idioma, sólo inválidas, BOM),
  `kobo-valid.sqlite`, `kobo-empty.sqlite`, `kobo-corrupt.sqlite`. Los `.sqlite` se generan con
  `sql.js` en un script (`tests/fixtures/build-kobo.ts`) para que sean reproducibles. **Los
  archivos "reales" que pide la constitución los tiene que aportar el usuario** (exportar de su
  Kindle/Kobo, anonimizando texto si quiere); hasta entonces los fixtures son sintéticos y
  están marcados así.
- **Integración**: rutas `/api/imports*` y la función `import_batch` contra Supabase local
  (`supabase start`; requiere `supabase init` y Docker). Casos: idempotencia (SC-003), fusión
  Kindle+Kobo (SC-006), bloqueo 409, RLS entre dos usuarios, borrado del objeto en éxito y error.
- **E2E (Playwright)**: importar Kindle, importar Kobo, reimportar (tercer flujo crítico
  "importar" de la constitución); mobile y desktop.

## R13. Descartes por motivo, códigos de error y mensajes (decisiones del 2026-09-21)

**Desglose de descartes**: el parser devuelve `discardBreakdown: Partial<Record<DiscardReason, number>>`
y `discarded` es su suma. `DiscardReason` ∈ `bookmark_no_text` ("marcadores sin texto"),
`empty_text` ("registros sin texto"), `truncated` ("registros truncados"), `no_title`
("registros sin título de libro"), `unknown_type` ("registros de tipo desconocido"),
`orphan_volume` ("anotaciones sin libro"). Se guarda en `imports.discard_breakdown` (jsonb, sólo
conteos; **nunca texto ni ubicaciones del usuario**). La UI lo muestra siempre expandido en
`done` cuando `discarded > 0` (mockup `03-importacion-parcial`). Sin "Descargar el detalle".

**Catálogo de errores** (`lib/import/messages.ts`): cada código tiene `kind` (`format` |
`generic`), título, cuerpo y, si aplica, texto de ayuda. `kind` decide la variante de la tarjeta:

| Código | Causa | `kind` |
|---|---|---|
| `ERR_IMPORT_4001` | Kindle: sin separador `==========` o ningún registro con la forma `Título (Autor)` | format |
| `ERR_IMPORT_4002` | Kobo: la cabecera no es SQLite | format |
| `ERR_IMPORT_4003` | Kobo: SQLite dañado o truncado | format |
| `ERR_IMPORT_4004` | Kobo: falta `Bookmark`/`content` (otro esquema o firmware anterior a 2018) | format |
| `ERR_IMPORT_4005` | Estructura válida pero cero resaltados válidos (todo descartado / Kobo sin anotaciones) | format |
| `ERR_IMPORT_4006` | Archivo por encima de 50 MB | format |
| `ERR_IMPORT_5031` | Procesamiento interrumpido (trabajo muerto, fallo de lote, timeout) | generic |
| `ERR_IMPORT_5001` | Error no clasificado | generic |

**Detalle técnico plegado** (`imports.error_details`, jsonb; sólo para `kind = format`):
`{ linesRead, validRecords, expected?, found? }`, con `found` = primera línea no vacía
truncada a 80 caracteres (es contenido de un archivo que **no** es un clippings válido, no
resaltados). Kobo: `{ found: "La cabecera del archivo no es SQLite" }` y similares.

**Mensaje fiel a lo persistido (FR-022 / FR-013)**: `messageFor(code, { saved })` con
`saved = highlights_new > 0`. `saved = false` → "No se guardó nada. Podés reintentar sin
duplicar." `saved = true` → "Lo que ya se guardó se conserva. Podés reintentar sin duplicar."
El mockup afirma "no se guardó nada" siempre; la variante `saved = true` es una **desviación
justificada** por FR-013 y por el Principio I.

**Reintentar (FR-030)**: `use-import` conserva la referencia al `File` mientras la pestaña siga
viva; "Reintentar" vuelve a subirlo (import nuevo). Tras una recarga sólo queda "Elegir otro
archivo". El servidor no guarda nada para reintentar (FR-004).

**"Dónde está el archivo"**: panel plegable dentro de la tarjeta (sin diálogo modal ni
dependencia nueva) con la ruta en el lector: Kindle, carpeta `documents`, `My Clippings.txt`;
Kobo, carpeta oculta `.kobo`, `KoboReader.sqlite`. El mockup sólo muestra el botón, no el
estado abierto: desviación a registrar en el plan.
