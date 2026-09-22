# Contrato interno: pipeline de portadas

**Feature**: 004-cover-image-storage

Funciones con dependencias inyectables (`fetch`, `sleep`, almacenamiento, cliente de base) para
probar sin red ni Storage. Todo bajo `lib/covers/`; sólo servidor.

## `inspectImage(bytes: Uint8Array): ImageInfo | InvalidReason` — `image-info.ts`

Sin dependencias. Devuelve `{ format, width, height, bytes, sha256 }` o un motivo:

| Motivo | Cuándo |
|---|---|
| `not_image` | la cabecera no es JPEG/PNG/WebP |
| `truncated` | JPEG sin `FFD9` final, PNG sin `IEND`, WebP con tamaño `RIFF` inconsistente |
| `too_large` | `bytes.length > 10 MB` |
| `too_small` | lado menor < 100 px |
| `placeholder` | SHA-256 en `KNOWN_PLACEHOLDERS` o `bytes/(w×h) < 0.03` |

`KNOWN_PLACEHOLDERS` se define en `placeholders.ts` con las huellas de la investigación E5
(`3efa8c43…`, `e3f8c414…`); agregar una es una línea.

## `coverCandidates(origin: string, source: CoverSource): string[]` — `candidates.ts`

Deriva las URLs candidatas, de mayor a menor calidad esperada (R2):

| Entrada | Salida |
|---|---|
| `…covers.openlibrary.org/b/id/{id}-L.jpg` | `[…/{id}.jpg?default=false, …/{id}-L.jpg?default=false]` |
| `…books.google.com/books/content?id={id}&…&edge=curl…` | `[…zoom=0, …zoom=4, …zoom=3, …zoom=2]` sin `edge=curl`, siempre `https` |
| URL sin id reconocible | `[]` |

Pura y determinista; sirve igual para portadas nuevas y para la migración.

## `getBinary(url, deps): Promise<FetchOutcome>` — `download.ts`

Reintentos 1 s → 2 s → 4 s, timeout 15 s, corte al superar 10 MB, respeto de `Retry-After` ≤ 10 s
(mismo esquema que `lib/enrichment/http.ts`). Resultado `ok | absent | failed` (R5).

## `storeCover(row, deps): Promise<StoreOutcome>` — `store-cover.ts`

```text
row   { id, cover_origin_url, cover_source, cover_status, cover_attempts, cover_checked_at }
deps  { fetchImpl, sleep, bucket: CoverStore, db: CatalogCoverDb, now }
```

1. Si `cover_status = 'stored'` → `skipped`. Si es `pending` con reintento aún no vencido
   (`attempts ≥ 5` o `checked_at` < 1 h) → `skipped`.
2. Candidatas = `coverCandidates(origin, source)`; sin candidatas → `unavailable`.
3. Para cada candidata en orden: `getBinary` → `inspectImage`. La primera válida gana. Una `failed`
   corta el recorrido → `pending` (attempts + 1). Todas `absent`/inválidas sin `failed` → `unavailable`.
4. `bucket.upload(id, bytes, contentType)`; si ya existe, adopta el objeto existente (R6).
5. `db.markStored(id, meta)` con condición `cover_status <> 'stored'`.
6. Nunca lanza por causas de red o de contenido: devuelve el estado. Sólo propaga errores de
   programación.

## `enrichBook` (002, modificado)

Tras `saveCatalog` con `cover_status = 'pending'` (si hay portada candidata), llama a `storeCover`.
Resultado ampliado: `{ status, catalogId, cover: StoreOutcome | 'none' }`. En `catalog_hit` con
la portada `pending` reintenta (FR-012).

## `backfillCovers(opts, deps)` — `backfill.ts`

```text
opts  { limit?, batchSize = 50, concurrency = 4, includeUnavailable = false, dryRun = false }
→     { processed, stored, pending, unavailable, skipped }
```

Recorre `cover_status = 'pending'` por `cover_checked_at nulls first`; con
`includeUnavailable` primero los reactiva (`pending`, `attempts = 0`). Idempotente y reanudable.

## Script — `scripts/backfill-covers.ts`

`npm run covers:backfill -- [--limit N] [--dry-run] [--include-unavailable]`. Lee `.env.local`,
usa `service_role`, imprime el resumen y sale con código `0`.

## Variables de entorno

Sin variables nuevas. Usa `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (sólo servidor).
