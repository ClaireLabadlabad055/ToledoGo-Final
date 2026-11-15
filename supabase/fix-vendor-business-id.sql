-- Run in the Supabase SQL Editor before deploying the vendor business-ID form.
-- Existing vendor records remain unchanged and may have a null business_id_url.
alter table public.vendors
  add column if not exists business_id_url text;
