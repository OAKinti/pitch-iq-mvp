-- 007_prelaunch_hardening.sql — B-6 pre-launch Mediums + Lows from the D7.2 re-audit (Nov 25 2026).

-- ═══════════ M1: co-members see a display name only (not age bracket / verification) ═══════════
-- 004's profiles_group_read exposed the whole profile row to squad-mates. Replace it with a members-only
-- RPC that returns names only; an unverified under-13 shows as 'Player'.
drop policy if exists profiles_group_read on public.profiles;

create or replace function public.squad_member_names(p_group_id uuid)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select m.user_id,
         case
           when p.age_bracket = 'under_13' and p.parental_consent_verified_at is null then 'Player'
           else coalesce(p.display_name, 'Player')
         end
    from public.group_members m
    left join public.profiles p on p.id = m.user_id
   where m.group_id = p_group_id
     and exists (select 1 from public.group_members me
                  where me.group_id = p_group_id and me.user_id = auth.uid())
$$;
revoke execute on function public.squad_member_names(uuid) from public, anon;
grant execute on function public.squad_member_names(uuid) to authenticated, service_role;

-- ═══════════ M2: global daily cap on Tier-2 spend (anonymous-account farming) ═══════════
-- Per-user monthly caps (003) can be multiplied by creating accounts. This adds a project-wide daily
-- ceiling checked by voice-debrief / voice-qa before any provider call.
create table public.voice_daily_global (
  day           date primary key,
  debriefs      integer not null default 0 check (debriefs >= 0),
  qa_seconds    integer not null default 0 check (qa_seconds >= 0)
);
alter table public.voice_daily_global enable row level security; -- no policies: service_role only
revoke all on public.voice_daily_global from anon, authenticated;

-- true = this debrief fits under today's ceiling (and is counted); false = ceiling reached.
create or replace function public.reserve_global_debrief(p_cap integer default 1000)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_cap integer := least(greatest(coalesce(p_cap, 1000), 1), 100000);
  v_ok boolean;
begin
  insert into public.voice_daily_global (day) values (v_day) on conflict (day) do nothing;
  update public.voice_daily_global set debriefs = debriefs + 1
   where day = v_day and debriefs < v_cap
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke execute on function public.reserve_global_debrief(integer) from public, anon, authenticated;
grant execute on function public.reserve_global_debrief(integer) to service_role;

-- ═══════════ M3: storage sweep for objects no drill_sessions row points at ═══════════
-- Direct uploads, deleted rows and overwritten paths left raw video outside the row-based purge.
-- Every raw-video object is <= 90 days by policy (debrief audio: 30 days), so sweep by object age.
create or replace function public.list_stale_storage_objects(p_bucket text, p_limit integer default 500)
returns setof text language plpgsql stable security definer set search_path = '' as $$
declare
  v_max_age interval;
begin
  v_max_age := case p_bucket
                 when 'raw-video' then interval '90 days'
                 when 'debrief-audio' then interval '30 days'
               end;
  if v_max_age is null then
    raise exception 'bucket_not_swept' using errcode = '22023';
  end if;
  return query
    select o.name from storage.objects o
     where o.bucket_id = p_bucket and o.created_at <= now() - v_max_age
     order by o.created_at
     limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;
revoke execute on function public.list_stale_storage_objects(text, integer) from public, anon, authenticated;
grant execute on function public.list_stale_storage_objects(text, integer) to service_role;

-- ═══════════ Lows ═══════════
-- raw_video_path: no parent-directory segments.
alter table public.drill_sessions
  add constraint raw_video_path_no_traversal
  check (raw_video_path is null or raw_video_path not like '%..%') not valid;

-- Consents: the server stamps granted_at, and a revocation cannot be undone by the client.
create or replace function public.consents_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.granted_at := now();
      new.revoked_at := null;
    else
      new.granted_at := old.granted_at;
      if old.revoked_at is not null then
        new.revoked_at := old.revoked_at;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger consents_guard
  before insert or update on public.consents
  for each row execute function public.consents_guard();
