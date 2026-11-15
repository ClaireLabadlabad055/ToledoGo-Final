-- Run this in Supabase to enable optional customer photos on vendor reports.

alter table public.content_reports
  add column if not exists photo_url text;

drop function if exists public.submit_vendor_report(uuid, text, text, text, text);

create or replace function public.submit_vendor_report(
  report_vendor_id uuid,
  report_reason text,
  report_details text,
  report_category text default 'vendor_issue',
  report_severity text default 'medium',
  report_photo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to file a report';
  end if;
  if report_vendor_id is null then
    raise exception 'Vendor is required';
  end if;

  insert into public.content_reports (
    reporter_id, customer_id, vendor_id, category, reason, details, photo_url, severity, status, action_taken
  )
  values (
    auth.uid(), auth.uid(), report_vendor_id,
    coalesce(nullif(trim(report_category), ''), 'vendor_issue'),
    coalesce(nullif(trim(report_reason), ''), 'Vendor issue'),
    nullif(trim(report_details), ''),
    nullif(trim(report_photo_url), ''),
    coalesce(nullif(trim(report_severity), ''), 'medium'),
    'open', 'pending'
  )
  returning id into created_id;

  return created_id;
end;
$$;

grant execute on function public.submit_vendor_report(uuid, text, text, text, text, text) to authenticated;
notify pgrst, 'reload schema';