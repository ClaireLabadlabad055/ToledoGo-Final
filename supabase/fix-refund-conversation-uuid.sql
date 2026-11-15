-- Run in Supabase SQL Editor when refund confirmation fails on an existing
-- conversation or reports that left(uuid, integer) does not exist.
-- Requires vendor-managed-refunds.sql to have already created the text helper
-- and, when needed, its UUID overload. Existing conversations are reused
-- without updating their protected participant/order columns.

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
grant execute on function public.get_or_create_vendor_refund_conversation(uuid, uuid, text) to authenticated;

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
grant execute on function public.get_or_create_vendor_refund_conversation(uuid, uuid, uuid) to authenticated;

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
