-- Migración 004: portadas como recurso propio (feature 004-cover-image-storage)
-- book_catalog.cover_url pasa a ser sólo procedencia (cover_origin_url); las copias propias
-- viven en el bucket privado `covers`, un objeto por libro del catálogo.

-- 1. Renombrar cover_url → cover_origin_url (ya no se usa para mostrar la imagen)
alter table public.book_catalog rename column cover_url to cover_origin_url;

-- 2. Columnas de la copia propia
alter table public.book_catalog
  add column if not exists cover_status text not null default 'none'
    check (cover_status in ('none', 'pending', 'stored', 'unavailable')),
  add column if not exists cover_path text,
  add column if not exists cover_format text check (cover_format in ('jpeg', 'png', 'webp')),
  add column if not exists cover_width int,
  add column if not exists cover_height int,
  add column if not exists cover_bytes int,
  add column if not exists cover_sha256 text,
  add column if not exists cover_source text check (cover_source in ('open_library', 'google_books')),
  add column if not exists cover_attempts int not null default 0,
  add column if not exists cover_checked_at timestamptz,
  add column if not exists cover_stored_at timestamptz;

-- Una portada 'stored' siempre trae ruta, huella, formato y dimensiones (research.md R3/R6)
do $$ begin
  alter table public.book_catalog add constraint cover_stored_complete check (
    cover_status <> 'stored'
    or (cover_path is not null and cover_sha256 is not null and cover_format is not null
        and cover_width is not null and cover_height is not null and cover_bytes is not null)
  );
exception when duplicate_object then null; end $$;

-- 3. Migrar las filas existentes: la fuente sale del host de la URL de procedencia (R7/R9)
update public.book_catalog
   set cover_status = 'pending',
       cover_source = case
         when cover_origin_url like '%openlibrary.org%' then 'open_library'
         when cover_origin_url like '%books.google.%'   then 'google_books'
       end
 where cover_origin_url is not null
   and cover_status = 'none';

create index if not exists book_catalog_cover_pending
  on public.book_catalog (cover_checked_at nulls first) where cover_status = 'pending';

-- 4. Bucket privado y permanente de portadas: sin políticas para el usuario, sólo service_role;
-- se sirve por GET /api/covers/{id} (contracts/covers-api.md).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
