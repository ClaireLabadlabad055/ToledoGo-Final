-- Apply after vendor-managed-refunds.sql to stop cash-on-pickup cancellations
-- from crediting the order total as a cash refund.
-- This replaces only the cancellation trigger function; it does not rerun orders.sql.

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
    new.cancellation_reason := case
      when is_vendor then 'Vendor emergency or out of stock'
      else 'Customer cancelled before preparation'
    end;
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
