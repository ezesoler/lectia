-- Migración 003: feature 002 (importación Kindle/Kobo)
-- Progreso y errores en imports, catálogo compartido book_catalog, hash de resaltados,
-- bucket temporal de archivos y la función transaccional import_batch.

-- 1. imports: progreso, desglose de descartes y errores
alter table public.imports
  add column if not exists entries_total int not null default 0,
  add column if not exists entries_done int not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  -- conteo por motivo (bookmark_no_text, empty_text, truncated, no_title, unknown_type,
  -- orphan_volume). Sólo números: nunca texto ni ubicaciones del usuario.
  add column if not exists discard_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists error_code text,
  -- sólo en errores de formato: { linesRead, validRecords, expected, found }
  add column if not exists error_details jsonb;

-- Una sola importación activa por usuario y origen (FR-025), garantizado por la base
create unique index if not exists imports_one_active_per_source
  on public.imports (user_id, source) where state in ('queued', 'parsing');

-- 2. book_catalog: catálogo bibliográfico compartido (datos públicos, sin user_id)
create table if not exists public.book_catalog (
  id         uuid primary key default gen_random_uuid(),
  isbn       text,
  title      text not null,
  author     text not null,
  title_key  text not null,
  author_key text not null,
  cover_url  text,
  category   text,
  pages      int,
  sources    text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_valid
    check (cardinality(sources) > 0 and sources <@ array['open_library', 'google_books'])
);

create unique index if not exists book_catalog_isbn on public.book_catalog (isbn) where isbn is not null;
create unique index if not exists book_catalog_keys on public.book_catalog (title_key, author_key);

alter table public.book_catalog enable row level security;

-- Lectura para cualquier usuario autenticado. Sin políticas de escritura: sólo service_role
-- (que ignora RLS) escribe, y únicamente cuando una API externa respalda los datos.
create policy "catalog read" on public.book_catalog
  for select to authenticated using (true);

-- 3. books.catalog_id
alter table public.books
  add column if not exists catalog_id uuid references public.book_catalog (id) on delete set null;

-- 4. highlights: hash de deduplicación y capítulo
alter table public.highlights
  add column if not exists hash text not null,
  add column if not exists chapter text;

create unique index if not exists highlights_user_hash on public.highlights (user_id, hash);

-- 5. Storage: bucket privado y transitorio para los archivos originales.
-- Sin políticas en storage.objects: sólo se accede con service_role / URL firmada.
insert into storage.buckets (id, name, public, file_size_limit)
values ('imports', 'imports', false, 52428800)
on conflict (id) do nothing;

-- 6. import_batch: persiste un lote de resaltados de forma atómica, bajo RLS (security invoker).
-- p_items: [{ title, author, title_key, author_key, kind, text, text_key, page, location,
--             chapter, highlighted_at, hash }]
create or replace function public.import_batch(
  p_import_id uuid,
  p_source public.source_kind,
  p_items jsonb
)
returns table (inserted int, duplicated int)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_state    public.import_state;
  v_total    int  := jsonb_array_length(p_items);
  v_inserted int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select state into v_state from public.imports where id = p_import_id and user_id = v_user;
  if v_state is null then
    raise exception 'import_not_found';
  end if;
  if v_state <> 'parsing' then
    raise exception 'import_not_parsing';
  end if;

  -- Libros nuevos; los existentes conservan source, imported_at y demás campos (FR-011/FR-012)
  insert into public.books (user_id, title, author, title_key, author_key, source, imported_at)
  select v_user, i->>'title', i->>'author', i->>'title_key', i->>'author_key', p_source, now()
  from jsonb_array_elements(p_items) as i
  on conflict (user_id, title_key, author_key) do nothing;

  -- Resaltados: user_id, book_id, source e import_id los pone la función, nunca el payload
  with ins as (
    insert into public.highlights
      (user_id, book_id, kind, text, text_key, page, location, chapter,
       highlighted_at, source, import_id, hash)
    select v_user, b.id, (i->>'kind')::public.note_kind, i->>'text', i->>'text_key',
           nullif(i->>'page', '')::int, coalesce(i->>'location', ''), nullif(i->>'chapter', ''),
           nullif(i->>'highlighted_at', '')::timestamptz, p_source, p_import_id, i->>'hash'
    from jsonb_array_elements(p_items) as i
    join public.books b
      on b.user_id = v_user
     and b.title_key = i->>'title_key'
     and b.author_key = i->>'author_key'
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_inserted from ins;

  update public.imports
     set entries_done   = entries_done + v_total,
         highlights_new = highlights_new + v_inserted,
         highlights_dup = highlights_dup + (v_total - v_inserted),
         updated_at     = now()
   where id = p_import_id and user_id = v_user;

  return query select v_inserted, v_total - v_inserted;
end;
$$;

revoke all on function public.import_batch(uuid, public.source_kind, jsonb) from public, anon;
grant execute on function public.import_batch(uuid, public.source_kind, jsonb) to authenticated;
