-- Run after vendor-managed-refunds.sql to let customers view proof for their own settled refunds.
drop policy if exists "Vendors and admins can view refund proof" on storage.objects;
create policy "Vendors and admins can view refund proof"
on storage.objects for select to authenticated
using (
  bucket_id = 'refund-proof'
  and (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (
        select 1 from public.orders
        where orders.id::text = split_part(storage.objects.name, '/', 2)
          and orders.vendor_id = auth.uid()
          and orders.refund_transfer_proof_path = storage.objects.name
      )
    )
    or exists (
      select 1 from public.orders
      where orders.id::text = split_part(storage.objects.name, '/', 2)
        and orders.customer_id = auth.uid()
        and orders.status = 'cancelled'
        and orders.refund_status = 'settled'
        and orders.refund_transfer_proof_path = storage.objects.name
    )
  )
);
