-- Run after pro-subscription-hardening.sql.
-- Replaces Stripe-dependent checkout state with PayMongo one-month passes.

alter table public.vendors
  add column if not exists paymongo_checkout_locked_until timestamptz,
  add column if not exists paymongo_checkout_session_id text,
  add column if not exists paymongo_checkout_reference text;

create table if not exists public.vendor_pro_payment_events (
  payment_event_id text primary key,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  checkout_session_id text not null,
  processed_at timestamptz not null default now()
);

create unique index if not exists vendor_pro_payment_events_checkout_session_id_key
  on public.vendor_pro_payment_events (checkout_session_id);

alter table public.vendor_pro_payment_events enable row level security;
revoke all on public.vendor_pro_payment_events from anon, authenticated;

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
    or new.paymongo_checkout_locked_until is distinct from old.paymongo_checkout_locked_until
    or new.paymongo_checkout_session_id is distinct from old.paymongo_checkout_session_id
    or new.paymongo_checkout_reference is distinct from old.paymongo_checkout_reference
  )
  and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'Subscription fields can only be changed by the payment service';
  end if;
  return new;
end;
$$;

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
  where id = p_vendor_id and is_verified = true
  for update;
  if not found then
    raise exception 'Verified vendor profile not found';
  end if;
  if target_vendor.paymongo_checkout_locked_until > now() then
    return false;
  end if;

  update public.vendors
  set paymongo_checkout_locked_until = now() + interval '24 hours',
      paymongo_checkout_session_id = null,
      paymongo_checkout_reference = null
  where id = p_vendor_id;
  return true;
end;
$$;

create or replace function public.set_vendor_pro_checkout_session(
  p_vendor_id uuid,
  p_session_id text,
  p_reference text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the payment service can update checkout';
  end if;
  if nullif(trim(p_session_id), '') is null or nullif(trim(p_reference), '') is null then
    raise exception 'Checkout session and reference are required';
  end if;

  update public.vendors
  set paymongo_checkout_session_id = p_session_id,
      paymongo_checkout_reference = p_reference
  where id = p_vendor_id
    and paymongo_checkout_locked_until > now();
  return found;
end;
$$;

drop function if exists public.release_vendor_pro_checkout(uuid, text);

create or replace function public.release_vendor_pro_checkout(
  p_vendor_id uuid,
  p_reference text default null
)
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
  set paymongo_checkout_locked_until = null,
      paymongo_checkout_session_id = null,
      paymongo_checkout_reference = null
  where id = p_vendor_id
    and (p_reference is null or paymongo_checkout_reference = p_reference);
  return found;
end;
$$;

create or replace function public.release_vendor_pro_checkout_by_reference(p_reference text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the payment service can release checkout';
  end if;
  if nullif(trim(p_reference), '') is null then
    raise exception 'Checkout reference is required';
  end if;

  update public.vendors
  set paymongo_checkout_locked_until = null,
      paymongo_checkout_session_id = null,
      paymongo_checkout_reference = null
  where paymongo_checkout_reference = p_reference;
  return found;
end;
$$;

create or replace function public.apply_vendor_pro_payment(
  p_event_id text,
  p_vendor_id uuid,
  p_session_id text,
  p_reference text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_vendor public.vendors%rowtype;
  inserted_event_id text;
  access_start timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the payment service can apply Pro payments';
  end if;
  if nullif(trim(p_event_id), '') is null
    or p_vendor_id is null
    or nullif(trim(p_session_id), '') is null
    or nullif(trim(p_reference), '') is null
  then
    raise exception 'Invalid Pro payment event';
  end if;

  select * into current_vendor
  from public.vendors
  where id = p_vendor_id
  for update;
  if not found then
    raise exception 'Vendor profile not found';
  end if;
  if exists (
    select 1
    from public.vendor_pro_payment_events
    where payment_event_id = p_event_id
      or (vendor_id = p_vendor_id and checkout_session_id = p_session_id)
  ) then
    return false;
  end if;
  if current_vendor.paymongo_checkout_session_id is distinct from p_session_id
    or current_vendor.paymongo_checkout_reference is distinct from p_reference
  then
    raise exception 'PayMongo checkout does not match the vendor’s pending payment';
  end if;

  insert into public.vendor_pro_payment_events (
    payment_event_id, vendor_id, checkout_session_id
  )
  values (p_event_id, p_vendor_id, p_session_id)
  on conflict do nothing
  returning payment_event_id into inserted_event_id;

  if inserted_event_id is null then
    return false;
  end if;

  access_start := greatest(coalesce(current_vendor.subscription_expires_at, now()), now());
  update public.vendors
  set subscription_tier = 'pro',
      subscription_status = 'active',
      subscription_started_at = access_start,
      subscription_expires_at = access_start + interval '1 month',
      paymongo_checkout_locked_until = null,
      paymongo_checkout_session_id = null,
      paymongo_checkout_reference = null
  where id = p_vendor_id;

  return true;
end;
$$;

revoke all on function public.reserve_vendor_pro_checkout(uuid) from public, anon, authenticated;
revoke all on function public.set_vendor_pro_checkout_session(uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_vendor_pro_checkout(uuid, text) from public, anon, authenticated;
revoke all on function public.release_vendor_pro_checkout_by_reference(text) from public, anon, authenticated;
revoke all on function public.apply_vendor_pro_payment(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_vendor_pro_checkout(uuid) to service_role;
grant execute on function public.set_vendor_pro_checkout_session(uuid, text, text) to service_role;
grant execute on function public.release_vendor_pro_checkout(uuid, text) to service_role;
grant execute on function public.release_vendor_pro_checkout_by_reference(text) to service_role;
grant execute on function public.apply_vendor_pro_payment(text, uuid, text, text) to service_role;
