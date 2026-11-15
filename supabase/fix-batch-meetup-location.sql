-- Run this directly in the live Supabase SQL Editor.
-- Repairs older vendor_batches tables used by the batch schedule screen.

alter table if exists public.vendor_batches
  add column if not exists meetup_location text;

notify pgrst, 'reload schema';

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'vendor_batches'
  and column_name = 'meetup_location';
