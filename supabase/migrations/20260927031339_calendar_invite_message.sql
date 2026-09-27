alter table public.xp_calendar_invites
  add column if not exists invite_message text not null default ''
  check (char_length(invite_message) <= 1000);

-- The invitation email endpoint already expects this field, but the earlier
-- daily essentials migration has not been applied in all deployments.
alter table public.xp_calendar_invites
  add column if not exists email_sent_at timestamptz;

grant update(email_sent_at) on public.xp_calendar_invites to authenticated;

drop policy if exists "calendar owner tracks invitation email" on public.xp_calendar_invites;
create policy "calendar owner tracks invitation email" on public.xp_calendar_invites
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
