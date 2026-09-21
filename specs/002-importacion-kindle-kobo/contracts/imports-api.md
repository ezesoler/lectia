# Contrato: /api/imports

**Feature**: 002-importacion-kindle-kobo

Todas las rutas requieren sesión. Sin sesión → `401 { error: { code: "unauthorized", message: "Sesión requerida." } }`.
Un import ajeno o inexistente → `404 not_found` (nunca `403`, para no revelar existencia).
Errores con el formato del proyecto: `{ error: { code, message, details? } }`; `message` en
español rioplatense. Sustituye lo descrito para estas rutas en `docs/modelo-de-datos.md` (H2).

Flujo completo:

```text
1. POST   /api/imports            → { importId, upload: { path, token } }
2. cliente sube el archivo a Storage con la URL/token firmados (uploadToSignedUrl)
3. POST   /api/imports/{id}/parse → 202 { state: "parsing" }
4. GET    /api/imports/{id}       (cada 1 s) → estado + contadores hasta done | error
   (si la subida falla)  DELETE /api/imports/{id}
```

---

## POST /api/imports — Crear el import y obtener permiso de subida

```
POST /api/imports
Content-Type: application/json

{ "source": "kindle" | "kobo", "fileName": string, "fileSize": number }
```

Validaciones: `source` ∈ {kindle, kobo}; `fileName` termina en `.txt` (kindle) o `.sqlite`
(kobo), insensible a mayúsculas; `0 < fileSize ≤ 52428800`.

**201 Created**
```json
{
  "importId": "uuid",
  "upload": { "bucket": "imports", "path": "{user_id}/{importId}", "token": "signed-upload-token" }
}
```
Crea la fila `imports` en `queued` y firma la subida (service_role) para esa ruta exacta.

| Estado | `code` | Cuándo |
|---|---|---|
| 400 | `invalid_file` | extensión o tamaño no válidos (`details.reason`: `extension` \| `too_large` \| `empty`) |
| 400 | `unsupported_source` | `source` distinto de kindle/kobo |
| 409 | `import_in_progress` | ya hay un import `queued`/`parsing` del mismo origen (FR-025). `details.importId` apunta al activo |

Antes de insertar se marcan como `error` los imports activos del usuario/origen sin latido
(R1), de modo que un trabajo muerto no bloquea.

---

## POST /api/imports/{id}/parse — Iniciar el procesamiento

Sin cuerpo. El archivo ya debe estar subido.

**202 Accepted**
```json
{ "state": "parsing" }
```
Transición atómica `queued → parsing`; el trabajo corre en segundo plano (`after()`).
Idempotente: si ya está `parsing` devuelve `202` con el mismo cuerpo sin lanzar otro trabajo.

| Estado | `code` | Cuándo |
|---|---|---|
| 404 | `not_found` | id inexistente o de otro usuario |
| 409 | `invalid_state` | el import está `done` o `error` |
| 422 | `file_missing` | no hay objeto en Storage para ese import |

Los fallos de contenido (archivo que no es un `My Clippings.txt`, SQLite corrupto/vacío, todo
descartado) **no** se devuelven aquí: se registran en la fila (`state = error` +
`error_message`) y se ven por `GET`, porque ocurren tras el `202`.

Este handler exporta `maxDuration = 300`.

---

## GET /api/imports/{id} — Estado y progreso

**200 OK**
```json
{
  "id": "uuid",
  "source": "kindle",
  "state": "queued" | "parsing" | "done" | "error",
  "fileName": "My Clippings.txt",
  "entriesTotal": 1200,
  "entriesDone": 480,
  "booksCount": 0,
  "highlightsNew": 0,
  "highlightsDup": 0,
  "discarded": 0,
  "discardBreakdown": {},
  "fileSize": 88397,
  "errorCode": null,
  "errorMessage": null,
  "errorDetails": null,
  "startedAt": "2026-09-21T14:03:11Z",
  "finishedAt": null
}
```

- Durante `parsing`, `highlightsNew/Dup` reflejan lo persistido hasta el momento;
  `booksCount` y `discarded` son definitivos recién en `done`.
- Porcentaje de progreso = `entriesDone / entriesTotal` (si `entriesTotal = 0`, indeterminado).
- Efecto secundario permitido: si el import está activo y sin latido, se marca `error`
  ("La importación se interrumpió. Volvé a subir el archivo.") antes de responder.

En `error`: `errorCode` (`ERR_IMPORT_xxxx`, catálogo en `research.md` R13), `errorMessage` (español
rioplatense, fiel a lo persistido: distingue "no se guardó nada" de "lo ya guardado se
conserva") y, sólo en errores de formato, `errorDetails` (`{ linesRead, validRecords,
expected?, found? }`, sin texto de resaltados). En `done` con descartes: `discardBreakdown`,
p. ej. `{ "bookmark_no_text": 9, "truncated": 2, "no_title": 1 }`.

---

## DELETE /api/imports/{id} — Cancelar antes de subir

Sólo válido en `queued` (subida fallida o cancelada). Elimina la fila y el objeto de Storage
si existiera.

**204 No Content** · `409 invalid_state` si el import ya está `parsing`/`done`/`error`
(una importación en curso nunca se interrumpe, FR-025) · `404 not_found`.

---

## Contrato del componente (UI ↔ estado)

`SourceCard` recibe `{ source, status: ImportStatus | null }` y deriva el estado visual:

| Estado visual | Condición |
|---|---|
| `idle` | `status = null` |
| `parsing` | subiendo, o `state ∈ {queued, parsing}` |
| `done` | `state = done`, `discarded = 0` → "N libros · M resaltados" + "listo" |
| `done` parcial | `state = done`, `discarded > 0` → igual + panel de aviso con el desglose siempre expandido (`mockups/estados-importar/03`) |
| `error` formato | `errorCode` 4xxx → "No pudimos leer este archivo", nombre y tamaño, "Ver detalle" plegado, "Elegir otro archivo", "Dónde está el archivo" (`…/01`) |
| `error` genérico | `errorCode` 5xxx → "Algo falló al importar", código + fecha + "Copiar código", "Reintentar" primario, "Elegir otro archivo" (`…/02`) |

"Ver mi biblioteca" (`/`) se habilita si al menos una tarjeta está en `done` (FR-023).
