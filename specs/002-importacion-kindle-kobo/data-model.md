# Data Model: Importación de Resaltados desde Kindle y Kobo

**Feature**: `002-importacion-kindle-kobo` | **Base**: `docs/modelo-de-datos.md`

Dos migraciones nuevas (la 001 ya existe: `profiles`). Cada una se aplica en orden.

---

## Migración `002_core_schema.sql` — esquema base (corrige H1)

Crea lo que `docs/modelo-de-datos.md` describe y el repo aún no tiene: enums `source_kind`,
`note_kind`, `import_state`; tablas `imports`, `books`, `highlights`, con RLS
`auth.uid() = user_id` (política "own rows", `for all`) e índices del doc.
`list_kind` y `list_items` se crean en la feature de listas.

Orden obligatorio: `imports` → `books` → `highlights` (esta referencia a `imports`).

## Migración `003_import_catalog.sql` — cambios de esta feature

### Cambios sobre `imports`

| Columna | Tipo | Nota |
|---|---|---|
| `entries_total` | `int not null default 0` | entradas a procesar; lo fija el parser (R7) |
| `entries_done` | `int not null default 0` | entradas ya procesadas; se actualiza por lote |
| `updated_at` | `timestamptz not null default now()` | latido para detectar trabajo muerto (R1) |
| `discard_breakdown` | `jsonb not null default '{}'` | conteo por motivo (`bookmark_no_text`, `empty_text`, `truncated`, `no_title`, `unknown_type`, `orphan_volume`); sólo números (R13) |
| `error_code` | `text` | `ERR_IMPORT_xxxx` cuando `state = 'error'` (FR-028) |
| `error_details` | `jsonb` | sólo en errores de formato: `{ linesRead, validRecords, expected?, found? }`; nunca texto de resaltados (FR-029) |

```sql
create unique index imports_one_active_per_source
  on imports (user_id, source) where state in ('queued', 'parsing');
```

### Cambios sobre `books`

| Columna | Tipo | Nota |
|---|---|---|
| `catalog_id` | `uuid references book_catalog(id) on delete set null` | FK nullable (FR-014/FR-018) |

### Cambios sobre `highlights`

| Columna | Tipo | Nota |
|---|---|---|
| `hash` | `text not null` | SHA-256 hex (R3) |
| `chapter` | `text` | capítulo (Kobo), FR-006 |

```sql
create unique index highlights_user_hash on highlights (user_id, hash);
-- la restricción unique del esquema base incluye `kind`: (user_id, book_id, kind, text_key, location)
-- (una nota con el mismo texto y ubicación que un subrayado no debe perderse; lo detectó la prueba (h))
```

`location` es `text not null default ''`: sin ubicación se guarda `''` (no `null`).

### Nueva tabla `book_catalog` (compartida, sin `user_id` — ver Complexity Tracking)

| Columna | Tipo | Nota |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `isbn` | `text` | opcional; único cuando no es nulo |
| `title` | `text not null` | tal como lo devolvió la API |
| `author` | `text not null` | |
| `title_key` | `text not null` | clave usada para la búsqueda que acertó |
| `author_key` | `text not null` | |
| `cover_url` | `text` | `null` si ninguna API lo dio |
| `category` | `text` | idem |
| `pages` | `int` | idem |
| `sources` | `text[] not null` | subconjunto de `{open_library, google_books}`; nunca vacío |
| `created_at` / `updated_at` | `timestamptz not null default now()` | |

```sql
create unique index book_catalog_isbn on book_catalog (isbn) where isbn is not null;
create unique index book_catalog_keys on book_catalog (title_key, author_key);
alter table book_catalog add constraint sources_valid
  check (cardinality(sources) > 0 and sources <@ array['open_library','google_books']);

alter table book_catalog enable row level security;
create policy "catalog read" on book_catalog
  for select to authenticated using (true);
-- Sin políticas de insert/update/delete: sólo service_role (que ignora RLS) escribe.
```

`FR-017`: la garantía "sólo escribe el servidor y sólo con datos de una API" es doble: RLS sin
políticas de escritura + el módulo `lib/enrichment/catalog.ts` es el único que llama a
`admin` para esta tabla y exige `sources.length > 0`.

### Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('imports', 'imports', false, 52428800)
on conflict (id) do nothing;
-- Sin políticas en storage.objects para este bucket: acceso sólo vía service_role / URL firmada.
```

### Función `import_batch` (R6)

```text
public.import_batch(p_import_id uuid, p_source source_kind, p_items jsonb)
  returns table (inserted int, duplicated int)
  language plpgsql  security invoker
```

Cada ítem de `p_items`: `{ title, author, title_key, author_key, kind, text, text_key, page,
location, chapter, highlighted_at, hash }`. Comportamiento:

1. Verifica que `p_import_id` pertenece a `auth.uid()` y está en `parsing`; si no, `raise exception`.
2. Upsert de libros con `do update set title = books.title` (no-op que devuelve `id`);
   `source = p_source` e `imported_at = now()` sólo aplican a libros nuevos.
3. `insert into highlights … on conflict do nothing returning id`; `user_id`, `book_id`, `source`,
   `import_id` los pone la función.
4. Suma a `imports.entries_done += jsonb_array_length(p_items)`, `highlights_new += inserted`,
   `highlights_dup += duplicated`, `updated_at = now()`.

---

## Entidades y estados

### `imports` — transiciones de estado

```text
POST /api/imports          →  queued
POST /api/imports/{id}/parse →  parsing        (UPDATE … WHERE state='queued'; idempotente)
job OK                     →  done             (books_count, discarded, finished_at)
job falla / validación     →  error            (error_message en español rioplatense, finished_at)
DELETE /api/imports/{id}   →  fila eliminada   (sólo desde queued: subida fallida)
sin latido (5 min / 2 min) →  error            ("La importación se interrumpió"), perezoso
```

`done` requiere `highlights_new + highlights_dup > 0`. Si el archivo no produce ningún
resaltado válido → `error` `ERR_IMPORT_4005` (US4-2, FR-021/FR-022). `discarded` cuenta
marcadores/marcas sin texto **y** registros malformados, con desglose en `discard_breakdown`
(R13). `error_message` es el texto completo que ve el usuario, ya resuelto con
`messageFor(code, { saved })`.

### Contadores (semántica)

| Campo | Significado |
|---|---|
| `books_count` | libros únicos (por `title_key`+`author_key`) presentes en el archivo |
| `highlights_new` | filas insertadas en `highlights` |
| `highlights_dup` | entradas válidas que ya existían (en base o repetidas dentro del archivo) |
| `discarded` | entradas descartadas (marcadores sin texto + malformadas); suma de `discard_breakdown` |
| `entries_total` | entradas válidas + descartadas |

Invariante al terminar `done`: `highlights_new + highlights_dup + discarded = entries_total`.

### Validaciones (origen: spec)

- `imports.source` ∈ {`kindle`,`kobo`} para esta feature (`manual` no importa).
- `imports.file_name` extensión `.txt` (Kindle) / `.sqlite` (Kobo); `file_size` ≤ 52 428 800.
- `highlights.text` no vacío; `text_key` no vacío; `hash` único por usuario.
- `books.title`, `books.author` no vacíos (autor ausente → `"Autor desconocido"`).

## Tipos TypeScript (referencia, en `lib/import/types.ts`)

```text
ParsedEntry   { title, author, isbn?, kind, text, page?, location, chapter?, highlightedAt? }
DiscardReason 'bookmark_no_text' | 'empty_text' | 'truncated' | 'no_title' | 'unknown_type' | 'orphan_volume'
ParseResult   { entries: ParsedEntry[], discarded: number,
                discardBreakdown: Partial<Record<DiscardReason, number>>, booksCount: number,
                linesRead?: number }
ErrorDetails  { linesRead?, validRecords?, expected?, found? }
ImportStatus  { id, source, state, entriesTotal, entriesDone, booksCount,
                highlightsNew, highlightsDup, discarded, discardBreakdown,
                errorCode?, errorMessage?, errorDetails?, fileName, fileSize, finishedAt? }
```
