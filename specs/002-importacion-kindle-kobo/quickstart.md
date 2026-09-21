# Quickstart: validar la importación Kindle / Kobo

**Feature**: `002-importacion-kindle-kobo`. Guía de validación; el detalle de rutas está en
[contracts/imports-api.md](contracts/imports-api.md) y el esquema en [data-model.md](data-model.md).

## Prerrequisitos

1. Feature 001 operativa (login con Google).
2. Migraciones `002_core_schema.sql` y `003_import_catalog.sql` aplicadas (Supabase Dashboard →
   SQL Editor, en orden, o `supabase db push` contra el stack local).
3. `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` y `GOOGLE_BOOKS_API_KEY`.
4. Para integración: Docker + Supabase CLI (`supabase start`).
5. Nueva dependencia: `npm install sql.js && npm install -D @types/sql.js`.

## Validación automática

```bash
npm test                       # unitarias: normalize, hash, parsers, enriquecimiento
npm run test:integration       # rutas /api/imports* + import_batch contra Supabase local
npm run test:e2e               # Playwright: importar Kindle, Kobo y reimportar (mobile + desktop)
```

## Escenarios manuales

Usar `tests/fixtures/` (o archivos propios).

| # | Escenario | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Kindle primera vez (US1) | `/importar` → arrastrar `clippings-es.txt` a Kindle | tarjeta `parsing` con barra en < 3 s → `done` "N libros · M resaltados"; "Ver mi biblioteca" habilitado |
| 2 | Reimportar el mismo archivo (SC-003) | repetir el escenario 1 | `highlights_new = 0`; `highlights_dup` = total del archivo; filas en `highlights` sin cambios |
| 3 | Archivo incorrecto (US1-4) | arrastrar un PDF a Kindle | tarjeta `error` con mensaje y "Reintentar"; nada previo se modifica |
| 4 | Kobo (US2) | arrastrar `kobo-valid.sqlite` a Kobo | `done` con conteos; libros comunes con Kindle fusionados en un solo `books` (SC-006) |
| 5 | Kobo vacío/corrupto | `kobo-empty.sqlite`, `kobo-corrupt.sqlite` | `error` con mensaje específico |
| 6 | Importación parcial (US4, SC-005) | `clippings-broken.txt` | `done` (aviso, no error); "N registros quedaron afuera" con desglose por motivo siempre expandido (`mockups/estados-importar/03`); válidas guardadas; sin "Descargar el detalle". Un archivo 100 % inválido → `error` `ERR_IMPORT_4005` |
| 7 | Reimportación con novedades (US5) | subir `clippings-es.txt`, luego `clippings-es-plus10.txt` | `highlights_new = 10`, `highlights_dup` = anteriores |
| 8 | Cerrar la pestaña (edge case) | iniciar import, cerrar, volver a `/importar` | la tarjeta retoma `parsing` con barra, o muestra `done` |
| 9 | Importación concurrente (FR-025) | con un import `parsing`, iniciar otro del mismo origen (2.ª pestaña) | rechazo con mensaje "hay una importación en curso"; la activa sigue |
| 10 | Enriquecimiento (FR-014..019) | tras `done` esperar ≤ 30 s | filas en `book_catalog` y `books.catalog_id` completos para libros conocidos; `done` no esperó |
| 11 | Limpieza (FR-004) | tras éxito y tras error | el bucket `imports` no contiene el objeto |
| 12 | Aislamiento (Const. VII) | con un segundo usuario | no ve `imports`/`books`/`highlights` del primero; sí lee `book_catalog`, no puede escribirla |
| 13 | Archivos reales (T023, T036) | importar `docs/files imports/My Clippings.txt` y `KoboReader.sqlite` | Kindle: 214 resaltados, 1 descartado (`empty_text`), 8 libros. Kobo: 504 resaltados (501 + 3 notas), 15 descartados (12 `bookmark_no_text` + 3 `empty_text`), 9 libros. Reimportar ambos → `highlights_new = 0` |
| 14 | Error genérico (US3, FR-028) | forzar un fallo de procesamiento (p. ej. cortar `import_batch` en local) | tarjeta "Algo falló al importar" con `ERR_IMPORT_xxxx`, fecha, archivo · tamaño, "Copiar código" (copia y anuncia "Código copiado"), "Reintentar" primario; el texto dice "No se guardó nada" sólo si no se persistió ningún lote, si no "Lo que ya se guardó se conserva" |
| 15 | Error de formato (US4, FR-029) | subir `clippings-not-clippings.txt` a Kindle | "No pudimos leer este archivo" con nombre y tamaño; "Ver detalle" plegado con líneas leídas, registros válidos y motivo (sin texto de resaltados); "Elegir otro archivo"; "Dónde está el archivo" abre la ayuda; la tarjeta Kobo sigue utilizable |

> **Escenario 10 — cómo medir SC-008**: con `GOOGLE_BOOKS_API_KEY` configurada, importar una biblioteca de ~80 libros, esperar 30 s desde que la tarjeta muestra `done` y correr `scripts/check-enrichment.sql` (`psql -v uid=<user_id>` o reemplazando `:'uid'`). Objetivo: `pct_enriquecidos ≥ 80`. Sin la clave, Google Books se omite y sólo se usa Open Library. En importaciones mayores de ~80 libros el enriquecimiento continúa en segundo plano (límite de ~3 req/s de Open Library).

## Verificaciones en base

```sql
-- SC-003 / SC-004: sin duplicados, conteos coherentes
select count(*), count(distinct hash) from highlights where user_id = '<uid>';
-- Invariante de contadores del último import
select highlights_new + highlights_dup + discarded = entries_total from imports order by started_at desc limit 1;
-- El desglose suma lo descartado y no guarda texto del usuario
select discarded = (select coalesce(sum(value::int), 0) from jsonb_each_text(discard_breakdown)), discard_breakdown, error_code, error_details
from imports order by started_at desc limit 1;
-- FR-017: catálogo sin filas sin fuente
select count(*) from book_catalog where cardinality(sources) = 0;   -- debe ser 0
```

## Verificación visual (Constitución VIII)

Comparar contra `mockups/mobile/02-importar.html` y `mockups/estados-importar/01`, `02`, `03` primero y luego
contra `mockups/desktop/lectia-desktop.html?s=import` y las versiones desktop de esos tres, en claro y oscuro:
tarjetas, chips (`--k-bg`/`--o-bg`), zona punteada, botón de 44–52 px, estados `idle`/`parsing`/`done`/`done` parcial/error de
formato/error genérico. Desviaciones registradas en el plan: estado `parsing` y "Dónde está el archivo" abierto (sin mockup)
y el mensaje `saved = true` del error.
