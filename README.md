# Lectia — paquete de traspaso a código

Gestor de notas de ebooks: unifica los resaltados de **Kindle** y **Kobo**, permite buscarlos,
organizarlos en listas y exportarlos a Markdown.

Este paquete existe para arrancar el desarrollo con **Spec Kit** (spec-driven development) sobre
**Next.js (App Router) + TypeScript + Tailwind** y **Supabase** (auth con Google + Postgres).

---

## Qué hay acá

```
lectia-handoff/
├── README.md                      ← este archivo
├── .specify/
│   └── memory/
│       └── constitution.md        ← principios del proyecto (Spec Kit)
├── docs/
│   ├── funcionalidades.md         ← TODAS las funcionalidades del producto, sección por sección
│   ├── guia-de-estilo.md          ← tokens, tipografía, componentes, estados, accesibilidad
│   └── modelo-de-datos.md         ← entidades, esquema Postgres, RLS, contratos de API
├── specs/                         ← fase 1 del MVP, formato Spec Kit
│   ├── 001-auth-google/spec.md
│   ├── 002-importacion-kindle-kobo/spec.md
│   └── 003-busqueda-global/spec.md
└── mockups/
    ├── index.html                 ← índice de la referencia gráfica (abrí este primero)
    ├── desktop/lectia-desktop.html    ← prototipo navegable, todas las secciones
    └── mobile/01..08-*.html           ← una pantalla por archivo, 390 × 844
```

## Los mockups son referencia, no código de producción

Los archivos de `mockups/` son **prototipos HTML de alta fidelidad**: colores, tipografía,
espaciado y estados finales. Sirven para medir, copiar valores exactos y entender el
comportamiento esperado.

**No se portan tal cual.** La tarea es reconstruirlos en Next.js con componentes React y
Tailwind, siguiendo `docs/guia-de-estilo.md`. Todo el estilo de los mockups está en atributos
`style` inline (es el formato del prototipo, no una recomendación); en el código real va a
clases de Tailwind sobre los tokens declarados en la guía.

- **`mockups/desktop/lectia-desktop.html`** es un único archivo autocontenido e **interactivo**:
  se navega entre secciones, se cambia el tema, se abren libros, se filtra y se exporta.
  Es la fuente de verdad para hovers, transiciones y flujos.
- **`mockups/desktop/01..08-*.html`** abren esa misma app directamente en una sección
  (login, importar, inicio, detalle, resaltados, listas, estadísticas, búsqueda), para revisar
  una pantalla sin tener que navegar hasta ella. Siguen siendo interactivas. Internamente usan
  el parámetro `?s=` del archivo grande: `lectia-desktop.html?s=stats`,
  `?s=book&book=aurelio`, `?s=search&q=Murakami`, y `&theme=dark` para el tema oscuro.
- **`mockups/estados-importar/*.html`** cubren los tres desenlaces de una importación fallida:
  error de formato, error genérico e importación parcial. Cada archivo trae la versión de
  escritorio, la de mobile y las notas de implementación del estado.
- **`mockups/mobile/*.html`** son estáticos, una pantalla por archivo, a 390 × 844 (iPhone 14).
  Muestran los patrones mobile: barra inferior de cinco destinos, buscador de ancho completo,
  filtros en fila deslizable, lectura en una sola columna.

Fidelidad: **hi-fi**. Si un valor no está en la guía de estilo, medilo en el mockup.

---

## Cómo usar esto con Spec Kit

1. Inicializá el proyecto (`specify init` o el flujo que uses) y copiá
   `.specify/memory/constitution.md` a la raíz de tu repo, en la misma ruta.
2. Copiá `docs/` y `mockups/` al repo (sugerencia: `docs/design/` y `docs/design/mockups/`).
   Los specs referencian esas rutas.
3. Corré `/specify` por feature usando los `spec.md` de `specs/` como punto de partida:
   están escritos en el formato de Spec Kit (escenarios, requisitos funcionales numerados,
   entidades, criterios de aceptación) y marcan con `[NEEDS CLARIFICATION]` lo que falta decidir.
4. Después de cada `/specify`, corré `/plan` indicando: Next.js 15 App Router, TypeScript strict,
   Tailwind v4, Supabase (auth + Postgres + Storage), parseo de archivos **en el servidor**
   (Route Handlers / Server Actions), Vitest + Playwright.
5. `/tasks` e implementación. Mantené `docs/guia-de-estilo.md` como contrato visual: cualquier
   componente nuevo se construye con esos tokens.

### Fase 1 (lo que cubren los specs)

| # | Feature | Spec |
|---|---|---|
| 001 | Entrada con Google (auth + sesión + tema persistente) | `specs/001-auth-google/spec.md` |
| 002 | Importación de Kindle y Kobo (parseo en servidor) | `specs/002-importacion-kindle-kobo/spec.md` |
| 003 | Búsqueda global (catálogo, autores, resaltados) | `specs/003-busqueda-global/spec.md` |

Fases siguientes, ya documentadas en `docs/funcionalidades.md` pero sin spec todavía:
biblioteca, detalle del libro, listas, estadísticas, exportación a Markdown, responsive mobile.

---

## Decisiones ya tomadas

| Decisión | Valor |
|---|---|
| Framework | Next.js (App Router) + TypeScript strict |
| Estilos | Tailwind v4 sobre CSS custom properties (tokens de la guía) |
| Auth | Supabase Auth con proveedor Google (OAuth) |
| Base de datos | Supabase Postgres con RLS por `user_id` |
| Parseo de `My Clippings.txt` y `KoboReader.sqlite` | **En el servidor** |
| Idioma de la UI | Español rioplatense (voseo suave, sin imperativos duros) |
| Tema | Claro y oscuro, ambos de primera clase |

## Fuera de alcance del MVP

Sincronización automática con el lector, apps nativas, compartir resaltados en público,
anotaciones colaborativas, OCR de libros en papel, recomendaciones algorítmicas.

---

## Pruebas

| Tipo | Comando | Requisitos |
|---|---|---|
| Unitarias (Vitest) | `npm test` | ninguno |
| Integración (rutas, `import_batch`, RLS, enriquecimiento) | `npm run test:integration` | Docker + Supabase local |
| End-to-end (Playwright, mobile y desktop) | `npx playwright test` | Docker + Supabase local |

**Supabase local** (una vez): `npx supabase start` y copiar las claves de `npx supabase status -o env`
a `.env.test.local` con los nombres `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` (archivo ignorado por git). Las migraciones de `supabase/migrations/` se
aplican solas; `npx supabase db reset` las reaplica desde cero. Sin ese archivo, las suites de
integración y los e2e autenticados se omiten.

Con `.env.test.local` presente, los e2e levantan su propio servidor en `:3100` (directorio de build
`.next-e2e`, enriquecimiento externo desactivado) y no pisan un `next dev` abierto contra el proyecto real.
Las pruebas `*.real.test.ts` leen los archivos personales de `docs/files imports/` (ignorada por git) y
se omiten si no están.
