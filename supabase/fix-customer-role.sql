-- Run this in Supabase if customer registration still reports a null role.
-- Keeps older app bundles compatible with the customers table.

update public.customers
set role = 'customer'
where role is null;

alter table public.customers
  alter column role set default 'customer';

notify pgrst, 'reload schema';
