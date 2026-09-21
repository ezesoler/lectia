# Constitución de Lectia

Versión 1.1.1 · Ratificada 2026-09-11 · Última enmienda 2026-09-21

Este documento manda sobre planes, tareas e implementación. Cuando un plan contradiga un
principio de acá, gana el principio o se enmienda la constitución explícitamente.

---

## Principios

### I. Las notas son del lector

Los resaltados importados son datos del usuario, no del producto. En consecuencia:

- Todo lo que entra tiene que poder salir: exportación completa a Markdown y a JSON, sin
  recortes, sin marcas de agua, sin cuenta paga.
- Nunca se pierde un resaltado: la importación es **aditiva e idempotente**; reimportar el
  mismo archivo no duplica ni borra nada.
- Borrar la cuenta borra los datos de verdad, de forma inmediata y sin período de gracia.

*No negociable.*

### II. Importar tiene que ser trivial

El camino feliz es: conectar el lector, elegir el archivo, ver los resaltados. Nada de
credenciales de Amazon o Kobo, nada de extensiones de navegador, nada de pasos manuales
de limpieza.

- Los dos orígenes (`My Clippings.txt`, `KoboReader.sqlite`) se importan por separado y en
  cualquier orden; el estado de cada uno es visible siempre.
- Un archivo mal formado nunca rompe la importación: se procesa lo válido y se informa
  cuántos registros se descartaron y por qué.
- El parseo ocurre en el servidor. Los archivos originales no se guardan más de lo necesario
  para completar el trabajo y se eliminan al finalizar.

### III. Una sola voz visual

La interfaz es papel: fondos cálidos, texto oscuro de alto contraste, un solo acento terracota,
tramas de papel como única textura.

- Nada de gradientes decorativos, glassmorphism, sombras de colores, emoji en la UI ni iconos
  de relleno. Las ilustraciones, si hacen falta, se piden como material real.
- Tres familias tipográficas y sólo tres: EB Garamond (marca), Instrument Sans (interfaz),
  Space Grotesk (datos y metadatos).
- Tema claro y oscuro son ciudadanos de primera: ninguna pantalla se diseña sólo para uno.
- La fuente de verdad de los valores es `docs/guia-de-estilo.md`. Un color nuevo se agrega ahí
  primero o no existe.

*No negociable.*

### IV. El texto del lector manda en la jerarquía

Un resaltado se lee antes que su metadato. En cualquier vista que muestre resaltados, la cita
es el elemento de mayor tamaño y contraste; libro, autor, página y fecha son secundarios.

- Cuerpo de cita: nunca menos de 16 px en mobile ni de 17,5 px en escritorio.
- Contraste mínimo 4,5:1 para texto y 3:1 para títulos grandes.
- Objetivos táctiles de 44 px como mínimo.

### V. Spec antes que código

Ninguna feature se implementa sin `spec.md` aprobado y `plan.md` derivado.

- Los requisitos se escriben numerados (`FR-001`) y verificables; lo ambiguo se marca
  `[NEEDS CLARIFICATION]` y se resuelve antes de `/tasks`.
- Cada feature declara sus criterios de aceptación en lenguaje de usuario, no de implementación.
- Los cambios de alcance se reflejan en el spec, no sólo en el código.

### VI. Calidad verificable

- TypeScript en modo strict; sin `any` implícito y sin `@ts-ignore` sin comentario que lo justifique.
- Pruebas: unitarias para los parsers y la normalización de datos (Vitest), de integración para
  las rutas de importación y búsqueda, y end-to-end de los tres flujos críticos —entrar,
  importar, buscar— (Playwright).
- Los parsers se prueban con archivos reales de muestra, incluidos casos rotos: recortes en
  otros idiomas, notas sin página, líneas truncadas, base de datos vacía.
- Sin datos falsos en producción: si no hay datos, se muestra el estado vacío diseñado.

### VII. Privacidad por defecto

- Toda tabla de datos de usuario lleva `user_id` y RLS activa; ninguna consulta cruza usuarios.
- Las tablas compartidas (p. ej. el catálogo bibliográfico) sólo contienen datos públicos, nunca
  contenido del usuario; tienen RLS activa, lectura para usuarios autenticados y escritura
  exclusiva del servidor.
- Sin analítica de terceros que reciba contenido de resaltados. Métricas agregadas y anónimas
  solamente.
- Los secretos viven en variables de entorno; nunca en el cliente ni en el repositorio.

### VIII. Fidelidad al mockup

Cada pantalla implementada DEBE ser fiel al mockup correspondiente en `mockups/`.

- El mockup es el criterio de aceptación visual: layout, tipografía, colores, espaciado y
  componentes deben coincidir con lo diseñado antes de considerar una pantalla terminada.
- Cualquier desviación del mockup debe ser explícita y justificada en el `spec.md` o
  `plan.md` de la feature. Sin justificación, la implementación se considera incompleta.
- El orden de revisión es: mockup mobile primero, luego desktop.
- Las pantallas se validan visualmente contra el mockup antes de pasar a `/speckit-tasks`.

*No negociable.*

---

## Restricciones técnicas

- **Stack**: Next.js (App Router) · TypeScript strict · Tailwind v4 · Supabase (Auth Google,
  Postgres con RLS, Storage temporal para la subida).
- **Parseo en servidor** (Route Handlers o Server Actions). El cliente sólo sube el archivo y
  escucha el progreso.
- Sin librerías de componentes que traigan su propio lenguaje visual. Primitivas accesibles
  sin estilo (Radix o equivalente) sí, con los tokens propios encima.
- Sin dependencias nuevas sin justificación escrita en el `plan.md` correspondiente.

## Flujo de trabajo

1. `/specify` → `spec.md` (qué y por qué, sin tecnología).
2. `/plan` → `plan.md` (cómo, con el stack de arriba).
3. `/tasks` → `tasks.md` (tareas chicas, verificables, ordenadas).
4. Implementación con pruebas en el mismo commit que el código que cubren.
5. Revisión contra esta constitución, contra `docs/guia-de-estilo.md` y contra el mockup correspondiente.

## Gobernanza

Las enmiendas requieren: la razón del cambio, el impacto en los specs vigentes y un bump de
versión semántico (mayor para quitar o redefinir un principio, menor para agregar uno,
parche para redacción). Los principios marcados *no negociable* sólo se enmiendan con
justificación escrita en el commit.
