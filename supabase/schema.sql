-- =====================================================================
--  Familia Labaut · Gastos del hogar
--  Pegar TODO este archivo en Supabase → SQL Editor → "Run"
-- =====================================================================

-- ---------- 1. Emails autorizados (solo la familia puede registrarse) ----------
create table if not exists public.allowed_emails (
  email    text primary key,
  name     text not null,
  is_admin boolean not null default false,
  color    text not null default '#E07A5F'
);

insert into public.allowed_emails (email, name, is_admin, color) values
  ('yoania.rodriguez1973@gmail.com', 'Yoania', true, '#E07A5F')
on conflict (email) do nothing;

-- ---------- 2. Miembros (se crean solos al registrarse) ----------
create table if not exists public.members (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  name       text not null,
  color      text not null default '#3D405B',
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = auth.uid() and is_admin);
$$;

-- Al crear una cuenta: si el email está autorizado se crea el miembro; si no, se rechaza.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.allowed_emails;
begin
  select * into a from public.allowed_emails where lower(email) = lower(new.email);
  if not found then
    raise exception 'Este email no está autorizado para la familia Labaut';
  end if;
  insert into public.members (id, email, name, color, is_admin)
  values (new.id, lower(new.email), a.name, a.color, a.is_admin)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. Meses (cuota por persona y cierre) ----------
create table if not exists public.months (
  id         text primary key check (id ~ '^\d{4}-\d{2}$'),   -- 'YYYY-MM'
  quota      numeric(12,2) not null default 0 check (quota >= 0),
  closed     boolean not null default false,
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_month_open(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.months where id = to_char(d, 'YYYY-MM') and closed);
$$;

create or replace function public.is_month_id_open(m text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.months where id = m and closed);
$$;

-- ---------- 4. Aportes a la caja común ----------
create table if not exists public.contributions (
  id         uuid primary key default gen_random_uuid(),
  month_id   text not null references public.months(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  kind       text not null default 'cuota' check (kind in ('cuota','ajuste','inicial')),
  amount     numeric(12,2) not null check (amount > 0),
  note       text,
  created_by uuid not null default auth.uid() references public.members(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- 5. Gastos ----------
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  spent_on     date not null default current_date,
  amount       numeric(12,2) not null check (amount > 0),
  currency     text not null default 'UYU' check (currency in ('UYU','USD')),
  rate         numeric(12,4) not null default 1 check (rate > 0),
  amount_uyu   numeric(12,2) generated always as (round(amount * rate, 2)) stored,
  category     text not null,
  note         text,
  receipt_path text,
  created_by   uuid not null default auth.uid() references public.members(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index if not exists expenses_spent_on_idx on public.expenses (spent_on);

-- ---------- 6. Seguridad (Row Level Security) ----------
alter table public.allowed_emails enable row level security;
alter table public.members        enable row level security;
alter table public.months         enable row level security;
alter table public.contributions  enable row level security;
alter table public.expenses       enable row level security;

-- Borrar políticas previas para que este archivo se pueda ejecutar más de una vez
drop policy if exists ae_select on public.allowed_emails;
drop policy if exists ae_admin  on public.allowed_emails;
drop policy if exists m_select  on public.members;
drop policy if exists m_update  on public.members;
drop policy if exists mo_select on public.months;
drop policy if exists mo_admin  on public.months;
drop policy if exists c_select  on public.contributions;
drop policy if exists c_insert  on public.contributions;
drop policy if exists c_delete  on public.contributions;
drop policy if exists e_select  on public.expenses;
drop policy if exists e_insert  on public.expenses;
drop policy if exists e_update  on public.expenses;
drop policy if exists e_delete  on public.expenses;

-- Emails autorizados: solo la administradora los gestiona
create policy ae_select on public.allowed_emails for select to authenticated using (public.is_member());
create policy ae_admin  on public.allowed_emails for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Miembros: todos se ven; cada uno edita solo su nombre/color
create policy m_select on public.members for select to authenticated using (public.is_member());
create policy m_update on public.members for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Meses: todos ven; solo la administradora define cuota y cierra
create policy mo_select on public.months for select to authenticated using (public.is_member());
create policy mo_admin  on public.months for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Aportes: todos ven; cada uno registra el suyo (la admin puede registrar el de cualquiera)
create policy c_select on public.contributions for select to authenticated using (public.is_member());
create policy c_insert on public.contributions for insert to authenticated with check (
  public.is_member() and created_by = auth.uid()
  and (member_id = auth.uid() or public.is_admin())
  and public.is_month_id_open(month_id));
create policy c_delete on public.contributions for delete to authenticated using (
  (created_by = auth.uid() or public.is_admin()) and public.is_month_id_open(month_id));

-- Gastos: todos ven; cada uno edita/borra SOLO los suyos, y solo si el mes está abierto
create policy e_select on public.expenses for select to authenticated using (public.is_member());
create policy e_insert on public.expenses for insert to authenticated with check (
  public.is_member() and created_by = auth.uid() and public.is_month_open(spent_on));
create policy e_update on public.expenses for update to authenticated
  using (created_by = auth.uid() and public.is_month_open(spent_on))
  with check (created_by = auth.uid() and public.is_month_open(spent_on));
create policy e_delete on public.expenses for delete to authenticated using (
  created_by = auth.uid() and public.is_month_open(spent_on));

-- Permisos explícitos
revoke all on public.allowed_emails, public.members, public.months, public.contributions, public.expenses from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.allowed_emails, public.months, public.contributions, public.expenses to authenticated;
grant select on public.members to authenticated;
revoke update on public.members from authenticated;
grant update (name, color) on public.members to authenticated;
grant execute on function public.is_member(), public.is_admin(), public.is_month_open(date), public.is_month_id_open(text) to authenticated;

-- ---------- 7. Fotos de tickets (bucket privado) ----------
insert into storage.buckets (id, name, public) values ('tickets', 'tickets', false)
on conflict (id) do nothing;

drop policy if exists tickets_read   on storage.objects;
drop policy if exists tickets_insert on storage.objects;
drop policy if exists tickets_delete on storage.objects;

create policy tickets_read on storage.objects for select to authenticated
  using (bucket_id = 'tickets' and public.is_member());
create policy tickets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tickets' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy tickets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 8. Tiempo real (todos ven los cambios al instante) ----------
do $$
declare t text;
begin
  foreach t in array array['expenses','contributions','months','members'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
