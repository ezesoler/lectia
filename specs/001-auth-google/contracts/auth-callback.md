# Contrato: GET /auth/callback

**Feature**: 001-auth-google

## Descripción

Route Handler que recibe el código de autorización de Google (vía Supabase Auth) e intercambia
una sesión activa. Es la única URL a la que Google redirige después de que el usuario autoriza.

---

## Request

```
GET /auth/callback?code={authorization_code}&next={redirect_path}
```

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `code` | string | sí | Código de autorización de OAuth2 enviado por Supabase/Google |
| `next` | string | no | Ruta a la que redirigir después del login; por defecto `/` |

**Restricciones**:
- Ruta pública: no requiere sesión previa.
- No acepta métodos distintos de GET.

---

## Respuestas

### Éxito

```
302 Found
Location: /importar        # usuario sin libros
Location: /                # usuario con libros (o `next` si fue provisto)
```

La sesión queda establecida en cookies HttpOnly mediante `@supabase/ssr`.

### Error de intercambio (code inválido, expirado o ya usado)

```
302 Found
Location: /login?error=auth_failed
```

El parámetro `error` es leído por la página `/login` para mostrar el mensaje de reintento.

### Cancelación del usuario en Google

No hay `code` en la URL; Supabase redirige con `error=access_denied`.

```
302 Found
Location: /login
```

Sin parámetro `error` alarmante; la pantalla de login queda operativa.

---

## Comportamiento esperado

1. Supabase intercambia el `code` por tokens de acceso y refresco.
2. El trigger `on_auth_user_created` crea el registro en `profiles` si es el primer login.
3. Se consulta si el usuario tiene libros (`count(*) from books where user_id = auth.uid()`).
4. Se redirige a `/importar` (sin libros) o `/` (con libros).
