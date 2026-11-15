-- Run 00-base-schema.sql, menus.sql, and orders.sql before this file.
-- Adds dated home-kitchen batches, cutoffs, batch inventory, and order linkage.

create table if not exists public.vendor_batches (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  cutoff_at timestamptz not null,
  pickup_at timestamptz not null,
  pickup_window_end timestamptz not null,
  max_orders integer not null default 5 check (max_orders > 0),
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  constraint vendor_batches_times_check check (starts_at < cutoff_at and cutoff_at <= pickup_at and pickup_window_end = pickup_at + interval '30 minutes')
);

create table if not exists public.batch_menu_inventory (
  batch_id uuid not null references public.vendor_batches(id) on delete cascade,
  menu_id uuid not null references public.menus(id) on delete cascade,
  quantity_remaining integer not null check (quantity_remaining >= 0),
  primary key (batch_id, menu_id)
);

alter table public.orders add column if not exists batch_id uuid references public.vendor_batches(id) on delete set null;
alter table public.vendor_batches add column if not exists meetup_location text;
alter table public.vendor_batches add column if not exists pickup_window_end timestamptz;
alter table public.vendor_batches add column if not exists max_orders integer not null default 5;
update public.vendor_batches set pickup_window_end = pickup_at + interval '30 minutes' where pickup_window_end is null;
alter table public.vendor_batches alter column pickup_window_end set not null;
alter table public.vendor_batches drop constraint if exists vendor_batches_status_check;
alter table public.vendor_batches add constraint vendor_batches_status_check check (status in ('scheduled', 'open', 'full', 'closed', 'completed', 'cancelled'));
alter table public.vendor_batches drop constraint if exists vendor_batches_times_check;
alter table public.vendor_batches add constraint vendor_batches_times_check check (starts_at < cutoff_at and cutoff_at <= pickup_at and pickup_window_end = pickup_at + interval '30 minutes');
alter table public.vendor_batches drop constraint if exists vendor_batches_max_orders_check;
alter table public.vendor_batches add constraint vendor_batches_max_orders_check check (max_orders > 0);
alter table public.orders drop constraint if exists orders_batch_status_check;
alter table public.orders add constraint orders_batch_status_check check (batch_status is null or batch_status in ('open', 'locked', 'completed'));
alter table public.vendor_batches enable row level security;
alter table public.batch_menu_inventory enable row level security;

drop policy if exists "Vendors can manage their batches" on public.vendor_batches;
create policy "Vendors can manage their batches" on public.vendor_batches for all to authenticated
using (auth.uid() = vendor_id) with check (auth.uid() = vendor_id);
drop policy if exists "Customers can view open batches" on public.vendor_batches;
create policy "Customers can view open batches" on public.vendor_batches for select to authenticated using (
  status in ('scheduled', 'open', 'full', 'closed') and exists (select 1 from public.vendors where id = vendor_id and is_verified = true and is_open = true)
);
drop policy if exists "Vendors can manage batch inventory" on public.batch_menu_inventory;
create policy "Vendors can manage batch inventory" on public.batch_menu_inventory for all to authenticated
using (exists (select 1 from public.vendor_batches where id = batch_id and vendor_id = auth.uid()))
with check (exists (select 1 from public.vendor_batches where id = batch_id and vendor_id = auth.uid()));
drop policy if exists "Customers can view open batch inventory" on public.batch_menu_inventory;
create policy "Customers can view open batch inventory" on public.batch_menu_inventory for select to authenticated using (
  exists (select 1 from public.vendor_batches where id = batch_id and status = 'open' and cutoff_at > now())
);

create or replace function public.create_vendor_batch(
  batch_name text,
  batch_meetup_location text,
  batch_starts_at timestamptz,
  batch_cutoff_at timestamptz,
  batch_pickup_at timestamptz,
  batch_max_orders integer
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  vendor_user_id uuid := auth.uid();
  created_batch_id uuid;
  inventory_item_count integer;
  vendor_tier text;
  active_batch_count integer;
  active_batch_limit integer;
begin
  if vendor_user_id is null then raise exception 'Not authenticated'; end if;
  select case
    when subscription_tier = 'pro'
      and subscription_status in ('active', 'trial')
      and (subscription_expires_at is null or subscription_expires_at > now())
    then 'pro'
    else 'free'
  end into vendor_tier
  from public.vendors
  where id = vendor_user_id and is_verified = true
  for update;
  if not found then
    raise exception 'Only verified vendors can create batches';
  end if;
  active_batch_limit := case when vendor_tier = 'pro' then 8 else 1 end;
  select count(*) into active_batch_count
  from public.vendor_batches
  where vendor_id = vendor_user_id
    and status in ('scheduled', 'open', 'full', 'closed')
    and pickup_at > now();
  if active_batch_count >= active_batch_limit then
    raise exception 'Your plan allows up to % active meetup windows. Complete or cancel one before adding another', active_batch_limit;
  end if;
  if nullif(trim(batch_name), '') is null then raise exception 'Batch name is required'; end if;
  if batch_starts_at is null or batch_cutoff_at is null or batch_pickup_at is null
    or batch_cutoff_at <> batch_pickup_at - interval '30 minutes'
    or batch_starts_at >= batch_cutoff_at or batch_cutoff_at <= now() then
    raise exception 'Orders must open before the cutoff, which is 30 minutes before pickup';
  end if;
  if batch_max_orders is null or batch_max_orders < 1 then
    raise exception 'Maximum orders must be at least one';
  end if;

  insert into public.vendor_batches (
    vendor_id, name, meetup_location, starts_at, cutoff_at, pickup_at,
    pickup_window_end, max_orders
  ) values (
    vendor_user_id, trim(batch_name), nullif(trim(batch_meetup_location), ''),
    batch_starts_at, batch_cutoff_at, batch_pickup_at,
    batch_pickup_at + interval '30 minutes', batch_max_orders
  ) returning id into created_batch_id;

  insert into public.batch_menu_inventory (batch_id, menu_id, quantity_remaining)
  select created_batch_id, m.id, m.stock_quantity
  from public.menus m
  where m.vendor_id = vendor_user_id and m.is_available = true;

  get diagnostics inventory_item_count = row_count;
  if inventory_item_count = 0 then
    raise exception 'Add at least one available menu item before creating a batch';
  end if;

  return created_batch_id;
end;
$$;
revoke all on function public.create_vendor_batch(text, text, timestamptz, timestamptz, timestamptz, integer) from public;
grant execute on function public.create_vendor_batch(text, text, timestamptz, timestamptz, timestamptz, integer) to authenticated;

create or replace function public.set_vendor_fulfillment_mode(target_fulfillment_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vendor_store_type text;
  vendor_tier text;
begin
  select store_type, case
    when subscription_tier = 'pro'
      and subscription_status in ('active', 'trial')
      and (subscription_expires_at is null or subscription_expires_at > now())
    then 'pro'
    else 'free'
  end
  into vendor_store_type, vendor_tier
  from public.vendors
  where id = auth.uid() and is_verified = true
  for update;

  if not found then raise exception 'Verified vendor profile not found'; end if;
  if vendor_store_type is distinct from 'physical' then
    raise exception 'Only physical stores can change fulfillment options';
  end if;
  if vendor_tier is distinct from 'pro' then
    raise exception 'Pro is required to change physical store fulfillment options';
  end if;
  if target_fulfillment_mode not in ('instore', 'both') then
    raise exception 'Physical stores can choose in-store pickup or both options';
  end if;

  update public.vendors
  set fulfillment_mode = target_fulfillment_mode
  where id = auth.uid();

  if target_fulfillment_mode = 'instore' then
    update public.vendor_batches b
    set status = case
      when exists (select 1 from public.orders o where o.batch_id = b.id) then 'closed'
      else 'cancelled'
    end
    where b.vendor_id = auth.uid()
      and b.status in ('scheduled', 'open', 'full')
      and b.pickup_at > now();
  end if;
end;
$$;
revoke all on function public.set_vendor_fulfillment_mode(text) from public;
grant execute on function public.set_vendor_fulfillment_mode(text) to authenticated;

create or replace function public.update_vendor_batch(
  target_batch_id uuid,
  batch_name text,
  batch_meetup_location text,
  batch_starts_at timestamptz,
  batch_cutoff_at timestamptz,
  batch_pickup_at timestamptz,
  batch_max_orders integer
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  vendor_user_id uuid := auth.uid();
  target_batch public.vendor_batches%rowtype;
begin
  if vendor_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.vendors
    where id = vendor_user_id and is_verified = true
  ) then
    raise exception 'Only verified vendors can manage batches';
  end if;

  select * into target_batch
  from public.vendor_batches
  where id = target_batch_id and vendor_id = vendor_user_id
  for update;
  if not found then raise exception 'Batch not found'; end if;
  if target_batch.status not in ('scheduled', 'open', 'closed') or target_batch.pickup_at <= now() then
    raise exception 'Only upcoming meetups can be edited';
  end if;
  if exists (select 1 from public.orders where batch_id = target_batch_id) then
    raise exception 'A batch with orders cannot be edited';
  end if;
  if nullif(trim(batch_name), '') is null then raise exception 'Batch name is required'; end if;
  if batch_starts_at is null or batch_cutoff_at is null or batch_pickup_at is null
    or batch_cutoff_at <> batch_pickup_at - interval '30 minutes'
    or batch_starts_at >= batch_cutoff_at or batch_cutoff_at <= now() then
    raise exception 'Choose an upcoming pickup time with a cutoff 30 minutes earlier';
  end if;
  if batch_max_orders is null or batch_max_orders < 1 then
    raise exception 'Maximum orders must be at least one';
  end if;

  update public.vendor_batches
  set name = trim(batch_name),
      meetup_location = nullif(trim(batch_meetup_location), ''),
      starts_at = batch_starts_at,
      cutoff_at = batch_cutoff_at,
      pickup_at = batch_pickup_at,
      pickup_window_end = batch_pickup_at + interval '30 minutes',
      max_orders = batch_max_orders
  where id = target_batch_id;
end;
$$;
revoke all on function public.update_vendor_batch(uuid, text, text, timestamptz, timestamptz, timestamptz, integer) from public;
grant execute on function public.update_vendor_batch(uuid, text, text, timestamptz, timestamptz, timestamptz, integer) to authenticated;

create or replace function public.cancel_vendor_batch(target_batch_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  vendor_user_id uuid := auth.uid();
  target_batch public.vendor_batches%rowtype;
begin
  if vendor_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.vendors
    where id = vendor_user_id and is_verified = true
  ) then
    raise exception 'Only verified vendors can manage batches';
  end if;

  select * into target_batch
  from public.vendor_batches
  where id = target_batch_id and vendor_id = vendor_user_id
  for update;
  if not found then raise exception 'Batch not found'; end if;
  if target_batch.status not in ('scheduled', 'open', 'closed') or target_batch.pickup_at <= now() then
    raise exception 'Only upcoming meetups can be cancelled';
  end if;
  if exists (select 1 from public.orders where batch_id = target_batch_id) then
    raise exception 'A batch with orders cannot be cancelled';
  end if;

  update public.vendor_batches set status = 'cancelled' where id = target_batch_id;
end;
$$;
revoke all on function public.cancel_vendor_batch(uuid) from public;
grant execute on function public.cancel_vendor_batch(uuid) to authenticated;

create or replace function public.sync_vendor_batch_statuses()
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.vendor_batches set status = 'open' where status = 'scheduled' and starts_at <= now() and cutoff_at > now();
  update public.vendor_batches set status = 'closed' where status = 'scheduled' and cutoff_at <= now();
  update public.vendor_batches set status = 'closed' where status = 'open' and cutoff_at <= now();
  update public.vendor_batches set status = 'completed' where status in ('open', 'full', 'closed') and pickup_at <= now();
  update public.orders
  set batch_status = 'locked', updated_at = now()
  where batch_id is not null and batch_status = 'open' and cutoff_time <= now();
  update public.orders o
  set batch_status = 'completed', updated_at = now()
  where o.batch_id is not null and o.batch_status in ('open', 'locked')
    and exists (select 1 from public.vendor_batches b where b.id = o.batch_id and b.pickup_at <= now());
end;
$$;
grant execute on function public.sync_vendor_batch_statuses() to authenticated;

drop function if exists public.get_open_vendor_batches(uuid);
create function public.get_open_vendor_batches(target_vendor_id uuid)
returns table (id uuid, name text, meetup_location text, cutoff_at timestamptz, pickup_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  perform public.sync_vendor_batch_statuses();
  return query select b.id, b.name, b.meetup_location, b.cutoff_at, b.pickup_at from public.vendor_batches b
  where b.vendor_id = target_vendor_id and b.status = 'open' and b.cutoff_at > now()
    and exists (select 1 from public.vendors v where v.id = b.vendor_id and v.is_verified = true and v.is_open = true)
  order by b.pickup_at;
end;
$$;
grant execute on function public.get_open_vendor_batches(uuid) to authenticated;

drop function if exists public.get_vendor_batches(uuid);
create function public.get_vendor_batches(target_vendor_id uuid)
returns table (id uuid, name text, meetup_location text, starts_at timestamptz, cutoff_at timestamptz, pickup_at timestamptz, status text)
language plpgsql security definer set search_path = public
as $$
begin
  perform public.sync_vendor_batch_statuses();
  return query select b.id, b.name, b.meetup_location, b.starts_at, b.cutoff_at, b.pickup_at, b.status
  from public.vendor_batches b
  where b.vendor_id = target_vendor_id
    and b.status in ('scheduled', 'open')
    and exists (select 1 from public.vendors v where v.id = b.vendor_id and v.is_verified = true and v.is_open = true)
    and (b.status = 'open' or b.starts_at > now())
  order by b.pickup_at;
end;
$$;
grant execute on function public.get_vendor_batches(uuid) to authenticated;

create or replace function public.decrement_batch_stock_for_order()
returns trigger language plpgsql security definer set search_path = public
as $$
declare order_item jsonb; item_id uuid; requested_quantity integer; batch_vendor uuid; batch_max_orders integer; batch_order_count integer;
begin
  if new.batch_id is null then return new; end if;
  perform public.sync_vendor_batch_statuses();
  select vendor_id, name, cutoff_at, max_orders into batch_vendor, new.batch_slot, new.cutoff_time, batch_max_orders
  from public.vendor_batches where id = new.batch_id and status = 'open' and cutoff_at > now() for update;
  if batch_vendor is null or batch_vendor <> new.vendor_id then raise exception 'This batch is closed or unavailable'; end if;
  if not exists (select 1 from public.vendors where id = batch_vendor and fulfillment_mode in ('meetup', 'both')) then
    raise exception 'This vendor is not accepting meetup orders';
  end if;
  select count(*) into batch_order_count from public.orders where batch_id = new.batch_id and status <> 'cancelled';
  if batch_order_count >= batch_max_orders then raise exception 'This pickup window has reached its order limit'; end if;
  if batch_order_count + 1 >= batch_max_orders then
    update public.vendor_batches set status = 'full' where id = new.batch_id;
  end if;
  new.batch_status := 'open';
  for order_item in select value from jsonb_array_elements(new.items) loop
    item_id := (order_item ->> 'id')::uuid;
    requested_quantity := (order_item ->> 'qty')::integer;
    if requested_quantity is null or requested_quantity < 1 then raise exception 'Invalid batch quantity'; end if;
    update public.batch_menu_inventory set quantity_remaining = quantity_remaining - requested_quantity
    where batch_id = new.batch_id and menu_id = item_id and quantity_remaining >= requested_quantity;
    if not found then raise exception 'Insufficient stock for this batch'; end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists decrement_batch_stock_on_order on public.orders;
create trigger decrement_batch_stock_on_order before insert on public.orders for each row execute function public.decrement_batch_stock_for_order();
revoke all on function public.decrement_batch_stock_for_order() from public;

drop function if exists public.get_vendor_batch_summary(uuid);
create function public.get_vendor_batch_summary(target_vendor_id uuid)
returns table (batch_id uuid, batch_slot text, meetup_location text, pickup_at timestamptz, pickup_window_end timestamptz, max_orders integer, cutoff_time timestamptz, batch_status text, order_count bigint, item_totals jsonb)
language sql security definer set search_path = public
as $$
  with order_lines as (
    select
      o.id,
      o.batch_id,
      coalesce(o.batch_slot, 'Unassigned orders') as batch_slot,
      b.meetup_location,
      b.pickup_at,
      b.pickup_window_end,
      b.max_orders,
      o.cutoff_time,
      coalesce(o.batch_status, 'open') as batch_status,
      item.value ->> 'name' as item_name,
      sum((item.value ->> 'qty')::integer)::integer as quantity
    from public.orders o
    left join public.vendor_batches b on b.id = o.batch_id
    cross join lateral jsonb_array_elements(o.items) item(value)
    where o.vendor_id = target_vendor_id and target_vendor_id = auth.uid() and o.status <> 'cancelled'
    group by o.id, o.batch_id, coalesce(o.batch_slot, 'Unassigned orders'), b.meetup_location, b.pickup_at, b.pickup_window_end, b.max_orders, o.cutoff_time, coalesce(o.batch_status, 'open'), item.value ->> 'name'
  ),
  item_totals as (
    select batch_id, batch_slot, batch_status, item_name, sum(quantity)::integer as quantity
    from order_lines
    group by batch_id, batch_slot, batch_status, item_name
  )
  select
    lines.batch_id,
    lines.batch_slot,
    lines.meetup_location,
    lines.pickup_at,
    lines.pickup_window_end,
    lines.max_orders,
    max(lines.cutoff_time) as cutoff_time,
    lines.batch_status,
    count(distinct lines.id) as order_count,
    coalesce(
      (select jsonb_object_agg(t.item_name, t.quantity order by t.item_name)
       from item_totals t
      where t.batch_id is not distinct from lines.batch_id and t.batch_slot = lines.batch_slot and t.batch_status = lines.batch_status),
      '{}'::jsonb
    ) as item_totals
  from order_lines lines
  group by lines.batch_id, lines.batch_slot, lines.meetup_location, lines.pickup_at, lines.pickup_window_end, lines.max_orders, lines.batch_status
  order by lines.pickup_at nulls last, lines.batch_slot;
$$;
grant execute on function public.get_vendor_batch_summary(uuid) to authenticated;

create or replace function public.reopen_batch_after_cancellation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.batch_id is not null and old.status <> 'cancelled' and new.status = 'cancelled' then
    update public.vendor_batches b
    set status = case when b.cutoff_at <= now() then 'closed' else 'open' end
    where b.id = old.batch_id and b.status = 'full'
      and (select count(*) from public.orders o where o.batch_id = b.id and o.status <> 'cancelled') < b.max_orders;
  end if;
  return new;
end;
$$;
drop trigger if exists reopen_batch_after_cancellation on public.orders;
create trigger reopen_batch_after_cancellation after update of status on public.orders
for each row execute function public.reopen_batch_after_cancellation();
revoke all on function public.reopen_batch_after_cancellation() from public;

-- Batch orders use batch_menu_inventory instead of the legacy global menu stock.
create or replace function public.decrement_menu_stock_for_order()
returns trigger language plpgsql security definer set search_path = public
as $$
declare order_item jsonb; item_id uuid; requested_quantity integer;
begin
  for order_item in select value from jsonb_array_elements(new.items) loop
    item_id := (order_item ->> 'id')::uuid;
    requested_quantity := (order_item ->> 'qty')::integer;
    if requested_quantity is null or requested_quantity < 1 then raise exception 'Invalid quantity for menu item %', item_id; end if;
    update public.menus set stock_quantity = stock_quantity - requested_quantity, is_available = stock_quantity - requested_quantity > 0
    where id = item_id and vendor_id = new.vendor_id and is_available = true and stock_quantity >= requested_quantity;
    if not found then raise exception 'Insufficient stock for menu item %', item_id; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.decrement_menu_stock_for_order() from public;

create index if not exists vendor_batches_vendor_pickup_idx on public.vendor_batches(vendor_id, pickup_at);
create index if not exists orders_batch_slot_idx on public.orders(batch_id, status);
create index if not exists batch_menu_inventory_menu_idx on public.batch_menu_inventory(menu_id);
do $$ begin alter publication supabase_realtime add table public.vendor_batches; exception when duplicate_object then null; end $$;
