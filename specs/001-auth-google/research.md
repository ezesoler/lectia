# Research: Entrada con Google

**Feature**: 001-auth-google | **Date**: 2026-09-18

---

## Decisión 1: Librería de Supabase para Next.js App Router

**Decisión**: Usar `@supabase/ssr` junto con `@supabase/supabase-js`.

**Rationale**: `@supabase/ssr` expone `createServerClient` (para Server Components, Route
Handlers y middleware, usando cookies) y `createBrowserClient` (para componentes cliente,
usando `localStorage`). Esto permite que la sesión se lea en el servidor sin exponer el token
al cliente más de lo necesario, y habilita el refresco automático de tokens en el middleware.

**Alternativas consideradas**:
- `@supabase/auth-helpers-nextjs` — deprecado por Supabase a favor de `@supabase/ssr`.
- Implementar el intercambio OAuth manualmente — descartado: complejidad innecesaria cuando
  Supabase ya lo gestiona.

---

## Decisión 2: Prevención de destello de tema (FOUC)

**Decisión**: Script inline bloqueante en el `<head>` del root layout que lee
`localStorage.getItem('theme')` y aplica `data-theme` en `<html>` antes de que React hidrate.
En el servidor, leer la cookie `theme` (seteada en el PATCH de perfil) para el primer render
de usuarios autenticados.

**Rationale**: Next.js no puede resolver el tema preferido en el servidor sin cookies porque
`prefers-color-scheme` es sólo del cliente. Un script síncrono en `<head>` es la única forma
de garantizar que el atributo esté presente antes del primer paint sin introducir un parpadeo.

**Alternativas consideradas**:
- Leer sólo `prefers-color-scheme` en el servidor — incompleto: no refleja la preferencia
  guardada del usuario.
- CSS `color-scheme` sin JS — no aplica: el sistema de diseño usa `data-theme`, no la clase
  `dark` de Tailwind ni `color-scheme` nativo.

**Implementación**:
1. Script inline en `<head>`: lee `localStorage.theme` → si existe y es válido (`light`/`dark`),
   aplica `data-theme`; si no, aplica `system` (sin atributo o `data-theme="system"`).
2. Al autenticarse, el PATCH de perfil setea una cookie `theme` (HttpOnly: false, SameSite: Lax)
   para que el servidor pueda leerla en el primer SSR del layout protegido.
3. El `theme-switch.tsx` actualiza `localStorage`, el atributo `data-theme` en `<html>`, llama
   a `PATCH /api/profile` y actualiza la cookie.

---

## Decisión 3: Creación automática de perfil

**Decisión**: Trigger Postgres en `auth.users` para insertar en `profiles` automáticamente.

**Rationale**: La creación del perfil debe ser atómica y no depender de que el cliente llame
a un endpoint después del login. Un trigger `AFTER INSERT ON auth.users` garantiza que
`profiles` siempre existe cuando el middleware o cualquier Route Handler lo consulta.

**Alternativas consideradas**:
- Server Action post-login en el callback route — descartado: puede fallar si el usuario cierra
  la ventana entre el callback y la inserción, dejando un `auth.users` sin `profiles`.
- Upsert en cada request — descartado: overhead innecesario en cada petición.

**SQL**:
```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

## Decisión 4: Protección de rutas con middleware

**Decisión**: `middleware.ts` en la raíz del proyecto usando `createServerClient` de
`@supabase/ssr`. Refresca la sesión en cada request y redirige a `/login` si no hay sesión
para cualquier ruta fuera de `/login` y `/auth/callback`.

**Rationale**: El middleware de Next.js se ejecuta en el edge antes de que el componente de
página se renderice, lo que garantiza que ninguna ruta interna sea accesible sin sesión (FR-011).
El refresco de tokens en el middleware evita que sesiones válidas expiren silenciosamente.

**Alternativas consideradas**:
- Verificar sesión en cada `layout.tsx` protegido — descartado: duplicación y riesgo de rutas
  sin proteger si se agrega una nueva sin el check.
- Middleware propio con JWT manual — descartado: complejidad innecesaria; Supabase ya valida
  y refresca el token.

---

## Decisión 5: Borrado de cuenta

**Decisión**: Route Handler `DELETE /api/profile` llama a
`supabase.auth.admin.deleteUser(userId)` usando la `service_role` key del servidor.

**Rationale**: `deleteUser` con la service role elimina el registro en `auth.users`, lo que
dispara la cascada de FK en `profiles`, `books`, `highlights`, `list_items` e `imports`.
Los archivos temporales de Storage se limpian en el mismo handler antes de llamar a `deleteUser`.

**Alternativas consideradas**:
- `supabase.auth.signOut()` + borrado manual de tablas — descartado: requiere transacción
  manual y puede dejar datos huérfanos si algo falla a mitad.
- Soft-delete — descartado por la constitución: el borrado es inmediato (FR-012).
