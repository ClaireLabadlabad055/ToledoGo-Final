-- Run after the existing schema migrations before production deployment.
-- This migration tightens client-facing RLS policies without changing app table names.

-- Older Supabase projects may already have these tables without the approval
-- columns introduced by 00-base-schema.sql. Add the required columns before
-- creating policies that reference them.
alter table public.vendors
  add column if not exists is_verified boolean not null default false,
  add column if not exists is_open boolean not null default true,
  add column if not exists verification_status text not null default 'pending',
  add column if not exists meetup_hub_id uuid,
  add column if not exists menu_categories text[] not null default array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks'];

do $$
declare category_type text;
begin
  select t.typname into category_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public' and c.relname = 'vendors'
    and a.attname = 'menu_categories' and a.attnum > 0 and not a.attisdropped;

  if category_type = 'jsonb' then
    execute $convert$
      alter table public.vendors alter column menu_categories type text[]
      using case
        when jsonb_typeof(menu_categories) = 'array' then array(select jsonb_array_elements_text(menu_categories))
        else array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks']
      end
    $convert$;
  elsif category_type = 'json' then
    execute $convert$
      alter table public.vendors alter column menu_categories type text[]
      using case
        when json_typeof(menu_categories) = 'array' then array(select json_array_elements_text(menu_categories))
        else array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks']
      end
    $convert$;
  elsif category_type = '_varchar' then
    execute 'alter table public.vendors alter column menu_categories type text[] using menu_categories::text[]';
  elsif category_type <> '_text' then
    raise exception 'Unsupported vendors.menu_categories column type: %', category_type;
  end if;
end;
$$;

alter table public.customers
  add column if not exists is_verified boolean not null default false;

create or replace function public.update_vendor_menu_categories(category_values text[])
returns void
language plpgsql security definer set search_path = public
as $$
declare cleaned_categories text[];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select coalesce(array_agg(value order by position), array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks'])
  into cleaned_categories
  from (
    select distinct nullif(trim(value), '') as value, min(ordinality) as position
    from unnest(coalesce(category_values, array[]::text[])) with ordinality as category_values(value, ordinality)
    where char_length(trim(category_values.value)) between 2 and 40
    group by trim(category_values.value)
  ) categories
  where value is not null;

  if coalesce(array_length(cleaned_categories, 1), 0) = 0 then
    raise exception 'Add at least one menu category';
  end if;
  if array_length(cleaned_categories, 1) > 12 then
    raise exception 'Use no more than 12 menu categories';
  end if;

  update public.vendors
  set menu_categories = cleaned_categories
  where id = auth.uid();
  if not found then raise exception 'Vendor profile not found'; end if;
end;
$$;

revoke all on function public.update_vendor_menu_categories(text[]) from public;
grant execute on function public.update_vendor_menu_categories(text[]) to authenticated;

-- Repair older batch tables created before meetup locations were added.
do $$
begin
  if to_regclass('public.vendor_batches') is not null then
    alter table public.vendor_batches
      add column if not exists meetup_location text;
  end if;
end;
$$;

create or replace function public.prevent_multiple_account_roles()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'vendors' and exists (select 1 from public.customers where id = new.id) then
    raise exception 'This account already has a customer profile';
  end if;
  if tg_table_name = 'customers' and exists (select 1 from public.vendors where id = new.id) then
    raise exception 'This account already has a vendor profile';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_vendor_customer_role on public.vendors;
create trigger prevent_vendor_customer_role before insert on public.vendors
for each row execute function public.prevent_multiple_account_roles();
drop trigger if exists prevent_customer_vendor_role on public.customers;
create trigger prevent_customer_vendor_role before insert on public.customers
for each row execute function public.prevent_multiple_account_roles();

revoke all on function public.prevent_multiple_account_roles() from public;

alter table public.vendors
  drop constraint if exists vendors_verification_status_check;

alter table public.vendors
  add constraint vendors_verification_status_check
  check (verification_status in ('pending', 'under_review', 'approved', 'rejected'));

do $$
begin
  if to_regclass('public.official_meetup_landmarks') is not null
    and not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.vendors'::regclass
        and contype = 'f'
        and conkey = array[
          (select attnum from pg_attribute where attrelid = 'public.vendors'::regclass and attname = 'meetup_hub_id')::smallint
        ]
        and confrelid = 'public.official_meetup_landmarks'::regclass
    ) then
    update public.vendors
    set meetup_hub_id = null
    where meetup_hub_id is not null
      and not exists (
        select 1 from public.official_meetup_landmarks
        where id = public.vendors.meetup_hub_id
      );

    alter table public.vendors
      add constraint vendors_meetup_hub_id_fkey
      foreign key (meetup_hub_id)
      references public.official_meetup_landmarks(id)
      on delete set null;
  end if;
end;
$$;

-- New account rows must always start unverified and pending. Admins can still
-- approve them through the separate admin update policies.
drop policy if exists "Users can create their vendor record" on public.vendors;
create policy "Users can create their vendor record"
on public.vendors
for insert
to authenticated
with check (
  auth.uid() = id
  and is_verified = false
  and verification_status = 'pending'
);

drop policy if exists "Users can create their customer record" on public.customers;
create policy "Users can create their customer record"
on public.customers
for insert
to authenticated
with check (
  auth.uid() = id
  and is_verified = false
);

-- Keep owner IDs and permits private. Customers only need customer-facing
-- vendor media such as profile/store photos and payment QR images.
drop policy if exists "Customers can view vendor profile photos" on storage.objects;
drop policy if exists "Customers can view vendor-facing vendor media" on storage.objects;
create policy "Customers can view vendor-facing vendor media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vendor-verification'
  and (
    name like (auth.uid()::text || '/%')
    or (
      exists (
        select 1
        from public.vendors
        where vendors.id::text = split_part(storage.objects.name, '/', 1)
          and vendors.is_verified = true
      )
      and (
        name like '%/profile-photo-%'
        or name like '%/store-photo-%'
        or name like '%/payment-qr-%'
        or name like '%/gcash-qr-%'
        or name like '%/maya-qr-%'
      )
    )
  )
);

-- Only approved vendors may publish or change menu items.
drop policy if exists "Vendors can manage their menus" on public.menus;
drop policy if exists "Approved vendors can manage their menus" on public.menus;
create policy "Approved vendors can manage their menus"
on public.menus
for all
to authenticated
using (
  auth.uid() = vendor_id
  and exists (select 1 from public.vendors where id = vendor_id and is_verified = true)
)
with check (
  auth.uid() = vendor_id
  and exists (select 1 from public.vendors where id = vendor_id and is_verified = true)
);

-- Pending vendors must not publish or schedule operational batches.
drop policy if exists "Vendors can manage their batches" on public.vendor_batches;
drop policy if exists "Approved vendors can manage their batches" on public.vendor_batches;
create policy "Approved vendors can manage their batches"
on public.vendor_batches
for all
to authenticated
using (
  auth.uid() = vendor_id
  and exists (select 1 from public.vendors where id = vendor_id and is_verified = true)
)
with check (
  auth.uid() = vendor_id
  and exists (select 1 from public.vendors where id = vendor_id and is_verified = true)
);

drop policy if exists "Vendors can manage batch inventory" on public.batch_menu_inventory;
drop policy if exists "Approved vendors can manage batch inventory" on public.batch_menu_inventory;
create policy "Approved vendors can manage batch inventory"
on public.batch_menu_inventory
for all
to authenticated
using (
  exists (
    select 1
    from public.vendor_batches b
    join public.vendors v on v.id = b.vendor_id
    where b.id = batch_id and b.vendor_id = auth.uid() and v.is_verified = true
  )
)
with check (
  exists (
    select 1
    from public.vendor_batches b
    join public.vendors v on v.id = b.vendor_id
    where b.id = batch_id and b.vendor_id = auth.uid() and v.is_verified = true
  )
);

-- Moderated reviews are only public after an admin publishes them. Customers
-- can still read their own submissions through the existing owner policy.
drop policy if exists "Customers can view vendor reviews" on public.reviews;
drop policy if exists "Customers can view published vendor reviews" on public.reviews;
create policy "Customers can view published vendor reviews"
on public.reviews
for select
to authenticated
using (
  moderation_status = 'published'
  and exists (select 1 from public.vendors where id = vendor_id and is_verified = true)
);

-- Replace broad order updates with server-controlled transition checks. The
-- trigger compares OLD and NEW because RLS WITH CHECK only sees the new row.
drop policy if exists "Vendors can update their orders" on public.orders;
drop policy if exists "Vendors can update order workflow fields" on public.orders;
create policy "Vendors can update order workflow fields"
on public.orders
for update
to authenticated
using (
  auth.uid() = vendor_id
  and exists (select 1 from public.vendors where id = vendor_id and is_verified = true)
)
with check (
  auth.uid() = vendor_id
  and exists (select 1 from public.vendors where id = vendor_id and is_verified = true)
);

create or replace function public.enforce_order_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' then
    return new;
  end if;

  if auth.uid() = old.vendor_id then
    if new.customer_id is distinct from old.customer_id
      or new.vendor_id is distinct from old.vendor_id
      or new.items is distinct from old.items
      or new.total is distinct from old.total
      or new.customer_name is distinct from old.customer_name
      or new.customer_phone is distinct from old.customer_phone
      or new.payment_method is distinct from old.payment_method
      or new.payment_reference is distinct from old.payment_reference
      or new.payment_verification_expires_at is distinct from old.payment_verification_expires_at
      or new.payment_verified_at is distinct from old.payment_verified_at
      or new.payment_amount is distinct from old.payment_amount
      or new.refund_amount is distinct from old.refund_amount
      or new.refund_status is distinct from old.refund_status
      or (new.cancellation_reason is distinct from old.cancellation_reason and new.status <> 'cancelled') then
      raise exception 'Vendors may only update order workflow and payment status';
    end if;
    if not (
      old.status = new.status
      or (old.status = 'pending' and new.status in ('preparing', 'cancelled'))
      or (old.status = 'preparing' and new.status in ('ready', 'cancelled'))
      or (old.status = 'ready' and new.status in ('completed', 'cancelled'))
    ) then
      raise exception 'Invalid order status transition';
    end if;
    if new.status = 'preparing'
      and new.payment_method in ('GCash', 'Maya')
      and new.payment_status <> 'verified' then
      raise exception 'Online payment must be verified before preparation';
    end if;
    return new;
  end if;

  if auth.uid() = old.customer_id then
    if old.status <> 'pending'
      or new.status <> 'cancelled'
      or new.customer_id is distinct from old.customer_id
      or new.vendor_id is distinct from old.vendor_id
      or new.items is distinct from old.items
      or new.total is distinct from old.total
      or new.customer_name is distinct from old.customer_name
      or new.customer_phone is distinct from old.customer_phone
      or new.payment_status is distinct from old.payment_status
      or new.payment_reference is distinct from old.payment_reference
      or new.payment_amount is distinct from old.payment_amount
      or new.refund_amount is distinct from old.refund_amount
      or new.refund_status is distinct from old.refund_status then
      raise exception 'Customers may only cancel pending orders';
    end if;
    return new;
  end if;

  raise exception 'You cannot update this order';
end;
$$;

drop trigger if exists enforce_order_update_scope on public.orders;
create trigger enforce_order_update_scope
before update on public.orders
for each row execute function public.enforce_order_update_scope();

-- Never trust item prices or totals supplied by the client. The client may
-- still send item names and notes, but the payable total comes from menus.
create or replace function public.validate_order_pricing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_item jsonb;
  menu_item public.menus%rowtype;
  item_id uuid;
  requested_quantity integer;
  calculated_total numeric(10, 2) := 0;
begin
  for order_item in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
  loop
    item_id := (order_item ->> 'id')::uuid;
    requested_quantity := (order_item ->> 'qty')::integer;
    if requested_quantity is null or requested_quantity < 1 then
      raise exception 'Invalid quantity for menu item %', item_id;
    end if;

    select * into menu_item
    from public.menus
    where id = item_id
      and vendor_id = new.vendor_id
      and is_available = true;
    if not found then
      raise exception 'Menu item is unavailable: %', item_id;
    end if;

    calculated_total := calculated_total + (menu_item.price * requested_quantity);
  end loop;

  new.total := greatest(calculated_total, 0);
  new.coin_discount := 0;
  return new;
end;
$$;

drop trigger if exists validate_order_pricing on public.orders;
drop trigger if exists a_validate_order_pricing on public.orders;
create trigger a_validate_order_pricing
before insert on public.orders
for each row execute function public.validate_order_pricing();

-- Trigger names run alphabetically for the same timing, so this runs after
-- loyalty redemption and records the amount actually due.
create or replace function public.sync_online_payment_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_method in ('GCash', 'Maya') then
    new.payment_amount := greatest(coalesce(new.total, 0), 0);
  else
    new.payment_amount := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_online_payment_amount on public.orders;
create trigger sync_online_payment_amount
before insert or update of payment_method, payment_status, total on public.orders
for each row execute function public.sync_online_payment_amount();

create or replace function public.validate_order_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare vendor_fulfillment text;
begin
  if new.fulfillment_mode not in ('instore', 'meetup') then
    raise exception 'Invalid fulfillment mode';
  end if;

  select fulfillment_mode into vendor_fulfillment
  from public.vendors
  where id = new.vendor_id and is_verified = true and is_open = true;
  if vendor_fulfillment is null then
    raise exception 'This vendor is not available';
  end if;

  if new.fulfillment_mode = 'meetup' and new.batch_id is null then
    raise exception 'Meet-up orders require an available batch';
  end if;
  if new.fulfillment_mode = 'meetup' and vendor_fulfillment = 'instore' then
    raise exception 'This vendor only supports in-store pickup';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_order_fulfillment on public.orders;
create trigger validate_order_fulfillment
before insert on public.orders
for each row execute function public.validate_order_fulfillment();

revoke all on function public.validate_order_pricing() from public;
revoke all on function public.sync_online_payment_amount() from public;
revoke all on function public.validate_order_fulfillment() from public;

-- Customers may only cancel their own pending orders without rewriting order data.
drop policy if exists "Customers can cancel pending orders" on public.orders;
create policy "Customers can cancel pending orders"
on public.orders
for update
to authenticated
using (auth.uid() = customer_id and status = 'pending')
with check (
  auth.uid() = customer_id
  and status = 'cancelled'
);

-- Participants may not transfer or relink a conversation.
drop policy if exists "Participants can update conversations" on public.conversations;
drop policy if exists "Participants can update conversation metadata" on public.conversations;
create policy "Participants can update conversation metadata"
on public.conversations
for update
to authenticated
using (auth.uid() = customer_id or auth.uid() = vendor_id)
with check (
  (auth.uid() = customer_id or auth.uid() = vendor_id)
);

create or replace function public.enforce_conversation_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is distinct from old.customer_id
    or new.vendor_id is distinct from old.vendor_id
    or new.order_id is distinct from old.order_id then
    raise exception 'Conversation participants and order cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_conversation_update_scope on public.conversations;
create trigger enforce_conversation_update_scope
before update on public.conversations
for each row execute function public.enforce_conversation_update_scope();

-- Messages are immutable after sending; participants may only mark them read.
create or replace function public.enforce_message_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
    or new.sender_id is distinct from old.sender_id
    or new.body is distinct from old.body
    or new.created_at is distinct from old.created_at then
    raise exception 'Sent messages cannot be edited';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_message_update_scope on public.messages;
create trigger enforce_message_update_scope
before update on public.messages
for each row execute function public.enforce_message_update_scope();

revoke all on function public.enforce_conversation_update_scope() from public;
revoke all on function public.enforce_message_update_scope() from public;

-- Only approved vendors may open their storefront and operate it.
create or replace function public.set_vendor_open_status(open_status boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.vendors
  set is_open = open_status
  where id = auth.uid() and is_verified = true;

  if not found then
    raise exception 'Only an approved vendor can change store status';
  end if;
end;
$$;

revoke all on function public.set_vendor_open_status(boolean) from public;
grant execute on function public.set_vendor_open_status(boolean) to authenticated;
