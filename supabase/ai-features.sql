-- Enables the age attestation required for the vendor-only Gemini writing tool.

alter table public.vendors
  add column if not exists ai_adult_confirmed boolean not null default false,
  add column if not exists ai_adult_confirmed_at timestamptz;

create or replace function public.confirm_vendor_ai_adult()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'An authenticated vendor must confirm their age';
  end if;

  update public.vendors
  set ai_adult_confirmed = true,
      ai_adult_confirmed_at = coalesce(ai_adult_confirmed_at, now())
  where id = auth.uid();

  if not found then
    raise exception 'Vendor profile not found';
  end if;
  return true;
end;
$$;

revoke all on function public.confirm_vendor_ai_adult() from public, anon;
grant execute on function public.confirm_vendor_ai_adult() to authenticated;
