-- Run this in the Supabase SQL Editor for existing deployments.
-- Fixes UUID-based orders.id deployments when a vendor completes a pickup.

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('preparing', 'ready', 'completed')
    and new.customer_id is not null then
    insert into public.notifications (customer_id, order_id, title, body)
    values (
      new.customer_id,
      new.id,
      case new.status
        when 'preparing' then 'Your order is being prepared'
        when 'ready' then 'Your order is ready'
        else 'Your order is completed'
      end,
      format('Order %s is now %s.', left(new.id::text, 8), replace(new.status, '_', ' '))
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_order_status_change() from public;
notify pgrst, 'reload schema';