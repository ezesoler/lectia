# Feature Specification: Portadas como recurso propio

**Feature Branch**: `004-cover-image-storage`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "actualmente la imagen de portada se está guardando en la BD haciendo referencia a la URL de google book api, debería guardarse el jpg en el servidor para que sea un recurso propio (además de guardar la imagen con la mayor calidad posible)"

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Las portadas de libros nuevos se guardan como recurso propio (Priority: P1)

Cuando el enriquecimiento de metadatos (feature 002) encuentra la portada de un libro, hoy el catálogo guarda sólo la dirección de la imagen en el servicio externo (Open Library o Google Books). Con esta feature, el sistema descarga la imagen, la guarda en el almacenamiento propio del proyecto y el catálogo pasa a referenciar **esa copia propia**. El lector que ve su biblioteca deja de depender de que un tercero siga sirviendo, cambiando o bloqueando la imagen.

**Por qué esta prioridad**: es el núcleo del pedido. Sin esto, cualquier cambio de URL, límite de tasa o caída del servicio externo rompe las portadas de todos los libros.

**Independent Test**: se puede testear importando un libro con portada disponible en una fuente y verificando que el catálogo referencia un recurso propio (no una dirección externa) y que la imagen se obtiene sin contactar al servicio de origen.

**Acceptance Scenarios**:

1. **Given** un libro nuevo cuya portada está disponible en una fuente externa, **When** termina el enriquecimiento de metadatos, **Then** existe una copia de la imagen en el almacenamiento propio y la entrada del catálogo referencia esa copia.
2. **Given** un libro con portada ya guardada como recurso propio, **When** otro usuario importa el mismo libro, **Then** no se descarga ni se guarda otra copia: se reutiliza la existente.
3. **Given** un libro cuya portada se guardó como recurso propio, **When** el servicio externo deja de responder o cambia la dirección de la imagen, **Then** la portada sigue disponible sin cambios.
4. **Given** una importación con varios libros, **When** el estado de la importación pasa a `done`, **Then** ese estado no esperó a la descarga de las imágenes (se guardan en segundo plano, igual que el resto del enriquecimiento).

---

### User Story 2 — La portada se guarda con la mayor calidad disponible (Priority: P1)

El lector espera portadas nítidas. El sistema elige, entre las versiones que ofrece la fuente, la de **mayor resolución** y la guarda **tal como la entrega la fuente**, sin recomprimirla ni reducirla. La fuente preferida es Open Library; Google Books se usa sólo como respaldo cuando Open Library no tiene portada del libro.

**Por qué esta prioridad**: guardar una copia propia de una miniatura de baja resolución fijaría esa mala calidad para siempre; la calidad hay que resolverla en el momento de guardar.

**Independent Test**: se puede testear con libros cuya fuente ofrece varias resoluciones y comparando la resolución guardada con la mayor disponible, y verificando que el archivo guardado es idéntico byte a byte al descargado.

**Acceptance Scenarios**:

1. **Given** una fuente que ofrece la portada en varias resoluciones, **When** se guarda la copia propia, **Then** se guarda la de mayor resolución disponible, no la miniatura.
2. **Given** que ambas fuentes ofrecen portada para el mismo libro, **When** se guarda la copia propia, **Then** se usa la de Open Library (aunque la de Google Books tenga mayor resolución) y no se descarga la de Google Books.
3. **Given** un libro cuya portada sólo ofrece Google Books, **When** se guarda la copia propia, **Then** se guarda la de Google Books, en su mayor resolución disponible.
4. **Given** una imagen descargada, **When** se guarda, **Then** el archivo guardado es idéntico al descargado (no se recomprime, no se reduce, no se convierte con pérdida).
5. **Given** una copia guardada, **When** se consultan sus datos, **Then** constan sus dimensiones, tamaño y huella de integridad, para poder verificar la calidad y la copia.

---

### User Story 3 — Las portadas ya existentes se migran a recurso propio (Priority: P2)

El catálogo ya tiene libros cuya portada quedó guardada como dirección externa. Esos libros también deben pasar a tener copia propia, sin que nadie tenga que volver a importar sus archivos.

**Por qué esta prioridad**: sin la migración, el problema seguiría vigente para todo lo importado hasta hoy; pero no bloquea a los libros nuevos, por eso va después.

**Independent Test**: se puede testear con un catálogo que contenga entradas con dirección externa, ejecutando la migración y verificando que cada una pasa a referenciar una copia propia, y que ejecutarla otra vez no duplica nada.

**Acceptance Scenarios**:

1. **Given** entradas del catálogo con portada como dirección externa, **When** corre la migración, **Then** cada una queda con copia propia y deja de referenciar la dirección externa.
2. **Given** una migración interrumpida a la mitad, **When** se vuelve a ejecutar, **Then** continúa donde quedó, sin repetir descargas ya hechas ni duplicar copias.
3. **Given** una entrada cuya imagen externa ya no está disponible, **When** corre la migración, **Then** esa entrada queda sin portada (no rompe la migración) y se puede reintentar más tarde.
4. **Given** que la migración de una entrada encuentra en la fuente una versión de mayor resolución que la que tenía, **When** se guarda la copia, **Then** se guarda la de mayor resolución.

---

### User Story 4 — Una imagen que falla o no sirve nunca rompe la importación (Priority: P2)

Descargar imágenes de terceros puede fallar: el servicio no responde, devuelve algo que no es una imagen, una imagen vacía de "no disponible" o un archivo enorme. Nada de eso puede afectar la importación del lector ni el enriquecimiento de los demás libros.

**Por qué esta prioridad**: es un requisito de robustez del producto (Principio II: lo malformado no rompe la importación), pero depende de que la descarga exista.

**Independent Test**: se puede testear simulando fuentes que fallan, tardan, devuelven contenido inválido o imágenes de reemplazo, y verificando que la importación termina bien y esos libros quedan sin portada.

**Acceptance Scenarios**:

1. **Given** una fuente que no responde o devuelve error, **When** se intenta guardar la portada, **Then** se reintenta con espera creciente un número acotado de veces y, si sigue fallando, el libro queda sin portada sin afectar al resto.
2. **Given** una respuesta que no es una imagen válida, **When** se valida, **Then** se descarta y no se guarda.
3. **Given** la imagen de reemplazo que algunas fuentes devuelven cuando no tienen portada (muy pequeña o vacía), **When** se valida, **Then** se descarta: no se guarda como portada.
4. **Given** una imagen que supera el tamaño máximo permitido, **When** se valida, **Then** se descarta.
5. **Given** un libro que quedó sin portada por un fallo, **When** el libro vuelve a pasar por el enriquecimiento (nueva importación o pasada de reintento), **Then** se intenta de nuevo guardar su portada.

---

### Edge Cases

- Dos usuarios importan al mismo tiempo el mismo libro → se guarda una sola copia; la segunda petición reutiliza la primera.
- Las dos fuentes ofrecen portada para el mismo libro → se usa la de Open Library, sin comparar resoluciones con la de Google Books; la regla de mayor resolución se aplica dentro de la fuente elegida.
- La fuente entrega la imagen en un formato distinto de JPEG (por ejemplo PNG o WebP) → se guarda tal como se entrega, sin convertirla con pérdida.
- Una portada con proporciones raras (apaisada, casi cuadrada) → se guarda igual; no se recorta ni se deforma.
- La migración encuentra una portada cuya dirección devuelve una imagen distinta de la esperada (otro libro) → no hay forma de detectarlo sin la fuente original; se confía en el origen ya validado por el enriquecimiento (feature 002, criterio de aceptación de resultados).
- Se borra la cuenta de un lector → las portadas **no** se borran: son datos bibliográficos públicos del catálogo compartido, no contenido del lector.
- Una copia propia ya existe pero luego una fuente ofrece una versión mejor → no se reemplaza automáticamente en esta versión.
- Falta de espacio de almacenamiento o error al escribir la copia → se trata como fallo de esa portada (reintento acotado); no afecta la importación.

---

## Requirements *(mandatory)*

### Functional Requirements

**Copia propia**

- **FR-001**: Cuando el enriquecimiento de metadatos obtenga la portada de un libro, el sistema DEBE descargar la imagen y guardarla en el almacenamiento propio del proyecto, y la entrada del catálogo DEBE referenciar esa copia propia.
- **FR-002**: Una vez guardada la copia propia, la entrada del catálogo NO DEBE seguir referenciando la dirección externa para mostrar la portada. La fuente y la dirección original se conservan **sólo como registro de procedencia**, nunca para mostrar la imagen.
- **FR-003**: Debe existir **una sola copia por libro del catálogo**, compartida por todos los usuarios. Importaciones simultáneas o repetidas del mismo libro NO DEBEN generar copias duplicadas.
- **FR-004**: El guardado de portadas DEBE ocurrir de forma asincrónica, después de que la importación esté en `done`; NO DEBE retrasar ni cambiar el estado visible de la importación (coherente con FR-019 de la feature 002).

**Calidad**

- **FR-005**: El sistema DEBE elegir, entre las versiones de la portada que ofrece la fuente, la de **mayor resolución disponible**.
- **FR-006**: Si ambas fuentes (Open Library y Google Books) ofrecen portada para el mismo libro, el sistema DEBE usar la de **Open Library**; Google Books es sólo respaldo cuando Open Library no la ofrece. Es el mismo orden de preferencia de la feature 002 (FR-016); la regla de mayor resolución de FR-005 se aplica dentro de la fuente elegida.
- **FR-007**: El archivo guardado DEBE ser **idéntico al entregado por la fuente**: sin recompresión, sin reducción de tamaño y sin conversión con pérdida de calidad.
- **FR-008**: Por cada copia el sistema DEBE registrar su formato, dimensiones en píxeles, tamaño en bytes y una huella de integridad, que permitan verificar la calidad y que la copia no se corrompió.

**Validación y errores**

- **FR-009**: Antes de guardar, el sistema DEBE validar que el contenido descargado es una imagen válida y completa (no truncada), que su tamaño no supera el máximo permitido (10 MB), que su resolución alcanza el mínimo (lado menor ≥ 100 px) y que **no es una imagen de reemplazo** de "portada no disponible" (las fuentes las devuelven con éxito y a veces con tamaño normal, no sólo miniaturas), de modo que un reemplazo nunca se guarde como portada.
- **FR-010**: Ante un error de red, tiempo de espera agotado, límite de tasa o error del servicio externo, el sistema DEBE reintentar con espera creciente (1 s → 2 s → 4 s, máximo 3 reintentos, igual criterio que FR-027 de la feature 002). Agotados los reintentos, el libro queda sin portada.
- **FR-011**: Un fallo al guardar una portada NUNCA DEBE interrumpir ni retrasar la importación, ni el enriquecimiento de los demás libros.
- **FR-012**: Un libro que quedó sin portada por un fallo DEBE volver a intentarse la próxima vez que pase por el enriquecimiento y durante la migración (FR-013).

**Migración de portadas existentes**

- **FR-013**: El sistema DEBE migrar las entradas del catálogo cuya portada esté guardada como dirección externa: descargar la imagen, guardar la copia propia y pasar a referenciarla. La migración DEBE ser **idempotente y reanudable**: ejecutarla varias veces o retomarla tras una interrupción no repite descargas ni duplica copias.
- **FR-014**: Una entrada que no pueda migrarse (imagen ya no disponible o inválida) DEBE quedar sin portada y marcada para reintento posterior, sin detener la migración del resto.

**Acceso y privacidad**

- **FR-015**: Las copias de portadas DEBEN poder ser leídas por cualquier usuario autenticado y escritas **únicamente por el servidor**, con el mismo criterio que el catálogo compartido (Constitución VII, v1.1.1). Ningún usuario puede subir, reemplazar ni borrar portadas.
- **FR-016**: La ruta o el nombre de una copia NO DEBE contener datos de ningún usuario. Las portadas son datos bibliográficos públicos y NO se eliminan al borrar la cuenta de un lector.
- **FR-017**: Mientras un libro no tenga copia propia, el sistema NO DEBE servir su portada desde el servicio externo: el libro se muestra en el estado "sin portada" hasta que la copia exista.
- **FR-018**: El sistema DEBE minimizar las copias de contenido de Google Books: sólo guarda una portada de Google Books cuando Open Library no ofrece ninguna para ese libro. El orden de preferencia es Open Library primero y Google Books como respaldo.

### Key Entities *(include if feature involves data)*

- **Portada propia**: copia de la imagen de portada de un libro del catálogo, guardada en el almacenamiento del proyecto. Atributos: archivo, formato, ancho y alto en píxeles, tamaño en bytes, huella de integridad, fuente de origen y dirección original (sólo procedencia), fecha de guardado. Relación: una por libro del catálogo, como máximo.
- **Libro del catálogo** (`book_catalog`, ya existe): pasa de guardar la dirección externa de la portada a referenciar su portada propia. Sigue siendo compartido entre usuarios y sin `user_id`.
- **Estado de la portada de un libro**: sin portada / con portada propia / pendiente de reintento. Permite reanudar la migración y reintentar los fallos sin duplicar trabajo.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de los libros nuevos cuya portada está disponible en una fuente quedan con portada como recurso propio, y ninguno referencia una dirección externa para mostrarla.
- **SC-002**: Tras la migración, al menos el 99 % de las portadas que hoy están como dirección externa pasan a copia propia; el resto queda sin portada y en reintento porque la fuente ya no la ofrece. Cero copias duplicadas.
- **SC-003**: En una muestra de 30 libros, la resolución guardada es igual a la mayor que ofrece la fuente en al menos el 95 % de los casos.
- **SC-004**: El 100 % de las copias guardadas es idéntico al archivo entregado por la fuente (misma huella de integridad); ninguna pasó por recompresión ni reducción.
- **SC-005**: Ver la portada de un libro con copia propia no genera ninguna petición a servicios externos.
- **SC-006**: Con fuentes que fallan, tardan o devuelven contenido inválido, el 100 % de las importaciones termina en `done` (o en el error que le corresponda por su archivo, nunca por una portada).
- **SC-007**: Para importaciones de hasta 80 libros, al menos el 80 % de las portadas disponibles quedan guardadas dentro de los 30 segundos posteriores a que la importación muestra `done` (mismo plazo que SC-008 de la feature 002).

---

## Clarifications

### Session 2026-09-21

- Q: ¿Qué portadas se guardan como copia propia? → A: Open Library primero; Google Books sólo como respaldo cuando Open Library no tiene portada del libro (reduce las copias de contenido de Google Books, cuyos términos de uso pueden restringir el almacenamiento propio; la regla de mayor resolución se aplica dentro de la fuente elegida).

## Assumptions

- Esta feature depende del enriquecimiento de metadatos de la feature 002 (`book_catalog`, Open Library y Google Books).
- Las portadas son **datos bibliográficos públicos**, no notas del lector: viven en el catálogo compartido, no llevan `user_id` y no se borran con la cuenta (Constitución I y VII v1.1.1).
- La pantalla que muestra portadas (biblioteca, detalle de libro) es de otras features; esta feature deja el dato disponible como recurso propio. No cambia ninguna pantalla existente.
- No se generan miniaturas ni otros tamaños derivados: se guarda un único archivo maestro con la mejor calidad. Si una pantalla necesitara tamaños menores, los derivará del maestro en una feature posterior.
- El formato esperado es JPEG; si la fuente entrega otro formato (PNG, WebP) se guarda tal cual, sin conversión con pérdida.
- Las fuentes devuelven imágenes de reemplazo (por ejemplo, un "image not available" de 575 × 750 px de Google Books), por lo que el mínimo de resolución por sí solo no las detecta: se reconocen por su huella conocida y por tener casi ningún detalle.
- Límites por defecto: tamaño máximo 10 MB y lado menor mínimo de 100 px. Son valores razonables para portadas de libros y ajustables sin cambiar el comportamiento descripto.
- La migración de portadas existentes corre en segundo plano una vez en el despliegue y puede volver a ejecutarse; no requiere intervención de los lectores. Cada entrada se migra desde la fuente de su portada actual, sin volver a buscar en la otra fuente.
- Los términos de uso de Google Books no se verificaron en esta especificación; se reduce la exposición usándolo sólo como respaldo (FR-018) y conviene revisarlos antes de publicar.
- El espacio de almacenamiento necesario (unos cientos de KB por libro, compartidos entre usuarios) se considera aceptable para el catálogo esperado.
- Reemplazar automáticamente una copia ya guardada cuando una fuente ofrezca una versión mejor queda fuera de esta versión.
