# Lectia — funcionalidades

Inventario completo del producto tal como está diseñado en los mockups. Cada sección describe
qué hace el usuario, qué ve, qué estados existen y qué reglas aplican.

Referencia gráfica: `mockups/desktop/lectia-desktop.html` (navegable) y `mockups/mobile/*.html`.

---

## 0. Arquitectura de la aplicación

Seis destinos más dos vistas de profundidad:

| Destino | Ruta sugerida | Entrada |
|---|---|---|
| Login | `/entrar` | usuario sin sesión |
| Importar | `/importar` | primer ingreso, o botón desde Resaltados/Inicio |
| Inicio (biblioteca) | `/` | después de importar |
| Resaltados | `/resaltados` | nav |
| Listas | `/listas` | nav |
| Estadísticas | `/estadisticas` | nav |
| Resultados de búsqueda | `/buscar?q=` | escribir en el buscador global |
| Detalle del libro | `/libro/[id]` | tocar un libro |

### Barra superior (escritorio)

Una sola barra, `sticky top-0`, fondo translúcido con `backdrop-filter: blur(8px)` y borde
inferior. Tres bloques:

1. **Izquierda**: logotipo `Lectia.` (vuelve a Inicio) + navegación en píldoras.
2. **Centro**: buscador global, ancho flexible con máximo de 420 px, centrado con `margin: 0 auto`.
3. **Derecha**: interruptor de tema (luna · switch · sol) + avatar circular con la inicial.

En la sección Importar la barra es idéntica y agrega el kicker "Paso 1 de 1 · Importar" sobre
el contenido.

### Barra inferior (mobile)

Reemplaza la navegación en píldoras: cinco destinos —Inicio, Resaltados, Listas, Stats,
Importar— con icono de 20 px y etiqueta de 10 px. El destino activo va en color de acento.
El buscador pasa a ser un campo de ancho completo debajo del logotipo. El detalle del libro
oculta la barra inferior y muestra la acción "Exportar a Markdown" fija abajo.

---

## 1. Login

**Objetivo**: entrar con Google, sin contraseñas nuevas.

- Escritorio: dos columnas (`repeat(auto-fit, minmax(min(100%, 400px), 1fr))`). Izquierda es
  papel con trama y contiene marca, kicker "Kindle + Kobo", titular de tres líneas con la
  última resaltada, y el párrafo de propuesta de valor. Derecha, la tarjeta de acceso.
- Mobile: el bloque de papel arriba, el acceso abajo, todo en una columna.
- Un único botón: **Continuar con Google** (alto 52 px, fondo `--ink`).
- El interruptor de tema está disponible antes de iniciar sesión y su elección se conserva.

**Estados**: normal · cargando (spinner en el botón, botón deshabilitado) · error de OAuth
(mensaje bajo el botón, tono neutro, acción para reintentar).

**Reglas**
- Sesión persistente; al volver, el usuario cae en Inicio.
- Si el usuario no tiene ningún libro importado, la app lo lleva a Importar.

---

## 2. Importar

**Objetivo**: cargar los resaltados del lector en una sola pasada.

Dos tarjetas independientes, una por origen, en grilla de `minmax(min(100%, 292px), 1fr)`:

### Kindle
- Archivo esperado: `My Clippings.txt` (raíz del lector, carpeta `documents`).
- Zona de arrastre con borde punteado; al pasar por encima, el borde pasa a sólido.
- En mobile no hay arrastre: botón **Elegir archivo** de 46 px.

### Kobo
- Archivo esperado: `KoboReader.sqlite` (carpeta oculta `.kobo`).
- Mismo comportamiento; la ayuda menciona explícitamente que la carpeta está oculta.

**Estados por tarjeta**
| Estado | Qué se ve |
|---|---|
| `idle` | zona punteada, icono de descarga, texto de instrucción, botón de archivo |
| `parsing` | barra de progreso con porcentaje y recuento parcial |
| `done` | chip con fondo `--chip`: "N libros · M resaltados" + etiqueta "listo" en `--ok` |
| `error` | mensaje de qué falló, cuántos registros se descartaron, acción para reintentar |

**Pie de la sección**: sólo el botón primario **Ver mi biblioteca**, alineado a la derecha,
habilitado cuando al menos un origen terminó bien.

**Reglas**
- Los dos orígenes son independientes y se pueden importar en cualquier orden.
- Importación **idempotente**: la clave de deduplicación es
  `(user_id, book_id, texto_normalizado, ubicacion)`. Reimportar no duplica.
- Un registro inválido no aborta el lote; se cuenta y se informa.
- Los archivos subidos se eliminan del almacenamiento temporal al terminar el trabajo.
- Un mismo libro puede llegar por los dos orígenes: se funde por título + autor normalizados
  y conserva el origen de cada resaltado.

---

## 3. Inicio · biblioteca

**Objetivo**: ver todos los libros con resaltados y entrar a uno.

- **Sección "Leyendo ahora"** (si hay libros en la lista *Leyendo*): tarjetas horizontales en
  grilla de `minmax(min(100%, 400px), 1fr)` con portada, título, autor y recuento.
- **Fila de utilidades**: filtros por origen en píldoras con recuento (Todos · Kindle · Kobo),
  divisor vertical, y **zona punteada "Importar de Kindle o Kobo"** que lleva a Importar;
  a la derecha, orden (`Importados recién` · `Título A–Z` · `Más notas`) y conmutador de
  vista **Mosaico / Lista**.
- **Mosaico**: grilla `repeat(auto-fill, minmax(148px, 1fr))`, portada en `aspect-ratio: 2/3`
  con trama de papel, origen arriba, título y autor abajo; al hover la portada sube 3 px y la
  sombra crece. Debajo de la portada, título y recuento de resaltados.
- **Lista**: contenedor único con filas de 1 px de separación: portada 38 × 54, título 18 px,
  autor, chip de origen, recuento, fecha de importación y flecha.
- Mobile: mosaico de dos columnas; los filtros pasan a fila deslizable.

**Estados**: con libros · sin libros (estado vacío con acción a Importar) · filtro sin
resultados (mensaje y acción para limpiar el filtro).

---

## 4. Detalle del libro

**Objetivo**: leer y trabajar los resaltados de un libro.

- Encabezado: portada grande con trama, chip de origen, título, autor, y métricas
  (resaltados, notas, páginas).
- Acciones: **Exportar a Markdown**, favorito, menú de más opciones.
- Filtros de contenido en píldoras: `Todo` · `Resaltados` · `Notas` · `Favoritos`.
- Lista de notas en **papel continuo** (separadores de 1 px, sin tarjetas) o en **tarjetas**,
  según preferencia. Cada entrada: cita a 17,5–21 px, metadato "Pág. N · fecha" y acciones de
  copiar y fijar. Las notas propias llevan chip "Nota".
- Mobile: una columna, cita a 18 px, acción de exportar fija al pie.

**Estados**: con resaltados · libro sin resaltados ("Este libro todavía no tiene resaltados.")
· filtro sin resultados.

**Interacciones**
- Copiar muestra un *toast* inferior ("Resaltado copiado") de 12 px de alto interno,
  fondo `--ink`, que desaparece a los 2,5 s.
- Fijar marca el resaltado como favorito; el icono pasa a `--accent`.

---

## 5. Resaltados

**Objetivo**: todos los resaltados de todos los libros, en un solo lugar.

- Buscador propio de la sección ("Buscar en tus resaltados…") que filtra por texto de la cita,
  título y autor.
- Filtros por origen (Todos · Kindle · Kobo) y, **sólo cuando no hay búsqueda activa**, la zona
  punteada de importar al final de la fila, separada por un divisor vertical.
- Recuento: "N resaltados · M libros".
- Tarjetas de resaltado: cita a 16,5 px, separador, miniatura de portada 26 × 38, título del
  libro y metadato "autor · pág. N · origen".
- Al buscar: recuento de coincidencias y resaltado del término; estado vacío con sugerencias
  clicables.

---

## 6. Listas

**Objetivo**: organizar lecturas pendientes, en curso y terminadas.

- Tres pestañas con recuento: **Deseo leer** · **Leyendo** · **Leídos**.
- Conmutador de vista **Tarjetas / Listado** al final de la fila de pestañas.
- **Tarjetas**: grilla `repeat(auto-fill, minmax(min(100%, 330px), 1fr))`; portada 48 × 72,
  título, autor, metadato "año · páginas · género", fecha de lectura en `--ok` si existe,
  enlace a los resaltados del libro si los tiene, y acciones según la pestaña.
- **Listado**: filas compactas dentro de un contenedor único, con las mismas acciones en línea.
- Acciones por pestaña:
  | Pestaña | Acción 1 | Acción 2 | Terciaria |
  |---|---|---|---|
  | Deseo leer | Empezar a leer | Ya lo leí | Quitar |
  | Leyendo | Ya lo leí | Volver a deseo leer | Quitar |
  | Leídos | Releer | Mover a deseo leer | Quitar |
- Orden: *Leídos* por fecha de lectura descendente; las otras dos alfabéticas por título.
- Las tarjetas **no** muestran chip de idioma: el idioma sólo aparece en resultados de búsqueda,
  donde sirve para decidir.

**Estados vacíos** (texto exacto por pestaña)
- Deseo leer: "Todavía no anotaste nada para leer."
- Leyendo: "No estás leyendo nada ahora mismo."
- Leídos: "Cuando termines un libro va a aparecer acá."
Cada uno con el botón **Buscar libros**.

---

## 7. Estadísticas

**Objetivo**: ver el hábito de lectura sin gamificación.

Dos bloques con encabezado de sección (kicker en acento + regla horizontal):

### Lectura
- Cuatro fichas: libros leídos, páginas leídas, meses de racha, autores distintos.
- **Libros por mes** (últimos 12 meses) con conmutador **Barras / Línea**:
  - *Barras*: columnas de 104 px de alto, valor arriba, mes abajo; los meses en cero se ven
    como riel `--track`.
  - *Línea*: área rellena en `--track`, línea de 1,8 px en `--accent` con trazo no escalado,
    punto por mes (7 px, relleno `--card`, borde de acento) y valor sobre el punto; los meses
    en cero no muestran número.
- **Géneros leídos**: barras horizontales proporcionales al máximo.
- **Autores más leídos**: ranking con número, nombre y recuento.

### Resaltados
- Tres fichas: resaltados guardados, libros con resaltados, promedio por libro.
- Libros más resaltados, con barra proporcional.

**Reglas**
- La racha cuenta meses consecutivos con al menos un libro terminado, hacia atrás desde el mes
  actual; el mes en curso no rompe la racha si está en cero.
- Sin datos suficientes, cada tarjeta muestra su propio estado vacío; nunca se inventan números.

---

## 8. Búsqueda global

**Objetivo**: encontrar cualquier cosa —un libro del catálogo, un autor, un resaltado propio—
desde un solo campo.

- Campo en la barra superior, presente en todas las secciones.
- Al escribir: navegación a la página de resultados con estado de carga (spinner + esqueletos y
  la leyenda "Buscando en Open Library y Google Books…").
- Encabezado de resultados: consulta como título, subtítulo con recuentos
  ("N libros en el catálogo · M autores · K resaltados") y acción **Limpiar búsqueda**.
- **Ficha de autor** cuando la consulta coincide con un autor: inicial en círculo, nombre y
  línea "Autor · N libros · M en tus listas".
- **Filtros**: Todos · En español · En mis listas · Con mis resaltados. **Orden**: relevante ·
  reciente · A–Z.
- **Tarjetas de resultado**: portada, título (y título original si difiere), autor y año,
  chip de idioma (ES/EN/…), y acciones **Deseo leer** / **Ya lo leí**; si ya está en una lista,
  se muestra el estado ("En deseo leer") y la acción **Quitar**.
- **Resaltados propios coincidentes** en bloque aparte, con recuento.
- Estados: cargando · con resultados · filtrado sin resultados (mensaje + limpiar filtro) ·
  sin resultados (sugerencias clicables).

**Reglas**
- Búsqueda por título, título original y autor; sin distinguir mayúsculas ni acentos.
- Debounce de 300 ms; la consulta vive en la URL (`/buscar?q=`) para poder compartirla.
- Agregar a una lista desde resultados crea el libro en el catálogo del usuario si no existía.

---

## 9. Exportación a Markdown

- Se abre desde el detalle del libro (y desde el menú del libro en la biblioteca).
- Modal centrado, máximo 620 px de ancho, 82 vh de alto: encabezado con el nombre de archivo
  sugerido, cuerpo con vista previa monoespaciada del Markdown, pie con recuento y dos
  acciones: **Copiar** y **Descargar .md**.
- Formato: título como `#`, autor en línea de metadatos, cada resaltado como cita `>` con
  `— pág. N, fecha`; las notas propias como párrafo con prefijo `**Nota:**`.
- Nombre de archivo: `titulo-normalizado.md`.

---

## 10. Tema claro / oscuro

- Interruptor visible en la barra superior de todas las secciones y en Login: luna, switch de
  46 × 27 px con perilla de 22 px, sol. Transiciones de 0,28 s con `cubic-bezier(.4,.2,.2,1)`.
- La elección se guarda por usuario y se respeta en el primer render (sin destello).
- Por defecto sigue la preferencia del sistema.

---

## 11. Comportamiento responsive

| Ancho | Comportamiento |
|---|---|
| ≥ 1180 px | contenido centrado con `max-width: 1180px` |
| 768–1180 px | grillas reflowean por `auto-fit`; la barra superior mantiene los tres bloques |
| < 768 px | patrones mobile: barra inferior de cinco destinos, buscador de ancho completo, filtros deslizables, biblioteca en dos columnas, lectura en una columna |

Los mockups mobile son la referencia para el segundo caso. Nada de anchos fijos fuera de los
marcos de dispositivo: todo con `max-width`, `minmax(0, 1fr)` y `flex-wrap`.

---

## 12. Estado de la aplicación

Variables que el prototipo maneja y que la implementación necesita, agrupadas:

- **Sesión**: usuario, tema.
- **Navegación**: sección activa, `bookId` abierto, consulta de búsqueda.
- **Biblioteca**: filtro de origen (`all|kindle|kobo`), orden (`recent|title|notes`),
  vista (`grid|list`).
- **Detalle**: filtro de notas (`all|hl|note|fav`), favoritos por nota, modal de exportación.
- **Resaltados**: consulta local, filtro de origen.
- **Listas**: pestaña activa (`want|reading|read`), vista (`cards|rows`), mapa libro → lista.
- **Estadísticas**: tipo de gráfico de meses (`bars|line`).
- **Importación**: estado y progreso por origen (`idle|parsing|done|error`).
- **Efímero**: toast (mensaje + temporizador).
