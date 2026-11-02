-- =====================================================================
--  Familia Labaut · v2: gastos personales, "No imputa" y notificaciones
--  Pegar TODO este archivo en Supabase → SQL Editor → "Run".
--  Requiere haber ejecutado antes schema.sql y categorias.sql.
--  Se puede ejecutar más de una vez. No borra datos.
--  (Si alguna vez volvés a ejecutar schema.sql, ejecutá este archivo después.)
-- =====================================================================

-- ---------- 1. Nuevas columnas en gastos ----------
-- scope: 'comun' (entra en la caja) o 'personal' (control propio, no toca la caja)
alter table public.expenses add column if not exists scope text not null default 'comun';
-- Parte personal dentro de un ticket común (ej: la cerveza), en la moneda del gasto
alter table public.expenses add column if not exists personal_amount numeric(12,2) not null default 0;
-- Marca de la administradora: este gasto común NO se imputa a la caja
alter table public.expenses add column if not exists excluded        boolean not null default false;
alter table public.expenses add column if not exists excluded_reason text;
alter table public.expenses add column if not exists excluded_by     uuid references public.members(id) on delete set null;
alter table public.expenses add column if not exists excluded_at     timestamptz;

alter table public.expenses drop constraint if exists expenses_scope_check;
alter table public.expenses add  constraint expenses_scope_check check (scope in ('comun', 'personal'));
alter table public.expenses drop constraint if exists expenses_personal_amount_check;
alter table public.expenses add  constraint expenses_personal_amount_check check (personal_amount >= 0 and personal_amount < amount);

-- Lo que realmente va a la caja común (en $UY). Personal o "No imputa" = 0.
alter table public.expenses add column if not exists shared_uyu numeric(12,2)
  generated always as (
    case when scope = 'comun' and not excluded then round((amount - personal_amount) * rate, 2) else 0 end
  ) stored;

-- ---------- 2. Seguridad de gastos ----------
-- Comunes: los ven todos. Personales: solo quien los cargó y la administradora.
drop policy if exists e_select on public.expenses;
drop policy if exists e_insert on public.expenses;
drop policy if exists e_update on public.expenses;
drop policy if exists e_delete on public.expenses;

create policy e_select on public.expenses for select to authenticated using (
  public.is_member() and (scope = 'comun' or created_by = auth.uid() or public.is_admin()));
-- Los personales se pueden cargar/editar aunque el mes esté cerrado (no tocan la caja)
create policy e_insert on public.expenses for insert to authenticated with check (
  public.is_member() and created_by = auth.uid() and (scope = 'personal' or public.is_month_open(spent_on)));
create policy e_update on public.expenses for update to authenticated
  using      (created_by = auth.uid() and (scope = 'personal' or public.is_month_open(spent_on)))
  with check (created_by = auth.uid() and (scope = 'personal' or public.is_month_open(spent_on)));
create policy e_delete on public.expenses for delete to authenticated using (
  created_by = auth.uid() and (scope = 'personal' or public.is_month_open(spent_on)));

-- Cada uno puede cambiar los datos de SU gasto, pero no la marca "No imputa"
revoke insert, update on public.expenses from authenticated;
grant insert (spent_on, amount, currency, rate, category, note, receipt_path, scope, personal_amount)
  on public.expenses to authenticated;
grant update (spent_on, amount, currency, rate, category, note, receipt_path, scope, personal_amount)
  on public.expenses to authenticated;

-- ---------- 3. "No imputa": solo la administradora ----------
create or replace function public.set_expense_excluded(p_id uuid, p_excluded boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo la administradora puede marcar gastos como No imputa';
  end if;
  update public.expenses set
    excluded        = p_excluded,
    excluded_reason = case when p_excluded then nullif(btrim(p_reason), '') end,
    excluded_by     = case when p_excluded then auth.uid() end,
    excluded_at     = case when p_excluded then now() end
  where id = p_id and scope = 'comun' and public.is_month_open(spent_on);
  if not found then
    raise exception 'No se pudo cambiar el gasto (¿el mes está cerrado?)';
  end if;
end; $$;

revoke all on function public.set_expense_excluded(uuid, boolean, text) from public, anon;
grant execute on function public.set_expense_excluded(uuid, boolean, text) to authenticated;

-- ---------- 4. Suscripciones a notificaciones (una por celular) ----------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  member_id  uuid not null default auth.uid() references public.members(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
drop policy if exists ps_select on public.push_subscriptions;
drop policy if exists ps_insert on public.push_subscriptions;
drop policy if exists ps_update on public.push_subscriptions;
drop policy if exists ps_delete on public.push_subscriptions;
create policy ps_select on public.push_subscriptions for select to authenticated using (member_id = auth.uid());
create policy ps_insert on public.push_subscriptions for insert to authenticated with check (member_id = auth.uid() and public.is_member());
create policy ps_update on public.push_subscriptions for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy ps_delete on public.push_subscriptions for delete to authenticated using (member_id = auth.uid());

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
