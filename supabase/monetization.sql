-- Run after orders.sql and admin-ledger-moderation.sql.
-- Adds admin-managed commission accounting for completed orders.

create table if not exists public.platform_settings (
  id boolean primary key default true check (id = true),
  commission_rate numeric(5, 2) not null default 5.00 check (commission_rate between 0 and 20),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.platform_settings (id, commission_rate)
values (true, 5.00)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

drop policy if exists "Admins can view platform settings" on public.platform_settings;
create policy "Admins can view platform settings"
on public.platform_settings
for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can update platform settings" on public.platform_settings;
create policy "Admins can update platform settings"
on public.platform_settings
for update to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

alter table public.orders
  add column if not exists commission_rate numeric(5, 2),
  add column if not exists platform_fee numeric(10, 2) not null default 0;

create or replace function public.update_platform_commission(target_rate numeric)
returns public.platform_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_settings public.platform_settings;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' then
    raise exception 'Only admins can update monetization settings';
  end if;
  if target_rate is null or target_rate < 0 or target_rate > 20 then
    raise exception 'Commission rate must be between 0 and 20 percent';
  end if;

  update public.platform_settings
  set commission_rate = round(target_rate, 2), updated_at = now(), updated_by = auth.uid()
  where id = true
  returning * into updated_settings;

  return updated_settings;
end;
$$;

revoke all on function public.update_platform_commission(numeric) from public;
grant execute on function public.update_platform_commission(numeric) to authenticated;

create or replace function public.capture_order_platform_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_rate numeric(5, 2);
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select commission_rate into active_rate
    from public.platform_settings
    where id = true;

    new.commission_rate := coalesce(active_rate, 5.00);
    new.platform_fee := round(greatest(coalesce(new.total, 0), 0) * new.commission_rate / 100, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists capture_order_platform_fee on public.orders;
create trigger capture_order_platform_fee
before update of status on public.orders
for each row execute function public.capture_order_platform_fee();

revoke all on function public.capture_order_platform_fee() from public;

alter table public.vendor_payouts
  add column if not exists platform_fees numeric(10, 2) not null default 0;

drop function if exists public.ensure_vendor_payout(uuid, date, date);
create or replace function public.ensure_vendor_payout(
  target_vendor_id uuid,
  target_period_start date,
  target_period_end date
)
returns setof public.vendor_payouts
language plpgsql security definer set search_path = public
as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' then
    raise exception 'Only admins can prepare vendor payouts';
  end if;

  return query
  insert into public.vendor_payouts as payout (vendor_id, period_start, period_end, gross_amount, platform_fees, refund_offsets, net_amount)
  select target_vendor_id, target_period_start, target_period_end,
    coalesce((select sum(greatest(o.total, 0)) from public.orders o where o.vendor_id = target_vendor_id and o.status = 'completed' and o.created_at::date between target_period_start and target_period_end), 0),
    coalesce((select sum(greatest(o.platform_fee, 0)) from public.orders o where o.vendor_id = target_vendor_id and o.status = 'completed' and o.created_at::date between target_period_start and target_period_end), 0),
    coalesce((select sum(greatest(a.amount, 0)) from public.vendor_settlement_adjustments a where a.vendor_id = target_vendor_id and a.status <> 'voided' and a.created_at::date between target_period_start and target_period_end), 0),
    greatest(
      coalesce((select sum(greatest(o.total, 0) - greatest(o.platform_fee, 0)) from public.orders o where o.vendor_id = target_vendor_id and o.status = 'completed' and o.created_at::date between target_period_start and target_period_end), 0)
      - coalesce((select sum(greatest(a.amount, 0)) from public.vendor_settlement_adjustments a where a.vendor_id = target_vendor_id and a.status <> 'voided' and a.created_at::date between target_period_start and target_period_end), 0), 0
    )
  on conflict (vendor_id, period_start, period_end) do update set
    gross_amount = excluded.gross_amount,
    platform_fees = excluded.platform_fees,
    refund_offsets = excluded.refund_offsets,
    net_amount = excluded.net_amount
  returning payout.*;
end;
$$;

revoke all on function public.ensure_vendor_payout(uuid, date, date) from public;
grant execute on function public.ensure_vendor_payout(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';