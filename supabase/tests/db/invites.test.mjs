// D-9B invite-only squad joins and D-9C Tier-2 gate (migration 004), on Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { as, asCommit, createDb, failure, seedUser, uuid } from './harness.mjs';

let db;
let owner, friend, kid, kidVerified, outsider;
const groupId = uuid(800);

before(async () => {
  db = await createDb();
  owner = await seedUser(db, 11);
  friend = await seedUser(db, 12);
  kid = await seedUser(db, 13, { ageBracket: 'under_13' });
  kidVerified = await seedUser(db, 14, { ageBracket: 'under_13', verified: true });
  outsider = await seedUser(db, 15);
  // created by the owner through RLS, so the owner-membership trigger runs as in production
  await asCommit(db, 'authenticated', owner, (t) =>
    t.query(`insert into public.groups (id, owner_id, name) values ($1, $2, 'Squad')`, [
      groupId,
      owner,
    ]),
  );
});
after(async () => {
  await db?.close();
});

const createInvite = (uid) =>
  asCommit(db, 'authenticated', uid, (t) =>
    t.query('select public.create_group_invite($1) as code', [groupId]),
  ).then((r) => r.rows[0].code);
const join = (uid, code) =>
  asCommit(db, 'authenticated', uid, (t) =>
    t.query('select public.join_group_by_invite($1) as g', [code]),
  ).then((r) => r.rows[0].g);
const isMember = async (uid) =>
  (
    await db.query('select 1 from public.group_members where group_id = $1 and user_id = $2', [
      groupId,
      uid,
    ])
  ).rows.length === 1;

test('creating a group makes its owner a member', async () => {
  assert.equal(await isMember(owner), true);
});

test('a member creates a 10-char code; a non-member cannot', async () => {
  const code = await createInvite(owner);
  assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.match((await failure(createInvite(outsider))) ?? '', /not_a_member/);
  assert.match(
    (await failure(
      as(db, 'anon', null, (t) => t.query('select public.create_group_invite($1)', [groupId])),
    )) ?? '',
    /permission denied/,
  );
});

test('a friend joins with the link code (case/space tolerant) and the use is counted once', async () => {
  const code = await createInvite(owner);
  assert.equal(await join(friend, ` ${code.toLowerCase()} `), groupId);
  assert.equal(await isMember(friend), true);
  assert.equal(await join(friend, code), groupId, 'joining twice is idempotent');
  const r = await db.query('select uses from public.group_invites where code = $1', [code]);
  assert.equal(r.rows[0].uses, 1);
});

test('expired, exhausted and unknown codes are rejected', async () => {
  const code = await createInvite(owner);
  await db.query(
    `update public.group_invites set expires_at = now() - interval '1 second' where code = $1`,
    [code],
  );
  assert.match((await failure(join(outsider, code))) ?? '', /invite_invalid/);
  const code2 = await createInvite(owner);
  await db.query('update public.group_invites set max_uses = 1, uses = 1 where code = $1', [code2]);
  assert.match((await failure(join(outsider, code2))) ?? '', /invite_invalid/);
  assert.match((await failure(join(outsider, 'ZZZZZZZZZZ'))) ?? '', /invite_invalid/);
  assert.equal(await isMember(outsider), false);
});

test('an under-13 without verifiable parental consent cannot join; a verified one can', async () => {
  const code = await createInvite(owner);
  assert.match((await failure(join(kid, code))) ?? '', /parental_consent_required/);
  assert.equal(await isMember(kid), false);
  assert.equal(await join(kidVerified, code), groupId);
});

test('an unverified under-13 cannot create invites, even for a squad they own (direct RPC call)', async () => {
  const kidGroup = uuid(810);
  await asCommit(db, 'authenticated', kid, (t) =>
    t.query(`insert into public.groups (id, owner_id, name) values ($1, $2, 'Kid squad')`, [
      kidGroup,
      kid,
    ]),
  );
  const msg = await failure(
    asCommit(db, 'authenticated', kid, (t) =>
      t.query('select public.create_group_invite($1)', [kidGroup]),
    ),
  );
  assert.match(msg ?? '', /parental_consent_required/);
  const n = await db.query('select count(*)::int n from public.group_invites where group_id = $1', [
    kidGroup,
  ]);
  assert.equal(n.rows[0].n, 0);
  // a parent-verified minor who is a member may invite
  const code = await asCommit(db, 'authenticated', kidVerified, (t) =>
    t.query('select public.create_group_invite($1) as code', [groupId]),
  );
  assert.match(code.rows[0].code, /^[A-HJ-NP-Z2-9]{10}$/);
});

test('clients cannot write invites directly or read other groups’ invites', async () => {
  assert.ok(
    await failure(
      as(db, 'authenticated', owner, (t) =>
        t.query(
          `insert into public.group_invites (code, group_id, created_by) values ('ABCDEFGHJK', $1, $2)`,
          [groupId, owner],
        ),
      ),
    ),
  );
  const r = await as(db, 'authenticated', outsider, (t) =>
    t.query('select code from public.group_invites'),
  );
  assert.equal(r.rows.length, 0);
});

test('D-9C voice_tier2_status: service_role only; under-13 needs verification', async () => {
  const status = (uid) =>
    as(db, 'service_role', null, (t) =>
      t.query('select public.voice_tier2_status($1) as s', [uid]),
    ).then((r) => r.rows[0].s);
  assert.equal(await status(owner), 'ok');
  assert.equal(await status(kid), 'parental_consent_required');
  assert.equal(await status(kidVerified), 'ok');
  assert.equal(await status(uuid(999)), 'profile_required');
  assert.match(
    (await failure(
      as(db, 'authenticated', kid, (t) => t.query('select public.voice_tier2_status($1)', [kid])),
    )) ?? '',
    /permission denied/,
  );
});
