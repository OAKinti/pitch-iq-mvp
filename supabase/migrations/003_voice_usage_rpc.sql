-- 003_voice_usage_rpc.sql — contract v1.1.0 (Nov 24, D-6)
-- Atomic monthly voice quotas for the voice-debrief / voice-qa edge functions.
-- No new table: these RPCs write public.voice_usage (001), which clients can only SELECT (RLS).
-- All three are SECURITY DEFINER with an empty search_path and are executable by service_role only.
-- Month = first day of the current UTC month, computed here (never trusted from the caller).

-- Reserve p_chars (1..400) of the 16 000-char/month TTS budget.
-- Returns the reserved month, or NULL when the reservation would exceed the cap.
create or replace function public.reserve_debrief_chars(
  p_user_id uuid,
  p_chars integer,
  p_cap integer default 16000
) returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', timezone('utc', now()))::date;
  v_cap integer := least(coalesce(p_cap, 16000), 16000);
  v_reserved date;
begin
  if p_user_id is null then
    raise exception 'reserve_debrief_chars: p_user_id is required';
  end if;
  if p_chars is null or p_chars < 1 or p_chars > 400 then
    raise exception 'reserve_debrief_chars: p_chars must be 1..400 (got %)', p_chars;
  end if;

  insert into public.voice_usage (user_id, month)
  values (p_user_id, v_month)
  on conflict (user_id, month) do nothing;

  update public.voice_usage
     set debrief_chars_used = debrief_chars_used + p_chars
   where user_id = p_user_id
     and month = v_month
     and debrief_chars_used + p_chars <= v_cap
  returning month into v_reserved;

  return v_reserved; -- NULL = cap reached
end;
$$;

-- Give back an unused reservation (LLM refusal/error, or shorter TTS than reserved).
create or replace function public.refund_debrief_chars(
  p_user_id uuid,
  p_month date,
  p_chars integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_month is null then
    raise exception 'refund_debrief_chars: p_user_id and p_month are required';
  end if;
  if p_chars is null or p_chars < 1 or p_chars > 400 then
    raise exception 'refund_debrief_chars: p_chars must be 1..400 (got %)', p_chars;
  end if;

  update public.voice_usage
     set debrief_chars_used = greatest(0, debrief_chars_used - p_chars)
   where user_id = p_user_id
     and month = p_month;
end;
$$;

-- Tier 3 Q&A: grant min(requested, cap - used) seconds. p_seconds is clamped to 0..120
-- (0 = read remaining), p_cap_seconds to [300, 600] (matches the 001 CHECK on qa_seconds_used).
create or replace function public.consume_qa_seconds(
  p_user_id uuid,
  p_seconds integer,
  p_cap_seconds integer default 300
) returns table (granted integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', timezone('utc', now()))::date;
  v_seconds integer := least(greatest(coalesce(p_seconds, 0), 0), 120);
  v_cap integer := least(greatest(coalesce(p_cap_seconds, 300), 300), 600);
  v_used integer;
  v_granted integer;
begin
  if p_user_id is null then
    raise exception 'consume_qa_seconds: p_user_id is required';
  end if;

  insert into public.voice_usage (user_id, month)
  values (p_user_id, v_month)
  on conflict (user_id, month) do nothing;

  select vu.qa_seconds_used into v_used
    from public.voice_usage vu
   where vu.user_id = p_user_id
     and vu.month = v_month
     for update;

  v_granted := least(v_seconds, greatest(0, v_cap - v_used));

  if v_granted > 0 then
    update public.voice_usage
       set qa_seconds_used = qa_seconds_used + v_granted
     where user_id = p_user_id
       and month = v_month;
  end if;

  granted := v_granted;
  remaining := greatest(0, v_cap - v_used - v_granted);
  return next;
end;
$$;

revoke execute on function public.reserve_debrief_chars(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.refund_debrief_chars(uuid, date, integer) from public, anon, authenticated;
revoke execute on function public.consume_qa_seconds(uuid, integer, integer) from public, anon, authenticated;

grant execute on function public.reserve_debrief_chars(uuid, integer, integer) to service_role;
grant execute on function public.refund_debrief_chars(uuid, date, integer) to service_role;
grant execute on function public.consume_qa_seconds(uuid, integer, integer) to service_role;
