#!/usr/bin/env node
// Live smoke test against the deployed Supabase project (contract v1.2.0, D-9).
// Usage: node --env-file=.env scripts/smoke-live.mjs
//   needs EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, PURGE_CRON_SECRET;
//   SMOKE_SERVICE_KEY (optional, never stored) lets the script delete the test users it created.
// Creates 3 anonymous users (adult owner, adult friend, under-13), exercises RLS, the invite RPCs,
// the Tier-2 gate and the purge endpoint, then cleans up. Prints no keys or tokens.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const CRON = process.env.PURGE_CRON_SECRET;
const SERVICE = process.env.SMOKE_SERVICE_KEY;
if (!URL || !ANON || !CRON) {
  console.error(
    'missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / PURGE_CRON_SECRET',
  );
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const client = () =>
  createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function anonUser(label, ageBracket) {
  const c = client();
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`${label} sign-in: ${error.message}`);
  const id = data.user.id;
  const p = await c
    .from('profiles')
    .insert({ id, display_name: `smoke-${label}`, age_bracket: ageBracket });
  if (p.error) throw new Error(`${label} profile: ${p.error.message}`);
  return { c, id };
}

const debriefBody = {
  v: 2,
  persona: 'captain',
  metrics: {
    drill: 'ball_mastery',
    touches: 42,
    touchesPerMinute: 84,
    footBalance: 0.8,
    rhythmCv: 0.12,
    hipSway: 0.04,
  },
  ovr: {
    value: 74.5,
    band: 'standard',
    position: 'MID',
    attributes: { pace: 70, agility: 72, ballControl: 80, balance: 75, rhythm: 71, endurance: 69 },
  },
  badges: [],
  archetype: null,
  wearables: [],
};

const created = [];
try {
  const owner = await anonUser('owner', 'adult_18_plus');
  const friend = await anonUser('friend', 'teen_13_17');
  const kid = await anonUser('kid', 'under_13');
  created.push(owner.id, friend.id, kid.id);
  check('anonymous sign-in + own profile insert (3 users)', true);

  // consents: allowed type ok, parental_verified refused
  const ok = await owner.c.from('consents').insert({
    user_id: owner.id,
    consent_type: 'camera_skeletal_tracking',
    policy_version: 'smoke',
  });
  check('consent insert (camera_skeletal_tracking)', !ok.error, ok.error?.message);
  const pv = await kid.c
    .from('consents')
    .insert({ user_id: kid.id, consent_type: 'parental_verified', policy_version: 'smoke' });
  check("client cannot insert 'parental_verified'", !!pv.error);

  // age lock + no profile delete
  await kid.c.from('profiles').update({ age_bracket: 'adult_18_plus' }).eq('id', kid.id);
  const age = await kid.c.from('profiles').select('age_bracket').eq('id', kid.id).single();
  check(
    'age_bracket cannot be changed by the client',
    age.data?.age_bracket === 'under_13',
    age.data?.age_bracket,
  );
  await kid.c.from('profiles').delete().eq('id', kid.id);
  const still = await kid.c.from('profiles').select('id').eq('id', kid.id);
  check('profile cannot be deleted by the client', (still.data ?? []).length === 1);

  // squad + invite
  const g = await owner.c
    .from('groups')
    .insert({ name: 'Smoke squad', owner_id: owner.id })
    .select('id')
    .single();
  check('group create (owner auto-member)', !g.error, g.error?.message);
  const groupId = g.data?.id;
  const direct = await friend.c
    .from('group_members')
    .insert({ group_id: groupId, user_id: friend.id });
  check('direct self-join rejected', !!direct.error);
  const inv = await owner.c.rpc('create_group_invite', { p_group_id: groupId });
  check(
    'create_group_invite returns a 10-char code',
    /^[A-HJ-NP-Z2-9]{10}$/.test(inv.data ?? ''),
    inv.error?.message,
  );
  const join = await friend.c.rpc('join_group_by_invite', { p_code: inv.data });
  check('friend joins via invite', join.data === groupId, join.error?.message);
  const kidJoin = await kid.c.rpc('join_group_by_invite', { p_code: inv.data });
  check(
    'unverified under-13 join refused',
    /parental_consent_required/.test(kidJoin.error?.message ?? ''),
  );
  const kidInvite = await kid.c.rpc('create_group_invite', { p_group_id: groupId });
  check('unverified under-13 cannot create invites', !!kidInvite.error);
  const purgeRpc = await owner.c.rpc('purge_expired_raw_videos');
  check('purge RPC not callable by clients', !!purgeRpc.error);

  // Tier-2 gate (no third-party call for an unverified under-13)
  const kd = await kid.c.functions.invoke('voice-debrief', { body: debriefBody });
  const kdBody = kd.data ?? (await kd.error?.context?.json?.().catch(() => null));
  check(
    'voice-debrief: under-13 -> parental_consent_required',
    kdBody?.reason === 'parental_consent_required',
    JSON.stringify(kdBody),
  );
  const legacy = await owner.c.functions.invoke('voice-debrief', {
    body: { system: 'x', user: 'y' },
  });
  const legacyBody = legacy.data ?? (await legacy.error?.context?.json?.().catch(() => null));
  check(
    'voice-debrief rejects legacy {system,user}',
    legacyBody?.reason === 'legacy_prompt_rejected',
    JSON.stringify(legacyBody),
  );
  const qa = await kid.c.functions.invoke('voice-qa', { body: { seconds: 30 } });
  const qaBody = qa.data ?? (await qa.error?.context?.json?.().catch(() => null));
  check(
    'voice-qa: under-13 granted nothing',
    qaBody?.ok === false && qaBody?.reason === 'parental_consent_required',
    JSON.stringify(qaBody),
  );

  // purge endpoint auth
  const noAuth = await fetch(`${URL}/functions/v1/purge-raw-video`, { method: 'POST', body: '{}' });
  check('purge-raw-video without token -> 401', noAuth.status === 401, String(noAuth.status));
  const withAuth = await fetch(`${URL}/functions/v1/purge-raw-video`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const purgeBody = await withAuth.json().catch(() => null);
  check(
    'purge-raw-video with cron token -> ok (rows + storage sweep)',
    withAuth.status === 200 && purgeBody?.ok === true && purgeBody?.sweep?.ok === true,
    `${withAuth.status} ${JSON.stringify(purgeBody)}`,
  );
} catch (e) {
  check('smoke run', false, e.message);
} finally {
  if (SERVICE && created.length) {
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
    let removed = 0;
    let lastError = '';
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) lastError = error.message;
      else removed++;
    }
    console.log(
      `cleanup: deleted ${removed}/${created.length} smoke users (profiles cascade)${lastError ? ` - ${lastError}` : ''}`,
    );
    if (removed < created.length) {
      console.log(
        '  fallback: npx supabase db query --remote --yes "delete from auth.users where id in (select id from public.profiles where display_name like \'smoke-%\')"',
      );
    }
  } else if (created.length) {
    console.log(
      `cleanup skipped (no SMOKE_SERVICE_KEY): ${created.length} anonymous smoke users remain`,
    );
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
