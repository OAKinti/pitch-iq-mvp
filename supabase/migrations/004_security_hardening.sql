-- 004_security_hardening.sql — contract v1.2.0 (Nov 24 2026, D-9; owner decisions A/B/C)
-- Fixes the D7.2 security-privacy-auditor findings (CLAUDE.md non-negotiable 4) and adds invite-only
-- squad joins (B) and the under-13 Tier-2 gate (C). Executed by supabase/tests/db/*.test.mjs on
-- Postgres (PGlite) via `npm run test:db`.
--
-- Avoids pgcrypto on purpose: Supabase installs it in schema `extensions`, so with an empty
-- search_path its functions would need an environment-specific prefix. gen_random_uuid() is core.

-- ═══════════ H-consent: clients cannot self-assert age or parental verification ═══════════
-- A column-level REVOKE is a no-op while the table-level UPDATE grant (Supabase default) exists:
-- revoke at table level, grant back only the user-editable columns.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, visibility, position, persona, updated_at) on public.profiles to authenticated;

-- Belt and braces (also covers INSERT): API roles can never set parental verification, and the
-- age bracket is fixed once written. Only service_role (a future verifiable-parental-consent
-- provider webhook, D-9C) may set parental_consent_verified_at.
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.parental_consent_verified_at := null;
    else
      new.age_bracket := old.age_bracket;
      new.parental_consent_verified_at := old.parental_consent_verified_at;
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- Consents are an insert-only written release; revocation is recorded in revoked_at, never deleted.
drop policy if exists consents_owner on public.consents;
create policy consents_owner_read on public.consents
  for select using (user_id = auth.uid());
create policy consents_owner_insert on public.consents
  for insert with check (user_id = auth.uid() and consent_type <> 'parental_verified');
create policy consents_owner_revoke on public.consents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update, delete on public.consents from anon, authenticated;
grant update (revoked_at) on public.consents to authenticated;

-- ═══════════ H-groups: invite-only joins (D-9B), minors hidden until parent-verified ═══════════
alter function public.is_group_member(uuid) set search_path = '';

drop policy if exists group_members_self_join on public.group_members;
revoke insert, update on public.group_members from anon, authenticated;

-- The group owner becomes a member automatically (direct member inserts are no longer allowed).
create or replace function public.groups_add_owner_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members (group_id, user_id) values (new.id, new.owner_id)
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.groups_add_owner_member() from public, anon, authenticated;
create trigger groups_add_owner_member
  after insert on public.groups
  for each row execute function public.groups_add_owner_member();

create table public.group_invites (
  code        text primary key check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  group_id    uuid not null references public.groups (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  max_uses    integer not null default 25 check (max_uses between 1 and 100),
  uses        integer not null default 0 check (uses >= 0)
);
alter table public.group_invites enable row level security;
create policy group_invites_member_read on public.group_invites
  for select using (public.is_group_member(group_id));
revoke insert, update, delete on public.group_invites from anon, authenticated;

-- 10-char code over a 32-symbol alphabet without 0/O/1/I (50 bits), from gen_random_uuid() bytes.
create or replace function public.create_group_invite(p_group_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..9 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.group_invites (code, group_id, created_by) values (v_code, p_group_id, v_uid);
      return v_code;
    exception when unique_violation then
      -- astronomically rare collision: draw again
    end;
  end loop;
end $$;

-- Join a squad from an invite link. Under-13 users can join only after verifiable parental consent
-- (their membership exposes them to co-members).
create or replace function public.join_group_by_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.group_invites%rowtype;
  v_profile public.profiles%rowtype;
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'profile_required' using errcode = '42501';
  end if;
  if v_profile.age_bracket = 'under_13' and v_profile.parental_consent_verified_at is null then
    raise exception 'parental_consent_required' using errcode = '42501';
  end if;

  select * into v_invite from public.group_invites where code = upper(trim(p_code)) for update;
  if not found or v_invite.expires_at <= now() or v_invite.uses >= v_invite.max_uses then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;

  insert into public.group_members (group_id, user_id) values (v_invite.group_id, v_uid)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.group_invites set uses = uses + 1 where code = v_invite.code;
  end if;
  return v_invite.group_id;
end $$;

revoke execute on function public.create_group_invite(uuid) from public, anon;
revoke execute on function public.join_group_by_invite(text) from public, anon;
grant execute on function public.create_group_invite(uuid) to authenticated, service_role;
grant execute on function public.join_group_by_invite(text) to authenticated, service_role;

drop policy if exists group_results_self_write on public.group_session_results;
create policy group_results_member_write on public.group_session_results
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.group_sessions s
                where s.id = session_id and public.is_group_member(s.group_id))
  );

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

-- ═══════════ H-purge: raw-video TTL (<= 90 days) ═══════════
revoke execute on function public.purge_expired_raw_videos() from public, anon, authenticated;
grant execute on function public.purge_expired_raw_videos() to service_role;
alter function public.purge_expired_raw_videos() set search_path = '';

-- 001's nightly job ran the SQL function alone, nulling pointers WITHOUT deleting storage objects.
-- The only deletion path is now the `purge-raw-video` edge function (paged, pointer cleared after
-- its object is deleted). Schedule it with pg_net + Vault (docs/RELEASE_CHECKLIST.md).
-- Dynamic SQL: a direct cron.job reference fails at plan time when pg_cron is absent.
do $$
begin
  if to_regclass('cron.job') is not null then
    execute $q$ select cron.unschedule(jobid) from cron.job where jobname = 'purge-expired-raw-videos' $q$;
  end if;
end $$;

-- Medium: the server pins created_at, so a client cannot widen the 90-day CHECK window.
create or replace function public.drill_sessions_pin_ttl()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.created_at := now();
    new.raw_video_expires_at := least(coalesce(new.raw_video_expires_at, now() + interval '90 days'),
                                      now() + interval '90 days');
  end if;
  return new;
end $$;
create trigger drill_sessions_pin_ttl
  before insert on public.drill_sessions
  for each row execute function public.drill_sessions_pin_ttl();
revoke update on public.drill_sessions from anon, authenticated;
grant update (metrics, ovr, raw_video_path) on public.drill_sessions to authenticated;

-- Medium: a session may only point at a video in its owner's storage folder.
alter table public.drill_sessions
  add constraint raw_video_path_owned
  check (raw_video_path is null or raw_video_path like (user_id::text || '/%')) not valid;

-- ═══════════ D-9C: Tier 2 (third-party AI/TTS) needs verifiable parental consent under 13 ═══════════
-- 'ok' | 'profile_required' | 'parental_consent_required'. voice-debrief and voice-qa call this
-- before reserving quota or contacting Anthropic / ElevenLabs.
create or replace function public.voice_tier2_status(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when p.id is null then 'profile_required'
           when p.age_bracket = 'under_13' and p.parental_consent_verified_at is null
             then 'parental_consent_required'
           else 'ok'
         end
    from (select 1) as one
    left join public.profiles p on p.id = p_user_id
$$;
revoke execute on function public.voice_tier2_status(uuid) from public, anon, authenticated;
grant execute on function public.voice_tier2_status(uuid) to service_role;
