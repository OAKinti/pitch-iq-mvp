import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LOCAL_PROFILE_KEY,
  createLocalProfileStore,
  createMemoryStorage,
  parseLocalProfile,
  type KeyValueStorage,
} from '../../services/persist/localProfile';

const consent = {
  type: 'camera_skeletal_tracking',
  policyVersion: '2026-11-22',
  grantedAt: 't',
} as const;
const EMPTY = { ageBracket: null, consents: [], onboardedAt: null };

describe('localProfile', () => {
  it('serializes saves issued in the same tick so neither patch is lost', async () => {
    const storage = createMemoryStorage();
    const slow: KeyValueStorage = {
      ...storage,
      // yield between read and write so unserialized saves would interleave
      getItem: async (k) => {
        await new Promise((r) => setTimeout(r, 5));
        return storage.getItem(k);
      },
    };
    const store = createLocalProfileStore(slow);
    await Promise.all([
      store.save({ ageBracket: 'teen_13_17' }),
      store.save({ consents: [consent] }),
      store.save({ onboardedAt: 'now' }),
    ]);
    expect(await store.load()).toEqual({
      ageBracket: 'teen_13_17',
      consents: [consent],
      onboardedAt: 'now',
    });
  });

  it('starts empty, then round-trips age, consents and onboardedAt (merging patches)', async () => {
    const storage = createMemoryStorage();
    const store = createLocalProfileStore(storage);
    expect(await store.load()).toEqual(EMPTY);
    await store.save({ ageBracket: 'teen_13_17' });
    await store.save({ consents: [consent], onboardedAt: 'now' });
    expect(await createLocalProfileStore(storage).load()).toEqual({
      ageBracket: 'teen_13_17',
      consents: [consent],
      onboardedAt: 'now',
    });
  });

  it('defaults to AsyncStorage when no storage is injected', async () => {
    await AsyncStorage.clear();
    const store = createLocalProfileStore();
    await store.save({ ageBracket: 'adult_18_plus' });
    expect((await createLocalProfileStore().load()).ageBracket).toBe('adult_18_plus');
    await AsyncStorage.clear();
    expect((await store.load()).ageBracket).toBeNull();
  });

  it('degrades malformed or invalid stored data to empty fields', () => {
    expect(parseLocalProfile(null)).toEqual(EMPTY);
    expect(parseLocalProfile('{nope')).toEqual(EMPTY);
    expect(
      parseLocalProfile(
        JSON.stringify({
          ageBracket: 'ancient',
          consents: [consent, { type: 'x' }, 5, null],
          onboardedAt: 3,
        }),
      ),
    ).toEqual({ ageBracket: null, consents: [consent], onboardedAt: null });
    expect(parseLocalProfile(JSON.stringify({ consents: 'no' })).consents).toEqual([]);
  });

  it('falls back to memory when native storage throws, and never throws itself', async () => {
    const broken: KeyValueStorage = {
      getItem: async () => {
        throw new Error('io');
      },
      setItem: async () => {
        throw new Error('io');
      },
      removeItem: async () => undefined,
    };
    const store = createLocalProfileStore(broken);
    expect((await store.load()).ageBracket).toBeNull();
    await store.save({ ageBracket: 'under_13' });
    expect((await store.load()).ageBracket).toBe('under_13');

    const writeFails: KeyValueStorage = {
      ...createMemoryStorage(),
      setItem: async () => {
        throw new Error('full');
      },
    };
    const s2 = createLocalProfileStore(writeFails);
    await s2.save({ onboardedAt: 'x' });
    expect((await s2.load()).onboardedAt).toBe('x');
  });

  it('memory storage supports removeItem', async () => {
    const m = createMemoryStorage();
    await m.setItem(LOCAL_PROFILE_KEY, '1');
    await m.removeItem(LOCAL_PROFILE_KEY);
    expect(await m.getItem(LOCAL_PROFILE_KEY)).toBeNull();
  });
});
