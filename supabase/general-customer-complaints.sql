-- Run after admin-ledger-moderation.sql for an existing deployment.
-- Allows order-independent complaints while keeping the existing vendor/review/order reports.
alter table public.content_reports
  drop constraint if exists content_reports_target_check;

alter table public.content_reports
  add constraint content_reports_target_check check (
    review_id is not null
    or order_id is not null
    or vendor_id is not null
    or category = 'general_complaint'
  );

create or replace function public.submit_customer_complaint(
  complaint_category text,
  complaint_details text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
  cleaned_details text := trim(coalesce(complaint_details, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to submit a complaint';
  end if;
  if not exists (select 1 from public.customers where id = auth.uid()) then
    raise exception 'Customer profile not found';
  end if;
  if complaint_category is null
    or complaint_category not in ('app_issue', 'account_security', 'payment_transaction', 'vendor_service', 'other') then
    raise exception 'Choose a valid complaint category';
  end if;
  if char_length(cleaned_details) < 10 or char_length(cleaned_details) > 2000 then
    raise exception 'Complaint details must be between 10 and 2000 characters';
  end if;

  insert into public.content_reports (
    reporter_id,
    customer_id,
    category,
    reason,
    details,
    severity,
    status,
    action_taken
  )
  values (
    auth.uid(),
    auth.uid(),
    'general_complaint',
    complaint_category,
    cleaned_details,
    'medium',
    'open',
    'pending'
  )
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.submit_customer_complaint(text, text) from public;
grant execute on function public.submit_customer_complaint(text, text) to authenticated;

notify pgrst, 'reload schema';
