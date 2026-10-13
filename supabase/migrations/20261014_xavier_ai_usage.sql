-- Owner-only Xavier usage metadata. No prompts, responses, IPs or raw tokens.
create table if not exists public.xavier_ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  model text not null,
  status text not null default 'success' check (status in ('success')),
  source text not null default 'azure-ai'
);
create index if not exists xavier_ai_usage_user_time_idx on public.xavier_ai_usage(user_id, occurred_at desc);
create index if not exists xavier_ai_usage_time_idx on public.xavier_ai_usage(occurred_at desc);
alter table public.xavier_ai_usage enable row level security;
revoke all on public.xavier_ai_usage from anon, authenticated;
-- Only a server-held Supabase service-role credential can write/read this table.
