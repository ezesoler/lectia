# Implementation Plan: Entrada con Google

**Branch**: `001-auth-google` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-auth-google/spec.md`

## Summary

Implementar autenticación exclusiva con Google OAuth2 a través de Supabase Auth, con sesión
persistente entre visitas, preferencia de tema (claro / oscuro / sistema) que sobrevive al
reload sin destello, y protección completa de rutas internas para usuarios sin sesión.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, sin `any` implícito)

**Primary Dependencies**:
- Next.js 15 (App Router)
- `@supabase/supabase-js` + `@supabase/ssr` (auth + gestión de sesión server-side)
- Tailwind CSS v4 (tokens de `docs/guia-de-estilo.md`)
- Vitest (pruebas unitarias del helper de tema), Playwright (e2e de los tres flujos críticos)

**Storage**: Supabase Postgres — tabla `profiles` con RLS activa

**Testing**: Vitest para lógica de normalización/tema; Playwright para flujos de acceso

**Target Platform**: Web — mobile 390 px mínimo, escritorio hasta 1 180 px

**Project Type**: Aplicación web fullstack (Next.js App Router)

**Performance Goals**: Tema aplicado en el primer render sin destello visible; redirección
post-login en ≤ 1 s desde el callback

**Constraints**: Sin contraseñas ni otros proveedores OAuth; borrado de cuenta inmediato con
cascada completa en Postgres

**Scale/Scope**: MVP — un solo proveedor de identidad, un perfil por cuenta

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Nota |
|---|---|---|
| I. Las notas son del lector | ✅ | Borrado inmediato con cascada desde `auth.users` (FR-012) |
| II. Importar es trivial | ✅ | No aplica en esta feature; flujo de auth es previo a la importación |
| III. Una sola voz visual | ✅ | Pantalla de login usa tokens del sistema de diseño; sin elementos ajenos |
| IV. El texto del lector manda | ✅ | No hay resaltados en esta pantalla |
| V. Spec antes que código | ✅ | Plan deriva directamente del spec aprobado y sin `[NEEDS CLARIFICATION]` |
| VI. Calidad verificable | ✅ | TypeScript strict; e2e para flujo nuevo, existente y cancelación |
| VII. Privacidad por defecto | ✅ | RLS en `profiles`; sin analítica que reciba datos del usuario |

Sin violaciones. No se requiere Complexity Tracking.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-auth-google/
├── plan.md              # Este archivo
├── research.md          # Phase 0: decisiones técnicas
├── data-model.md        # Phase 1: esquema de profiles + trigger
├── quickstart.md        # Phase 1: guía de validación e2e
└── contracts/
    ├── auth-callback.md # Ruta GET /auth/callback
    └── profile-api.md   # Rutas PATCH + DELETE /api/profile
```

### Source Code

```text
app/
├── (auth)/
│   └── login/
│       └── page.tsx             # Pantalla de acceso pública
├── auth/
│   └── callback/
│       └── route.ts             # Route Handler: intercambia code por sesión
├── (app)/
│   ├── layout.tsx               # Layout protegido: verifica sesión, redirige a /login
│   └── importar/                # Primera pantalla post-login (usuario sin libros)
├── api/
│   └── profile/
│       └── route.ts             # PATCH /api/profile (tema) + DELETE /api/profile (cuenta)
├── layout.tsx                   # Root layout: inyecta data-theme sin flash
└── globals.css                  # CSS custom properties + @theme inline (Tailwind v4)

middleware.ts                    # Protección global de rutas + refresco de sesión

lib/
└── supabase/
    ├── client.ts                # createBrowserClient (componentes cliente)
    └── server.ts                # createServerClient (Server Components, Route Handlers)

components/
└── theme-switch.tsx             # Interruptor luna/sol accesible (aria-label, operable por teclado)
```

**Structure Decision**: App Router de Next.js. Las rutas internas viven bajo el grupo `(app)/`
con su propio `layout.tsx` que verifica sesión. Las rutas públicas (`/login`, `/auth/callback`)
quedan fuera del grupo protegido. `middleware.ts` en la raíz refresca la sesión Supabase en
cada request y redirige rutas internas si no hay sesión activa.
