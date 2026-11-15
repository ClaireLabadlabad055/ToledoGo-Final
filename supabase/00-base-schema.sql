-- Run this file first in the Supabase SQL Editor.
-- It creates the account tables used by the feature migrations.

create table if not exists public.vendors (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null,
  owner_name text,
  email text,
  phone text,
  store_type text not null default 'home',
  physical_address text,
  fulfillment_mode text not null default 'instore',
  meetup_details text,
  cuisine_specialty text,
  owner_id_url text,
  business_id_url text,
  permit_url text,
  store_photo_url text,
  profile_photo_url text,
  payment_qr_url text,
  gcash_qr_url text,
  maya_qr_url text,
  payment_account_name text,
  verification_status text not null default 'pending',
  admin_notes text,
  is_verified boolean not null default false,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.official_meetup_landmarks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.vendors
  add column if not exists meetup_hub_id uuid references public.official_meetup_landmarks(id) on delete set null;

alter table public.vendors enable row level security;
alter table public.customers enable row level security;
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

create index if not exists vendors_verified_open_idx
  on public.vendors(is_verified, is_open);
create index if not exists vendors_business_name_idx
  on public.vendors(business_name);

-- Registration and later feature migrations add the remaining policies.
