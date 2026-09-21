# Tasks: Entrada con Google

**Input**: Design documents from `specs/001-auth-google/`

**Nota sobre pruebas**: La constitución exige e2e para los tres flujos críticos (entrar,
importar, buscar). Esta feature cubre "entrar" — se incluyen pruebas Playwright para los
flujos de acceso y unitarias para la lógica de tema (Vitest).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: Historia de usuario a la que pertenece la tarea (US1–US6)

---

## Phase 1: Setup (Infraestructura compartida)

**Propósito**: Inicializar el proyecto y la estructura de carpetas definida en `plan.md`.

- [X] T001 Inicializar proyecto Next.js 15 con App Router y TypeScript strict en `tsconfig.json` (`"strict": true`, sin `any` implícito)
- [X] T002 Instalar dependencias: `@supabase/supabase-js`, `@supabase/ssr`, `tailwindcss@next`, `vitest`, `@playwright/test`
- [X] T003 [P] Crear `app/globals.css` con CSS custom properties de los tokens de `docs/guia-de-estilo.md` y bloque `@theme inline` para Tailwind v4
- [X] T004 [P] Crear `.env.local.example` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [X] T005 [P] Configurar `vitest.config.ts` con entorno `jsdom` y `playwright.config.ts` apuntando a `http://localhost:3000`

**Checkpoint**: Proyecto arranca en `localhost:3000` con tokens de color aplicados.

---

## Phase 2: Foundational (Prerequisitos bloqueantes)

**Propósito**: Base técnica que DEBE completarse antes de cualquier historia de usuario.

**⚠️ CRÍTICO**: Ninguna historia puede comenzar hasta que esta fase esté completa.

- [X] T006 Crear `lib/supabase/client.ts` exportando `createBrowserClient` de `@supabase/ssr` para componentes cliente
- [X] T007 [P] Crear `lib/supabase/server.ts` exportando `createServerClient` de `@supabase/ssr` usando cookies de Next.js para Server Components y Route Handlers
- [X] T008 Escribir y aplicar migración SQL: tabla `profiles` (esquema de `data-model.md`) + política RLS `"own profile"` + trigger `on_auth_user_created` (función `handle_new_user`)
- [X] T009 Crear `middleware.ts` en la raíz: refresca sesión Supabase en cada request; redirige a `/login` cualquier ruta fuera de `/login` y `/auth/callback` si no hay sesión activa
- [X] T010 [P] Crear `app/(app)/layout.tsx`: layout protegido que verifica sesión con `createServerClient` y redirige a `/login` si no existe (doble guarda server-side)

**Checkpoint**: Navegar a cualquier ruta interna sin sesión redirige a `/login`.

---

## Phase 3: US1 — Nuevo lector entra con Google (P1) 🎯 MVP

**Goal**: Un usuario nuevo completa el acceso con Google y llega a `/importar` en menos de tres toques; su perfil queda creado en `profiles`.

**Independent Test**: Escenarios 1 y 2 de `quickstart.md`.

### Pruebas — US1

- [X] T011 [P] [US1] Crear prueba e2e del flujo de usuario nuevo en `tests/e2e/auth-new-user.spec.ts` (verificar: redirección a `/login` sin sesión, botón único, carga post-login en `/importar`, fila en `profiles`)

### Implementación — US1

- [X] T012 [US1] Crear `app/(auth)/login/page.tsx`: pantalla de acceso con propuesta de valor y botón "Continuar con Google" que llama a `supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: '/auth/callback' })`
- [X] T013 [P] [US1] Crear `app/auth/callback/route.ts`: Route Handler GET que intercambia `code` por sesión con `supabase.auth.exchangeCodeForSession(code)` y redirige según `next` param
- [X] T014 [US1] Agregar lógica post-login en `app/auth/callback/route.ts`: consulta `count(*) from books where user_id = auth.uid()` y redirige a `/importar` (0 libros) o `/` (≥1 libro)
- [X] T015 [US1] Implementar estado de carga en el botón de `app/(auth)/login/page.tsx`: deshabilitar el botón mientras la autenticación está en curso (FR-008), usando estado local con `useState`

**Checkpoint**: Nuevo usuario completa el flujo Google → `/importar`. Perfil existe en `profiles`.

---

## Phase 4: US2 — Sesión persistente y protección de rutas (P1)

**Goal**: El usuario existente entra directo a `/` sin pasar por `/login`; ninguna ruta interna es accesible sin sesión.

**Independent Test**: Escenarios 3 y 7 de `quickstart.md`.

### Pruebas — US2

- [X] T016 [P] [US2] Crear prueba e2e de sesión persistente en `tests/e2e/auth-session.spec.ts` (verificar: reload no redirige a login; acceso directo a rutas internas sin sesión redirige a `/login`)

### Implementación — US2

- [X] T017 [US2] Completar lógica de refresco de token en `middleware.ts`: usar `supabase.auth.getUser()` para validar sesión y propagar cookies actualizadas en la respuesta
- [X] T018 [US2] Definir `config.matcher` en `middleware.ts` para excluir `_next/static`, `_next/image`, `favicon.ico` y archivos estáticos del middleware

**Checkpoint**: Recargar la app con sesión no redirige a login. Sin sesión, toda URL interna va a `/login`.

---

## Phase 5: US3 — Preferencia de tema sin destello (P2)

**Goal**: El usuario puede elegir claro/oscuro antes o después del login; la preferencia se aplica en el primer render sin parpadeo de tema incorrecto.

**Independent Test**: Escenario 5 de `quickstart.md`.

### Pruebas — US3

- [X] T019 [P] [US3] Crear prueba unitaria de resolución de tema en `tests/unit/theme.test.ts` con Vitest: verificar que la función lee `localStorage`, devuelve `system`/`light`/`dark` y nunca valores inválidos

### Implementación — US3

- [X] T020 [US3] Agregar script inline bloqueante en `<head>` de `app/layout.tsx`: lee `localStorage.getItem('theme')` y aplica `data-theme` en `<html>` antes del primer paint; fallback a `system` si no hay valor o es inválido (FR-007)
- [X] T021 [P] [US3] Crear `components/theme-switch.tsx`: interruptor luna/sol de 46×27 px según especificación de `docs/guia-de-estilo.md §6`; operable por teclado con `aria-label` descriptivo (NFR-004)
- [X] T022 [US3] Implementar `PATCH /api/profile` en `app/api/profile/route.ts`: valida `theme` ∈ `{light,dark,system}`, actualiza `profiles.theme`, setea cookie `theme` (SameSite: Lax) para SSR
- [X] T023 [US3] Conectar `theme-switch.tsx` al handler: al cambiar el tema actualizar `document.documentElement.dataset.theme`, `localStorage.theme` y llamar a `PATCH /api/profile` (FR-006)

**Checkpoint**: Cambiar el tema, recargar → mismo tema, sin destello. Valor persistido en `profiles.theme`.

---

## Phase 6: US4 — Manejo de errores y cancelación (P2)

**Goal**: Al cancelar en Google o ante un fallo de autenticación, la pantalla de acceso queda operativa sin estados colgados ni mensajes alarmantes.

**Independent Test**: Escenario 4 de `quickstart.md`.

### Pruebas — US4

- [X] T024 [P] [US4] Crear prueba e2e de cancelación en `tests/e2e/auth-cancel.spec.ts`: simular `error=access_denied` en la URL de callback y verificar que `/login` queda operativo

### Implementación — US4

- [X] T025 [US4] Manejar `error` y `error_description` en `app/auth/callback/route.ts`: redirigir a `/login` sin parámetro de error en cancelación; redirigir a `/login?error=auth_failed` ante fallo técnico
- [X] T026 [US4] Mostrar mensaje de error en `app/(auth)/login/page.tsx` cuando existe `?error=auth_failed` en la URL: texto en español rioplatense que explica qué pasó y ofrece reintentar; sin "¡Ups!" ni lenguaje alarmante (tono de `docs/guia-de-estilo.md §10`)

**Checkpoint**: Cancelar en Google devuelve a `/login` con botón listo para reintentar; sin estados colgados ni spinners.

---

## Phase 7: US5 — Cierre de sesión (P2)

**Goal**: El usuario puede cerrar sesión desde el avatar de la barra superior y sus datos permanecen intactos.

**Independent Test**: Escenario 6 de `quickstart.md`.

### Pruebas — US5

- [X] T027 [P] [US5] Crear prueba e2e de cierre de sesión en `tests/e2e/auth-signout.spec.ts`: verificar redirección a `/login` y que los datos persisten al volver a entrar

### Implementación — US5

- [X] T028 [US5] Crear `components/top-bar.tsx`: barra superior con avatar del usuario (nombre/inicial) y opción "Cerrar sesión" accesible; sólo visible en rutas protegidas (dentro de `app/(app)/`)
- [X] T029 [US5] Implementar Server Action o Route Handler de sign-out: llama a `supabase.auth.signOut()`, invalida cookies de sesión y redirige a `/login` (FR-010)

**Checkpoint**: Clic en "Cerrar sesión" → `/login`. Volver a entrar muestra los mismos datos.

---

## Phase 8: US6 — Borrado de cuenta (P3)

**Goal**: El usuario puede eliminar su cuenta y todos sus datos de forma inmediata e irreversible.

**Independent Test**: Escenario 8 de `quickstart.md`.

### Pruebas — US6

- [X] T030 [P] [US6] Crear prueba e2e de borrado de cuenta en `tests/e2e/auth-delete-account.spec.ts`: verificar `204`, invalidación de sesión, ausencia de fila en `auth.users` y re-registro limpio

### Implementación — US6

- [X] T031 [US6] Agregar lógica `DELETE /api/profile` en `app/api/profile/route.ts`: (1) listar y borrar archivos en Storage `imports/{user_id}/`; (2) llamar a `supabase.auth.admin.deleteUser(userId)` con `service_role` key; (3) devolver `204` (FR-012)
- [X] T032 [US6] Agregar UI de borrado de cuenta (botón con confirmación explícita) en la pantalla de ajustes/perfil dentro de `app/(app)/`; llamar a `DELETE /api/profile` y redirigir a `/login` tras la respuesta

**Checkpoint**: Borrar cuenta → `/login`. Acceder a Supabase: no existe el usuario en `auth.users` ni en `profiles`.

---

## Phase Final: Polish y requisitos no funcionales

**Propósito**: Verificar NFRs y accesibilidad antes de dar la feature por terminada.

- [X] T033 [P] Verificar NFR-001: pantalla `/login` usable a 390 px sin scroll horizontal — ajustar `app/(auth)/login/page.tsx` si hace falta
- [X] T034 [P] Verificar NFR-002: objetivo táctil del botón "Continuar con Google" ≥ 44 px (52 px objetivo) en `app/(auth)/login/page.tsx`
- [X] T035 [P] Verificar NFR-003: contraste ≥ 4,5:1 en texto y ≥ 3:1 en titular en tema claro y oscuro usando los tokens de `docs/guia-de-estilo.md`
- [X] T036 Verificar NFR-004: `theme-switch.tsx` tiene `aria-label` descriptivo, responde a teclado (Enter/Space) y el foco es visible con borde en `--accent`
- [ ] T037 Correr todos los escenarios de `specs/001-auth-google/quickstart.md` y marcar cada uno como pasado

---

## Dependencies & Execution Order

### Dependencias de fase

- **Phase 1 (Setup)**: Sin dependencias — empezar de inmediato
- **Phase 2 (Foundational)**: Depende de Phase 1 — **bloquea todas las historias**
- **Phase 3–8 (US1–US6)**: Todas dependen de Phase 2; pueden correr en orden de prioridad
- **Phase Final (Polish)**: Depende de todas las historias completadas

### Dependencias entre historias

| Historia | Prioridad | Depende de |
|---|---|---|
| US1 — Entrada con Google | P1 | Phase 2 |
| US2 — Sesión persistente | P1 | Phase 2, US1 |
| US3 — Preferencia de tema | P2 | Phase 2, US1 |
| US4 — Errores y cancelación | P2 | US1 |
| US5 — Cierre de sesión | P2 | US1, US2 |
| US6 — Borrado de cuenta | P3 | US1, US2 |

### Dentro de cada historia

Pruebas (escribir primero, verificar que fallan) → Implementación → Checkpoint

### Oportunidades de paralelismo

- T003, T004, T005 (Phase 1) — paralelos entre sí
- T006, T007 (Phase 2) — paralelos entre sí
- T009, T010 (Phase 2) — paralelos entre sí (archivos distintos)
- T011, T013 (US1) — paralelos: prueba e2e + route handler
- T019, T021 (US3) — paralelos: test unitario + componente
- T024, T025 (US4) — paralelos: prueba e2e + handler de error
- T027, T028 (US5) — paralelos: prueba e2e + componente top-bar
- T030, T032 (US6) — paralelos: prueba e2e + UI de borrado
- T033, T034, T035 (Polish) — paralelos entre sí

---

## Parallel Example: US1

```
# Correr en paralelo:
T011 — Prueba e2e de usuario nuevo (tests/e2e/auth-new-user.spec.ts)
T013 — Route handler de callback (app/auth/callback/route.ts)

# Después (cuando T013 esté completa):
T014 — Lógica de redirección importar/inicio
T015 — Estado de carga en botón
```

---

## Implementation Strategy

### MVP (US1 + US2 únicamente)

1. Completar Phase 1: Setup
2. Completar Phase 2: Foundational (**crítico**)
3. Completar Phase 3: US1 — Entrada con Google
4. Completar Phase 4: US2 — Sesión persistente
5. **PARAR Y VALIDAR**: Escenarios 1–3 y 7 de `quickstart.md`
6. Desplegar/demo si está listo

### Entrega incremental

Cada fase entregable completa y verificable independientemente:
- Setup + Foundational → base lista
- \+ US1 → acceso con Google funciona
- \+ US2 → sesión persistente y rutas protegidas
- \+ US3 → tema claro/oscuro sin destello
- \+ US4 → manejo de errores
- \+ US5 → cierre de sesión
- \+ US6 → borrado de cuenta

---

## Resumen de tareas

| Fase | Tareas | Notas |
|---|---|---|
| Phase 1: Setup | T001–T005 | 5 tareas |
| Phase 2: Foundational | T006–T010 | 5 tareas |
| Phase 3: US1 (P1) | T011–T015 | 5 tareas, incluye e2e |
| Phase 4: US2 (P1) | T016–T018 | 3 tareas, incluye e2e |
| Phase 5: US3 (P2) | T019–T023 | 5 tareas, incluye unit test |
| Phase 6: US4 (P2) | T024–T026 | 3 tareas, incluye e2e |
| Phase 7: US5 (P2) | T027–T029 | 3 tareas, incluye e2e |
| Phase 8: US6 (P3) | T030–T032 | 3 tareas, incluye e2e |
| Phase Final: Polish | T033–T037 | 5 tareas |
| **Total** | **37 tareas** | |
