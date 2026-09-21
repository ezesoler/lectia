# Contrato interno: parsers y enriquecimiento

**Feature**: 002-importacion-kindle-kobo

Funciones puras (sin acceso a red ni base de datos) para poder probarlas con archivos de muestra.

## `parseClippings(text: string): ParseResult` — `lib/import/kindle-parser.ts`

| Entrada | Salida |
|---|---|
| Contenido completo de `My Clippings.txt` (UTF-8, con o sin BOM) | `ParseResult` |

- `entries`: sólo entradas válidas (`kind` ∈ `highlight`/`note`) con `title`, `author`, `text`,
  `location` (`''` si falta), `page?`, `highlightedAt?`.
- `discarded`: entradas descartadas (marcadores sin texto y malformadas), con `discardBreakdown` por motivo (R13). `linesRead`: líneas leídas (para el detalle técnico de errores de formato).
- `booksCount`: cantidad de pares `(title_key, author_key)` distintos en `entries`.
- Nunca lanza por contenido malformado; sólo devuelve conteos. Entrada vacía → `entries = []`.

## `parseKobo(buffer: Uint8Array): Promise<ParseResult>` — `lib/import/kobo-parser.ts`

- Lanza `KoboFileError` con `code` ∈ `not_sqlite` | `corrupt` | `unsupported_schema` | `empty`
  (el orquestador la traduce a `errorMessage`). El contenido individual malformado se cuenta en
  `discarded` y no lanza.
- Notas: el texto es `Annotation`; `markup`/`dogear` se descartan (`bookmark_no_text`). Devuelve además `isbn?` por libro (uso exclusivo del enriquecimiento; no se persiste).

## `normalize`, `buildKeys`, `hashHighlight` — `lib/import/normalize.ts`

```text
normalize(s: string): string
hashHighlight(k: { titleKey, authorKey, kind, textKey, location }): string   // sha256 hex, R3
```

## `enrichBook(input): Promise<EnrichResult>` — `lib/enrichment/enrich-book.ts`

```text
input   { title, author, titleKey, authorKey, isbn? }
result  { status: 'catalog_hit' | 'enriched' | 'partial' | 'not_found',
          catalogId?: string }
```

- Inyección de dependencias (`fetch`, `sleep`, cliente admin) para probar merge, aceptación de
  resultado y backoff sin red.
- `not_found` no escribe en `book_catalog`. `enriched`/`partial` sólo se producen si al menos
  un campo provino de una API (FR-017).

## Variables de entorno nuevas (sólo servidor)

| Variable | Uso |
|---|---|
| `GOOGLE_BOOKS_API_KEY` | Google Books |
| `OPEN_LIBRARY_CONTACT` | (opcional) contacto en el `User-Agent` para el límite de 3 req/s |

Se agregan a `.env.local.example`; ninguna con prefijo `NEXT_PUBLIC_`.
