# Research: Portadas como recurso propio

**Feature**: `004-cover-image-storage` | **Date**: 2026-09-21

El spec no tiene `[NEEDS CLARIFICATION]` abiertos. Esta investigación resuelve las decisiones
técnicas y documenta los **hallazgos empíricos** contra las APIs reales (Open Library y Google
Books, con la clave real), que cambian supuestos del spec y del código de la feature 002.

---

## Hallazgos empíricos (verificados el 2026-09-21)

| # | Hallazgo | Consecuencia |
|---|---|---|
| E1 | **Open Library**: `covers.openlibrary.org/b/id/{id}.jpg` (sin sufijo) devuelve el **archivo original**; `-L` está topado en ~500 px de alto. Ejemplo real: *Dune* (id 6976407) → original 2734×4650 (988 KB) vs `-L` 294×500. En la mayoría de los libros son iguales, pero el sufijo `-L` nunca es mejor. | La mayor calidad es el original: variantes `[original, -L]`. La feature 002 guardaba `-L`. |
| E2 | Open Library, id inexistente: **sin** `?default=false` devuelve `200` con un **GIF de 1×1**; **con** `?default=false` devuelve `404`. | Siempre se pide con `?default=false`; el `404` significa "no ofrece portada". |
| E3 | **Google Books, búsqueda**: `imageLinks` sólo trae `smallThumbnail`/`thumbnail` (**128 px**). La URL trae `&edge=curl` (efecto de página curvada) y `zoom=1`. La 002 guardaba esa URL: una miniatura de 128 px con efecto curl. | Google Books no sirve tal cual: hay que construir la URL de contenido. |
| E4 | **Google Books, contenido**: `books.google.com/books/content?id={id}&printsec=frontcover&img=1&zoom=N`. `zoom=0` da el **original** cuando existe (*La generación ansiosa*: 1744×2641, 548 KB); `zoom=4`→800 px, `3`→575 px, `2`→300 px, `1`→128 px; `5` en adelante vuelve a la miniatura. Sin `edge=curl`. | Variantes `[0, 4, 3, 2]`, sin `edge=curl`. |
| E5 | **Google Books, imagen de reemplazo**: cuando no hay portada devuelve `200` con un **PNG "image not available" de 575×750 (9.103 B)** en `zoom=0` y de **128×170 (1.269 B)** en `zoom=1`. Ejemplo real: *Superficiales* en `zoom=0` devuelve el reemplazo y en `zoom=4` la portada real (800×1153). Con un `id` falso devuelve **exactamente los mismos bytes** (SHA-256 `3efa8c43…`). | El mínimo de 100 px del spec (FR-009) **no alcanza**: el reemplazo mide 575×750. Hay que detectarlo por huella conocida y por heurística (ver R4). |
| E6 | `zoom=0` no es siempre el mayor: en *Superficiales* es el reemplazo y `zoom=4` es el mejor. | La selección recorre las variantes en orden descendente y toma la **primera válida** (no reemplazo). |

---

## R1. Dónde se guardan las imágenes y cómo se sirven

**Decisión**: bucket **privado** `covers` de Supabase Storage (sin políticas para los usuarios;
sólo `service_role` escribe y lee), un objeto por libro del catálogo con ruta `{catalog_id}`
(sin extensión; el tipo va en los metadatos y en `book_catalog.cover_format`). Se sirven por una
ruta propia `GET /api/covers/{catalogId}` que exige sesión, lee el objeto con `service_role` y
lo entrega con `Cache-Control: private, max-age=31536000, immutable` y `ETag` = SHA-256.

**Por qué**:
- FR-015 pide lectura para usuarios autenticados y escritura sólo del servidor: un bucket
  privado + ruta con sesión lo cumple sin abrir Storage al cliente.
- La URL es del propio dominio (verdadero "recurso propio", SC-005) y es **estable** (no caduca
  como una URL firmada), así que el navegador la cachea de forma inmutable: el costo del
  servidor es una lectura por usuario y portada.
- Las políticas de Storage para `authenticated` complicarían el modelo de permisos y la
  ruta `/api/covers` deja la decisión de acceso en un solo lugar.

**Alternativas descartadas**:
- Bucket público: la URL sería abierta a cualquiera; contradice FR-015 y expone las copias de
  contenido de Google Books a cualquier persona.
- URLs firmadas: caducan, no se pueden cachear de forma inmutable y exponen el dominio de Supabase.
- Guardar la imagen como `bytea` en Postgres: infla la base y las consultas del catálogo.

## R2. Selección de la mayor resolución (FR-005, FR-006, FR-018)

**Decisión**: cada fuente aporta una lista ordenada de URLs candidatas, de mayor a menor
calidad esperada; se descarga en orden y se toma la **primera válida** (imagen real, no
reemplazo, dentro de límites).

| Fuente | Candidatas (en orden) |
|---|---|
| Open Library (`cover_i`) | `…/b/id/{cover_i}.jpg?default=false` (original) → `…/b/id/{cover_i}-L.jpg?default=false` |
| Google Books (`id` del volumen) | `books.google.com/books/content?id={id}&printsec=frontcover&img=1&zoom={0,4,3,2}` |

- Orden entre fuentes (clarificación del spec): **Open Library primero**; Google Books sólo si
  Open Library no ofrece portada (no hay `cover_i` o todas sus candidatas dieron `404`).
  Un fallo **transitorio** de Open Library (red, `429`, `5xx` agotados) **no** habilita el
  respaldo de Google Books: la portada queda `pending` y se reintenta (evita copiar contenido de
  Google sin necesidad).
- El `id` de Google Books se extrae de la URL `imageLinks.thumbnail` (parámetro `id`). Sin `id`
  no hay candidatas de Google Books.
- La misma derivación (`variantsFromOrigin(url)`) sirve para la migración: una URL existente de
  Open Library da `[original, -L]`; una de Google Books, `[0, 4, 3, 2]` (E3–E4). La migración
  usa la fuente de la portada actual (Assumption del spec).

**Alternativa descartada**: descargar todas las candidatas y quedarse con la de más píxeles.
Triplica o cuadruplica el tráfico (hasta ~1,3 MB por libro de Google) sin ganancia demostrada:
en los ejemplos reales, la primera válida en orden descendente es la mayor (E4, E6).

## R3. Fidelidad de los bytes (FR-007, FR-008)

**Decisión**: el objeto guardado son exactamente los bytes recibidos (`Uint8Array` desde
`arrayBuffer()`); no hay decodificación, recompresión ni redimensionado. Se registran formato,
ancho, alto, bytes y SHA-256 (`node:crypto`) calculados sobre esos mismos bytes.

**Formatos aceptados**: JPEG, PNG y WebP (el spec: "se guarda tal como se entrega").

**Dimensiones sin dependencia nueva**: módulo propio `lib/covers/image-info.ts` que lee la
cabecera (JPEG: marcadores `SOF0–SOF15`; PNG: `IHDR`; WebP: `VP8`/`VP8L`/`VP8X`) y verifica
que el archivo no esté truncado (JPEG termina en `FFD9`; PNG contiene `IEND`; WebP: el tamaño
declarado en `RIFF` coincide). ~150 líneas, sin binarios nativos.

**Alternativas descartadas**: `sharp` (binario nativo, pesado, tienta a re-codificar), `image-size`
(resuelve dimensiones pero no truncamiento ni reemplazos; habría que validar igual).

## R4. Validación e imágenes de reemplazo (FR-009)

Una imagen se acepta si cumple **todo**:

1. Formato reconocido por su cabecera (no se confía en `Content-Type`).
2. No truncada (R3).
3. Tamaño ≤ **10 MB** (se corta la descarga al superarlo, no se lee completa).
4. Lado menor ≥ **100 px**.
5. **No es una imagen de reemplazo conocida**: SHA-256 en la lista `KNOWN_PLACEHOLDERS` (E5:
   `3efa8c43…` y `e3f8c414…`).
6. **Heurística "casi vacía"**: `bytes / (ancho × alto) < 0.03`. El reemplazo de Google tiene
   0,021; una portada real de Open Library ronda 0,15 y una de Google ≥ 0,1. Cubre reemplazos
   futuros que cambien de huella. Se documenta el umbral y se prueba con los ejemplos reales.

El spec sólo pedía descartar reemplazos "muy pequeños o vacíos" (E5 muestra que eran grandes):
se ajusta FR-009 y una Assumption en el spec.

## R5. Descarga: reintentos y salidas (FR-010, FR-011)

**Decisión**: nuevo `getBinary(url, deps)` sobre el mismo esquema que `getJson` (feature 002):
timeout **15 s** por intento, hasta 3 reintentos con esperas 1 s → 2 s → 4 s ante red/timeout/
`429`/`5xx`, respeta `Retry-After` ≤ 10 s. Resultado tipado:

| Resultado | Cuándo | Efecto |
|---|---|---|
| `ok` | `2xx` con bytes | se valida (R4) |
| `absent` | `404`/`410`/`403` | la fuente no ofrece esa variante: se prueba la siguiente |
| `failed` | reintentos agotados | transitorio: el libro queda `pending` |

Si **ninguna** variante es válida pero alguna fue `absent` o reemplazo (y ninguna `failed`), la
fuente no ofrece portada: `cover_status = 'unavailable'`. Si alguna `failed` → `pending` con
`cover_attempts + 1`.

## R6. Guardado sin duplicados y con consistencia (FR-003)

- Ruta del objeto = `{catalog_id}`: **una copia por libro** por construcción.
- Subida con `upsert: false`. Si el objeto ya existe (`409`, otra importación ganó la carrera,
  o un intento anterior murió entre la subida y la actualización de la fila), se **adopta**:
  se descarga el objeto existente, se valida y se recalculan los metadatos desde esos bytes.
  Así la fila siempre describe lo que realmente hay guardado.
- Actualización de la fila condicionada a `cover_status <> 'stored'` (gana el primero); si otra
  instancia ya la completó, no se pisa.
- Un objeto huérfano (subido pero sin fila actualizada) se reconcilia en el siguiente intento
  por la vía de adopción.

## R7. Cuándo corre (FR-004, FR-012)

- **En importaciones nuevas**: dentro del enriquecimiento (`after()`, ya posterior al `done`).
  Tras guardar la fila del catálogo con `cover_status = 'pending'` y la URL de origen, el mismo
  trabajador descarga y guarda la portada. Mismo presupuesto de tiempo y concurrencia (4) que la 002.
- **Reintento**: si un libro del import ya está en el catálogo con `cover_status = 'pending'`,
  `attempts < 5` y `cover_checked_at` anterior a 1 hora, se vuelve a intentar (FR-012). Al llegar
  a 5 intentos pasa a `unavailable` (no reintenta solo; reactivable con el script).
- **Migración de existentes**: `scripts/backfill-covers.ts` (`npm run covers:backfill`) con
  `service_role` contra el entorno indicado por `.env.local`. Toma lotes de filas
  `cover_status = 'pending'` ordenadas por `cover_checked_at nulls first`, concurrencia 4;
  es idempotente y reanudable porque su cursor es el propio estado de la fila. Flags:
  `--limit N`, `--dry-run`, `--include-unavailable`.
- Ritmo: Open Library por id de portada no tiene el límite de 100 pedidos/5 min que sí aplica a
  ISBN/OLID; Google `books/content` no lleva clave y no mostró límites en las pruebas. Aun así
  el backfill espacia los pedidos por host (mínimo 150 ms).

## R8. Esquema

Ver `data-model.md`. Resumen: `book_catalog.cover_url` → `cover_origin_url` (sólo procedencia);
columnas `cover_status`, `cover_path`, `cover_format`, `cover_width`, `cover_height`,
`cover_bytes`, `cover_sha256`, `cover_source`, `cover_attempts`, `cover_checked_at`,
`cover_stored_at`; bucket privado `covers`. La migración marca `pending` todas las filas con
`cover_origin_url` y deja `none` las demás.

## R9. Cambios sobre la feature 002 (código y pruebas)

- `ApiCandidate.coverUrl` → `coverOrigin?: string` (URL base de procedencia) y `coverSource`;
  `NewCatalogEntry.cover_url` → `cover_origin_url` + `cover_status` + `cover_source`.
- `enrichBook` devuelve además el estado de la portada y llama a `storeCover` tras `saveCatalog`.
- Se ajustan pruebas de la 002 (`enrich-book.test.ts`, `catalog.test.ts`) y
  `docs/modelo-de-datos.md`. Se quitan de `next.config.ts` los `remotePatterns` de
  `covers.openlibrary.org` y `books.google.com`: nada muestra portadas desde hosts externos (SC-005).
- La nota "portada" de `research.md` R9 de la 002 (`-L.jpg`) queda superada por E1.

## R10. Riesgos y límites conocidos

- **Términos de uso de Google Books**: sin verificar (Assumption del spec). Mitigado usándolo
  sólo como respaldo (FR-018); revisar antes de publicar. Las portadas de Open Library son de
  origen mixto: la copia propia no cambia su estatus de derechos.
- **`zoom` de Google Books no es una API documentada**: puede cambiar. Cubierto por la
  validación (R4), la migración reintentable y la prueba de humo del quickstart.
- **Almacenamiento**: portadas de hasta 10 MB; el promedio observado es 25–550 KB.
- **Sin miniaturas**: la ruta sirve el maestro. Si una pantalla necesita tamaños menores, se
  agregará derivación en otra feature (Assumption del spec).
