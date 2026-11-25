import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMO_USER_ID } from './repository';

export interface AuthSession {
  readonly userId: string;
  readonly isAnonymous: boolean;
}

export interface AuthService {
  /** getSession(); if none, signInAnonymously(). Resolves null on failure (offline) - never throws. */
  ensureSession(): Promise<AuthSession | null>;
  currentUserId(): string | null;
}

interface SessionLike {
  user: { id: string; is_anonymous?: boolean };
}

const toSession = (s: SessionLike | null | undefined): AuthSession | null =>
  s ? { userId: s.user.id, isAnonymous: s.user.is_anonymous ?? false } : null;

/** client null (Demo Mode) -> a fixed demo session { userId: DEMO_USER_ID, isAnonymous: true }. */
export function createAuthService(client: SupabaseClient | null): AuthService {
  if (!client) {
    const demo: AuthSession = { userId: DEMO_USER_ID, isAnonymous: true };
    return { ensureSession: async () => demo, currentUserId: () => demo.userId };
  }
  let current: AuthSession | null = null;
  let inflight: Promise<AuthSession | null> | null = null;

  const resolve = async (): Promise<AuthSession | null> => {
    try {
      const existing = await client.auth.getSession();
      const found = toSession(existing.data.session);
      if (found) return found;
      const { data, error } = await client.auth.signInAnonymously();
      if (error) return null;
      return toSession(data.session ?? (data.user ? { user: data.user } : null));
    } catch {
      return null;
    }
  };

  return {
    ensureSession(): Promise<AuthSession | null> {
      // Concurrent callers share one attempt, so we sign in anonymously at most once at a time.
      if (!inflight) {
        inflight = resolve().then((s) => {
          inflight = null;
          if (s) current = s;
          return s ?? current;
        });
      }
      return inflight;
    },
    currentUserId: () => current?.userId ?? null,
  };
}
