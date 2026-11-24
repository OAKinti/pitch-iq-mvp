import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getShareConfig } from '../../../services/share/shareConfig';

const SRC = join(__dirname, '..', '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe('shareConfig', () => {
  it('reads only the two allowlisted share ids and nulls malformed values', () => {
    expect(
      getShareConfig({
        EXPO_PUBLIC_FACEBOOK_APP_ID: ' 1234567890 ',
        EXPO_PUBLIC_TIKTOK_CLIENT_KEY: ' aw_Key-12 ',
        EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      }),
    ).toEqual({ facebookAppId: '1234567890', tiktokClientKey: 'aw_Key-12' });
    expect(getShareConfig({})).toEqual({ facebookAppId: null, tiktokClientKey: null });
    expect(
      getShareConfig({
        EXPO_PUBLIC_FACEBOOK_APP_ID: 'abc123',
        EXPO_PUBLIC_TIKTOK_CLIENT_KEY: 'a b!',
      }),
    ).toEqual({ facebookAppId: null, tiktokClientKey: null });
    expect(
      getShareConfig({
        EXPO_PUBLIC_FACEBOOK_APP_ID: '1234',
        EXPO_PUBLIC_TIKTOK_CLIENT_KEY: '12345',
      }),
    ).toEqual({ facebookAppId: null, tiktokClientKey: null });
    expect(
      getShareConfig({ EXPO_PUBLIC_FACEBOOK_APP_ID: '   ', EXPO_PUBLIC_TIKTOK_CLIENT_KEY: '' }),
    ).toEqual({ facebookAppId: null, tiktokClientKey: null });
  });

  it('falls back to static process.env reads when no override is given', () => {
    const prevApp = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
    const prevKey = process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY;
    process.env.EXPO_PUBLIC_FACEBOOK_APP_ID = '99999';
    delete process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY;
    try {
      expect(getShareConfig()).toEqual({ facebookAppId: '99999', tiktokClientKey: null });
    } finally {
      if (prevApp === undefined) delete process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
      else process.env.EXPO_PUBLIC_FACEBOOK_APP_ID = prevApp;
      if (prevKey !== undefined) process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY = prevKey;
    }
  });

  it('services read share ids only in shareConfig.ts', () => {
    const offenders = walk(join(SRC, 'services'))
      .filter((f) =>
        /EXPO_PUBLIC_(FACEBOOK_APP_ID|TIKTOK_CLIENT_KEY)/.test(readFileSync(f, 'utf8')),
      )
      .map((f) => relative(SRC, f).replace(/\\/g, '/'));
    expect(offenders).toEqual(['services/share/shareConfig.ts']);
  });

  it('every EXPO_PUBLIC name in src is on the allowlist', () => {
    const allowed = new Set([
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_DEMO_MODE',
      'EXPO_PUBLIC_FACEBOOK_APP_ID',
      'EXPO_PUBLIC_TIKTOK_CLIENT_KEY',
    ]);
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)) {
        if (!allowed.has(m[0])) bad.push(`${relative(SRC, f)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
