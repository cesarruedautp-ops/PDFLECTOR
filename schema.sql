-- ============================================================
-- SGD - Sistema de Gestion Documental
-- Netlify (frontend) + Supabase (Auth + Base de datos + Storage)
-- Pegar COMPLETO en Supabase -> SQL Editor -> Run
-- Se puede ejecutar varias veces sin romper nada.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
do $$ begin
  create type user_role as enum ('ADMIN', 'UPLOADER', 'READER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type log_action as enum ('UPLOAD', 'DELETE', 'LOGIN');
exception when duplicate_object then null; end $$;

alter type log_action add value if not exists 'PASSWORD_RESET_COMPLETE';
alter type log_action add value if not exists 'ROLE_CHANGED';
alter type log_action add value if not exists 'STATUS_CHANGED';
alter type log_action add value if not exists 'USER_CREATED';
alter type log_action add value if not exists 'PASSWORD_RESET_BY_ADMIN';

-- ---------- Tablas ----------
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  full_name text not null,
  role user_role not null default 'READER',
  is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table public.profiles add column if not exists email text;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  numero_oficio text not null,
  descripcion text not null,
  anio int not null,
  tomo text not null,
  mes int not null check (mes between 1 and 12),
  fecha_subida timestamptz default now(),
  storage_path text not null,
  file_size_bytes int not null check (file_size_bytes > 0),
  uploaded_by uuid references public.profiles(id) not null,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  unique (anio, tomo, numero_oficio)
);

-- Texto del PDF (sin acentos, en minusculas) para buscar por palabra clave
alter table public.documents add column if not exists contenido_texto text;

create index if not exists idx_documents_tree on public.documents (anio, tomo, mes);
create index if not exists idx_documents_oficio on public.documents (numero_oficio);
create index if not exists idx_documents_fecha on public.documents (fecha_subida desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action log_action not null,
  "timestamp" timestamptz default now(),
  user_id uuid references public.profiles(id) not null,
  document_id uuid references public.documents(id),
  detail text
);

create index if not exists idx_audit_logs_timestamp on public.audit_logs ("timestamp" desc);

-- ---------- Trigger: crea el perfil al crear un usuario ----------
-- Los 2 correos de la lista entran como ADMIN, el resto como READER.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  admin_emails text[] := array['cesarrueda.utp@gmail.com', 'santykfunez.utp@gmail.com'];
  assigned_role user_role;
begin
  if lower(new.email) = any (admin_emails) then
    assigned_role := 'ADMIN';
  else
    assigned_role := 'READER';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    assigned_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- Usuarios que ya existian antes de este script ----------
insert into public.profiles (id, email, full_name, role)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.email),
       case when lower(u.email) in ('cesarrueda.utp@gmail.com', 'santykfunez.utp@gmail.com')
            then 'ADMIN'::user_role else 'READER'::user_role end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles p set email = u.email
from auth.users u where p.id = u.id and p.email is null;

update public.profiles set role = 'ADMIN'
where lower(email) in ('cesarrueda.utp@gmail.com', 'santykfunez.utp@gmail.com');

-- ---------- Hook: pone el rol dentro del token (JWT) ----------
-- Luego activarlo en: Authentication -> Hooks -> Customize Access Token
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  existing_app_metadata jsonb;
  user_role_value text;
  user_active boolean;
begin
  select role::text, is_active into user_role_value, user_active
  from public.profiles
  where id = (event->>'user_id')::uuid;

  if user_active is false then
    user_role_value := 'READER';
  end if;

  claims := event->'claims';
  existing_app_metadata := coalesce(claims->'app_metadata', '{}'::jsonb);
  existing_app_metadata := jsonb_set(existing_app_metadata, '{role}', to_jsonb(coalesce(user_role_value, 'READER')));
  claims := jsonb_set(claims, '{app_metadata}', existing_app_metadata);
  event := jsonb_set(event, '{claims}', claims);

  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;

-- ---------- Seguridad por filas (RLS) ----------
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.audit_logs enable row level security;

alter table public.profiles force row level security;
alter table public.documents force row level security;
alter table public.audit_logs force row level security;

-- profiles
drop policy if exists "Auth admin lee perfiles para el hook" on public.profiles;
create policy "Auth admin lee perfiles para el hook"
on public.profiles for select to supabase_auth_admin using (true);

drop policy if exists "Ver perfiles" on public.profiles;
create policy "Ver perfiles"
on public.profiles for select to authenticated
using (id = auth.uid() or (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

drop policy if exists "ADMIN actualiza perfiles" on public.profiles;
create policy "ADMIN actualiza perfiles"
on public.profiles for update to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

-- documents
drop policy if exists "Lectura de documentos" on public.documents;
create policy "Lectura de documentos"
on public.documents for select to authenticated
using (is_deleted = false or (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

drop policy if exists "Subida ADMIN y UPLOADER" on public.documents;
create policy "Subida ADMIN y UPLOADER"
on public.documents for insert to authenticated
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('ADMIN', 'UPLOADER'));

drop policy if exists "ADMIN borra logicamente" on public.documents;
create policy "ADMIN borra logicamente"
on public.documents for update to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

drop policy if exists "Nadie borra fisicamente filas" on public.documents;
create policy "Nadie borra fisicamente filas"
on public.documents for delete to authenticated using (false);

-- audit_logs
drop policy if exists "Logs solo ADMIN lee" on public.audit_logs;
create policy "Logs solo ADMIN lee"
on public.audit_logs for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

drop policy if exists "Cualquiera inserta su propio log" on public.audit_logs;
create policy "Cualquiera inserta su propio log"
on public.audit_logs for insert to authenticated
with check (user_id = auth.uid());

-- ---------- Storage: bucket privado para los PDF ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents-originals', 'documents-originals', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

drop policy if exists "Nadie actualiza ni borra archivos" on storage.objects;

drop policy if exists "Leer PDF de documentos no eliminados" on storage.objects;
create policy "Leer PDF de documentos no eliminados"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents-originals'
  and exists (
    select 1 from public.documents d
    where d.storage_path = storage.objects.name
      and (d.is_deleted = false or (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN')
  )
);

drop policy if exists "Subir PDF para ADMIN y UPLOADER" on storage.objects;
create policy "Subir PDF para ADMIN y UPLOADER"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents-originals'
  and (auth.jwt() -> 'app_metadata' ->> 'role') in ('ADMIN', 'UPLOADER')
);

-- ============================================================
-- ACTUALIZACION: tipos de documento (Oficio, Memorandum,
-- Asignacion de viaticos, Liquidacion de viaticos)
-- Seguro de correr de nuevo aunque ya se haya ejecutado antes.
-- ============================================================
do $$ begin
  create type document_type as enum ('OFICIO', 'MEMORANDUM', 'ASIGNACION_VIATICOS', 'LIQUIDACION_VIATICOS');
exception when duplicate_object then null; end $$;

alter table public.documents add column if not exists tipo_documento document_type not null default 'OFICIO';
alter table public.documents add column if not exists empleado text;
alter table public.documents add column if not exists fecha_viaje_inicio date;
alter table public.documents add column if not exists fecha_viaje_fin date;
alter table public.documents add column if not exists remitente text;
alter table public.documents add column if not exists destinatario text;

-- Tomo solo aplica a Oficios; numero_oficio (codigo) no aplica a viaticos.
alter table public.documents alter column tomo drop not null;
alter table public.documents alter column numero_oficio drop not null;

-- La unicidad de "mismo numero en el mismo tomo/año" ya no sirve como una
-- sola regla para los 4 tipos (Memorandum no usa tomo). Se reemplaza por
-- dos reglas independientes, una por tipo que si necesita numero único.
alter table public.documents drop constraint if exists documents_anio_tomo_numero_oficio_key;

drop index if exists idx_documents_oficio_unico;
create unique index idx_documents_oficio_unico
  on public.documents (anio, tomo, numero_oficio)
  where tipo_documento = 'OFICIO';

drop index if exists idx_documents_memo_unico;
create unique index idx_documents_memo_unico
  on public.documents (anio, numero_oficio)
  where tipo_documento = 'MEMORANDUM';

create index if not exists idx_documents_tipo on public.documents (tipo_documento);
