# Contrato: /api/covers

**Feature**: 004-cover-image-storage

Ruta que entrega la portada propia de un libro del catálogo. Es el **único** camino para leer
las imágenes: el bucket `covers` es privado y no tiene políticas para los usuarios (R1).

---

## GET /api/covers/{catalogId}

Requiere sesión. `{catalogId}` es el `book_catalog.id` (uuid), el mismo que referencia
`books.catalog_id`.

```
GET /api/covers/{catalogId}
If-None-Match: "<sha256>"        (opcional)
```

### Respuestas

**200 OK** — la portada guardada, bytes idénticos a los descargados (FR-007)

| Cabecera | Valor |
|---|---|
| `Content-Type` | `image/jpeg` · `image/png` · `image/webp` (según `cover_format`) |
| `Content-Length` | `cover_bytes` |
| `ETag` | `"<cover_sha256>"` |
| `Cache-Control` | `private, max-age=31536000, immutable` |

**304 Not Modified** — `If-None-Match` coincide con la huella actual; sin cuerpo.

**404 Not Found** — el libro no existe **o** no tiene copia propia (`cover_status ≠ 'stored'`).
Nunca redirige ni sirve la imagen desde el servicio externo (FR-017): la interfaz muestra el
estado "sin portada".
```json
{ "error": { "code": "not_found", "message": "Este libro no tiene portada." } }
```

**401 Unauthorized** — sin sesión (la petición no autenticada la redirige antes el middleware,
igual que el resto de `/api/*`; el handler también lo verifica).
```json
{ "error": { "code": "unauthorized", "message": "Sesión requerida." } }
```

**500** — el objeto no está en Storage aunque la fila dice `stored` (incoherencia). Se registra
el error (sólo id, sin datos del usuario) y se responde
`{ "error": { "code": "server_error", "message": "No se pudo leer la portada." } }`.

### Notas

- La fila del catálogo se lee con el cliente del usuario (RLS: lectura para `authenticated`); el
  objeto, con `service_role`.
- `{catalogId}` que no es un uuid → `404` sin consultar la base.
- La respuesta no incluye ningún dato de usuario, y no varía entre usuarios: es cacheable de
  forma inmutable porque la copia no se reemplaza (una portada guardada nunca cambia de bytes).
- No hay parámetros de tamaño: se sirve el maestro (Assumption del spec: sin miniaturas).

## Helper de interfaz

`lib/covers/href.ts` exporta `coverHref(catalogId: string): string` → `"/api/covers/{id}"`. Las
pantallas futuras (biblioteca, detalle) lo usan para el `src` de la imagen, y muestran "sin
portada" ante un `404`. Ninguna pantalla debe usar `cover_origin_url`.
