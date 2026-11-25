// In-process Postgres (PGlite, WASM) with a minimal Supabase shim, so the SQL migrations and their
// RLS policies run under `node --test` (npm run test:db) without Docker or a Supabase project.
//
// Shim: roles anon / authenticated / service_role (service_role BYPASSRLS), auth.users + auth.uid()
// from `request.jwt.claim.sub` (what PostgREST sets per request), storage.buckets / storage.objects /
// storage.foldername(), and Supabase's default grants on public tables to all three API roles.
// It is NOT Supabase: no PostgREST, GoTrue, pg_cron or pg_net (the migrations guard those).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
}

/** Fresh database: shim + every migration (or up to and including the one starting with `upTo`). */
export async function createDb(upTo) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  for (const f of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
    if (upTo && f.startsWith(upTo)) break;
  }
  return db;
}

async function enter(db, role, uid) {
  await db.exec('begin');
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
  await db.exec(`set local role ${role}`);
}

/** Run `fn` as an API role with auth.uid() = uid, in a transaction that is ROLLED BACK. */
export async function as(db, role, uid, fn) {
  await enter(db, role, uid);
  try {
    return await fn(db);
  } finally {
    await db.exec('rollback');
  }
}

/** Same as `as`, but COMMITS (fixtures later calls must see). */
export async function asCommit(db, role, uid, fn) {
  await enter(db, role, uid);
  try {
    const out = await fn(db);
    await db.exec('commit');
    return out;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

/** Resolves the error message when the statement fails, or null when it succeeds. */
export async function failure(p) {
  try {
    await p;
    return null;
  } catch (e) {
    return String(e.message ?? e);
  }
}

export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Service-role fixture: an auth user + profile. */
export async function seedUser(
  db,
  n,
  { ageBracket = 'adult_18_plus', verified = false, name } = {},
) {
  const id = uuid(n);
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into public.profiles (id, display_name, age_bracket, parental_consent_verified_at)
     values ($1, $2, $3, $4)`,
    [id, name ?? `user${n}`, ageBracket, verified ? new Date().toISOString() : null],
  );
  return id;
}
