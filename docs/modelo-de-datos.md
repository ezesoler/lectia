# Lectia — modelo de datos

Supabase Postgres. Toda tabla de usuario lleva `user_id` y **RLS activa**; ninguna consulta
cruza usuarios. Esquema en `public`.

---

## Entidades

| Entidad | Qué es |
|---|---|
| `profiles` | datos de la cuenta y preferencias (tema) |
| `books` | libro del usuario: puede venir de una importación o del catálogo de búsqueda |
| `highlights` | resaltado o nota de un libro, con su origen |
| `list_items` | pertenencia de un libro a una lista (deseo leer / leyendo / leído) |
| `imports` | ejecución de una importación, con su resultado |

---

## Esquema

```sql
create type source_kind  as enum ('kindle', 'kobo', 'manual');
create type note_kind    as enum ('highlight', 'note');
create type list_kind    as enum ('want', 'reading', 'read');
create type import_state as enum ('queued', 'parsing', 'done', 'error');

create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  display_name text,
  theme       text not null default 'system'
                check (theme in ('system', 'light', 'dark')),
  created_at  timestamptz not null default now()
);

create table books (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null,
  title_orig    text,
  author        text not null,
  -- claves normalizadas (minúsculas, sin acentos, sin puntuación) para deduplicar y buscar
  title_key     text not null,
  author_key    text not null,
  lang          text,               -- ISO 639: 'es', 'en', 'ja'…
  has_es        boolean not null default false,
  year          int,
  pages         int,
  genre         text,
  cover_url     text,
  source        source_kind not null default 'manual',
  imported_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, title_key, author_key)
);

create table highlights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  book_id     uuid not null references books on delete cascade,
  kind        note_kind not null default 'highlight',
  text        text not null,
  text_key    text not null,        -- normalizado, para deduplicar
  page        int,
  location    text,                 -- ubicación cruda del lector
  highlighted_at timestamptz,
  source      source_kind not null,
  is_favorite boolean not null default false,
  import_id   uuid references imports on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, book_id, text_key, location)
);

create table list_items (
  user_id    uuid not null references auth.users on delete cascade,
  book_id    uuid not null references books on delete cascade,
  list       list_kind not null,
  finished_at date,                 -- sólo cuando list = 'read'
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)    -- un libro está en una sola lista
);

create table imports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  source        source_kind not null,
  state         import_state not null default 'queued',
  file_name     text not null,
  file_size     int,
  books_count   int not null default 0,
  highlights_new int not null default 0,
  highlights_dup int not null default 0,
  discarded     int not null default 0,
  error_message text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index on books (user_id, imported_at desc);
create index on highlights (user_id, book_id);
create index on highlights using gin (to_tsvector('spanish', text));
create index on books using gin (to_tsvector('spanish', title || ' ' || author));
```

### RLS

Para las cinco tablas, el mismo patrón:

```sql
alter table books enable row level security;
create policy "own rows" on books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`profiles` usa `auth.uid() = id`.

---

## Normalización

Una función compartida (TypeScript en el servidor y `immutable` en SQL si se necesita para
índices) produce las claves:

```
normalize(s) = s.trim().toLowerCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[^\p{L}\p{N}\s]/gu, '')
  .replace(/\s+/g, ' ')
```

- `title_key`, `author_key`: normalize(título / autor).
- `text_key`: normalize(texto del resaltado), además con comillas tipográficas unificadas.
- La deduplicación de resaltados usa `(user_id, book_id, text_key, location)`. Si el origen no
  trae ubicación, `location` es `''`.

---

## Reglas de integridad

1. **Importación idempotente**: se inserta con `on conflict do nothing`; el contador
   `highlights_dup` registra las colisiones.
2. **Fusión de orígenes**: si un libro ya existe con las mismas claves, no se crea otro; los
   resaltados nuevos se cuelgan del mismo `book_id` conservando su `source`.
3. **Un libro, una lista**: mover entre listas es un `upsert` sobre `list_items`; `finished_at`
   se setea al pasar a `read` y se limpia al salir.
4. **Borrado de cuenta**: cascada desde `auth.users`; los archivos temporales de Storage se
   eliminan en el mismo trabajo.
5. **Archivos originales**: se suben a un bucket privado `imports/{user_id}/{import_id}` y se
   borran al terminar el parseo (éxito o error).

---

## Contratos de API (Route Handlers)

| Método y ruta | Entrada | Salida |
|---|---|---|
| `POST /api/imports` | `{ source, fileName, fileSize }` | `{ importId, uploadUrl }` |
| `POST /api/imports/{id}/parse` | — (el archivo ya está subido) | `{ state, booksCount, highlightsNew, highlightsDup, discarded }` |
| `GET /api/imports/{id}` | — | estado y contadores (para el progreso) |
| `GET /api/books` | `source?, sort?, q?` | libros con recuento de resaltados |
| `GET /api/books/{id}` | `filter?` | libro + resaltados |
| `GET /api/highlights` | `q?, source?, page?` | resaltados con su libro |
| `PATCH /api/highlights/{id}` | `{ isFavorite }` | resaltado |
| `GET /api/search` | `q, filter?, sort?` | `{ books[], authors[], highlights[] }` |
| `PUT /api/lists/{bookId}` | `{ list, finishedAt? }` | ítem de lista |
| `DELETE /api/lists/{bookId}` | — | `204` |
| `GET /api/stats` | — | fichas, meses, géneros, autores |
| `GET /api/books/{id}/export.md` | — | `text/markdown` |

Errores en formato `{ error: { code, message, details? } }`, con `code` estable
(`invalid_file`, `unsupported_source`, `rate_limited`, `not_found`, `unauthorized`).

---

## Búsqueda

- **Catálogo del usuario**: `to_tsvector('spanish', title || ' ' || author)` + `ilike` sobre
  claves normalizadas para tolerar acentos.
- **Resaltados**: índice GIN sobre `text`; se devuelve el fragmento coincidente para resaltarlo.
- **Catálogo externo**: Open Library y Google Books, sólo cuando la consulta no encuentra
  suficiente en el catálogo propio. Respuesta cacheada por consulta normalizada.
  `[NEEDS CLARIFICATION: ¿se guarda el resultado externo como libro del usuario sólo al
  agregarlo a una lista, o se cachea en una tabla compartida de catálogo?]`
