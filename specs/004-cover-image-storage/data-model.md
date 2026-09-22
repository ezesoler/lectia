# Data Model: Portadas como recurso propio

**Feature**: `004-cover-image-storage` | **Base**: `specs/002-importacion-kindle-kobo/data-model.md`

Una migración nueva: `supabase/migrations/004_cover_storage.sql`.

## Cambios sobre `book_catalog` (compartida, sin `user_id`)

`cover_url` deja de ser el dato que se muestra: pasa a ser **sólo procedencia**.

| Columna | Tipo | Nota |
|---|---|---|
| `cover_url` → **`cover_origin_url`** | `text` | renombrada. URL de la que salió (o saldrá) la imagen. Nunca se usa para mostrar (FR-002). Mientras está `pending` es la URL base para derivar las candidatas |
| `cover_status` | `text not null default 'none'` | `none` · `pending` · `stored` · `unavailable` (ver transiciones) |
| `cover_path` | `text` | ruta del objeto en el bucket `covers` (`{id}`); `null` hasta `stored` |
| `cover_format` | `text` | `jpeg` · `png` · `webp` |
| `cover_width` / `cover_height` | `int` | píxeles del archivo guardado |
| `cover_bytes` | `int` | tamaño del archivo guardado |
| `cover_sha256` | `text` | huella hexadecimal de los bytes guardados (integridad, `ETag`) |
| `cover_source` | `text` | `open_library` · `google_books`; fuente de la copia o de la portada pendiente |
| `cover_attempts` | `int not null default 0` | intentos fallidos por causa transitoria |
| `cover_checked_at` | `timestamptz` | último intento (para el reintento espaciado) |
| `cover_stored_at` | `timestamptz` | cuándo se guardó la copia |

```sql
alter table book_catalog rename column cover_url to cover_origin_url;

alter table book_catalog
  add column cover_status text not null default 'none'
    check (cover_status in ('none', 'pending', 'stored', 'unavailable')),
  add column cover_path text,
  add column cover_format text check (cover_format in ('jpeg', 'png', 'webp')),
  add column cover_width int,
  add column cover_height int,
  add column cover_bytes int,
  add column cover_sha256 text,
  add column cover_source text check (cover_source in ('open_library', 'google_books')),
  add column cover_attempts int not null default 0,
  add column cover_checked_at timestamptz,
  add column cover_stored_at timestamptz,
  -- una portada 'stored' siempre trae su ruta, su huella y sus dimensiones
  add constraint cover_stored_complete check (
    cover_status <> 'stored'
    or (cover_path is not null and cover_sha256 is not null and cover_format is not null
        and cover_width is not null and cover_height is not null and cover_bytes is not null)
  );

-- Migración de las portadas existentes: la fuente sale del host de la URL
update book_catalog
   set cover_status = 'pending',
       cover_source = case
         when cover_origin_url like '%openlibrary.org%' then 'open_library'
         when cover_origin_url like '%books.google.%'   then 'google_books'
       end
 where cover_origin_url is not null;

create index book_catalog_cover_pending
  on book_catalog (cover_checked_at nulls first) where cover_status = 'pending';
```

RLS **sin cambios**: lectura para `authenticated`, sin políticas de escritura. Las columnas
nuevas heredan esa protección: sólo `service_role` las modifica.

### Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
-- Sin políticas en storage.objects: sólo service_role. Se sirve por /api/covers/{id}.
```

## Estados y transiciones de `cover_status`

```text
none        ──(enriquecimiento halla portada)──▶  pending
pending     ──(descarga válida y guardada)─────▶  stored
pending     ──(fallo transitorio, intentos < 5)─▶ pending   (attempts + 1, checked_at = now)
pending     ──(5 fallos transitorios)──────────▶  unavailable
pending     ──(la fuente no ofrece la imagen)──▶  unavailable   (404 / reemplazo en todas las variantes)
unavailable ──(script con --include-unavailable)▶ pending   (attempts = 0)
stored      ──(sin transiciones: no se reemplaza automáticamente en esta versión)
```

`stored` es terminal y sólo lo alcanza un `update … where cover_status <> 'stored'` (gana el
primero; R6). `unavailable` no reintenta solo, pero el libro **se muestra sin portada** como
cualquier otro sin copia.

## Reglas de validación (origen: spec)

| Regla | Requisito |
|---|---|
| El objeto guardado es idéntico a los bytes recibidos; `cover_sha256` = SHA-256 de esos bytes | FR-007/FR-008 |
| Una fila por libro; el objeto se llama `{id}` | FR-003 |
| Formato JPEG/PNG/WebP por cabecera, archivo no truncado, ≤ 10 MB, lado menor ≥ 100 px | FR-009 |
| Sin huella de reemplazo conocida y `bytes/píxel ≥ 0,03` | FR-009 |
| `stored` ⇒ ruta, huella, formato y dimensiones presentes | check `cover_stored_complete` |

## Tipos TypeScript (referencia, en `lib/covers/types.ts`)

```text
CoverStatus   'none' | 'pending' | 'stored' | 'unavailable'
CoverSource   'open_library' | 'google_books'
ImageInfo     { format, width, height, bytes, sha256 }
FetchOutcome  { kind: 'ok', bytes, contentType } | { kind: 'absent' } | { kind: 'failed' }
StoreOutcome  'stored' | 'pending' | 'unavailable' | 'skipped'
CoverStore    { upload(id, bytes, contentType): 'created' | 'exists'; download(id): bytes | null }
```
