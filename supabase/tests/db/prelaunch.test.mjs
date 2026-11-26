// Migration 007 (B-6 pre-launch hardening) on Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { as, asCommit, createDb, failure, seedUser, uuid } from './harness.mjs';

let db, owner, teen, kid, outsider;
const groupId = uuid(600);

before(async () => {
  db = await createDb();
  owner = await seedUser(db, 31, { name: 'Owner' });
  teen = await seedUser(db, 32, { ageBracket: 'teen_13_17', name: 'Teen' });
  kid = await seedUser(db, 33, { ageBracket: 'under_13', name: 'Kiddo' });
  outsider = await seedUser(db, 34);
  await asCommit(db, 'authenticated', owner, (t) =>
    t.query(`insert into public.groups (id, owner_id, name) values ($1, $2, 'Squad')`, [
      groupId,
      owner,
    ]),
  );
  await db.query('insert into public.group_members (group_id, user_id) values ($1, $2), ($1, $3)', [
    groupId,
    teen,
    kid,
  ]);
  await db.query(
    `insert into storage.buckets (id, name) values ('raw-video','raw-video'), ('debrief-audio','debrief-audio') on conflict do nothing`,
  );
});
after(async () => {
  await db?.close();
});

test('M1: co-members can no longer read each other’s profile rows', async () => {
  const r = await as(db, 'authenticated', owner, (t) =>
    t.query('select id from public.profiles where id = $1', [teen]),
  );
  assert.equal(r.rows.length, 0);
});

test('M1: squad_member_names returns names only, hides an unverified under-13, members only', async () => {
  const r = await as(db, 'authenticated', owner, (t) =>
    t.query('select * from public.squad_member_names($1) order by display_name', [groupId]),
  );
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['display_name', 'user_id']);
  const byId = Object.fromEntries(r.rows.map((x) => [x.user_id, x.display_name]));
  assert.equal(byId[owner], 'Owner');
  assert.equal(byId[teen], 'Teen');
  assert.equal(byId[kid], 'Player');
  const o = await as(db, 'authenticated', outsider, (t) =>
    t.query('select * from public.squad_member_names($1)', [groupId]),
  );
  assert.equal(o.rows.length, 0, 'a non-member learns nothing');
  assert.match(
    (await failure(
      as(db, 'anon', null, (t) =>
        t.query('select * from public.squad_member_names($1)', [groupId]),
      ),
    )) ?? '',
    /permission denied/,
  );
});

test('M2: reserve_global_debrief enforces the daily ceiling and is service_role only', async () => {
  await as(db, 'service_role', null, async (t) => {
    const r = async () =>
      (await t.query('select public.reserve_global_debrief(3) as ok')).rows[0].ok;
    assert.deepEqual([await r(), await r(), await r(), await r()], [true, true, true, false]);
  });
  assert.match(
    (await failure(
      as(db, 'authenticated', owner, (t) => t.query('select public.reserve_global_debrief(1)')),
    )) ?? '',
    /permission denied/,
  );
});

test('M3: list_stale_storage_objects finds orphaned/expired objects per bucket TTL', async () => {
  await db.query(
    `insert into storage.objects (bucket_id, name, created_at) values
       ('raw-video', $1 || '/old-orphan.mp4', now() - interval '91 days'),
       ('raw-video', $1 || '/fresh.mp4', now() - interval '10 days'),
       ('debrief-audio', $1 || '/old.mp3', now() - interval '31 days'),
       ('debrief-audio', $1 || '/new.mp3', now() - interval '1 day')`,
    [owner],
  );
  await as(db, 'service_role', null, async (t) => {
    const raw = (
      await t.query(`select * from public.list_stale_storage_objects('raw-video', 100) as name`)
    ).rows.map((x) => x.name);
    assert.deepEqual(raw, [`${owner}/old-orphan.mp4`]);
    const audio = (
      await t.query(`select * from public.list_stale_storage_objects('debrief-audio', 100) as name`)
    ).rows.map((x) => x.name);
    assert.deepEqual(audio, [`${owner}/old.mp3`]);
    assert.match(
      (await failure(t.query(`select * from public.list_stale_storage_objects('avatars', 1)`))) ??
        '',
      /bucket_not_swept/,
    );
  });
  assert.ok(
    await failure(
      as(db, 'authenticated', owner, (t) =>
        t.query(`select * from public.list_stale_storage_objects('raw-video', 1)`),
      ),
    ),
  );
});

test('Low: raw_video_path rejects parent-directory segments', async () => {
  const msg = await failure(
    as(db, 'authenticated', owner, (t) =>
      t.query(
        `insert into public.drill_sessions (user_id, drill_type, started_at, metrics, raw_video_path)
         values ($1, 'ball_mastery', now(), '{}', $2)`,
        [owner, `${owner}/../${teen}/clip.mp4`],
      ),
    ),
  );
  assert.ok(msg);
});

test('Low: server stamps granted_at; a revocation cannot be undone', async () => {
  await asCommit(db, 'authenticated', teen, (t) =>
    t.query(
      `insert into public.consents (user_id, consent_type, policy_version, granted_at)
       values ($1, 'voice_coach', 'v1', '2000-01-01')`,
      [teen],
    ),
  );
  const g = await db.query(
    `select granted_at > now() - interval '1 minute' as fresh from public.consents where user_id = $1 and consent_type = 'voice_coach'`,
    [teen],
  );
  assert.equal(g.rows[0].fresh, true);
  await asCommit(db, 'authenticated', teen, (t) =>
    t.query(
      `update public.consents set revoked_at = now() where user_id = $1 and consent_type = 'voice_coach'`,
      [teen],
    ),
  );
  await asCommit(db, 'authenticated', teen, (t) =>
    t.query(
      `update public.consents set revoked_at = null where user_id = $1 and consent_type = 'voice_coach'`,
      [teen],
    ),
  );
  const r = await db.query(
    `select revoked_at from public.consents where user_id = $1 and consent_type = 'voice_coach'`,
    [teen],
  );
  assert.notEqual(r.rows[0].revoked_at, null);
});
