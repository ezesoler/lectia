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
| `imports` | ejecución de una importación, con su resultado, progreso y errores |
| `book_catalog` | catálogo bibliográfico **compartido** (sin `user_id`): portada, categoría y páginas obtenidas de Open Library / Google Books |

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
  catalog_id    uuid references book_catalog on delete set null, -- metadatos enriquecidos (portada, categoría, páginas)
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
  location    text not null default '', -- ubicación cruda del lector; '' si el origen no la trae
  chapter     text,                 -- capítulo (Kobo), si se conoce
  highlighted_at timestamptz,
  source      source_kind not null,
  is_favorite boolean not null default false,
  import_id   uuid references imports on delete set null,
  hash        text not null,        -- SHA-256 de deduplicación (ver "Normalización")
  created_at  timestamptz not null default now(),
  -- incluye `kind`: una nota con el mismo texto y ubicación que un subrayado no debe perderse
  unique (user_id, book_id, kind, text_key, location)
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
  finished_at   timestamptz,
  -- progreso (sondeo del cliente) y latido para detectar un trabajo muerto
  entries_total int not null default 0,
  entries_done  int not null default 0,
  updated_at    timestamptz not null default now(),
  -- desglose de descartes por motivo (sólo números) y errores estructurados
  discard_breakdown jsonb not null default '{}',
  error_code    text,                -- ERR_IMPORT_xxxx
  error_details jsonb                -- sólo en errores de formato; nunca texto de resaltados
);

-- una sola importación activa por usuario y origen
create unique index imports_one_active_per_source
  on imports (user_id, source) where state in ('queued', 'parsing');
create unique index highlights_user_hash on highlights (user_id, hash);

-- catálogo compartido: RLS de sólo lectura para usuarios autenticados; escribe únicamente el servidor
create table book_catalog (
  id         uuid primary key default gen_random_uuid(),
  isbn       text,
  title      text not null,
  author     text not null,
  title_key  text not null,
  author_key text not null,
  cover_url  text,
  category   text,
  pages      int,
  sources    text[] not null check (cardinality(sources) > 0
                                    and sources <@ array['open_library', 'google_books']),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on book_catalog (isbn) where isbn is not null;
create unique index on book_catalog (title_key, author_key);

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

`book_catalog` es una tabla **compartida** (datos bibliográficos públicos, nunca contenido del
usuario): RLS activa con una política de lectura para `authenticated` y **sin** políticas de
escritura; sólo el servidor (`service_role`) la modifica, y únicamente cuando una API externa
respalda los datos (Constitución VII, v1.1.1).

---

## Normalización

Una función compartida (TypeScript en el servidor, `lib/import/normalize.ts`) produce las claves. Sólo se quitan diacríticos sobre **letras latinas**: las marcas combinantes de otros alfabetos (dakuten japonesa, vocales árabes o devanagari) se conservan, porque quitarlas cambia el significado y provoca colisiones.

```
normalize(s) = s.normalize('NFD')
  .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')   // diacríticos sólo sobre letras latinas
  .normalize('NFC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')     // conserva marcas de otros alfabetos
  .replace(/\s+/g, ' ').trim()
```

- `title_key`, `author_key`: normalize(título / autor).
- `text_key`: normalize(texto del resaltado). La puntuación (incluidas las comillas tipográficas)
  se elimina, así que no hace falta un paso de unificación.
- **Hash** (`highlights.hash`): `sha256_hex(title_key US author_key US kind US text_key US location)`, con
  `US = U+001F` como separador (evita colisiones por concatenación ambigua) e incluyendo el tipo
  (`highlight`/`note`). La deduplicación primaria es `(user_id, hash)`; la restricción
  `(user_id, book_id, kind, text_key, location)` es equivalente. Si el origen no trae ubicación,
  `location` es `''`.
- **Autor de Kindle**: `My Clippings.txt` separa varios autores con `;` (a veces sin espacio) y suele
  escribir `Apellido, Nombre`; se convierte a `Nombre Apellido, Nombre2 Apellido2`, que es el orden de
  Kobo, para que el mismo libro de los dos orígenes se funda en un solo registro.

---

## Reglas de integridad

1. **Importación idempotente**: se inserta por lotes con la función `import_batch` (`security invoker`,
   RLS activa) y `on conflict do nothing`; el contador `highlights_dup` registra las colisiones.
   Cada lote es una transacción: si el trabajo falla a mitad, lo ya guardado se conserva.
2. **Fusión de orígenes**: si un libro ya existe con las mismas claves, no se crea otro; los
   resaltados nuevos se cuelgan del mismo `book_id` conservando su `source`.
3. **Un libro, una lista**: mover entre listas es un `upsert` sobre `list_items`; `finished_at`
   se setea al pasar a `read` y se limpia al salir.
4. **Borrado de cuenta**: cascada desde `auth.users`; los archivos temporales de Storage se
   eliminan en el mismo trabajo.
5. **Archivos originales**: se suben a un bucket privado `imports/{user_id}/{import_id}` (URL firmada,
   sin políticas para el usuario) y se borran al terminar el parseo (éxito o error).
6. **Una importación activa por origen**: lo garantiza un índice único parcial; un import `queued`/`parsing`
   sin latido (5 min / 2 min) se marca `error` (`ERR_IMPORT_5031`) de forma perezosa.
7. **Enriquecimiento**: después del `done`, cada libro busca portada, categoría y páginas en `book_catalog`,
   luego Open Library y luego Google Books (merge por campo). Sin datos de una API no se crea fila en
   `book_catalog`; el libro se guarda igual con `catalog_id = null`.

---

## Contratos de API (Route Handlers)

| Método y ruta | Entrada | Salida |
|---|---|---|
| `POST /api/imports` | `{ source, fileName, fileSize }` | `201 { importId, upload: { bucket, path, token } }` (URL firmada de subida) |
| `POST /api/imports/{id}/parse` | — (el archivo ya está subido) | `202 { state: 'parsing' }` — el trabajo sigue en segundo plano |
| `GET /api/imports/{id}` | — | estado, progreso, contadores, `discardBreakdown` y, si falló, `errorCode` / `errorMessage` / `errorDetails` |
| `DELETE /api/imports/{id}` | — | `204`; sólo desde `queued` (subida fallida) |
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
(`invalid_file`, `unsupported_source`, `import_in_progress`, `invalid_state`, `file_missing`, `rate_limited`,
`not_found`, `unauthorized`). Detalle en `specs/002-importacion-kindle-kobo/contracts/imports-api.md`.

---

## Búsqueda

- **Catálogo del usuario**: `to_tsvector('spanish', title || ' ' || author)` + `ilike` sobre
  claves normalizadas para tolerar acentos.
- **Resaltados**: índice GIN sobre `text`; se devuelve el fragmento coincidente para resaltarlo.
- **Catálogo externo**: Open Library y Google Books, sólo cuando la consulta no encuentra
  suficiente en el catálogo propio. Respuesta cacheada por consulta normalizada.
  El catálogo compartido es `book_catalog` (ver arriba): la feature de búsqueda podrá escribir en él, siempre desde el servidor y sólo con datos que una API externa respalde.
