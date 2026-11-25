// D7.2 security-privacy-auditor findings, executed against the real migrations on Postgres.
// Each test states the attack; it must FAIL (be rejected or have no effect) once 004 is applied.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { as, asCommit, createDb, failure, seedUser, uuid } from './harness.mjs';

let db;
let adult, kid, kidVerified, stranger, owner;
let groupId, sessionId;

before(async () => {
  db = await createDb();
  adult = await seedUser(db, 1);
  kid = await seedUser(db, 2, { ageBracket: 'under_13' });
  kidVerified = await seedUser(db, 3, { ageBracket: 'under_13', verified: true });
  stranger = await seedUser(db, 4);
  owner = await seedUser(db, 5);
  groupId = uuid(900);
  sessionId = uuid(901);
  await db.query(
    `insert into public.groups (id, owner_id, name) values ($1, $2, 'Sunday League')`,
    [groupId, owner],
  );
  // The owner is added by the groups trigger (004) when present; `on conflict` keeps 001-only runs working.
  await db.query(
    `insert into public.group_members (group_id, user_id) values ($1, $2), ($1, $3), ($1, $4)
     on conflict do nothing`,
    [groupId, owner, kid, kidVerified],
  );
  await db.query(
    `insert into public.group_sessions (id, group_id, drill_type) values ($1, $2, 'ball_mastery')`,
    [sessionId, groupId],
  );
});
after(async () => {
  await db?.close();
});

// ── H-consent: clients cannot self-assert age or parental verification ──
test('H-consent: a user cannot change their own age_bracket (attempt committed)', async () => {
  await asCommit(db, 'authenticated', kid, (t) =>
    t.query(`update public.profiles set age_bracket = 'adult_18_plus' where id = $1`, [kid]),
  ).catch(() => undefined);
  const row = await db.query('select age_bracket from public.profiles where id = $1', [kid]);
  assert.equal(row.rows[0].age_bracket, 'under_13');
});

test('H-consent: the user can still edit display_name / persona', async () => {
  await as(db, 'authenticated', adult, async (t) => {
    const r = await t.query(
      `update public.profiles set display_name = 'Captain', persona = 'hype' where id = $1`,
      [adult],
    );
    assert.equal(r.affectedRows, 1);
  });
});

test('H-consent: UPDATE of age_bracket / parental_consent_verified_at is rejected for authenticated', async () => {
  const msg = await failure(
    as(db, 'authenticated', kid, (t) =>
      t.query(`update public.profiles set parental_consent_verified_at = now() where id = $1`, [
        kid,
      ]),
    ),
  );
  assert.ok(msg, 'expected permission denied');
});

test('H-consent: a client INSERT cannot pre-set parental_consent_verified_at', async () => {
  const fresh = uuid(50);
  await db.query('insert into auth.users (id) values ($1)', [fresh]);
  await asCommit(db, 'authenticated', fresh, (t) =>
    t.query(
      `insert into public.profiles (id, display_name, age_bracket, parental_consent_verified_at)
       values ($1, 'sneaky', 'under_13', now())`,
      [fresh],
    ),
  ); // the insert itself is allowed (own row); the guard trigger must sanitize it
  const row = await db.query(
    'select parental_consent_verified_at from public.profiles where id = $1',
    [fresh],
  );
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].parental_consent_verified_at, null);
});

test('H-consent: a user cannot DELETE their profile (would reset age and cascade-delete consents)', async () => {
  await db.query(
    `insert into public.consents (user_id, consent_type, policy_version) values ($1, 'camera_skeletal_tracking', 'v1')
     on conflict do nothing`,
    [kid],
  );
  const msg = await failure(
    asCommit(db, 'authenticated', kid, (t) => t.query('delete from public.profiles where id = $1', [kid])),
  );
  assert.match(msg ?? '', /permission denied/);
  const p = await db.query('select age_bracket from public.profiles where id = $1', [kid]);
  assert.equal(p.rows[0].age_bracket, 'under_13');
  const c = await db.query('select count(*)::int n from public.consents where user_id = $1', [kid]);
  assert.equal(c.rows[0].n, 1);
});

test("H-consent: a client cannot insert a 'parental_verified' consent", async () => {
  const msg = await failure(
    as(db, 'authenticated', kid, (t) =>
      t.query(
        `insert into public.consents (user_id, consent_type, policy_version) values ($1, 'parental_verified', 'v1')`,
        [kid],
      ),
    ),
  );
  assert.ok(msg, 'expected RLS violation');
});

test('H-consent: consent rows cannot be deleted; revocation sets revoked_at', async () => {
  await db.query(
    `insert into public.consents (user_id, consent_type, policy_version) values ($1, 'camera_skeletal_tracking', 'v1')`,
    [adult],
  );
  // The DELETE attempt is committed if it succeeds; a rejected one aborts only its own transaction.
  await asCommit(db, 'authenticated', adult, (t) =>
    t.query('delete from public.consents where user_id = $1', [adult]),
  ).catch(() => undefined);
  const left = await db.query('select count(*)::int n from public.consents where user_id = $1', [
    adult,
  ]);
  assert.equal(left.rows[0].n, 1, 'delete must not remove the written release');
  await as(db, 'authenticated', adult, async (t) => {
    const r = await t.query('update public.consents set revoked_at = now() where user_id = $1', [
      adult,
    ]);
    assert.equal(r.affectedRows, 1, 'revocation via revoked_at is allowed');
  });
  const msg = await failure(
    as(db, 'authenticated', adult, (t) =>
      t.query(`update public.consents set policy_version = 'v0' where user_id = $1`, [adult]),
    ),
  );
  assert.ok(msg, 'only revoked_at may be updated');
});

// ── H-groups: joining requires an invite; minors stay hidden until verified ──
test('H-groups: a stranger cannot add themselves to a group by id', async () => {
  const msg = await failure(
    as(db, 'authenticated', stranger, (t) =>
      t.query('insert into public.group_members (group_id, user_id) values ($1, $2)', [
        groupId,
        stranger,
      ]),
    ),
  );
  assert.ok(msg, 'direct self-join must be rejected');
});

test('H-groups: results only into sessions of groups you belong to', async () => {
  const msg = await failure(
    as(db, 'authenticated', stranger, (t) =>
      t.query(
        'insert into public.group_session_results (session_id, user_id, ovr) values ($1, $2, 80)',
        [sessionId, stranger],
      ),
    ),
  );
  assert.ok(msg, 'non-member result insert must be rejected');
});

test('H-groups: co-members cannot read an unverified under-13 profile', async () => {
  const r = await as(db, 'authenticated', owner, (t) =>
    t.query('select id from public.profiles where id = $1', [kid]),
  );
  assert.equal(r.rows.length, 0);
  const v = await as(db, 'authenticated', owner, (t) =>
    t.query('select id from public.profiles where id = $1', [kidVerified]),
  );
  assert.equal(v.rows.length, 1, 'a parent-verified minor is visible to co-members');
});

// ── H-purge / Medium: SECURITY DEFINER functions ──
test('H-purge: anon and authenticated cannot execute purge_expired_raw_videos()', async () => {
  for (const role of ['anon', 'authenticated']) {
    const msg = await failure(
      as(db, role, adult, (t) => t.query('select public.purge_expired_raw_videos()')),
    );
    assert.match(msg ?? '', /permission denied/, `${role} must not execute the purge`);
  }
  await as(db, 'service_role', null, (t) => t.query('select public.purge_expired_raw_videos()'));
});

test('Medium: SECURITY DEFINER functions in public pin an empty search_path', async () => {
  const r = await db.query(
    `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef`,
  );
  for (const row of r.rows) {
    assert.ok(
      (row.proconfig ?? []).some((c) => c === 'search_path=' || c === 'search_path=""'),
      `${row.proname} search_path: ${row.proconfig}`,
    );
  }
});

// ── Medium: TTL window and video path ownership ──
test('Medium: a client cannot push created_at / raw_video_expires_at past the 90-day window', async () => {
  const id = uuid(700);
  await asCommit(db, 'authenticated', adult, (t) =>
    t.query(
      `insert into public.drill_sessions (id, user_id, drill_type, started_at, metrics, created_at, raw_video_expires_at)
       values ($1, $2, 'ball_mastery', now(), '{}', '2099-01-01', '2099-03-01')`,
      [id, adult],
    ),
  ); // allowed; the pin trigger must rewrite the TTL columns
  const r = await db.query(
    `select raw_video_expires_at <= now() + interval '90 days 1 minute' as ok from public.drill_sessions where id = $1`,
    [id],
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].ok, true);
});

test("Medium: raw_video_path must live under the owner's folder", async () => {
  const msg = await failure(
    as(db, 'authenticated', adult, (t) =>
      t.query(
        `insert into public.drill_sessions (user_id, drill_type, started_at, metrics, raw_video_path)
         values ($1, 'ball_mastery', now(), '{}', $2)`,
        [adult, `${kid}/clip.mp4`],
      ),
    ),
  );
  assert.ok(msg, "another user's path must be rejected");
});
