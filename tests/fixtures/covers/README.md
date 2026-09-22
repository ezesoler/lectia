# Fixtures de portadas

Todas son **sintéticas**, generadas por `make-fixtures.ts` (`npm run fixtures:covers`). Ninguna
contiene datos de usuario ni proviene de una cuenta real.

- `valid.jpg` / `valid.png` / `valid.webp`: imágenes mínimas válidas (~400×600), una por formato
  aceptado (FR-009).
- `truncated.jpg`: como `valid.jpg`, sin los últimos bytes (sin marcador `FFD9` de fin de imagen).
- `tiny.jpg`: JPEG válido de 40×60, por debajo del mínimo de 100 px de lado menor.
- `not-image.bin`: cuerpo de una respuesta de error (HTML), no es una imagen.
- `huge.jpg`: cabecera JPEG válida con relleno hasta superar los 10 MB.

## Reemplazos reales de Google Books

`google-placeholder-575x750.png` y `google-placeholder-128x170.png` son descargas reales del
"image not available" que devuelve `books.google.com/books/content` cuando no tiene portada
(`research.md` de la feature 004, hallazgo E5). No son datos de ningún usuario: es el mismo
archivo genérico que devuelve la API a cualquiera. Se usan para probar `KNOWN_PLACEHOLDERS`.
