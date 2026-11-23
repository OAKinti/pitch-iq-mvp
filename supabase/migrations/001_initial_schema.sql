-- ════════════════════════════════════════════════════════════════════════
-- PitchIQ MVP — 001_initial_schema.sql  (FROZEN Day 1, Nov 22 2026)
--
-- Invariants (enforced by scripts/check-compliance.mjs + jest):
--   * RLS is ENABLED on every table in schema public.
--   * No column stores facial geometry, faceprints, voiceprints or raw
--     per-frame landmarks — only aggregate skeletal metrics (BIPA).
--   * Raw video rows carry raw_video_expires_at <= created_at + 90 days and
--     are purged nightly.
--   * Under-13 profiles are forced to visibility 'private' (COPPA 2026).
--   * Wearable ingestion sources exclude Strava (Strava is export-only).
--   * sport is constrained to 'soccer' for the MVP; widen the CHECK in v1.1.
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────── Enums ─────────────────────────────
create type public.age_bracket as enum ('under_13', 'teen_13_17', 'adult_18_plus');
create type public.profile_visibility as enum ('private', 'friends', 'public');
create type public.player_position as enum ('GK', 'DEF', 'MID', 'FWD');
create type public.coach_persona as enum ('captain', 'drill_sergeant', 'hype');
create type public.drill_type as enum ('ball_mastery', 'agility_shuttle');
create type public.consent_type as enum ('camera_skeletal_tracking', 'voice_coach', 'parental_verified');
create type public.ingestion_source as enum ('healthkit', 'health_connect', 'whoop');

-- ──────────────────────────── Profiles ────────────────────────────
-- Neutral age gate: we persist only the derived bracket, never a birthdate.
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text not null check (char_length(display_name) between 1 and 40),
  age_bracket      public.age_bracket not null,
  visibility       public.profile_visibility not null default 'private',
  parental_consent_verified_at timestamptz,
  sport            text not null default 'soccer' check (sport in ('soccer')),
  position         public.player_position,
  persona          public.coach_persona not null default 'captain',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint under_13_is_private check (age_bracket <> 'under_13' or visibility = 'private')
);

create or replace function public.enforce_minor_privacy()
returns trigger language plpgsql as $$
begin
  if new.age_bracket = 'under_13' then
    new.visibility := 'private';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_minor_privacy
  before insert or update on public.profiles
  for each row execute function public.enforce_minor_privacy();

-- ──────────────────────────── Consents ────────────────────────────
-- BIPA-style electronic written release for camera / skeletal tracking.
create table public.consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  consent_type    public.consent_type not null,
  policy_version  text not null,
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (user_id, consent_type, policy_version)
);

-- ───────────────────────── Drill sessions ─────────────────────────
create table public.drill_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  sport                 text not null default 'soccer' check (sport in ('soccer')),
  drill_type            public.drill_type not null,
  started_at            timestamptz not null,
  -- Aggregate metrics only (BallMasteryMetrics | AgilityShuttleMetrics JSON).
  metrics               jsonb not null,
  ovr                   numeric(4,1) check (ovr between 0 and 99.9),
  raw_video_path        text,
  created_at            timestamptz not null default now(),
  raw_video_expires_at  timestamptz not null default (now() + interval '90 days'),
  constraint raw_video_ttl_max_90_days
    check (raw_video_expires_at <= created_at + interval '90 days')
);
create index drill_sessions_user_idx on public.drill_sessions (user_id, started_at desc);
create index drill_sessions_expiry_idx on public.drill_sessions (raw_video_expires_at)
  where raw_video_path is not null;

-- ─────────────────────────── Ratings ───────────────────────────
create table public.ovr_ratings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  sport        text not null default 'soccer' check (sport in ('soccer')),
  position     public.player_position not null,
  ovr          numeric(4,1) not null check (ovr between 0 and 99.9),
  attributes   jsonb not null,
  archetype_id text,
  computed_at  timestamptz not null default now()
);
create index ovr_ratings_user_idx on public.ovr_ratings (user_id, computed_at desc);

create table public.badges (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  badge_id   text not null,
  earned_at  timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- ───────────────────────── Group sessions ─────────────────────────
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  sport       text not null default 'soccer' check (sport in ('soccer')),
  created_at  timestamptz not null default now()
);

create table public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_sessions (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  drill_type  public.drill_type not null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz
);

create table public.group_session_results (
  session_id        uuid not null references public.group_sessions (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  drill_session_id  uuid references public.drill_sessions (id) on delete set null,
  ovr               numeric(4,1) not null check (ovr between 0 and 99.9),
  submitted_at      timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- Membership helper (security definer avoids recursive RLS on group_members).
create or replace function public.is_group_member(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = g and m.user_id = auth.uid());
$$;

-- ─────────────────── Wearables (canonical, ingestion) ───────────────────
-- source enum EXCLUDES strava by design.
create table public.wearable_daily_summaries (
  user_id                uuid not null references public.profiles (id) on delete cascade,
  source                 public.ingestion_source not null,
  date                   date not null,
  resting_heart_rate_bpm numeric(5,1),
  hrv_rmssd_ms           numeric(6,1),
  sleep_minutes          integer check (sleep_minutes between 0 and 1440),
  recovery_score         numeric(4,1) check (recovery_score between 0 and 100),
  strain                 numeric(4,1) check (strain between 0 and 21),
  primary key (user_id, source, date)
);

-- ───────────────────── Strava (WRITE-ONLY export log) ─────────────────────
-- Stores only our own outbound export receipts — never Strava-sourced data.
create table public.strava_exports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  drill_session_id   uuid not null references public.drill_sessions (id) on delete cascade,
  strava_activity_id text,
  exported_at        timestamptz not null default now()
);

-- ─────────────────────── Voice usage (hard cap) ───────────────────────
create table public.voice_usage (
  user_id             uuid not null references public.profiles (id) on delete cascade,
  month               date not null check (extract(day from month) = 1),
  qa_seconds_used     integer not null default 0 check (qa_seconds_used between 0 and 600),
  debrief_chars_used  integer not null default 0 check (debrief_chars_used >= 0),
  primary key (user_id, month)
);

-- ════════════════════════════ ROW LEVEL SECURITY ════════════════════════════
alter table public.profiles                 enable row level security;
alter table public.consents                 enable row level security;
alter table public.drill_sessions           enable row level security;
alter table public.ovr_ratings              enable row level security;
alter table public.badges                   enable row level security;
alter table public.groups                   enable row level security;
alter table public.group_members            enable row level security;
alter table public.group_sessions           enable row level security;
alter table public.group_session_results    enable row level security;
alter table public.wearable_daily_summaries enable row level security;
alter table public.strava_exports           enable row level security;
alter table public.voice_usage              enable row level security;

-- profiles: owner full access; others see only non-private, non-minor profiles
-- or co-members of a shared group.
create policy profiles_owner_all on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_public_read on public.profiles
  for select using (
    age_bracket <> 'under_13' and visibility = 'public'
  );
create policy profiles_group_read on public.profiles
  for select using (
    exists (
      select 1 from public.group_members mine
      join public.group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

-- Owner-only tables.
create policy consents_owner on public.consents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy drill_sessions_owner on public.drill_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ovr_ratings_owner on public.ovr_ratings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy badges_owner on public.badges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wearables_owner on public.wearable_daily_summaries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy strava_exports_owner on public.strava_exports
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- voice_usage is read-only to clients; the edge function writes with service role.
create policy voice_usage_owner_read on public.voice_usage
  for select using (user_id = auth.uid());

-- Groups.
create policy groups_member_read on public.groups
  for select using (owner_id = auth.uid() or public.is_group_member(id));
create policy groups_owner_write on public.groups
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy group_members_read on public.group_members
  for select using (public.is_group_member(group_id));
create policy group_members_self_join on public.group_members
  for insert with check (user_id = auth.uid());
create policy group_members_self_leave on public.group_members
  for delete using (user_id = auth.uid());
create policy group_sessions_member_read on public.group_sessions
  for select using (public.is_group_member(group_id));
create policy group_sessions_member_create on public.group_sessions
  for insert with check (public.is_group_member(group_id));
create policy group_results_member_read on public.group_session_results
  for select using (
    exists (select 1 from public.group_sessions s
            where s.id = session_id and public.is_group_member(s.group_id))
  );
create policy group_results_self_write on public.group_session_results
  for insert with check (user_id = auth.uid());

-- ═══════════════════════ 90-day raw video purge ═══════════════════════
create or replace function public.purge_expired_raw_videos()
returns integer language plpgsql security definer set search_path = public as $$
declare purged integer;
begin
  update public.drill_sessions
     set raw_video_path = null
   where raw_video_path is not null
     and raw_video_expires_at <= now();
  get diagnostics purged = row_count;
  -- Storage objects are deleted by the `purge-raw-video` edge function, which
  -- lists expired paths before calling this function.
  return purged;
end $$;

-- Schedule nightly at 03:15 UTC when pg_cron is available (Supabase: enable
-- the pg_cron extension in Dashboard → Database → Extensions).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-expired-raw-videos', '15 3 * * *',
                          'select public.purge_expired_raw_videos();');
  end if;
end $$;

-- Realtime: group leaderboard sync.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.group_session_results;
  end if;
end $$;
