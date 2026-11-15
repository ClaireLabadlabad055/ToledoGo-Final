create table if not exists public.device_push_tokens (
  expo_push_token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists device_push_tokens_user_id_idx
  on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

revoke all on public.device_push_tokens from public, anon, authenticated;
grant all on public.device_push_tokens to service_role;
