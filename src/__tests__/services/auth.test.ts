import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthService } from '../../services/supabase/auth';
import { DEMO_USER_ID } from '../../services/supabase/repository';

interface Opts {
  stored?: { id: string; anon?: boolean } | null;
  signInError?: boolean;
  getSessionThrows?: boolean;
}

function fakeAuthClient(opts: Opts = {}) {
  let stored = opts.stored ?? null;
  const getSession = jest.fn(async () => {
    if (opts.getSessionThrows) throw new Error('network');
    return {
      data: {
        session: stored ? { user: { id: stored.id, is_anonymous: stored.anon ?? true } } : null,
      },
      error: null,
    };
  });
  const signInAnonymously = jest.fn(async () => {
    if (opts.signInError)
      return { data: { session: null, user: null }, error: { message: 'offline' } };
    stored = { id: 'anon-1', anon: true };
    return {
      data: { session: { user: { id: 'anon-1', is_anonymous: true } }, user: { id: 'anon-1' } },
      error: null,
    };
  });
  const client = { auth: { getSession, signInAnonymously } } as unknown as SupabaseClient;
  return { client, getSession, signInAnonymously };
}

describe('createAuthService', () => {
  it('AUTH-1: signs in anonymously once, then reuses the persisted session', async () => {
    const f = fakeAuthClient();
    const auth = createAuthService(f.client);
    expect(auth.currentUserId()).toBeNull();
    expect(await auth.ensureSession()).toEqual({ userId: 'anon-1', isAnonymous: true });
    expect(await auth.ensureSession()).toEqual({ userId: 'anon-1', isAnonymous: true });
    expect(auth.currentUserId()).toBe('anon-1');
    expect(f.signInAnonymously).toHaveBeenCalledTimes(1);

    // A fresh service (app restart) finds the stored session and never signs in again.
    const restarted = createAuthService(f.client);
    expect((await restarted.ensureSession())?.userId).toBe('anon-1');
    expect(f.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('AUTH-1: concurrent callers share one sign-in', async () => {
    const f = fakeAuthClient();
    const auth = createAuthService(f.client);
    const [a, b] = await Promise.all([auth.ensureSession(), auth.ensureSession()]);
    expect(a).toEqual(b);
    expect(f.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('AUTH-1: reuses an existing (non-anonymous) session without signing in', async () => {
    const f = fakeAuthClient({ stored: { id: 'real-user', anon: false } });
    const auth = createAuthService(f.client);
    expect(await auth.ensureSession()).toEqual({ userId: 'real-user', isAnonymous: false });
    expect(f.signInAnonymously).not.toHaveBeenCalled();
  });

  it('AUTH-1: never throws; resolves null when sign-in fails or the network throws, and retries later', async () => {
    const failing = fakeAuthClient({ signInError: true });
    const auth = createAuthService(failing.client);
    await expect(auth.ensureSession()).resolves.toBeNull();
    await expect(auth.ensureSession()).resolves.toBeNull();
    expect(failing.signInAnonymously).toHaveBeenCalledTimes(2);
    expect(auth.currentUserId()).toBeNull();

    const throwing = fakeAuthClient({ getSessionThrows: true });
    await expect(createAuthService(throwing.client).ensureSession()).resolves.toBeNull();
  });

  it('falls back to the user object when sign-in returns no session', async () => {
    const signInAnonymously = jest.fn(async () => ({
      data: { session: null, user: { id: 'u-9', is_anonymous: true } },
      error: null,
    }));
    const client = {
      auth: { getSession: async () => ({ data: { session: null } }), signInAnonymously },
    } as unknown as SupabaseClient;
    expect((await createAuthService(client).ensureSession())?.userId).toBe('u-9');
  });

  it('keeps the last known session if a later refresh attempt fails', async () => {
    const f = fakeAuthClient();
    const auth = createAuthService(f.client);
    await auth.ensureSession();
    f.getSession.mockRejectedValueOnce(new Error('offline'));
    expect((await auth.ensureSession())?.userId).toBe('anon-1');
  });

  it('Demo Mode (null client) gets the fixed demo session', async () => {
    const auth = createAuthService(null);
    expect(auth.currentUserId()).toBe(DEMO_USER_ID);
    expect(await auth.ensureSession()).toEqual({ userId: DEMO_USER_ID, isAnonymous: true });
  });
});
