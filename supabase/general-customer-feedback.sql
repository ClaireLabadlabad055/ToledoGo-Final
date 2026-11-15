-- Run after admin-ledger-moderation.sql before deploying the customer feedback form.
create table if not exists public.customer_feedback (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comments text not null default '' check (char_length(comments) <= 1000),
  status text not null default 'new' check (status in ('new', 'reviewed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table public.customer_feedback enable row level security;
drop policy if exists "Admins can manage customer feedback" on public.customer_feedback;
create policy "Admins can manage customer feedback"
on public.customer_feedback
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.submit_customer_feedback(
  feedback_rating integer,
  feedback_comments text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
  cleaned_comments text := trim(coalesce(feedback_comments, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to submit feedback';
  end if;
  if not exists (select 1 from public.customers where id = auth.uid()) then
    raise exception 'Customer profile not found';
  end if;
  if feedback_rating is null or feedback_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5 stars';
  end if;
  if char_length(cleaned_comments) > 1000 then
    raise exception 'Feedback comments cannot exceed 1000 characters';
  end if;

  insert into public.customer_feedback (customer_id, rating, comments)
  values (auth.uid(), feedback_rating, cleaned_comments)
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.submit_customer_feedback(integer, text) from public;
grant execute on function public.submit_customer_feedback(integer, text) to authenticated;

notify pgrst, 'reload schema';
