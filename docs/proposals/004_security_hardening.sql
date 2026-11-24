-- PROPOSED migration 004 — security + raw-video purge hardening (D7.2 release audit, Nov 24 2026)
-- supabase/migrations/** is a frozen area: the owner / Person B reviews this, copies it to
-- supabase/migrations/004_security_hardening.sql, then runs `supabase db push`.
--
-- Fixes two High findings in 001_initial_schema.sql (CLAUDE.md non-negotiable 4, raw video TTL <= 90 d):
--  H-1 purge_expired_raw_videos() is SECURITY DEFINER with the default PUBLIC execute grant, so any
--      client holding the anon key can call rpc('purge_expired_raw_videos'). It nulls every expired
--      raw_video_path WITHOUT deleting the storage object, orphaning those files forever.
--  H-2 001 schedules that same SQL function nightly via pg_cron. It runs without the edge function,
--      so pointers are cleared before `purge-raw-video` can list and delete the objects.
-- After this migration the only deletion path is the `purge-raw-video` edge function, which (since
-- D7.2) pages through expired rows and clears a pointer only after its object is deleted.

-- H-1: service role only; empty search_path (the body already uses public.drill_sessions).
revoke execute on function public.purge_expired_raw_videos() from public, anon, authenticated;
grant execute on function public.purge_expired_raw_videos() to service_role;
alter function public.purge_expired_raw_videos() set search_path = '';

-- H-2: drop the SQL-only nightly job.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'purge-expired-raw-videos') then
    perform cron.unschedule('purge-expired-raw-videos');
  end if;
end $$;

-- Schedule the edge function instead. Needs the pg_net extension and the service-role key stored in
-- Vault as 'service_role_key' (Dashboard -> Project Settings -> Vault). Replace <project-ref>.
-- Left commented so this migration applies cleanly before Vault is set up; run it once by hand:
--
-- select cron.schedule(
--   'purge-raw-video-edge',
--   '15 3 * * *',
--   $job$
--     select net.http_post(
--       url     := 'https://<project-ref>.supabase.co/functions/v1/purge-raw-video',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                                        where name = 'service_role_key'),
--         'Content-Type', 'application/json'),
--       body    := '{}'::jsonb)
--   $job$
-- );

-- pgTAP checks to add to supabase/tests (Person B):
--   select ok(not has_function_privilege('anon', 'public.purge_expired_raw_videos()', 'execute'));
--   select ok(not has_function_privilege('authenticated', 'public.purge_expired_raw_videos()', 'execute'));
--   select ok(has_function_privilege('service_role', 'public.purge_expired_raw_videos()', 'execute'));

-- ═══════════ Additional D7.2 findings (security-privacy-auditor), DRAFT, untested ═══════════
-- Same frozen-area rule: review, then copy into the 004 migration. Each block cites the finding.

-- SA-H2 Clients must not self-assert age or parental verification (COPPA, CLAUDE.md #4).
-- profiles_owner_all allows UPDATE of every column; restrict the sensitive ones to service_role.
-- A column-level REVOKE is a no-op while the table-level UPDATE grant (Supabase default) exists,
-- so revoke at table level and grant back only the user-editable columns.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, visibility, position, persona, updated_at) on public.profiles to authenticated;
-- (age_bracket is still set once on INSERT by the onboarding flow; a server-side check that the
--  INSERT happens only once per user, plus locking the client age gate, is part of OWNER DECISION A.)
-- consents: insert-only for the user, never 'parental_verified' (set by a verified server flow),
-- revocation through revoked_at instead of DELETE.
drop policy if exists consents_owner on public.consents;
create policy consents_owner_read on public.consents
  for select using (user_id = auth.uid());
create policy consents_owner_insert on public.consents
  for insert with check (user_id = auth.uid() and consent_type <> 'parental_verified');
create policy consents_owner_revoke on public.consents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.consents from authenticated;
grant update (revoked_at) on public.consents to authenticated;

-- SA-H1 (partial) Results only into sessions of groups you belong to.
drop policy if exists group_results_self_write on public.group_session_results;
create policy group_results_member_write on public.group_session_results
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.group_sessions s
                where s.id = session_id and public.is_group_member(s.group_id))
  );
-- SA-H1 (partial) Co-members only see an under-13 profile once a parent verified it.
drop policy if exists profiles_group_read on public.profiles;
create policy profiles_group_read on public.profiles
  for select using (
    (age_bracket <> 'under_13' or parental_consent_verified_at is not null)
    and exists (
      select 1 from public.group_members mine
      join public.group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
-- SA-H1 OWNER DECISION: group_members_self_join accepts ANY group_id. Replace with an invite flow
-- (e.g. groups.invite_code + a security-definer join_group(code) RPC) - needs a product decision.

-- SA-M1 is_group_member: empty search_path (body already schema-qualified).
alter function public.is_group_member(uuid) set search_path = '';

-- SA-M2 Pin created_at so a client cannot push the 90-day CHECK window out, and scope video paths.
create or replace function public.pin_drill_session_created_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  new.raw_video_expires_at := least(coalesce(new.raw_video_expires_at, now() + interval '90 days'),
                                    now() + interval '90 days');
  return new;
end $$;
create trigger drill_sessions_pin_created_at
  before insert on public.drill_sessions
  for each row execute function public.pin_drill_session_created_at();
alter table public.drill_sessions
  add constraint raw_video_path_owned
  check (raw_video_path is null or raw_video_path like (user_id::text || '/%'));
-- Block UPDATE of the TTL columns too (table-level revoke, then grant back the editable columns).
revoke update on public.drill_sessions from authenticated;
grant update (metrics, ovr, raw_video_path) on public.drill_sessions to authenticated;

-- ═══════════ OWNER DECISIONS (not expressible as a safe migration yet) ═══════════
-- A  Auth: the app never signs in (DEMO_USER_ID 'demo-you'); outside Demo Mode every RLS write fails
--    silently and consents / age live only in memory. Proposal: Supabase anonymous sign-in on first
--    launch, write with auth.uid(), persist age bracket + consents server-side, lock the age gate.
--    This changes src/services/supabase/** and AppStateContext and likely contracts (v1.2.0).
-- B  Group join: invite code / owner approval instead of joining any group by id (SA-H1).
-- C  COPPA Tier 2: skip the Haiku/ElevenLabs debrief for under-13 without parental verification,
--    enforced in voice-debrief from profiles (needs A), template debrief on the client meanwhile.
