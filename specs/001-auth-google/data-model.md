# Data Model: Entrada con Google

**Feature**: 001-auth-google | **Date**: 2026-09-18

Esta feature toca exclusivamente la tabla `profiles` y el trigger de creación automática.
El esquema completo del proyecto está en `docs/modelo-de-datos.md`.

---

## Tabla: `profiles`

```sql
create table profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text not null,
  display_name text,
  theme        text not null default 'system'
                 check (theme in ('system', 'light', 'dark')),
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "own profile"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);
```

### Campos relevantes para esta feature

| Campo | Tipo | Restricción | Notas |
|---|---|---|---|
| `id` | uuid | FK → `auth.users` ON DELETE CASCADE | Mismo UUID que el usuario de Supabase Auth |
| `email` | text | NOT NULL | Proviene de `new.email` en el trigger |
| `display_name` | text | nullable | Nombre completo de Google; fallback: parte local del email |
| `theme` | text | `CHECK ('system','light','dark')` | Preferencia visual del usuario |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Fecha de primer ingreso |

---

## Trigger: creación automática de perfil

Se ejecuta después de cada inserción en `auth.users` (primer login con Google).

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

**Idempotencia**: El trigger sólo se ejecuta en `INSERT`; reimportar o re-autenticar no
duplica el perfil porque la PK `id` es la misma.

---

## Transiciones de estado del perfil

```
[no existe]
    │
    │ primer login con Google → trigger
    ▼
[activo]  ──PATCH /api/profile──▶  [activo, tema actualizado]
    │
    │ DELETE /api/profile → deleteUser → cascada
    ▼
[eliminado] (fila borrada de profiles y auth.users)
```

---

## Relaciones con otras entidades

La cascada `ON DELETE CASCADE` desde `auth.users` garantiza que al borrar la cuenta se
eliminan automáticamente: `profiles`, `books`, `highlights`, `list_items`, `imports`.
Los archivos en Storage (`imports/{user_id}/...`) se borran explícitamente en el handler
antes de llamar a `deleteUser`.
