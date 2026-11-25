-- 006_advisor_fixes.sql — Supabase security-advisor findings on the live project (Nov 25 2026).
-- Body only compares enum literals and calls now(), so an empty search_path is safe.
alter function public.enforce_minor_privacy() set search_path = '';

-- is_group_member() is only meaningful for a signed-in user (it reads auth.uid()); RLS policies on
-- the group tables call it as `authenticated`. anon has no use for it.
revoke execute on function public.is_group_member(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated, service_role;

-- Accepted advisor warnings (by design, D-9): anonymous users satisfy `authenticated` policies
-- (D-9A anonymous sign-in); create_group_invite / join_group_by_invite are SECURITY DEFINER RPCs that
-- authenticated users are meant to call (D-9B), each checking auth.uid() and membership/age itself.
