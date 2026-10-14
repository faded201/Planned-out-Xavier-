-- IP addresses are personal data; restrict access to the owner-only server API.
alter table public.xavier_ai_usage add column if not exists client_ip inet;
comment on column public.xavier_ai_usage.client_ip is
  'Azure ingress client IP; cleared after 30 days by pg_cron';
-- Supabase project must have pg_cron enabled. The job runs daily at 02:17 UTC.
select cron.schedule(
  'xavier_ip_retention_30_days',
  '17 2 * * *',
  $$update public.xavier_ai_usage
    set client_ip = null
    where client_ip is not null
      and occurred_at < now() - interval '30 days'$$
);
