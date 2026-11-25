// Migration 003 quota RPCs on Postgres (complements supabase/tests/voice_usage_rpc.test.sql, which
// needs pgTAP / `supabase test db`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { as, createDb, failure, seedUser } from './harness.mjs';

let db, u;
before(async () => {
  db = await createDb();
  u = await seedUser(db, 21);
});
after(async () => {
  await db?.close();
});

const svc = (sql, params) => as(db, 'service_role', null, (t) => t.query(sql, params));

test('reserve_debrief_chars stops at the 16 000-char monthly cap and refund gives back', async () => {
  await as(db, 'service_role', null, async (t) => {
    let month = null;
    for (let i = 0; i < 40; i++) {
      month = (await t.query('select public.reserve_debrief_chars($1, 400) as m', [u])).rows[0].m;
      assert.notEqual(month, null, `reservation ${i + 1} of 40 fits`);
    }
    assert.equal(
      (await t.query('select public.reserve_debrief_chars($1, 1) as m', [u])).rows[0].m,
      null,
    );
    await t.query('select public.refund_debrief_chars($1, $2, 400)', [u, month]);
    assert.notEqual(
      (await t.query('select public.reserve_debrief_chars($1, 400) as m', [u])).rows[0].m,
      null,
    );
  });
});

test('reserve rejects out-of-range chars; consume_qa_seconds clamps and caps', async () => {
  assert.ok(await failure(svc('select public.reserve_debrief_chars($1, 401)', [u])));
  assert.ok(await failure(svc('select public.reserve_debrief_chars($1, 0)', [u])));
  await as(db, 'service_role', null, async (t) => {
    const q = async (s, cap) =>
      (await t.query('select * from public.consume_qa_seconds($1, $2, $3)', [u, s, cap])).rows[0];
    assert.deepEqual(await q(500, 300), { granted: 120, remaining: 180 }); // per-call clamp 120
    assert.deepEqual(await q(120, 300), { granted: 120, remaining: 60 });
    assert.deepEqual(await q(120, 300), { granted: 60, remaining: 0 });
    assert.deepEqual(await q(0, 9999), { granted: 0, remaining: 300 }); // cap clamped to 600: 600-300 used
  });
});

test('quota RPCs are service_role only', async () => {
  for (const role of ['anon', 'authenticated']) {
    const msg = await failure(
      as(db, role, u, (t) => t.query('select public.reserve_debrief_chars($1, 10)', [u])),
    );
    assert.match(msg ?? '', /permission denied/);
  }
});
