-- =====================================================================
--  Familia Labaut · Categorías editables desde la app
--  Pegar TODO este archivo en Supabase → SQL Editor → "Run".
--  Se puede ejecutar más de una vez sin problemas.
--  (No borra datos: solo crea la tabla de categorías y sus permisos.)
-- =====================================================================

-- ---------- 1. Tabla ----------
create table if not exists public.categories (
  name       text primary key check (char_length(btrim(name)) between 1 and 30),
  icon       text not null default '📦' check (char_length(icon) between 1 and 16),
  color      text not null default '#9A8C98' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort       integer not null default 100,
  active     boolean not null default true,       -- false = oculta (no aparece al cargar gastos)
  created_at timestamptz not null default now()
);

-- Categorías iniciales
insert into public.categories (name, icon, color, sort) values
  ('Renta',    '🏠', '#3D405B', 10),
  ('Agua',     '💧', '#4EA8DE', 20),
  ('Luz',      '💡', '#E9B949', 30),
  ('Gas',      '🔥', '#E76F51', 40),
  ('Comida',   '🛒', '#81B29A', 50),
  ('Cárnicos', '🥩', '#B5394B', 60),
  ('Agro',     '🥬', '#6A994E', 70),
  ('Otros',    '📦', '#9A8C98', 80)
on conflict (name) do nothing;

-- Por si algún gasto ya usa una categoría que no está en la lista
insert into public.categories (name)
select distinct category from public.expenses
on conflict (name) do nothing;

-- ---------- 2. Vincular gastos con categorías ----------
-- "on update cascade": si se renombra una categoría, sus gastos se actualizan solos.
-- "on delete restrict": no se puede borrar una categoría que tiene gastos (se puede ocultar).
alter table public.expenses drop constraint if exists expenses_category_fkey;
alter table public.expenses add constraint expenses_category_fkey
  foreign key (category) references public.categories(name)
  on update cascade on delete restrict;

-- ---------- 3. Seguridad: todos ven, solo la administradora modifica ----------
alter table public.categories enable row level security;

drop policy if exists cat_select on public.categories;
drop policy if exists cat_admin  on public.categories;
create policy cat_select on public.categories for select to authenticated using (public.is_member());
create policy cat_admin  on public.categories for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.categories from anon;
grant select, insert, update, delete on public.categories to authenticated;

-- ---------- 4. Tiempo real ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories') then
    alter publication supabase_realtime add table public.categories;
  end if;
end $$;
