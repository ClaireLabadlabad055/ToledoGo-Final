-- Apply after loyalty-reviews.sql to change the daily login reward.
-- Customers can claim this once per calendar day, on their first dashboard open.

create or replace function public.claim_daily_login_bonus()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded numeric := 0.1;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.customers
  set last_login_coin_date = current_date
  where id = auth.uid()
    and (last_login_coin_date is null or last_login_coin_date < current_date);

  if found then
    insert into public.customer_wallets (customer_id, coin_balance)
    values (auth.uid(), awarded)
    on conflict (customer_id) do update
      set coin_balance = public.customer_wallets.coin_balance + awarded,
          updated_at = now();
    insert into public.coin_transactions (customer_id, amount, reason)
    values (auth.uid(), awarded, 'Daily login bonus');
    return awarded;
  end if;

  return 0;
end;
$$;

grant execute on function public.claim_daily_login_bonus() to authenticated;
