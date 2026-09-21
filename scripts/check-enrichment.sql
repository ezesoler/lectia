-- Verificación manual del enriquecimiento (quickstart, escenario 10 / SC-008).
-- Reemplazar :uid por el id del usuario (auth.users.id) y ejecutar en el SQL Editor de Supabase.
-- Medir SC-008: importar una biblioteca de ~80 libros, esperar 30 s después de `done` y correr esto.

with last_import as (
  select id, started_at, finished_at
  from imports
  where user_id = :'uid'
  order by started_at desc
  limit 1
),
touched as (
  select distinct b.id, b.catalog_id
  from books b
  join highlights h on h.book_id = b.id
  join last_import li on h.import_id = li.id
  where b.user_id = :'uid'
)
select
  count(*)                                                        as libros_del_import,
  count(t.catalog_id)                                             as con_catalog_id,
  round(100.0 * count(t.catalog_id) / nullif(count(*), 0), 1)     as pct_enriquecidos,
  count(*) filter (where c.cover_url is not null)                 as con_portada,
  count(*) filter (where c.category  is not null)                 as con_categoria,
  count(*) filter (where c.pages     is not null)                 as con_paginas,
  count(*) filter (where c.cover_url is not null
                     and c.category  is not null
                     and c.pages     is not null)                 as con_los_tres_campos
from touched t
left join book_catalog c on c.id = t.catalog_id;

-- Integridad del catálogo (FR-017): ninguna fila sin fuente externa
select count(*) as filas_sin_fuente from book_catalog where cardinality(sources) = 0;   -- debe ser 0
