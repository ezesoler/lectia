# Feature Specification: Importación de Resaltados desde Kindle y Kobo

**Feature Branch**: `002-importacion-kindle-kobo`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Feature 002 — Importación de resaltados desde Kindle y Kobo. El usuario puede subir su archivo My Clippings.txt (Kindle) o conectar su Kobo para importar KoboReader.sqlite. El sistema parsea el archivo en el servidor, normaliza los datos, deduplica resaltados y los persiste en la base de datos. El usuario ve el progreso de la importación y un resumen del resultado (libros procesados, resaltados nuevos, duplicados descartados). Aplica el esquema de datos ya definido en docs/modelo-de-datos.md."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Lector importa su Kindle por primera vez (Priority: P1)

Un lector conecta su Kindle a la computadora (o lo abre desde iCloud/archivos), navega hasta el archivo `My Clippings.txt` y lo arrastra a la zona de importación de Lectia. El sistema procesa el archivo en el servidor y al terminar muestra un resumen: cuántos libros se encontraron y cuántos resaltados se guardaron. El lector puede entonces ir a ver su biblioteca.

**Por qué esta prioridad**: Es el flujo de mayor volumen de usuarios (Kindle es el lector más común) y la razón principal de existencia del producto. Sin esto, la app no entrega valor.

**Independent Test**: Se puede testear completamente subiendo un `My Clippings.txt` real y verificando que los resaltados aparecen en la biblioteca. No depende de ningún otro flujo.

**Acceptance Scenarios**:

1. **Given** el usuario está en `/importar` sin ninguna importación previa, **When** arrastra un `My Clippings.txt` válido a la zona Kindle, **Then** la tarjeta pasa al estado `parsing` con barra de progreso y al terminar muestra el chip `done` con el recuento de libros y resaltados.
2. **Given** el usuario terminó una importación Kindle, **When** hace clic en "Ver mi biblioteca", **Then** llega a `/` y ve los libros importados organizados con sus resaltados.
3. **Given** el usuario ya importó antes, **When** vuelve a subir el mismo `My Clippings.txt`, **Then** el sistema termina sin añadir duplicados: `highlights_new` es 0 y `highlights_dup` refleja los resaltados ya existentes.
4. **Given** el usuario arrastra un archivo que no es `My Clippings.txt` (por ejemplo, un PDF), **When** el sistema intenta procesarlo, **Then** la tarjeta muestra el estado `error` con un mensaje que explica qué salió mal y ofrece reintentar; ningún resaltado anterior se modifica.

---

### User Story 2 — Lector importa su Kobo (Priority: P1)

Un lector conecta su Kobo, busca la carpeta oculta `.kobo` en el lector y arrastra el archivo `KoboReader.sqlite` a la zona de importación Kobo. El sistema procesa la base de datos y al terminar presenta el resumen de la importación.

**Por qué esta prioridad**: Kobo es el segundo lector más común y la promesa del producto lo menciona explícitamente. Tiene la misma prioridad que Kindle porque ambos forman el núcleo de la propuesta de valor.

**Independent Test**: Se puede testear subiendo un `KoboReader.sqlite` real y verificando que los resaltados del Kobo aparecen en la biblioteca, independientemente de si hay datos de Kindle.

**Acceptance Scenarios**:

1. **Given** el usuario está en `/importar`, **When** arrastra un `KoboReader.sqlite` válido a la zona Kobo, **Then** la tarjeta pasa a `parsing` y al finalizar muestra el chip `done` con el recuento de libros y resaltados del Kobo.
2. **Given** el usuario tiene resaltados de Kindle ya importados, **When** importa también `KoboReader.sqlite`, **Then** los libros que coinciden (mismo título y autor normalizados) se fusionan en un único registro de libro; los resaltados de cada origen conservan su etiqueta de origen (`kindle` / `kobo`).
3. **Given** el `KoboReader.sqlite` está vacío o corrupto, **When** el sistema intenta procesarlo, **Then** la tarjeta muestra el estado `error` con un mensaje específico que explica la situación y permite reintentar.

---

### User Story 3 — El lector ve el progreso en tiempo real y el resumen final (Priority: P2)

Mientras el sistema procesa el archivo, el lector ve una barra de progreso con porcentaje y recuento parcial de resaltados encontrados. Al terminar, el resumen indica con precisión cuántos libros se procesaron, cuántos resaltados son nuevos y cuántos se descartaron por ser duplicados.

**Por qué esta prioridad**: El progreso visible es esencial para archivos grandes (un `My Clippings.txt` puede tener miles de entradas). Sin feedback el usuario no sabe si el proceso continúa o falló.

**Independent Test**: Se puede testear con un archivo de tamaño medio y verificar que el estado de la tarjeta cambia de `idle` → `parsing` → `done` y que los contadores del resumen coinciden con el contenido real del archivo.

**Acceptance Scenarios**:

1. **Given** el usuario subió un archivo válido, **When** el parseo está en curso, **Then** la barra de progreso avanza y el recuento parcial se actualiza; el usuario no necesita recargar la página.
2. **Given** el parseo terminó exitosamente, **When** el usuario ve el resumen, **Then** el chip `done` muestra exactamente: cantidad de libros únicos detectados, cantidad de resaltados nuevos guardados, y cantidad de resaltados descartados por duplicados.
3. **Given** el parseo terminó con registros inválidos, **When** el usuario ve el resumen, **Then** el estado es `done` (no `error`) y se informa también cuántos registros se descartaron por estar malformados; el usuario puede continuar a la biblioteca.

---

### User Story 4 — El lector maneja un archivo parcialmente válido (Priority: P2)

Un archivo `My Clippings.txt` puede contener entradas corruptas, recortes en otros idiomas, notas sin número de página o líneas truncadas. El sistema procesa todo lo que pueda y descarta sólo lo inválido, informando cuánto se descartó.

**Por qué esta prioridad**: Es un requisito de robustez explicitado en la constitución del proyecto: "Un archivo mal formado nunca rompe la importación".

**Independent Test**: Se puede testear con un archivo de muestra que contenga entradas deliberadamente malformadas y verificar que las entradas válidas se guardan y las inválidas aparecen en el contador `discarded`.

**Acceptance Scenarios**:

1. **Given** un `My Clippings.txt` con 100 entradas de las cuales 10 están malformadas, **When** el sistema termina de procesar, **Then** se guardan hasta 90 resaltados válidos y el resumen indica que 10 registros se descartaron.
2. **Given** un archivo donde todas las entradas son inválidas, **When** el sistema termina, **Then** la tarjeta muestra el estado `error` (cero resaltados guardados) con un mensaje que explica qué ocurrió.

---

### User Story 5 — El lector re-importa después de leer más (Priority: P3)

Después de semanas de lectura, el lector tiene nuevos resaltados en su Kindle. Vuelve a Lectia y sube el archivo `My Clippings.txt` actualizado. El sistema detecta qué ya existe y sólo agrega los resaltados nuevos.

**Por qué esta prioridad**: La idempotencia es un principio no negociable de la constitución, pero el caso de uso activo (re-importar periódicamente) es menos urgente que la primera importación.

**Independent Test**: Importar un archivo, agregar resaltados de prueba al mismo archivo, re-importar y verificar que sólo los nuevos resaltados incrementan el contador `highlights_new`.

**Acceptance Scenarios**:

1. **Given** el usuario ya importó un archivo con 50 resaltados, **When** sube una versión actualizada con 60 resaltados (10 nuevos), **Then** el resumen muestra `highlights_new: 10`, `highlights_dup: 50`, y el total en la biblioteca pasa a 60.
2. **Given** el usuario sube exactamente el mismo archivo sin cambios, **When** termina el procesamiento, **Then** `highlights_new` es 0 y `highlights_dup` iguala el total de resaltados del archivo; la biblioteca no cambia.

---

### Edge Cases

- ¿Qué pasa si el archivo supera el límite de tamaño máximo permitido? → La tarjeta muestra un error de validación antes de subir el archivo, indicando el tamaño máximo aceptado.
- ¿Qué pasa si el usuario cierra la pestaña durante el parseo? → El trabajo en servidor continúa. Al volver a `/importar`, la página carga automáticamente el último estado de cada origen: si terminó, muestra el chip `done` con el resumen; si sigue en curso, retoma el polling y muestra la barra de progreso.
- ¿Qué pasa si un resaltado tiene texto idéntico pero ubicación diferente en el mismo libro? → Se guarda como resaltado distinto (la clave de deduplicación incluye la ubicación).
- ¿Qué pasa si el mismo libro aparece en Kindle y Kobo con una variación mínima en el título? → Se crean dos registros de libro separados si la clave normalizada difiere; si coincide exactamente, se fusionan.
- ¿Qué pasa si el archivo `KoboReader.sqlite` está bloqueado (el lector sigue conectado y la base de datos en uso)? → El sistema intenta abrir el archivo en modo sólo lectura; si falla, muestra error específico.
- ¿Qué pasa si el `My Clippings.txt` está en un idioma con caracteres no latinos (japonés, árabe)? → El sistema procesa el archivo con codificación UTF-8; los resaltados se guardan tal como están; la normalización de claves sólo aplica a letras latinas con diacríticos.

---

## Requirements *(mandatory)*

### Functional Requirements

**Subida de archivos**

- **FR-001**: El sistema DEBE aceptar la subida de archivos `My Clippings.txt` (Kindle) y `KoboReader.sqlite` (Kobo) como dos flujos independientes desde la pantalla de importación.
- **FR-002**: El sistema DEBE admitir arrastre de archivos (drag-and-drop) en escritorio y selección de archivo mediante botón en dispositivos móviles.
- **FR-003**: El sistema DEBE validar el archivo antes de iniciar el parseo y rechazar archivos que no correspondan al formato esperado (tipo incorrecto, tamaño excesivo), mostrando un mensaje que explica el problema.
- **FR-004**: El archivo original DEBE eliminarse del almacenamiento temporal al concluir el procesamiento (tanto en caso de éxito como de error), sin conservar ninguna copia.

**Parseo y normalización**

- **FR-005**: El sistema DEBE parsear `My Clippings.txt` en el servidor extrayendo título del libro, autor, tipo de entrada (resaltado o nota), texto, número de página y ubicación.
- **FR-006**: El sistema DEBE parsear `KoboReader.sqlite` en el servidor extrayendo las tablas de libros y anotaciones, incluyendo título, autor, texto resaltado, tipo, fecha y capítulo/ubicación.
- **FR-007**: El sistema DEBE normalizar títulos, autores y textos de resaltados según la función estándar del proyecto (minúsculas, sin acentos, sin puntuación) para producir claves de deduplicación.
- **FR-008**: Un registro malformado, incompleto o sin texto guardable (por ejemplo, marcadores de Kindle o marcas de Kobo sin texto) NO DEBE abortar el procesamiento del lote; DEBE contarse en el campo `discarded` del registro de importación y clasificarse por motivo (por ejemplo: marcador sin texto, registro truncado, registro sin título de libro), sin conservar el texto del registro.

**Deduplicación y persistencia**

- **FR-009**: El sistema DEBE calcular un hash SHA-256 por cada resaltado a partir de `normalize(título)`, `normalize(autor)`, el tipo (`highlight`/`note`), `normalize(texto)` y `(ubicación ?? '')`, unidos con un separador que no pueda aparecer en los campos (`U+001F`), y almacenarlo en `highlights.hash`; la deduplicación primaria usa `(user_id, hash)`. El separador evita colisiones por concatenación ambigua y el tipo evita que una nota con el mismo texto y ubicación que un subrayado se pierda.
- **FR-010**: Un resaltado cuyo hash ya exista para ese usuario NO DEBE duplicarse ni modificarse al reimportar, independientemente del origen o del archivo que lo introdujo.
- **FR-011**: Si un libro con las mismas claves normalizadas de título y autor ya existe en la biblioteca del usuario, el sistema DEBE asociar los nuevos resaltados al libro existente en lugar de crear uno nuevo.
- **FR-012**: Cada resaltado persistido DEBE conservar su `source` original (`kindle` o `kobo`), incluso cuando el libro ya existe con un origen diferente.
- **FR-013**: La importación DEBE ser atómica por lote: si el proceso falla a mitad, los resaltados ya persistidos se conservan y el registro de importación queda en estado `error` con el mensaje correspondiente.

**Enriquecimiento de metadatos del libro**

- **FR-014**: Tras identificar cada libro durante el parseo, el sistema DEBE buscar sus metadatos en la tabla `book_catalog` compartida usando ISBN (si está disponible) o la combinación `(title_key, author_key)`.
- **FR-015**: Si el libro no está en `book_catalog`, el sistema DEBE consultar primero Open Library (por ISBN si está disponible, luego por título y autor) para obtener los tres campos objetivo: URL de portada, categoría y cantidad de páginas.
- **FR-016**: Por cada campo objetivo que Open Library no haya devuelto, el sistema DEBE intentar obtenerlo de Google Books con la misma estrategia de búsqueda (ISBN → título+autor). El resultado final es un merge de ambas fuentes: cada campo se toma de la primera API que lo provea.
- **FR-017**: Los metadatos resultantes del merge DEBEN almacenarse en `book_catalog` (escritura exclusivamente por `service_role`) incluyendo los campos obtenidos y dejando en `null` los que ninguna API pudo proveer. El sistema NO DEBE escribir en `book_catalog` a partir de datos provistos directamente por el usuario.
- **FR-018**: Si ninguna API devuelve ningún dato para un libro, ese libro DEBE guardarse en `books` del usuario igualmente, sin entrada en `book_catalog`; el enriquecimiento fallido no interrumpe ni retrasa la importación visible al usuario.
- **FR-019**: El enriquecimiento de metadatos DEBE ocurrir de forma asincrónica, después de que los resaltados estén persistidos; el estado `done` de la importación no espera a que finalice el enriquecimiento.
- **FR-027**: El enriquecimiento de cada libro DEBE reintentarse con backoff exponencial (1 s → 2 s → 4 s) en caso de error de red o rate limit de la API; tras 3 intentos fallidos, el libro queda en `book_catalog` con los datos parciales obtenidos hasta ese punto (o sin entrada si ningún intento devolvió datos).

**Progreso y resultado**

- **FR-020**: Durante el parseo, la tarjeta del origen correspondiente DEBE mostrar el estado `parsing` con una barra de progreso y un recuento parcial de resaltados encontrados.
- **FR-021**: Al concluir exitosamente, la tarjeta DEBE mostrar el estado `done` con el recuento exacto de: libros procesados (`books_count`), resaltados nuevos (`highlights_new`), resaltados duplicados descartados (`highlights_dup`) y registros descartados (`discarded`). Cuando `discarded` es mayor que 0, la tarjeta DEBE mostrar además el desglose de descartes por motivo, siempre expandido, sin cambiar el estado `done` (aviso, no error).
- **FR-022**: Si el procesamiento falla, la tarjeta DEBE mostrar el estado `error` con un mensaje en español rioplatense que explica qué falló y ofrece la acción de reintentar. El mensaje DEBE ser fiel a lo persistido: si el fallo ocurre antes de guardar, indica que no se guardó nada; si ocurre a mitad del proceso, indica que lo ya guardado se conserva y que reintentar no duplica (ver FR-013).
- **FR-023**: El botón "Ver mi biblioteca" DEBE estar habilitado únicamente cuando al menos un origen finalizó en estado `done`.
- **FR-024**: Los dos orígenes (Kindle y Kobo) DEBEN poder importarse de forma independiente y en cualquier orden, sin afectarse mutuamente.
- **FR-025**: Si el usuario intenta iniciar una importación de un origen que ya tiene una importación en estado `parsing`, el sistema DEBE rechazar la solicitud y mostrar un mensaje indicando que hay una importación en curso para ese origen; la importación activa no se interrumpe.
- **FR-026**: Al cargar la pantalla `/importar`, el sistema DEBE consultar el estado de la última importación de cada origen para ese usuario y mostrar la tarjeta en el estado correspondiente (`idle`, `parsing`, `done` o `error`); si una importación sigue en `parsing`, el polling debe reanudarse automáticamente.
- **FR-028**: Todo import en estado `error` DEBE registrar un código de error estable (por ejemplo `ERR_IMPORT_5031`) que la tarjeta muestra con la acción "Copiar código"; el código no contiene datos del usuario y sirve para soporte.
- **FR-029**: Cuando el archivo no tiene el formato esperado, la tarjeta DEBE ofrecer un detalle técnico plegado por defecto ("Ver detalle") con líneas leídas, registros válidos y el motivo del rechazo (por ejemplo, qué se esperaba en la primera línea y qué se encontró, truncado). El detalle NUNCA incluye texto de resaltados. La tarjeta también ofrece "Elegir otro archivo" y "Dónde está el archivo" (ayuda de ubicación del archivo en el lector).
- **FR-030**: "Reintentar" reutiliza el archivo que el navegador todavía tiene en memoria durante la sesión; si la página se recargó, sólo se ofrece "Elegir otro archivo". El servidor nunca conserva el archivo para reintentar (FR-004).

### Key Entities *(include if feature involves data)*

- **Catálogo de libros** (`book_catalog`): base de datos bibliográfica propia del proyecto, compartida entre todos los usuarios, sin `user_id`. Contiene los datos enriquecidos de un libro: ISBN, título, autor, URL de portada, categoría, cantidad de páginas y la fuente de los datos (`open_library` / `google_books`). Se crea o actualiza **únicamente cuando una API externa (Open Library o Google Books) devuelve datos que lo respaldan**; ningún usuario puede escribir directamente en esta tabla. Cualquier usuario autenticado puede leer. Clave de búsqueda: ISBN (si existe) o `(title_key, author_key)`. Las escrituras las ejecuta el servidor con `service_role` sólo como resultado de una llamada exitosa a una API externa, ya sea durante una importación o una búsqueda (feature futura).
- **Libro del usuario** (`books`): registro específico del usuario que vincula sus resaltados con una entrada de `book_catalog` (FK nullable). Contiene título y autor tal como aparecen en el archivo importado, sus claves normalizadas, el origen y la fecha de importación. La deduplicación por usuario ocurre por `(user_id, title_key, author_key)`.
- **Resaltado** (`highlights`): texto subrayado o nota del lector; incluye el texto, su clave normalizada, un hash SHA-256 para deduplicación primaria, tipo (`highlight`/`note`), ubicación, fecha y origen. La deduplicación usa `(user_id, hash)`.
- **Importación** (`imports`): registro de una ejecución de importación; tiene origen (`kindle`/`kobo`), estado (`queued`/`parsing`/`done`/`error`), nombre del archivo, contadores de resultado y mensaje de error opcional. Se crea al iniciar y se actualiza al finalizar.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El usuario completa la importación de un archivo `My Clippings.txt` con hasta 5.000 resaltados en menos de 60 segundos desde que confirma el archivo.
- **SC-002**: El usuario completa la importación de un `KoboReader.sqlite` con hasta 3.000 resaltados en menos de 60 segundos.
- **SC-003**: Reimportar el mismo archivo produce exactamente cero resaltados nuevos y cero resaltados eliminados; la biblioteca no cambia.
- **SC-004**: El 100% de los resaltados válidos contenidos en el archivo original aparecen en la biblioteca del usuario al finalizar la importación.
- **SC-005**: Un archivo con hasta el 20% de entradas malformadas se procesa sin error general: las entradas válidas se guardan y el resumen informa las descartadas.
- **SC-006**: Los resaltados del mismo libro importados desde Kindle y desde Kobo coexisten bajo el mismo registro de libro sin duplicar el título ni el autor.
- **SC-007**: El usuario ve feedback de progreso dentro de los primeros 3 segundos de haber confirmado el archivo, sin necesidad de recargar la página.
- **SC-008**: En importaciones de hasta 80 libros, al menos el 80% de los libros obtienen portada, categoría y cantidad de páginas desde Open Library o Google Books dentro de los 30 segundos posteriores a que la importación muestra `done`. En importaciones mayores el enriquecimiento continúa en segundo plano sin plazo garantizado, condicionado por los límites de tasa de las APIs.

---

## Clarifications

### Session 2026-09-21

- Q: ¿Quién puede escribir en `book_catalog`? → A: Solo el servidor (`service_role`), y únicamente cuando una API externa (Open Library o Google Books) respalda los datos. Ningún usuario puede escribir directamente. La protección contra envenenamiento del catálogo es por origen de datos, no solo por RLS.
- Q: Si hay una importación del mismo origen ya en curso, ¿qué ocurre al iniciar una nueva? → A: Bloquear — mostrar mensaje de error indicando que hay una importación en curso y pedir que espere a que termine.
- Q: Si una API devuelve datos parciales (no los 3 campos mínimos), ¿qué hace el sistema? → A: Busca en Open Library primero; si faltan campos, consulta Google Books para completarlos (merge); si aún faltan campos, guarda los datos parciales con los campos faltantes en `null`.
- Q: ¿La página `/importar` carga el estado de la última importación al entrar, o arranca siempre vacía? → A: Carga automáticamente el último estado de cada origen (done/parsing/error) al entrar a la pantalla.
- Q: Si se alcanzan rate limits de Open Library o Google Books durante el enriquecimiento, ¿qué estrategia sigue el sistema? → A: Reintentar con backoff exponencial (1s → 2s → 4s), máximo 3 intentos por libro; si agota los reintentos, el libro queda con los datos parciales que se hayan obtenido.

### Session 2026-09-21 (revisión de mockups y archivos reales)

- Q: ¿Los marcadores y marcas sin texto (Kindle/Kobo) suman a `discarded`? → A: Sí, con desglose por motivo, tal como muestra el mockup de importación parcial.
- Q: ¿Qué dice el mensaje de error si el fallo ocurre a mitad del proceso? → A: Que lo ya guardado se conserva y que reintentar no duplica; sólo se afirma "no se guardó nada" cuando efectivamente no se persistió ningún lote.
- Q: ¿Se agregan código de error y detalle técnico de formato? → A: Sí (FR-028, FR-029). "Descargar el detalle" de descartes no entra en esta feature.

---

## Assumptions

- El tamaño máximo de archivo aceptado es 50 MB, suficiente para cubrir años de lectura en cualquiera de los dos dispositivos.
- El archivo `My Clippings.txt` está codificado en UTF-8 o UTF-8-BOM, que es el formato que produce Kindle por defecto.
- El `KoboReader.sqlite` corresponde a las versiones de firmware de Kobo lanzadas desde 2018 en adelante; versiones anteriores con esquemas distintos pueden no ser compatibles.
- El usuario ya inició sesión (la feature 001 — Auth Google — está completada y operativa).
- Esta feature crea las tablas `imports`, `books` y `highlights` con sus tipos enumerados (hoy sólo existe la migración de `profiles`), introduce la tabla `book_catalog` (compartida, sin `user_id`) y agrega `books.catalog_id` (FK nullable), `highlights.hash` y `highlights.chapter`, además de columnas de progreso, código de error y desglose de descartes en `imports`. Todas las migraciones se crean en esta feature.
- El almacenamiento temporal para archivos en tránsito se crea en esta feature como bucket privado `imports/{user_id}/{import_id}`.
- Las claves de API de Open Library (gratuita, sin clave) y Google Books (`GOOGLE_BOOKS_API_KEY`) están disponibles como variables de entorno en el servidor; ninguna clave se expone al cliente.
- El layout de la pantalla de importación (`/importar`) está definido en los mockups `mockups/desktop/02-importar.html` y `mockups/mobile/02-importar.html` y debe implementarse fielmente como parte de esta feature, respetando el Principio VIII de la constitución. La pantalla no existe en código todavía.
- Las notificaciones de progreso se implementan mediante polling desde el cliente al endpoint de estado (`GET /api/imports/{id}`); no se requiere WebSocket para esta versión.
- Los archivos originales no se retienen después del procesamiento, sin excepción; no hay función de "re-parsear desde el archivo guardado".
- Los estados `error de formato`, `error genérico` e `importación parcial` están diseñados en `mockups/estados-importar/` y se implementan fielmente (Principio VIII). "Descargar el detalle" de descartes que muestra el mockup de importación parcial **queda fuera de esta feature**; el desglose por motivo sí se muestra.
