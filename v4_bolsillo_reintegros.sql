-- =====================================================================
--  Familia Labaut · v4: gastos comunes pagados de bolsillo y reintegros
--  Pegar TODO este archivo en Supabase → SQL Editor → "Run".
--  Requiere haber ejecutado antes v2 y v3. Se puede ejecutar más de una vez. No borra datos.
-- =====================================================================

-- ---------- 1. Columnas nuevas ----------
-- paid_from: 'caja' (se pagó con plata de la caja) o 'bolsillo' (lo pagó la persona)
alter table public.expenses add column if not exists paid_from text not null default 'caja';
-- reimburse: si se pagó de bolsillo, 'reintegro' (quiere que se lo devuelvan) o 'fondo' (queda como aporte)
alter table public.expenses add column if not exists reimburse text not null default 'fondo';
-- Datos del reintegro (los completa solo la administradora con la función de abajo)
alter table public.expenses add column if not exists reimbursed_uyu   numeric(12,2);
alter table public.expenses add column if not exists reimbursed_month text;
alter table public.expenses add column if not exists reimbursed_by    uuid references public.members(id) on delete set null;
alter table public.expenses add column if not exists reimbursed_at    timestamptz;

alter table public.expenses drop constraint if exists expenses_paid_from_check;
alter table public.expenses add  constraint expenses_paid_from_check check (paid_from in ('caja', 'bolsillo'));
alter table public.expenses drop constraint if exists expenses_reimburse_check;
alter table public.expenses add  constraint expenses_reimburse_check check (reimburse in ('reintegro', 'fondo'));

-- ---------- 2. Permisos por columna (nadie toca los datos del reintegro ni "No imputa" directamente) ----------
revoke insert, update on public.expenses from authenticated;
grant insert (spent_on, amount, currency, rate, category, note, receipt_path, scope, personal_amount, paid_from, reimburse)
  on public.expenses to authenticated;
grant update (spent_on, amount, currency, rate, category, note, receipt_path, scope, personal_amount, paid_from, reimburse)
  on public.expenses to authenticated;

-- ---------- 3. Reintegrar / deshacer reintegro: solo la administradora ----------
-- El reintegro se registra en el mes actual (hora de Uruguay), que tiene que estar abierto.
create or replace function public.set_expense_reimbursed(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m text := to_char((now() at time zone 'America/Montevideo')::date, 'YYYY-MM');
begin
  if not public.is_admin() then
    raise exception 'Solo la administradora puede registrar reintegros';
  end if;
  if p_done then
    update public.expenses set
      reimbursed_uyu = shared_uyu, reimbursed_month = m, reimbursed_by = auth.uid(), reimbursed_at = now()
    where id = p_id and scope = 'comun' and paid_from = 'bolsillo' and not excluded
      and reimbursed_month is null and shared_uyu > 0 and public.is_month_id_open(m);
  else
    update public.expenses set
      reimbursed_uyu = null, reimbursed_month = null, reimbursed_by = null, reimbursed_at = null
    where id = p_id and reimbursed_month is not null and public.is_month_id_open(reimbursed_month);
  end if;
  if not found then
    raise exception 'No se pudo registrar el reintegro (¿el mes está cerrado o ya estaba hecho?)';
  end if;
end; $$;

revoke all on function public.set_expense_reimbursed(uuid, boolean) from public, anon;
grant execute on function public.set_expense_reimbursed(uuid, boolean) to authenticated;
