-- Run after orders.sql and before batch-scheduling.sql.
-- Adds tiered vendor subscriptions so home-based vendors can start free and upgrade to pro.

alter table public.vendors
  add column if not exists subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'pro')),
  add column if not exists subscription_status text not null default 'active'
    check (subscription_status in ('active', 'trial', 'past_due', 'inactive')),
  add column if not exists subscription_started_at timestamptz not null default now(),
  add column if not exists subscription_expires_at timestamptz;

create table if not exists public.vendor_subscription_plans (
  id text primary key check (id in ('free', 'pro')),
  display_name text not null,
  monthly_price numeric(10, 2) not null default 0,
  max_menu_items integer not null default 5,
  allows_quick_pos boolean not null default false,
  priority_listing boolean not null default false,
  batch_capacity_limit integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.vendor_subscription_plans (
  id, display_name, monthly_price, max_menu_items, allows_quick_pos, priority_listing, batch_capacity_limit
)
values
  ('free', 'Free / Basic', 0.00, 5, false, false, 1),
  ('pro', 'Pro / Storefront', 199.00, 999, true, true, 8)
on conflict (id) do update set
  display_name = excluded.display_name,
  monthly_price = excluded.monthly_price,
  max_menu_items = excluded.max_menu_items,
  allows_quick_pos = excluded.allows_quick_pos,
  priority_listing = excluded.priority_listing,
  batch_capacity_limit = excluded.batch_capacity_limit,
  updated_at = now();

alter table public.vendor_subscription_plans enable row level security;

create policy "Admins can manage vendor subscription plans"
on public.vendor_subscription_plans
for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.vendor_plan_limits()
returns table (
  tier text,
  max_menu_items integer,
  allows_quick_pos boolean,
  priority_listing boolean,
  batch_capacity_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    id as tier,
    max_menu_items,
    allows_quick_pos,
    priority_listing,
    batch_capacity_limit
  from public.vendor_subscription_plans
  where is_active = true;
end;
$$;

revoke all on function public.vendor_plan_limits() from public;
grant execute on function public.vendor_plan_limits() to authenticated;
