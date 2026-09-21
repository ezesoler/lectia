# Quickstart: Validación de Entrada con Google

**Feature**: 001-auth-google | **Date**: 2026-09-18

Guía para verificar que la feature funciona end-to-end. No incluye código de implementación;
eso vive en `tasks.md`.

---

## Prerequisitos

- Proyecto Next.js inicializado con App Router y TypeScript strict.
- Proyecto Supabase creado con Google OAuth configurado (Client ID + Secret en el dashboard).
- Variables de entorno presentes:
  ```
  NEXT_PUBLIC_SUPABASE_URL=...
  NEXT_PUBLIC_SUPABASE_ANON_KEY=...
  SUPABASE_SERVICE_ROLE_KEY=...
  ```
- Migrations aplicadas: tabla `profiles` + trigger `on_auth_user_created` + RLS.
- App corriendo en `localhost:3000`.

---

## Escenario 1: Usuario nuevo

**Objetivo**: Verificar FR-001, FR-004, FR-005, FR-008

1. Abrir `http://localhost:3000` sin sesión.
2. Verificar: redirige a `/login` (FR-011).
3. Verificar: la página muestra un único botón "Continuar con Google" (FR-001, FR-002).
4. Hacer clic en el botón; verificar que muestra estado de carga y deshabilita doble envío (FR-008).
5. Completar el flujo de Google con una cuenta de prueba.
6. Verificar: redirige a `/importar` (sin libros) (FR-005).
7. Verificar en Supabase dashboard: existe fila en `profiles` con el email correcto (FR-004).

**Resultado esperado**: El usuario llega a `/importar` en menos de tres toques / clics.

---

## Escenario 2: Usuario existente con libros

**Objetivo**: Verificar FR-003, FR-005

1. Con la cuenta del escenario anterior (ya con al menos un libro importado).
2. Cerrar el navegador y volver a abrir `http://localhost:3000`.
3. Verificar: entra directamente a `/` sin ver `/login` (FR-003).
4. Verificar: no pasa por `/importar` (FR-005).

---

## Escenario 3: Sesión persistente tras reload

**Objetivo**: Verificar FR-003

1. Con sesión activa, recargar la página (`F5` / Cmd+R).
2. Verificar: no redirige a `/login`; la sesión se mantiene.

---

## Escenario 4: Cancelación en Google

**Objetivo**: Verificar FR-009

1. Sin sesión, ir a `/login` y hacer clic en "Continuar con Google".
2. En la pantalla de Google, hacer clic en "Cancelar".
3. Verificar: vuelve a `/login` sin mensaje de error alarmante.
4. Verificar: el botón queda habilitado para reintentar.

---

## Escenario 5: Cambio de tema antes del login

**Objetivo**: Verificar FR-006, FR-007

1. Sin sesión, ir a `/login`.
2. Cambiar el tema con el interruptor (de claro a oscuro).
3. Recargar la página sin iniciar sesión.
4. Verificar: el tema oscuro se aplica en el primer render, sin destello de tema incorrecto (FR-007).
5. Iniciar sesión con Google.
6. Verificar: el tema oscuro se mantiene después del login (FR-006).
7. Verificar en `profiles`: `theme = 'dark'` (FR-006).

---

## Escenario 6: Cierre de sesión

**Objetivo**: Verificar FR-010

1. Con sesión activa, hacer clic en el avatar de la barra superior.
2. Seleccionar "Cerrar sesión".
3. Verificar: redirige a `/login`.
4. Verificar: los datos del usuario siguen existiendo en `profiles` y `books`.
5. Volver a iniciar sesión; verificar que los datos están intactos.

---

## Escenario 7: Protección de rutas internas

**Objetivo**: Verificar FR-011

1. Sin sesión, intentar acceder directamente a `/importar`, `/busqueda`, etc.
2. Verificar: todas redirigen a `/login`.

---

## Escenario 8: Borrado de cuenta

**Objetivo**: Verificar FR-012

1. Con sesión activa, borrar la cuenta desde los ajustes.
2. Verificar: respuesta `204` del `DELETE /api/profile`.
3. Verificar: la sesión se invalida y redirige a `/login`.
4. Verificar en Supabase: no existe fila en `auth.users` ni en `profiles` con ese ID.
5. Intentar iniciar sesión con la misma cuenta de Google.
6. Verificar: se crea un nuevo perfil vacío (nuevo UUID, sin libros ni resaltados).

---

## Referencias

- Contratos: [`contracts/auth-callback.md`](contracts/auth-callback.md),
  [`contracts/profile-api.md`](contracts/profile-api.md)
- Modelo de datos: [`data-model.md`](data-model.md)
- Decisiones técnicas: [`research.md`](research.md)
