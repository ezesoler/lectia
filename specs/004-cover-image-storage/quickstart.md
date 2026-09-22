# Quickstart: validar las portadas como recurso propio

**Feature**: `004-cover-image-storage`. Guía de validación; el detalle está en
[contracts/covers-api.md](contracts/covers-api.md), [contracts/cover-pipeline.md](contracts/cover-pipeline.md)
y [data-model.md](data-model.md).

## Prerrequisitos

1. Feature 002 operativa y `GOOGLE_BOOKS_API_KEY` cargada (para el respaldo de Google Books).
2. Migración `004_cover_storage.sql` aplicada (SQL Editor de Supabase, después de la 002 y la 003).
3. Para integración: Docker + `npx supabase start` y `.env.test.local` (ver README).

## Validación automática

```bash
npm test                     # unitarias: image-info, candidatas, descarga, storeCover, enrich-book
npm run test:integration     # Storage real: sin duplicados, adopción, ruta /api/covers, backfill
```

## Escenarios manuales

| # | Escenario | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Libro nuevo (US1) | importar `docs/files imports/My Clippings.txt` y esperar ~30 s | en `book_catalog`, los libros con portada tienen `cover_status = 'stored'`, `cover_path` y `cover_sha256`; `cover_origin_url` es sólo procedencia |
| 2 | Servida desde el propio dominio (SC-005) | abrir `/api/covers/{catalog_id}` con la sesión iniciada | `200` con la imagen, `ETag`, `Cache-Control: private, …, immutable`; el navegador no contacta a Open Library ni a Google |
| 3 | Reutilización (US1-2) | con otro usuario, importar el mismo libro | sigue habiendo un solo objeto `{catalog_id}` en el bucket; `cover_stored_at` no cambia |
| 4 | Mayor calidad (US2) | comparar `cover_width/height` con la mayor variante de la fuente (por ejemplo *Dune* de Open Library) | igual o mayor que `-L`; nunca una miniatura de 128 px |
| 5 | Bytes idénticos (US2-3) | descargar `/api/covers/{id}` y calcular su SHA-256 | coincide con `cover_sha256` |
| 6 | Reemplazo de Google (US4-3) | libro sólo en Google Books cuyo `zoom=0` es "image not available" (*Superficiales*) | se guarda la variante `zoom=4` (800×1153); el reemplazo se descarta |
| 7 | Fuente caída (US4-1) | cortar la red al enriquecer | la importación termina en `done`; el libro queda `pending` con `cover_attempts + 1`; se completa en la próxima pasada |
| 8 | Migración (US3) | `npm run covers:backfill -- --dry-run`, luego sin `--dry-run` | las filas `pending` pasan a `stored`; segunda corrida: `processed = 0` |
| 9 | Migración interrumpida | cortar el script a la mitad y volver a correrlo | continúa sin repetir descargas ni duplicar objetos |
| 10 | Sin portada (FR-017) | pedir `/api/covers/{id}` de un libro `none`/`unavailable` | `404`; nunca redirige a la fuente externa |
| 11 | Cuenta borrada | borrar una cuenta con libros importados | las portadas siguen en el catálogo y en el bucket |

## Verificaciones en base

```sql
-- SC-001 / SC-002: nada mostrable depende de una URL externa
select cover_status, count(*) from book_catalog group by 1;
-- Coherencia de las copias guardadas
select count(*) from book_catalog
 where cover_status = 'stored' and (cover_path is null or cover_sha256 is null);   -- debe ser 0
-- Una copia por libro: un objeto por id
select count(*) from storage.objects where bucket_id = 'covers';
select count(*) from book_catalog where cover_status = 'stored';                    -- mismo número
```

## Prueba de humo contra las APIs reales

Con `.env.local` cargado, importar 3 libros conocidos (uno de Open Library con original grande, uno
sólo de Google Books, uno con reemplazo en `zoom=0`) y comprobar los escenarios 4 y 6. Es la
verificación de que el parámetro `zoom` de Google Books (no documentado) sigue funcionando.
