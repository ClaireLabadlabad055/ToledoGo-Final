-- Run this in the Supabase project used by the app.
-- Adds vendor-custom menu categories and the profile update RPC.

alter table public.vendors
  add column if not exists menu_categories text[] not null
    default array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks'];

do $$
begin
  if exists (
    select 1 from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vendors'
      and a.attname = 'menu_categories' and a.atttypid = 'jsonb'::regtype
  ) then
    alter table public.vendors add column if not exists menu_categories_text text[];
    update public.vendors 
    set menu_categories_text = case
      when jsonb_typeof(v.menu_categories) = 'array' then coalesce((
        select array_agg(item.value order by item.ordinality)
        from jsonb_array_elements_text(v.menu_categories) with ordinality as item(value, ordinality)
      ), array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks'])
      else array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks']
    end;
    alter table public.vendors drop column menu_categories;
    alter table public.vendors rename column menu_categories_text to menu_categories;
    update public.vendors
    set menu_categories = array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks']
    where menu_categories is null or cardinality(menu_categories) = 0;
    alter table public.vendors alter column menu_categories set default array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks'];
    alter table public.vendors alter column menu_categories set not null;
  end if;
end;
$$;

create or replace function public.update_vendor_menu_categories(category_values text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_categories text[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(
    array_agg(value order by position),
    array['Home-cooked', 'Baked goods', 'Seafood', 'Snacks']
  )
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

  if not found then
    raise exception 'Vendor profile not found';
  end if;
end;
$$;

revoke all on function public.update_vendor_menu_categories(text[]) from public;
grant execute on function public.update_vendor_menu_categories(text[]) to authenticated;

notify pgrst, 'reload schema';

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'vendors'
  and column_name = 'menu_categories';
