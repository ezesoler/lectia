-- Migración 001: tabla profiles + RLS + trigger de creación automática
-- Aplicar en: Supabase Dashboard > SQL Editor

-- 1. Tabla profiles
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text not null,
  display_name text,
  theme        text not null default 'system'
                 check (theme in ('system', 'light', 'dark')),
  created_at   timestamptz not null default now()
);

-- 2. RLS
alter table public.profiles enable row level security;

create policy "own profile"
  on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3. Trigger: crea perfil automáticamente al registrar un usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

-- Elimina el trigger si existe para poder recrearlo
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
