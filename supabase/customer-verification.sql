-- Run after admin-policies.sql before deploying customer ID uploads.
alter table public.customers
  add column if not exists government_id_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-verification', 'customer-verification', false, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png'];

drop policy if exists "Customers can upload their verification ID" on storage.objects;
create policy "Customers can upload their verification ID"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'customer-verification'
  and name like (auth.uid()::text || '/%')
);

drop policy if exists "Admins can view customer verification IDs" on storage.objects;
create policy "Admins can view customer verification IDs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'customer-verification'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "Customers can delete their verification ID" on storage.objects;
create policy "Customers can delete their verification ID"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customer-verification'
  and name like (auth.uid()::text || '/%')
);
