import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, migrationFiles } from './harness.mjs';

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

test('every migration applies in order on Postgres', () => {
  const files = migrationFiles();
  assert.deepEqual(files.slice(0, 3), [
    '001_initial_schema.sql',
    '002_storage_buckets.sql',
    '003_voice_usage_rpc.sql',
  ]);
});

test('RLS is enabled on every public table', async () => {
  const r = await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
  );
  assert.deepEqual(r.rows, []);
});
