-- Run after orders.sql, messaging.sql, and deployment-hardening.sql.
-- Vendors manually send direct-wallet refunds and record the transfer reference.

alter table public.orders
  add column if not exists refund_wallet_provider text,
  add column if not exists refund_wallet_number text,
  add column if not exists refund_transfer_reference text,
  add column if not exists refund_settled_at timestamptz,
  add column if not exists refund_due_at timestamptz,
  add column if not exists refund_transfer_proof_path text,
  add column if not exists refund_disputed_at timestamptz,
  add column if not exists refund_dispute_reason text,
  add column if not exists refund_dispute_reviewed_at timestamptz,
  add column if not exists refund_dispute_admin_notes text;

-- Older deployments may still have conversations.order_id as uuid.
alter table public.conversations
  drop constraint if exists conversations_order_id_fkey;
alter table public.conversations
  alter column order_id type text using order_id::text;

alter table public.orders
  drop constraint if exists orders_refund_status_check,
  add constraint orders_refund_status_check
    check (refund_status in (
      'not_applicable',
      'wallet_credited',
      'pending_external',
      'settlement_pending',
      'awaiting_vendor_confirmation',
      'awaiting_customer_details',
      'pending_vendor',
      'settled'
    ));

update public.orders
set refund_due_at = coalesce(updated_at, created_at, now()) + interval '3 days'
where status = 'cancelled'
  and refund_status in ('awaiting_vendor_confirmation', 'pending_vendor')
  and refund_due_at is null;

create index if not exists orders_refund_due_idx
  on public.orders(refund_due_at)
  where status = 'cancelled'
    and refund_status in ('awaiting_vendor_confirmation', 'pending_vendor');

create index if not exists orders_refund_dispute_idx
  on public.orders(refund_disputed_at)
  where refund_disputed_at is not null and refund_dispute_reviewed_at is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('refund-proof', 'refund-proof', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Vendors can upload refund proof" on storage.objects;
create policy "Vendors can upload refund proof"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'refund-proof'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.orders
    where orders.id::text = split_part(storage.objects.name, '/', 2)
      and orders.vendor_id = auth.uid()
      and orders.status = 'cancelled'
      and orders.refund_status = 'pending_vendor'
  )
);

drop policy if exists "Vendors and admins can view refund proof" on storage.objects;
create policy "Vendors and admins can view refund proof"
on storage.objects for select to authenticated
using (
  bucket_id = 'refund-proof'
  and (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.orders
        where orders.id::text = split_part(storage.objects.name, '/', 2)
          and orders.vendor_id = auth.uid()
          and orders.refund_transfer_proof_path = storage.objects.name
      )
    )
    or exists (
      select 1 from public.orders
      where orders.id::text = split_part(storage.objects.name, '/', 2)
        and orders.customer_id = auth.uid()
        and orders.status = 'cancelled'
        and orders.refund_status = 'settled'
        and orders.refund_transfer_proof_path = storage.objects.name
    )
  )
);

alter table public.messages
  add column if not exists is_system boolean not null default false;

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages" on public.messages
for insert to authenticated with check (
  auth.uid() = sender_id
  and is_system = false
  and exists (
    select 1 from public.conversations
    where public.conversations.id = conversation_id
      and (public.conversations.customer_id = auth.uid() or public.conversations.vendor_id = auth.uid())
  )
);

create or replace function public.enforce_message_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' then
    return new;
  end if;

  if new.conversation_id is distinct from old.conversation_id
    or new.sender_id is distinct from old.sender_id
    or new.body is distinct from old.body
    or new.created_at is distinct from old.created_at
    or new.is_system is distinct from old.is_system
    or auth.uid() is null
    or old.sender_id = auth.uid()
    or new.read_at is null then
    raise exception 'Participants may only mark incoming messages as read';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_message_update_scope on public.messages;
create trigger enforce_message_update_scope
before update on public.messages
for each row execute function public.enforce_message_update_scope();
revoke all on function public.enforce_message_update_scope() from public;

create or replace function public.get_or_create_vendor_refund_conversation(
  conversation_vendor_id uuid,
  conversation_customer_id uuid,
  conversation_order_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_conversation_id uuid;
  order_card_body text;
begin
  if auth.uid() is null
    or auth.uid() not in (conversation_vendor_id, conversation_customer_id) then
    raise exception 'You are not a participant in this refund conversation';
  end if;

  select id into refund_conversation_id
  from public.conversations
  where customer_id = conversation_customer_id
    and vendor_id = conversation_vendor_id;

  if refund_conversation_id is null then
    insert into public.conversations (customer_id, vendor_id, order_id, subject)
    values (
      conversation_customer_id,
      conversation_vendor_id,
      conversation_order_id,
      'Refund request for order ' || left(conversation_order_id, 8)
    )
    on conflict (customer_id, vendor_id) do nothing
    returning id into refund_conversation_id;

    if refund_conversation_id is null then
      select id into refund_conversation_id
      from public.conversations
      where customer_id = conversation_customer_id
        and vendor_id = conversation_vendor_id;
    end if;
  end if;

  order_card_body := 'TOLEDOGO_ORDER_CARD:' || conversation_order_id;
  if not exists (
    select 1 from public.messages
    where conversation_id = refund_conversation_id
      and body = order_card_body
  ) then
    insert into public.messages (conversation_id, sender_id, body, is_system)
    values (refund_conversation_id, conversation_customer_id, order_card_body, true);
  end if;

  return refund_conversation_id;
end;
$$;

revoke all on function public.get_or_create_vendor_refund_conversation(uuid, uuid, text) from public;

-- Existing deployments may still use UUID order IDs.
create or replace function public.get_or_create_vendor_refund_conversation(
  conversation_vendor_id uuid,
  conversation_customer_id uuid,
  conversation_order_id uuid
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.get_or_create_vendor_refund_conversation(
    conversation_vendor_id,
    conversation_customer_id,
    conversation_order_id::text
  );
$$;

revoke all on function public.get_or_create_vendor_refund_conversation(uuid, uuid, uuid) from public;

create or replace function public.report_vendor_refund_not_received(
  target_order_id text,
  report_reason text default 'I have not received this refund.'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_order public.orders%rowtype;
  refund_conversation_id uuid;
  cleaned_reason text := trim(coalesce(report_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to report a missing refund';
  end if;
  if char_length(cleaned_reason) < 5 or char_length(cleaned_reason) > 500 then
    raise exception 'Add a short explanation (5–500 characters)';
  end if;

  update public.orders
  set refund_disputed_at = now(),
      refund_dispute_reason = cleaned_reason,
      refund_dispute_reviewed_at = null,
      refund_dispute_admin_notes = null,
      updated_at = now()
  where id::text = target_order_id
    and customer_id = auth.uid()
    and status = 'cancelled'
    and (
      (refund_status = 'settled' and refund_wallet_provider is not null)
      or (refund_status in ('pending_vendor', 'awaiting_vendor_confirmation') and refund_due_at <= now())
    )
    and (refund_disputed_at is null or refund_dispute_reviewed_at is not null)
  returning * into refund_order;

  if not found then
    raise exception 'This refund cannot be reported or has already been reported';
  end if;

  refund_conversation_id := public.get_or_create_vendor_refund_conversation(
    refund_order.vendor_id,
    refund_order.customer_id,
    refund_order.id
  );

  insert into public.messages (conversation_id, sender_id, body, is_system)
  values (
    refund_conversation_id,
    refund_order.customer_id,
    case
      when refund_order.refund_status = 'awaiting_vendor_confirmation'
        then format('The customer reported that the vendor has not confirmed the PHP %s refund request for order %s by the deadline. ToledoGo Support has been asked to review the case.', to_char(refund_order.refund_amount, 'FM999999990.00'), left(refund_order.id::text, 8))
      when refund_order.refund_status = 'pending_vendor'
        then format('The customer reported that the PHP %s refund for order %s has not arrived by the deadline. ToledoGo Support has been asked to review the case.', to_char(refund_order.refund_amount, 'FM999999990.00'), left(refund_order.id::text, 8))
      else format('The customer reported that the PHP %s refund for order %s was marked sent but has not arrived. ToledoGo Support has been asked to review the case.', to_char(refund_order.refund_amount, 'FM999999990.00'), left(refund_order.id::text, 8))
    end,
    true
  );

  insert into public.notifications (customer_id, order_id, title, body)
  values (
    refund_order.customer_id,
    refund_order.id,
    'Refund report sent to support',
    format('Your report for order %s was sent to ToledoGo Support for review.', left(refund_order.id::text, 8))
  );
end;
$$;

revoke all on function public.report_vendor_refund_not_received(text, text) from public;
grant execute on function public.report_vendor_refund_not_received(text, text) to authenticated;

create or replace function public.handle_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_item jsonb;
  item_id uuid;
  item_quantity integer;
  refund numeric(10, 2);
  is_vendor boolean;
  batch_id_value uuid;
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'This order can no longer be cancelled';
  end if;

  is_vendor := auth.uid() = old.vendor_id;
  if old.status <> 'pending' and not is_vendor then
    raise exception 'Cancellation is unavailable after preparation begins';
  end if;
  if not is_vendor and auth.uid() <> old.customer_id then
    raise exception 'You cannot cancel this order';
  end if;

  if old.payment_method in ('GCash', 'Maya') and old.payment_reference is not null then
    refund := greatest(coalesce(old.total, 0), 0);
    new.refund_amount := refund;
    new.refund_status := 'awaiting_vendor_confirmation';
    new.refund_due_at := now() + interval '3 days';
    insert into public.notifications (customer_id, order_id, title, body)
    select old.customer_id, old.id, 'Refund request awaiting vendor confirmation',
      format('Order %s was cancelled. Your PHP %s e-wallet refund request is waiting for the vendor to confirm. You will be asked for your wallet details after confirmation.', left(old.id::text, 8), to_char(refund, 'FM999999990.00'))
    where old.customer_id is not null;
  else
    refund := 0;
    new.refund_amount := 0;
    new.refund_status := 'not_applicable';
    insert into public.notifications (customer_id, order_id, title, body)
    select old.customer_id, old.id, 'Order cancelled before payment',
      format('Order %s was cancelled before payment was collected. No cash refund was due. Any redeemed loyalty coins have been restored separately.', left(old.id::text, 8))
    where old.customer_id is not null;
  end if;

  if new.cancellation_reason is null then
    new.cancellation_reason := case when is_vendor then 'Vendor emergency or out of stock' else 'Customer cancelled before preparation' end;
  end if;

  if coalesce(old.coins_redeemed, 0) > 0 then
    insert into public.customer_wallets (customer_id, coin_balance)
    values (old.customer_id, old.coins_redeemed)
    on conflict (customer_id) do update
      set coin_balance = public.customer_wallets.coin_balance + old.coins_redeemed,
          updated_at = now();
    insert into public.coin_transactions (customer_id, amount, reason, order_id)
    values (old.customer_id, old.coins_redeemed, 'Restored loyalty coins from cancelled order', old.id);
  end if;

  batch_id_value := nullif(to_jsonb(old) ->> 'batch_id', '')::uuid;
  if batch_id_value is not null and to_regclass('public.batch_menu_inventory') is not null then
    for order_item in select value from jsonb_array_elements(old.items)
    loop
      item_id := (order_item ->> 'id')::uuid;
      item_quantity := (order_item ->> 'qty')::integer;
      execute 'update public.batch_menu_inventory
        set quantity_remaining = quantity_remaining + greatest($1, 0)
        where batch_id = $2 and menu_id = $3'
        using item_quantity, batch_id_value, item_id;
    end loop;
  else
    for order_item in select value from jsonb_array_elements(old.items)
    loop
      item_id := (order_item ->> 'id')::uuid;
      item_quantity := (order_item ->> 'qty')::integer;
      update public.menus
      set stock_quantity = stock_quantity + greatest(coalesce(item_quantity, 0), 0),
          is_available = true
      where id = item_id and vendor_id = old.vendor_id;
    end loop;
  end if;
  return new;
end;
$$;

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
      or new.refund_due_at is distinct from old.refund_due_at
      or new.refund_disputed_at is distinct from old.refund_disputed_at
      or new.refund_dispute_reason is distinct from old.refund_dispute_reason
      or new.refund_dispute_reviewed_at is distinct from old.refund_dispute_reviewed_at
      or new.refund_dispute_admin_notes is distinct from old.refund_dispute_admin_notes
      or (new.cancellation_reason is distinct from old.cancellation_reason and new.status <> 'cancelled') then
      raise exception 'Vendors may only update order workflow and payment status';
    end if;

    if new.refund_wallet_provider is distinct from old.refund_wallet_provider
      or new.refund_wallet_number is distinct from old.refund_wallet_number then
      raise exception 'Vendors cannot change the customer refund destination';
    end if;
    if new.refund_status is distinct from old.refund_status
      and not (
        old.status = 'cancelled'
        and old.refund_status = 'awaiting_vendor_confirmation'
        and new.status = 'cancelled'
        and new.refund_status = 'awaiting_customer_details'
        and (to_jsonb(new) - array['refund_status', 'updated_at']::text[])
          = (to_jsonb(old) - array['refund_status', 'updated_at']::text[])
      )
      and not (
        old.status = 'cancelled'
        and old.refund_status = 'pending_vendor'
        and new.status = 'cancelled'
        and new.refund_status = 'settled'
        and new.refund_wallet_provider is not distinct from old.refund_wallet_provider
        and new.refund_wallet_number is not distinct from old.refund_wallet_number
        and new.refund_transfer_reference is not null
        and char_length(trim(new.refund_transfer_reference)) between 6 and 100
        and new.refund_due_at is not distinct from old.refund_due_at
        and new.refund_disputed_at is not distinct from old.refund_disputed_at
        and new.refund_dispute_reason is not distinct from old.refund_dispute_reason
        and new.refund_dispute_reviewed_at is not distinct from old.refund_dispute_reviewed_at
        and new.refund_dispute_admin_notes is not distinct from old.refund_dispute_admin_notes
        and new.refund_settled_at is not null
      ) then
      raise exception 'Only the assigned vendor can record a completed refund';
    end if;
    if new.refund_transfer_reference is distinct from old.refund_transfer_reference
      and not (
        old.refund_status = 'pending_vendor'
        and new.refund_status = 'settled'
        and char_length(trim(coalesce(new.refund_transfer_reference, ''))) between 6 and 100
      ) then
      raise exception 'A transfer reference is required to complete the refund';
    end if;
    if new.refund_settled_at is distinct from old.refund_settled_at
      and not (old.refund_status = 'pending_vendor' and new.refund_status = 'settled' and new.refund_settled_at is not null) then
      raise exception 'Invalid refund completion timestamp';
    end if;
    if new.refund_transfer_proof_path is distinct from old.refund_transfer_proof_path
      and not (
        old.refund_status = 'pending_vendor'
        and new.refund_status = 'settled'
        and new.refund_transfer_proof_path is not null
      ) then
      raise exception 'Transfer proof can only be added when the refund is completed';
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
    if old.status = 'cancelled'
        and old.refund_status in ('settled', 'pending_vendor', 'awaiting_vendor_confirmation')
      and new.status = 'cancelled'
        and new.refund_status = old.refund_status
        and (old.refund_disputed_at is null or old.refund_dispute_reviewed_at is not null)
      and new.refund_disputed_at is not null
      and new.refund_dispute_reason is not null
      and char_length(trim(new.refund_dispute_reason)) between 5 and 500
        and new.refund_dispute_reviewed_at is null
        and new.refund_dispute_admin_notes is null
        and (to_jsonb(new) - array['refund_disputed_at', 'refund_dispute_reason', 'refund_dispute_reviewed_at', 'refund_dispute_admin_notes', 'updated_at']::text[])
          = (to_jsonb(old) - array['refund_disputed_at', 'refund_dispute_reason', 'refund_dispute_reviewed_at', 'refund_dispute_admin_notes', 'updated_at']::text[]) then
      return new;
    end if;

    if old.status = 'cancelled'
      and old.refund_status = 'awaiting_customer_details'
      and new.status = 'cancelled'
      and new.refund_status = 'pending_vendor'
      and (to_jsonb(new) - array['refund_wallet_provider', 'refund_wallet_number', 'refund_due_at', 'refund_status', 'updated_at']::text[])
        = (to_jsonb(old) - array['refund_wallet_provider', 'refund_wallet_number', 'refund_due_at', 'refund_status', 'updated_at']::text[])
      and new.refund_wallet_provider is not null
      and char_length(trim(new.refund_wallet_provider)) between 2 and 50
      and new.refund_wallet_number ~ '^09[0-9]{9}$'
      and old.refund_due_at is not null
      and new.refund_due_at between now() + interval '2 days 23 hours'
        and now() + interval '3 days 1 minute' then
      return new;
    end if;

    if old.status <> 'pending'
      or new.status <> 'cancelled'
      or (to_jsonb(new) - array['status', 'cancellation_reason', 'updated_at']::text[])
        is distinct from (to_jsonb(old) - array['status', 'cancellation_reason', 'updated_at']::text[]) then
      raise exception 'Customers may only cancel pending orders or submit refund destination details';
    end if;
    return new;
  end if;

  raise exception 'You cannot update this order';
end;
$$;

create or replace function public.confirm_vendor_direct_refund_request(target_order_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_order public.orders%rowtype;
  refund_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to confirm this refund request';
  end if;

  update public.orders
  set refund_status = 'awaiting_customer_details',
      updated_at = now()
  where id::text = target_order_id
    and vendor_id = auth.uid()
    and status = 'cancelled'
    and refund_status = 'awaiting_vendor_confirmation'
  returning * into refund_order;

  if not found then
    raise exception 'This refund request is not waiting for your confirmation';
  end if;

  refund_conversation_id := public.get_or_create_vendor_refund_conversation(
    refund_order.vendor_id,
    refund_order.customer_id,
    refund_order.id
  );

  insert into public.messages (conversation_id, sender_id, body, is_system)
  values (
    refund_conversation_id,
    refund_order.vendor_id,
    format(
      'The vendor confirmed your PHP %s e-wallet refund request for order %s. Please enter your e-wallet name and mobile number in the refund section of your order pass. Never share your wallet PIN or OTP.',
      to_char(refund_order.refund_amount, 'FM999999990.00'),
      left(refund_order.id::text, 8)
    ),
    true
  );

  insert into public.notifications (customer_id, order_id, title, body)
  values (
    refund_order.customer_id,
    refund_order.id,
    'Vendor confirmed your refund request',
    format('The vendor confirmed your PHP %s refund request. Open your order pass to enter your e-wallet name and mobile number. Never share your wallet PIN or OTP.', to_char(refund_order.refund_amount, 'FM999999990.00'))
  );
end;
$$;

revoke all on function public.confirm_vendor_direct_refund_request(text) from public;
grant execute on function public.confirm_vendor_direct_refund_request(text) to authenticated;

create or replace function public.submit_vendor_refund_destination(
  target_order_id text,
  target_wallet_provider text,
  target_wallet_number text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_number_digits text := regexp_replace(coalesce(target_wallet_number, ''), '[^0-9]', '', 'g');
  refund_order public.orders%rowtype;
  refund_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to submit refund details';
  end if;
  if nullif(trim(target_wallet_provider), '') is null
    or char_length(trim(target_wallet_provider)) > 50 then
    raise exception 'Enter a valid e-wallet name';
  end if;
  if wallet_number_digits !~ '^09[0-9]{9}$' then
    raise exception 'Enter a valid 11-digit Philippine mobile number beginning with 09';
  end if;

  update public.orders
  set refund_wallet_provider = trim(target_wallet_provider),
      refund_wallet_number = wallet_number_digits,
      refund_status = 'pending_vendor',
      refund_due_at = now() + interval '3 days',
      updated_at = now()
  where id::text = target_order_id
    and customer_id = auth.uid()
    and status = 'cancelled'
    and refund_status = 'awaiting_customer_details'
  returning * into refund_order;

  if not found then
    raise exception 'This order is not waiting for refund details';
  end if;

  refund_conversation_id := public.get_or_create_vendor_refund_conversation(
    refund_order.vendor_id,
    auth.uid(),
    refund_order.id
  );

  insert into public.messages (conversation_id, sender_id, body, is_system)
  values (
    refund_conversation_id,
    auth.uid(),
    format(
      'Your e-wallet destination for the PHP %s refund on order %s has been securely submitted to the vendor. Please wait patiently while the vendor sends the refund manually. The vendor will record the transfer reference here when it is sent. Never share your wallet PIN or OTP.',
      to_char(refund_order.refund_amount, 'FM999999990.00'),
      left(target_order_id::text, 8)
    ),
    true
  );

  insert into public.notifications (customer_id, order_id, title, body)
  select customer_id, id, 'Refund details sent to vendor',
    format('Your PHP %s refund destination was sent to the vendor. Please wait patiently while the vendor sends the refund manually to your %s wallet ending in %s.', to_char(refund_amount, 'FM999999990.00'), trim(target_wallet_provider), right(wallet_number_digits, 4))
  from public.orders
  where id::text = target_order_id and customer_id = auth.uid();
end;
$$;

revoke all on function public.submit_vendor_refund_destination(text, text, text) from public;
grant execute on function public.submit_vendor_refund_destination(text, text, text) to authenticated;

drop function if exists public.complete_vendor_direct_refund(text, text);

create or replace function public.complete_vendor_direct_refund(
  target_order_id text,
  transfer_reference text,
  proof_storage_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_reference text := upper(trim(coalesce(transfer_reference, '')));
  refunded_order public.orders%rowtype;
  refund_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to record this refund';
  end if;
  if char_length(cleaned_reference) < 6 or char_length(cleaned_reference) > 100 then
    raise exception 'Enter a valid e-wallet transfer reference';
  end if;
  if proof_storage_path is not null and (
    split_part(proof_storage_path, '/', 1) <> auth.uid()::text
    or split_part(proof_storage_path, '/', 2) <> target_order_id
    or split_part(proof_storage_path, '/', 3) = ''
    or split_part(proof_storage_path, '/', 4) <> ''
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'refund-proof'
        and name = proof_storage_path
    )
  ) then
    raise exception 'The uploaded transfer proof is invalid';
  end if;

  update public.orders
  set refund_status = 'settled',
      refund_transfer_reference = cleaned_reference,
      refund_transfer_proof_path = proof_storage_path,
      refund_settled_at = now(),
      updated_at = now()
  where id::text = target_order_id
    and vendor_id = auth.uid()
    and status = 'cancelled'
    and refund_status = 'pending_vendor'
  returning * into refunded_order;

  if not found then
    raise exception 'This refund is not waiting for the vendor or was already completed';
  end if;

  refund_conversation_id := public.get_or_create_vendor_refund_conversation(
    refunded_order.vendor_id,
    refunded_order.customer_id,
    refunded_order.id
  );

  insert into public.messages (conversation_id, sender_id, body, is_system)
  values (
    refund_conversation_id,
    refunded_order.vendor_id,
    format(
      'The vendor marked the PHP %s refund for order %s as sent to your %s wallet. Transfer reference: %s. If you do not receive the transfer, contact ToledoGo Support and include this order number.',
      to_char(refunded_order.refund_amount, 'FM999999990.00'),
      left(refunded_order.id::text, 8),
      refunded_order.refund_wallet_provider,
      cleaned_reference
    ),
    true
  );

  insert into public.notifications (customer_id, order_id, title, body)
  values (
    refunded_order.customer_id,
    refunded_order.id,
    'E-wallet refund sent',
    format('The vendor marked your PHP %s refund as sent to your %s wallet. Transfer reference: %s.', to_char(refunded_order.refund_amount, 'FM999999990.00'), refunded_order.refund_wallet_provider, cleaned_reference)
  );
end;
$$;

revoke all on function public.complete_vendor_direct_refund(text, text, text) from public;
grant execute on function public.complete_vendor_direct_refund(text, text, text) to authenticated;

create or replace function public.review_vendor_refund_dispute(
  target_order_id text,
  admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'Admin access required';
  end if;

  if char_length(trim(coalesce(admin_note, ''))) > 500 then
    raise exception 'Admin notes cannot exceed 500 characters';
  end if;

  update public.orders
  set refund_dispute_reviewed_at = now(),
      refund_dispute_admin_notes = nullif(trim(admin_note), ''),
      updated_at = now()
  where id::text = target_order_id
    and refund_disputed_at is not null
    and refund_dispute_reviewed_at is null;

  if not found then
    raise exception 'This refund report is no longer awaiting review';
  end if;
end;
$$;

revoke all on function public.review_vendor_refund_dispute(text, text) from public;
grant execute on function public.review_vendor_refund_dispute(text, text) to authenticated;

notify pgrst, 'reload schema';
