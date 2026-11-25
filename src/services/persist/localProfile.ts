import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgeBracket, ConsentRecord, ConsentType } from '../../types/contracts';

export interface LocalProfile {
  ageBracket: AgeBracket | null;
  consents: ConsentRecord[];
  onboardedAt: string | null;
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface LocalProfileStore {
  load(): Promise<LocalProfile>;
  /** Merges the patch into the stored profile. Never throws (falls back to memory). */
  save(patch: Partial<LocalProfile>): Promise<void>;
}

export const LOCAL_PROFILE_KEY = 'pitchiq.localProfile.v1';

const AGE_BRACKETS: readonly AgeBracket[] = ['under_13', 'teen_13_17', 'adult_18_plus'];
const CONSENT_TYPES: readonly ConsentType[] = ['camera_skeletal_tracking', 'voice_coach', 'parental_verified'];

export const emptyLocalProfile = (): LocalProfile => ({ ageBracket: null, consents: [], onboardedAt: null });

function isConsent(v: unknown): v is ConsentRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    CONSENT_TYPES.includes(r.type as ConsentType) &&
    typeof r.policyVersion === 'string' &&
    typeof r.grantedAt === 'string'
  );
}

/** Defensive parse: anything malformed degrades to an empty field, never throws. */
export function parseLocalProfile(raw: string | null): LocalProfile {
  if (!raw) return emptyLocalProfile();
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      ageBracket: AGE_BRACKETS.includes(o.ageBracket as AgeBracket) ? (o.ageBracket as AgeBracket) : null,
      consents: Array.isArray(o.consents) ? o.consents.filter(isConsent) : [],
      onboardedAt: typeof o.onboardedAt === 'string' ? o.onboardedAt : null,
    };
  } catch {
    return emptyLocalProfile();
  }
}

/** In-memory storage for jest/web or when native storage is unavailable. */
export function createMemoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
    removeItem: async (k) => {
      m.delete(k);
    },
  };
}

export function createLocalProfileStore(storage: KeyValueStorage = AsyncStorage): LocalProfileStore {
  const fallback = createMemoryStorage();
  let useFallback = false;
  const pick = (): KeyValueStorage => (useFallback ? fallback : storage);

  return {
    async load() {
      try {
        return parseLocalProfile(await pick().getItem(LOCAL_PROFILE_KEY));
      } catch {
        useFallback = true;
        return parseLocalProfile(await fallback.getItem(LOCAL_PROFILE_KEY));
      }
    },
    async save(patch) {
      const write = async (s: KeyValueStorage): Promise<void> => {
        const merged = { ...parseLocalProfile(await s.getItem(LOCAL_PROFILE_KEY)), ...patch };
        await s.setItem(LOCAL_PROFILE_KEY, JSON.stringify(merged));
      };
      try {
        await write(pick());
      } catch {
        useFallback = true;
        await write(fallback);
      }
    },
  };
}
