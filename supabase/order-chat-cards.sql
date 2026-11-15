-- Creates a private order-linked chat card after a customer places an order.
-- Run after orders.sql and messaging.sql. Requires authenticated users.

alter table public.messages
  add column if not exists is_system boolean not null default false;

-- Order IDs are UUID in some deployed projects and text in newer schemas.
alter table public.conversations
  drop constraint if exists conversations_order_id_fkey;
alter table public.conversations
  alter column order_id type text using order_id::text;

create or replace function public.publish_order_chat_card(target_order_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders%rowtype;
  target_conversation_id uuid;
  card_body text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open the order conversation';
  end if;

  select * into target_order
  from public.orders
  where id::text = target_order_id;

  if not found or auth.uid() not in (target_order.customer_id, target_order.vendor_id) then
    raise exception 'Order not found or you are not a participant';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_order.id::text)::bigint);
  card_body := 'TOLEDOGO_ORDER_CARD:' || target_order.id::text;

  select id into target_conversation_id
  from public.conversations
  where customer_id = target_order.customer_id
    and vendor_id = target_order.vendor_id;

  if target_conversation_id is null then
    insert into public.conversations (customer_id, vendor_id, order_id, subject)
    values (
      target_order.customer_id,
      target_order.vendor_id,
      target_order.id::text,
      'Order ' || right(target_order.id::text, 8)
    )
    on conflict (customer_id, vendor_id) do nothing
    returning id into target_conversation_id;

    if target_conversation_id is null then
      select id into target_conversation_id
      from public.conversations
      where customer_id = target_order.customer_id
        and vendor_id = target_order.vendor_id;
    end if;
  end if;

  if not exists (
    select 1 from public.messages
    where conversation_id = target_conversation_id
      and body = card_body
  ) then
    insert into public.messages (conversation_id, sender_id, body, is_system)
    values (target_conversation_id, target_order.customer_id, card_body, true);
  end if;

  return target_conversation_id;
end;
$$;

revoke all on function public.publish_order_chat_card(text) from public;
grant execute on function public.publish_order_chat_card(text) to authenticated;
