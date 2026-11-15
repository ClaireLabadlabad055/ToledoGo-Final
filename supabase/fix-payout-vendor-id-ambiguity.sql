-- Run this in Supabase after monetization.sql if payout preparation reports
-- "column reference vendor_id is ambiguous".

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