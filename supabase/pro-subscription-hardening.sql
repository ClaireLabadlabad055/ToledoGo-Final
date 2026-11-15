-- Run after vendor-subscriptions.sql. Stripe is the only normal path that grants
-- or revokes vendor Pro entitlements; authenticated clients cannot edit them.

alter table public.vendors
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_event_created bigint not null default 0,
  add column if not exists stripe_checkout_locked_until timestamptz,
  add column if not exists stripe_checkout_session_id text;

drop function if exists public.upgrade_vendor_to_pro();
drop function if exists public.set_vendor_subscription_tier(uuid, text);

create table if not exists public.vendor_subscription_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.vendor_subscription_events enable row level security;
revoke all on public.vendor_subscription_events from anon, authenticated;

create or replace function public.guard_vendor_subscription_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.subscription_tier is distinct from old.subscription_tier
    or new.subscription_status is distinct from old.subscription_status
    or new.subscription_started_at is distinct from old.subscription_started_at
    or new.subscription_expires_at is distinct from old.subscription_expires_at
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.stripe_subscription_event_created is distinct from old.stripe_subscription_event_created
    or new.stripe_checkout_locked_until is distinct from old.stripe_checkout_locked_until
    or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
  )
  and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'Subscription fields can only be changed by the payment service';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_vendor_subscription_fields on public.vendors;
create trigger guard_vendor_subscription_fields
before update on public.vendors
for each row execute function public.guard_vendor_subscription_fields();

create or replace function public.apply_vendor_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_vendor_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_vendor public.vendors%rowtype;
  inserted_event_id text;
  effective_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the payment service can apply subscription events';
  end if;

  if nullif(trim(p_event_id), '') is null
    or nullif(trim(p_event_type), '') is null
    or p_event_created is null
    or p_event_created < 0
    or p_vendor_id is null
    or nullif(trim(p_customer_id), '') is null
    or nullif(trim(p_subscription_id), '') is null
    or p_status is null
    or p_status not in ('active', 'trial', 'past_due', 'inactive')
  then
    raise exception 'Invalid subscription event';
  end if;

  insert into public.vendor_subscription_events (stripe_event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (stripe_event_id) do nothing
  returning stripe_event_id into inserted_event_id;

  if inserted_event_id is null then
    return false;
  end if;

  select * into current_vendor
  from public.vendors
  where id = p_vendor_id
  for update;

  if not found then
    raise exception 'Vendor profile not found';
  end if;

  if current_vendor.stripe_subscription_event_created > p_event_created then
    return false;
  end if;

  if current_vendor.stripe_customer_id is not null
    and p_customer_id is distinct from current_vendor.stripe_customer_id
  then
    raise exception 'Stripe customer does not match this vendor';
  end if;

  if current_vendor.stripe_subscription_id is not null
    and p_subscription_id is distinct from current_vendor.stripe_subscription_id
    and current_vendor.subscription_status in ('active', 'trial')
    and (current_vendor.subscription_expires_at is null or current_vendor.subscription_expires_at > now())
  then
    raise exception 'Vendor already has a different active Stripe subscription';
  end if;

  effective_status := case
    when p_status in ('active', 'trial')
      and p_period_end is not null
      and p_period_end > now()
      then p_status
    else case when p_status = 'past_due' then 'past_due' else 'inactive' end
  end;

  update public.vendors
  set subscription_tier = case when effective_status in ('active', 'trial') then 'pro' else 'free' end,
      subscription_status = effective_status,
      subscription_started_at = coalesce(p_period_start, subscription_started_at, now()),
      subscription_expires_at = p_period_end,
      stripe_customer_id = coalesce(stripe_customer_id, p_customer_id),
      stripe_subscription_id = p_subscription_id,
      stripe_subscription_event_created = p_event_created,
      stripe_checkout_locked_until = null,
      stripe_checkout_session_id = null
  where id = p_vendor_id;

  return true;
end;
$$;

revoke all on function public.apply_vendor_subscription_event(text, text, bigint, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_vendor_subscription_event(text, text, bigint, uuid, text, text, text, timestamptz, timestamptz) to service_role;

create or replace function public.reserve_vendor_pro_checkout(p_vendor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_vendor public.vendors%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the payment service can reserve checkout';
  end if;

  select * into target_vendor
  from public.vendors
  where id = p_vendor_id
  for update;
  if not found then
    raise exception 'Vendor profile not found';
  end if;
  if target_vendor.subscription_tier = 'pro'
    and target_vendor.subscription_status in ('active', 'trial')
    and (target_vendor.subscription_expires_at is null or target_vendor.subscription_expires_at > now())
  then
    return false;
  end if;
  if target_vendor.stripe_checkout_locked_until > now() then
    return false;
  end if;

  update public.vendors
  set stripe_checkout_locked_until = now() + interval '35 minutes',
      stripe_checkout_session_id = null
  where id = p_vendor_id;
  return true;
end;
$$;

create or replace function public.set_vendor_pro_checkout_session(p_vendor_id uuid, p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the payment service can update checkout';
  end if;
  update public.vendors
  set stripe_checkout_session_id = p_session_id
  where id = p_vendor_id
    and stripe_checkout_locked_until > now();
  return found;
end;
$$;

create or replace function public.release_vendor_pro_checkout(p_vendor_id uuid, p_session_id text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the payment service can release checkout';
  end if;
  update public.vendors
  set stripe_checkout_locked_until = null,
      stripe_checkout_session_id = null
  where id = p_vendor_id
    and (p_session_id is null or stripe_checkout_session_id = p_session_id);
  return found;
end;
$$;

revoke all on function public.reserve_vendor_pro_checkout(uuid) from public, anon, authenticated;
revoke all on function public.set_vendor_pro_checkout_session(uuid, text) from public, anon, authenticated;
revoke all on function public.release_vendor_pro_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_vendor_pro_checkout(uuid) to service_role;
grant execute on function public.set_vendor_pro_checkout_session(uuid, text) to service_role;
grant execute on function public.release_vendor_pro_checkout(uuid, text) to service_role;

create or replace function public.enforce_vendor_menu_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vendor_tier text;
  vendor_status text;
  expires_at timestamptz;
  item_limit integer;
  existing_count integer;
begin
  if tg_op = 'UPDATE' and new.vendor_id is not distinct from old.vendor_id then
    return new;
  end if;

  select subscription_tier, subscription_status, subscription_expires_at
  into vendor_tier, vendor_status, expires_at
  from public.vendors
  where id = new.vendor_id
  for update;

  if not found then
    raise exception 'Vendor profile not found';
  end if;

  if vendor_tier = 'pro'
    and vendor_status in ('active', 'trial')
    and (expires_at is null or expires_at > now())
  then
    return new;
  end if;

  select max_menu_items into item_limit
  from public.vendor_subscription_plans
  where id = 'free' and is_active = true;
  item_limit := coalesce(item_limit, 5);

  select count(*) into existing_count
  from public.menus
  where vendor_id = new.vendor_id;

  if existing_count >= item_limit then
    raise exception 'Free plan allows up to % menu items. Upgrade to Pro to add more.', item_limit;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_vendor_menu_plan_limit on public.menus;
create trigger enforce_vendor_menu_plan_limit
before insert or update of vendor_id on public.menus
for each row execute function public.enforce_vendor_menu_plan_limit();

create or replace function public.create_vendor_pos_sale(
  p_items jsonb,
  p_cash_received numeric
)
returns table (order_id text, order_total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  vendor_user_id uuid := auth.uid();
  vendor_row public.vendors%rowtype;
  cart_line record;
  menu_row public.menus%rowtype;
  normalized_items jsonb := '[]'::jsonb;
  calculated_total numeric(10, 2) := 0;
  active_commission_rate numeric(5, 2);
  new_order_id text;
begin
  if vendor_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Sale items must be provided as a list';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Add between 1 and 100 items to the sale';
  end if;

  select * into vendor_row
  from public.vendors
  where id = vendor_user_id and is_verified = true
  for update;

  if not found then
    raise exception 'Only verified vendors can use Quick POS';
  end if;
  if vendor_row.subscription_tier <> 'pro'
    or vendor_row.subscription_status not in ('active', 'trial')
    or (vendor_row.subscription_expires_at is not null and vendor_row.subscription_expires_at <= now())
  then
    raise exception 'An active Pro subscription is required to use Quick POS';
  end if;

  for cart_line in
    select (entry.value ->> 'id')::uuid as item_id,
      sum((entry.value ->> 'qty')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(value)
    group by (entry.value ->> 'id')::uuid
  loop
    if cart_line.item_id is null or cart_line.quantity is null or cart_line.quantity < 1 then
      raise exception 'Invalid item or quantity in sale';
    end if;

    select * into menu_row
    from public.menus
    where id = cart_line.item_id
      and vendor_id = vendor_user_id
      and is_available = true
    for update;

    if not found then
      raise exception 'A menu item is no longer available';
    end if;
    if menu_row.stock_quantity < cart_line.quantity then
      raise exception 'Insufficient stock for %', menu_row.name;
    end if;

    calculated_total := calculated_total + (menu_row.price * cart_line.quantity);
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
      'id', menu_row.id,
      'name', menu_row.name,
      'qty', cart_line.quantity,
      'price', menu_row.price,
      'note', null
    ));
  end loop;

  if p_cash_received is null
    or p_cash_received::text in ('NaN', 'Infinity', '-Infinity')
    or p_cash_received < calculated_total
  then
    raise exception 'Cash received must cover the sale total';
  end if;

  select commission_rate into active_commission_rate
  from public.platform_settings
  where id = true;
  if not found then
    raise exception 'Platform commission settings are not configured';
  end if;

  insert into public.orders (
    vendor_id, customer_id, customer_name, items, total, status,
    fulfillment_mode, pickup_details, payment_method, payment_status,
    payment_amount, special_instructions, commission_rate, platform_fee
  )
  values (
    vendor_user_id, null, 'Walk-in customer', normalized_items, calculated_total, 'completed',
    'instore', 'In-store POS sale', 'Cash', 'not_required',
    0, format('In-store POS sale · cash collected PHP %s', to_char(p_cash_received, 'FM999999990.00')),
    active_commission_rate,
    round(calculated_total * active_commission_rate / 100, 2)
  )
  returning id into new_order_id;

  for cart_line in
    select (entry.value ->> 'id')::uuid as item_id,
      sum((entry.value ->> 'qty')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(value)
    group by (entry.value ->> 'id')::uuid
  loop
    update public.menus
    set stock_quantity = stock_quantity - cart_line.quantity,
        is_available = stock_quantity - cart_line.quantity > 0
    where id = cart_line.item_id and vendor_id = vendor_user_id;
  end loop;

  return query select new_order_id, calculated_total;
end;
$$;

revoke all on function public.create_vendor_pos_sale(jsonb, numeric) from public, anon;
grant execute on function public.create_vendor_pos_sale(jsonb, numeric) to authenticated;

create or replace function public.create_vendor_batch(
  batch_name text,
  batch_meetup_location text,
  batch_starts_at timestamptz,
  batch_cutoff_at timestamptz,
  batch_pickup_at timestamptz,
  batch_max_orders integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  vendor_user_id uuid := auth.uid();
  created_batch_id uuid;
  inventory_item_count integer;
  vendor_tier text;
  active_batch_count integer;
  active_batch_limit integer;
begin
  if vendor_user_id is null then
    raise exception 'Not authenticated';
  end if;

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
  if nullif(trim(batch_name), '') is null then
    raise exception 'Batch name is required';
  end if;
  if batch_starts_at is null or batch_cutoff_at is null or batch_pickup_at is null
    or batch_cutoff_at <> batch_pickup_at - interval '30 minutes'
    or batch_starts_at >= batch_cutoff_at or batch_cutoff_at <= now()
  then
    raise exception 'Orders must open before the cutoff, which is 30 minutes before pickup';
  end if;
  if batch_max_orders is null or batch_max_orders < 1 then
    raise exception 'Maximum orders must be at least one';
  end if;

  insert into public.vendor_batches (
    vendor_id, name, meetup_location, starts_at, cutoff_at, pickup_at,
    pickup_window_end, max_orders
  )
  values (
    vendor_user_id, trim(batch_name), nullif(trim(batch_meetup_location), ''),
    batch_starts_at, batch_cutoff_at, batch_pickup_at,
    batch_pickup_at + interval '30 minutes', batch_max_orders
  )
  returning id into created_batch_id;

  insert into public.batch_menu_inventory (batch_id, menu_id, quantity_remaining)
  select created_batch_id, menu.id, menu.stock_quantity
  from public.menus as menu
  where menu.vendor_id = vendor_user_id and menu.is_available = true;

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

  if not found then
    raise exception 'Verified vendor profile not found';
  end if;
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
    update public.vendor_batches as batch
    set status = case
      when exists (select 1 from public.orders as placed_order where placed_order.batch_id = batch.id) then 'closed'
      else 'cancelled'
    end
    where batch.vendor_id = auth.uid()
      and batch.status in ('scheduled', 'open', 'full')
      and batch.pickup_at > now();
  end if;
end;
$$;

revoke all on function public.set_vendor_fulfillment_mode(text) from public;
grant execute on function public.set_vendor_fulfillment_mode(text) to authenticated;

notify pgrst, 'reload schema';
