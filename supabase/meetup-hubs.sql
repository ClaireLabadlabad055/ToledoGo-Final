-- Run this once on existing databases before vendor-verification.sql.
-- Adds the vendor-selected fixed meetup hub feature.

create table if not exists public.official_meetup_landmarks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.vendors
  add column if not exists meetup_hub_id uuid references public.official_meetup_landmarks(id) on delete set null;

-- If meetup_hub_id already existed from an older migration, ADD COLUMN IF NOT
-- EXISTS does not add its foreign key. Repair the relationship explicitly so
-- PostgREST can expose it to nested vendor queries.
update public.vendors
set meetup_hub_id = null
where meetup_hub_id is not null
  and not exists (
    select 1
    from public.official_meetup_landmarks
    where id = public.vendors.meetup_hub_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.vendors'::regclass
      and contype = 'f'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.vendors'::regclass and attname = 'meetup_hub_id')::smallint
      ]
      and confrelid = 'public.official_meetup_landmarks'::regclass
  ) then
    alter table public.vendors
      add constraint vendors_meetup_hub_id_fkey
      foreign key (meetup_hub_id)
      references public.official_meetup_landmarks(id)
      on delete set null;
  end if;
end;
$$;

alter table public.official_meetup_landmarks enable row level security;

drop policy if exists "Authenticated users can view active meetup landmarks" on public.official_meetup_landmarks;
create policy "Authenticated users can view active meetup landmarks"
on public.official_meetup_landmarks for select to authenticated
using (is_active = true);

insert into public.official_meetup_landmarks (name, description)
values
  ('Toledo City Plaza - Main Fountain', 'Main fountain landmark'),
  ('Toledo Public Market - Main Entrance', 'Main market entrance'),
  ('Toledo City Covered Court', 'Covered court landmark')
on conflict (name) do nothing;

notify pgrst, 'reload schema';
