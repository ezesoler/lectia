# Contrato: /api/profile

**Feature**: 001-auth-google

Ambas rutas requieren sesión activa. Sin sesión devuelven `401`.

---

## PATCH /api/profile — Actualizar preferencia de tema

### Request

```
PATCH /api/profile
Content-Type: application/json

{ "theme": "light" | "dark" | "system" }
```

| Campo | Tipo | Requerido | Valores válidos |
|---|---|---|---|
| `theme` | string | sí | `"light"`, `"dark"`, `"system"` |

### Respuestas

**200 OK**
```json
{ "theme": "dark" }
```

**400 Bad Request** — valor de `theme` inválido
```json
{ "error": { "code": "invalid_theme", "message": "Valor de tema no válido." } }
```

**401 Unauthorized** — sin sesión
```json
{ "error": { "code": "unauthorized", "message": "Sesión requerida." } }
```

### Efectos secundarios

- Actualiza `profiles.theme` del usuario autenticado.
- El handler setea la cookie `theme` (SameSite: Lax, path: `/`) para que el root layout
  pueda leer el tema en el primer SSR sin esperar a `localStorage`.

---

## DELETE /api/profile — Eliminar cuenta

### Request

```
DELETE /api/profile
```

Sin cuerpo. La identidad se lee de la sesión activa.

### Respuestas

**204 No Content** — cuenta eliminada correctamente

**401 Unauthorized** — sin sesión
```json
{ "error": { "code": "unauthorized", "message": "Sesión requerida." } }
```

**500 Internal Server Error** — fallo al eliminar (se informa sin exponer detalles internos)
```json
{ "error": { "code": "delete_failed", "message": "No se pudo eliminar la cuenta. Intentá de nuevo." } }
```

### Secuencia de borrado

1. Limpiar archivos del usuario en Storage (`imports/{user_id}/`).
2. Llamar a `supabase.auth.admin.deleteUser(userId)` con la service role key (servidor).
3. La cascada de FK en Postgres borra `profiles`, `books`, `highlights`, `list_items`, `imports`.
4. Devolver `204`.

### Comportamiento post-borrado

El cliente invalida la sesión local (cookie limpiada por Supabase) y redirige a `/login`.
