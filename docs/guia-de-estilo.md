# Lectia — guía de estilo

Contrato visual del producto. Los valores de acá son la fuente de verdad; los mockups son la
verificación. Si algo falta, medilo en `mockups/` y agregalo a este documento.

---

## 1. Principio

Papel, no pantalla. Fondos cálidos con trama sutil, texto de alto contraste, **un solo acento**
terracota, bordes finos de 1 px y radios chicos (2–4 px). Sin gradientes decorativos, sin
sombras de color, sin emoji, sin iconos de relleno.

---

## 2. Tokens de color

Se declaran como CSS custom properties en `:root` (claro) y `[data-theme="dark"]` (oscuro).
**Nunca** se escribe un hex suelto en un componente.

### Claro

| Token | Hex | Uso |
|---|---|---|
| `--paper` | `#F6F3EC` | fondo de la app |
| `--raised` | `#EFEAE0` | bloques de papel, portadas, avatar |
| `--card` | `#FFFDF8` | tarjetas, inputs, superficies |
| `--card-2` | `#F9F6F0` | hover de filas, cuerpo del modal |
| `--chip` | `#F1EFE6` | píldoras inactivas, chips |
| `--ink` | `#2A2521` | texto principal, botón primario |
| `--ink-hover` | `#3D3630` | hover del botón primario |
| `--ink-2` | `#6B6259` | texto secundario y metadatos |
| `--on-ink` | `#F8F6F1` | texto sobre `--ink` |
| `--line` | `#E2DCD1` | bordes de tarjeta y barra |
| `--line-2` | `#EFEAE0` | separadores internos |
| `--line-3` | `#DDD6C9` | bordes de botón secundario |
| `--dash` | `#D3CABA` | bordes punteados |
| `--hover-line` | `#C9BFAD` | borde en hover |
| `--cover-line` | `#E0D9CC` | borde de portada |
| `--cover-shadow` | `#E7E0D3` | sombra base de portada |
| `--track` | `#E9E3D8` | rieles de gráfico y barra |
| `--accent` | `#A24A2E` | acento único: kickers, línea de gráfico, activo |
| `--accent-2` | `#7E3720` | hover del acento, enlaces |
| `--ok` | `#2F5D50` | éxito, fechas de lectura |
| `--star` | `#B6ABA0` | favoritos inactivos |
| `--k-bg` / `--k-fg` | `#EDE7DC` / `#6B5B45` | chip de Kindle |
| `--o-bg` / `--o-fg` | `#E4EBE7` / `#3E5F52` | chip de Kobo |
| `--bar` | `rgba(246,243,236,.92)` | barra sticky (con blur 8 px) |
| `--stripe` | `rgba(42,37,33,.032)` | trama de papel |
| `--emboss` / `--emboss-2` | `rgba(42,37,33,.05)` / `.07` | relieve de portadas |
| `--overlay` | `rgba(42,37,33,.42)` | fondo del modal |
| `--drop` | `rgba(42,37,33,.4)` | sombras proyectadas |
| `--selection` | `#EFDCD3` | selección de texto y subrayado del titular |

### Oscuro

| Token | Hex |
|---|---|
| `--paper` | `#191510` |
| `--raised` | `#221D17` |
| `--card` | `#1E1A15` |
| `--card-2` | `#241F19` |
| `--chip` | `#2A241D` |
| `--ink` | `#EFE9DF` |
| `--ink-hover` | `#FFFAF2` |
| `--ink-2` | `#A89D8E` |
| `--on-ink` | `#191510` |
| `--line` | `#302A22` |
| `--line-2` | `#262019` |
| `--line-3` | `#3A332A` |
| `--dash` | `#3F3830` |
| `--hover-line` | `#4A4238` |
| `--cover-line` | `#2E2820` |
| `--cover-shadow` | `#120F0B` |
| `--track` | `#2A241D` |
| `--accent` | `#D98A66` |
| `--accent-2` | `#EBA383` |
| `--ok` | `#7FB49B` |
| `--star` | `#5C5245` |
| `--k-bg` / `--k-fg` | `#2E2618` / `#C9B38C` |
| `--o-bg` / `--o-fg` | `#1C2B24` / `#93C0AA` |
| `--bar` | `rgba(25,21,16,.9)` |
| `--stripe` | `rgba(239,233,223,.05)` |
| `--emboss` / `--emboss-2` | `rgba(0,0,0,.4)` / `.5` |
| `--overlay` | `rgba(9,7,5,.62)` |
| `--drop` | `rgba(0,0,0,.6)` |
| `--selection` | `#4A3225` |

### Implementación con Tailwind v4

```css
/* app/globals.css */
:root, [data-theme="light"] { --paper:#F6F3EC; /* …todos los tokens… */ }
[data-theme="dark"]        { --paper:#191510; /* …todos los tokens… */ }

@theme inline {
  --color-paper: var(--paper);
  --color-raised: var(--raised);
  --color-card: var(--card);
  --color-card-2: var(--card-2);
  --color-chip: var(--chip);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-on-ink: var(--on-ink);
  --color-line: var(--line);
  --color-line-2: var(--line-2);
  --color-line-3: var(--line-3);
  --color-dash: var(--dash);
  --color-track: var(--track);
  --color-accent: var(--accent);
  --color-accent-2: var(--accent-2);
  --color-ok: var(--ok);
  --font-serif: "EB Garamond", Georgia, serif;
  --font-sans: "Instrument Sans", system-ui, sans-serif;
  --font-mono: "Space Grotesk", ui-monospace, monospace;
}
```

Uso: `bg-card border border-line text-ink-2`. El tema se controla con el atributo
`data-theme` en `<html>`, no con la clase `dark:`.

---

## 3. Tipografía

Tres familias, cada una con un trabajo:

| Familia | Pesos | Uso |
|---|---|---|
| **EB Garamond** | 500, 600 | sólo marca: logotipo `Lectia.`, inicial del avatar, título del modal |
| **Instrument Sans** | 400, 500, 600, 700 | interfaz: títulos, cuerpo, botones, citas |
| **Space Grotesk** | 400, 500 | datos: recuentos, fechas, kickers, etiquetas en mayúsculas |

### Escala (escritorio)

| Rol | Tamaño | Peso | Tracking | Familia |
|---|---|---|---|---|
| Titular de login | `clamp(36px, 5.6vw, 60px)` | 700 | `-.04em` | Sans |
| Título de sección (h2) | `clamp(25px, 5vw, 32px)` | 600 | `-.025em` | Sans |
| Título de resultados | `clamp(25px, 4.6vw, 34px)` | 600 | `-.03em` | Sans |
| Título de libro (detalle) | 23–31 px | 600 | `-.028em` | Sans |
| Título de tarjeta | 16–18 px | 500/600 | `-.012em` | Sans |
| Cita de resaltado | `clamp(17.5px, 2.4vw, 21px)` / `1.58` | 400 | `-.008em` | Sans |
| Cuerpo | 15–15,5 px / `1.65` | 400 | — | Sans |
| Cuerpo secundario | 13,5–14,5 px | 400 | — | Sans |
| Dato grande (ficha) | `clamp(28px, 4vw, 36px)` | 600 | `-.03em` | Sans |
| Metadato | 11–12,5 px | 400 | `.03–.08em` | Mono |
| Kicker (mayúsculas) | 10,5–11 px | 500 | `.12–.18em` | Mono |
| Logotipo | 27 px (barra) / 34 px (login) | 600 | `-.01em` | Serif |

### Mobile

Cita 16,5–18 px; título de sección 21 px; etiquetas de la barra inferior 10 px; metadatos
10,5–11 px. Mínimos: cuerpo 13 px, cita 16 px.

`text-wrap: pretty` en párrafos y citas; `text-wrap: balance` en títulos de portada.

---

## 4. Espaciado y layout

- Contenedor: `max-width: 1180px; margin: 0 auto;` con padding lateral
  `clamp(16px, 3vw, 32px)`.
- Padding vertical de sección: `clamp(24px, 4vw, 36px)` arriba, 90 px abajo.
- Escala de gaps: **4 · 6 · 8 · 10 · 12 · 14 · 18 · 20 · 24 · 34 px**.
- Padding de tarjeta: 16–18 px (compacta), `clamp(20px, 2.6vw, 26px)` (bloque).
- Grillas siempre fluidas: `repeat(auto-fit|auto-fill, minmax(min(100%, N), 1fr))`.
- Siempre `display: flex|grid` + `gap`; nunca márgenes entre hermanos ni espaciado por
  espacios en blanco del HTML.

---

## 5. Bordes, radios y sombras

- Bordes: 1 px sólido `--line` (tarjetas), `--line-3` (botón secundario), punteado `--dash`
  (zonas de importar).
- Radios: **2 px** chips y etiquetas · **3 px** botones e inputs rectos · **4 px** tarjetas ·
  **5 px** modal · **999 px** píldoras, buscador e indicadores.
- Sombras:
  - Portada: `0 1px 0 var(--cover-shadow), 3px 3px 0 -1px var(--emboss)`; en hover
    `0 2px 0 var(--cover-shadow), 5px 6px 0 -1px var(--emboss-2)` + `translateY(-3px)`.
  - Modal: `0 24px 60px -20px var(--drop)`.
  - Toast: `0 12px 30px -12px var(--drop)`.
  - Marco de teléfono (sólo mockups): `0 0 0 8px var(--raised), 0 30px 60px -34px var(--drop)`.
- Trama de papel: `repeating-linear-gradient(0deg, var(--stripe) 0 1px, transparent 1px Npx)`
  con `N` = 26 px en superficies grandes, 16 px en portadas medianas, 9 px en miniaturas.

---

## 6. Componentes

### Botón primario
Fondo `--ink`, texto `--on-ink`, borde 1 px `--ink`, radio 3 px, padding `14px 26px`
(52 px de alto en mobile), 14,5–15,5 px peso 500. Hover: fondo `--ink-hover`.

### Botón secundario
Fondo transparente, borde 1 px `--line-3`, texto `--ink-2`, radio 3 px, padding `7–11px 11–18px`.
Hover: borde `--ink`, texto `--ink`. Transición `all .16s ease`.

### Botón terciario
Sin caja: texto `--ink-2` con `text-decoration: underline; text-underline-offset: 3px`.
Hover: `--ink`.

### Píldora de filtro
Radio 999 px, padding `8px 13px`. Inactiva: fondo `--chip`, texto `--ink-2`. Activa: fondo
`--ink`, texto `--on-ink`, peso 500. Recuento adjunto en Mono 11 px. Transición
`background .16s ease, color .16s ease`.

### Zona punteada de importar
`display: inline-flex`, gap 9 px, icono de descarga 14 px, borde 1 px punteado `--dash`,
radio 3 px, texto 13 px `--ink-2`. Hover: borde **sólido** `--ink`, texto `--ink`
(`transition: border-color .16s, color .16s, border-style .16s`). Va después de los filtros,
separada por un divisor de 1 × 20 px en `--line-3`.

### Conmutador de vista (segmentado)
Contenedor con borde 1 px `--line`, radio 3 px, `overflow: hidden`, fondo `--card`. Cada
botón: padding `7px 12px`, 13 px; el segundo con `border-left: 1px solid var(--line)`.
Activo: fondo `--ink`, texto `--on-ink`.

### Pestañas
Fila con `border-bottom: 1px solid var(--line)`; cada pestaña `padding: 9px 14px 12px` y
`margin-bottom: -5px`, con `border-bottom: 2px solid` en `--accent` si está activa y
`transparent` si no. El recuento va al lado en Mono 11,5 px `--ink-2`.

### Input / buscador
Alto 44 px en mobile, `padding: 9px 34px` en escritorio; fondo `--card`, borde 1 px `--line`,
radio 999 px, 13,5–14,5 px. Foco: `border-color: var(--accent)`, sin `outline`. Icono de lupa
como círculo de 10–11 px con borde 1,5 px a la izquierda; botón de limpiar circular de 20–24 px
con fondo `--chip` a la derecha.

### Tarjeta
Fondo `--card`, borde 1 px `--line`, radio 4 px. Entrada con `lecPop .26s ease both`.

### Portada de libro
`aspect-ratio: 2/3` (mosaico) o tamaños fijos 26 × 38 / 38 × 54 / 46 × 68 / 48 × 72 / 78 × 117.
Fondo `--raised` + trama, borde 1 px `--cover-line`, radio 1–2 px. En mosaico lleva origen
arriba, título y autor abajo.

### Chip de origen
Radio 2 px, padding `4px 9px`, Mono 10–11 px, `letter-spacing: .1em`, mayúsculas.
Kindle: `--k-bg`/`--k-fg`. Kobo: `--o-bg`/`--o-fg`. Neutro: `--chip`/`--ink-2`.

### Interruptor de tema
Luna 14 px · pista 46 × 27 px con `box-shadow: inset 0 0 0 1px` y perilla de 22 px · sol 15 px.
La perilla se mueve con `transform: translateX()` en 0,28 s `cubic-bezier(.4,.2,.2,1)`; los
iconos cambian de color en el mismo tiempo.

### Modal
Overlay `--overlay` a pantalla completa, contenido `max-width: 620px; max-height: 82vh`,
fondo `--card`, borde 1 px `--line-3`, radio 5 px. Encabezado y pie separados por bordes de
1 px; cuerpo desplazable con fondo `--card-2`.

### Toast
Fijo abajo y centrado, fondo `--ink`, texto `--on-ink`, radio 3 px, padding `12px 20px`,
13,5 px. Entra con `lecPop .22s`.

### Gráficos
- Barras: ancho fluido, alto 104 px, radio `2px 2px 0 0`, `--accent` con valor > 0 y `--track`
  en cero, `transition: height .3s ease`.
- Línea: área `--track`, trazo `--accent` de 1,8–2 px con `vector-effect: non-scaling-stroke`,
  `viewBox="0 0 100 40"` + `preserveAspectRatio="none"`; los puntos se posicionan en HTML
  (no en el SVG) para que no se deformen.
- Barra horizontal: riel 8–9 px `--track`, radio 999 px, relleno `--accent`.

### Barra inferior (mobile)
Alto ~62 px + indicador de inicio. Fondo `--bar`, borde superior 1 px `--line`. Cinco botones
`flex: 1`, icono 20 px trazo 1,8 px, etiqueta Mono 10 px. Activo en `--accent`, resto `--ink-2`.

---

## 7. Iconografía

SVG de trazo, `viewBox="0 0 24 24"`, `stroke-width` 1,6–2, `stroke-linecap="round"`,
`stroke-linejoin="round"`, `fill="none"`, color por `currentColor`. Tamaños 13 / 14 / 15 / 18 /
20 / 22 px. Sin librerías de iconos con lenguaje propio; si se usa una, se normaliza el trazo.

Inventario en uso: descarga (importar), chevron izquierdo/abajo, copiar, fijar (pin),
tres puntos, libro abierto, líneas (resaltados), marcador (listas), barras (stats), sol, luna,
lupa (círculo + borde), cruz de limpiar.

---

## 8. Movimiento

| Nombre | Definición | Uso |
|---|---|---|
| `lecFade` | `opacity 0→1` + `translateY(10px→0)`, 0,3–0,4 s ease | cambio de sección |
| `lecPop` | `opacity 0→1` + `translateY(8px)` + `scale(.985)`, 0,22–0,3 s ease | tarjetas, toast, modal |
| `lecRise` | `opacity 0→1` + `translateY(16px)`, 0,5–0,6 s | login, en cascada |
| `lecRule` | `scaleX(0→1)` desde la izquierda, 0,6 s `cubic-bezier(.2,.7,.2,1)` | regla del kicker |
| `lecSpin` | `rotate(360deg)`, 0,7 s lineal infinito | spinner de búsqueda |

Transiciones de interacción: 0,16 s para color y borde; 0,18–0,2 s para fondo y transform;
0,28 s para el interruptor de tema; 0,3 s para alto/ancho de gráficos.
Respetar `prefers-reduced-motion: reduce` desactivando las entradas y dejando sólo cambios de color.

---

## 9. Accesibilidad

- Contraste mínimo 4,5:1 en texto y 3:1 en títulos grandes; `--ink-2` sobre `--card` cumple.
- Objetivos táctiles ≥ 44 px en mobile (los botones de acción de las tarjetas usan
  `min-height: 40–42px` dentro de filas densas: no bajar de ahí).
- Foco visible en todo control: borde en `--accent`; no se elimina el foco sin reemplazo.
- Todo icono sin texto lleva `aria-label` (interruptor de tema, copiar, fijar, limpiar).
- Los conmutadores de vista y las pestañas se implementan con roles correctos
  (`role="tablist"`, `aria-selected`, `role="group"` + `aria-pressed`).
- El interruptor de tema no depende del color para comunicar estado: la perilla se mueve.
- Jerarquía de encabezados real: un `h1` por página, `h2` por sección.

---

## 10. Tono de la copia

Español rioplatense, segunda persona, frases cortas y concretas. Se explica el paso siguiente,
no el producto. Ejemplos del prototipo: "Conectá el lector por cable o abrí el archivo desde
iCloud", "Todavía no anotaste nada para leer", "Está en la carpeta oculta .kobo del lector".

Reglas: sin signos de exclamación, sin emoji, sin mayúsculas de énfasis, sin "¡Ups!".
Los errores dicen qué pasó y qué hacer. Los recuentos se escriben con separador de miles
local ("4.512 páginas").
