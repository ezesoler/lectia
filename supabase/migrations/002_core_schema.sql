-- Migración 002: esquema base de importación (imports, books, highlights) + RLS
-- Fuente: docs/modelo-de-datos.md. Aplicar en orden, después de 001_profiles.sql.
-- list_kind / list_items se crean en la feature de listas.

-- 1. Tipos enumerados (idempotente)
do $$ begin
  create type public.source_kind as enum ('kindle', 'kobo', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.note_kind as enum ('highlight', 'note');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.import_state as enum ('queued', 'parsing', 'done', 'error');
exception when duplicate_object then null; end $$;

-- 2. imports (antes que highlights, que la referencia)
create table if not exists public.imports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  source         public.source_kind not null,
  state          public.import_state not null default 'queued',
  file_name      text not null,
  file_size      int,
  books_count    int not null default 0,
  highlights_new int not null default 0,
  highlights_dup int not null default 0,
  discarded      int not null default 0,
  error_message  text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

-- 3. books
create table if not exists public.books (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null,
  title_orig  text,
  author      text not null,
  -- claves normalizadas (minúsculas, sin acentos latinos, sin puntuación)
  title_key   text not null,
  author_key  text not null,
  lang        text,
  has_es      boolean not null default false,
  year        int,
  pages       int,
  genre       text,
  cover_url   text,
  source      public.source_kind not null default 'manual',
  imported_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, title_key, author_key)
);

-- 4. highlights
create table if not exists public.highlights (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  book_id        uuid not null references public.books on delete cascade,
  kind           public.note_kind not null default 'highlight',
  text           text not null,
  text_key       text not null,
  page           int,
  -- ubicación cruda del lector; '' cuando el origen no la trae (no null: la restricción única la necesita)
  location       text not null default '',
  highlighted_at timestamptz,
  source         public.source_kind not null,
  is_favorite    boolean not null default false,
  import_id      uuid references public.imports on delete set null,
  created_at     timestamptz not null default now(),
  unique (user_id, book_id, kind, text_key, location)
);

-- 5. Índices
create index if not exists books_user_imported_idx on public.books (user_id, imported_at desc);
create index if not exists highlights_user_book_idx on public.highlights (user_id, book_id);
create index if not exists highlights_text_fts_idx
  on public.highlights using gin (to_tsvector('spanish', text));
create index if not exists books_fts_idx
  on public.books using gin (to_tsvector('spanish', title || ' ' || author));
create index if not exists imports_user_source_started_idx
  on public.imports (user_id, source, started_at desc);

-- 6. RLS: mismo patrón "own rows" en las tres tablas
alter table public.imports enable row level security;
alter table public.books enable row level security;
alter table public.highlights enable row level security;

create policy "own rows" on public.imports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.highlights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
