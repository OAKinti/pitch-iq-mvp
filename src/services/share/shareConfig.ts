export interface ShareConfig {
  readonly facebookAppId: string | null;
  readonly tiktokClientKey: string | null;
}

type Env = Record<string, string | undefined>;

const FACEBOOK_APP_ID = /^[0-9]{5,20}$/;
const TIKTOK_CLIENT_KEY = /^[A-Za-z0-9_-]{6,64}$/;

const clean = (v: string | undefined, pattern: RegExp): string | null => {
  const t = v?.trim();
  return t && pattern.test(t) ? t : null;
};

/**
 * Public share identifiers. Expo inlines EXPO_PUBLIC_* only for static dotted access, so each
 * variable is read literally when no env override is given. Missing or malformed -> null, which
 * routes the handoff to the OS share sheet. No placeholder is ever substituted.
 */
export function getShareConfig(env?: Env): ShareConfig {
  const appId = env ? env.EXPO_PUBLIC_FACEBOOK_APP_ID : process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
  const clientKey = env ? env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY : process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY;
  return {
    facebookAppId: clean(appId, FACEBOOK_APP_ID),
    tiktokClientKey: clean(clientKey, TIKTOK_CLIENT_KEY),
  };
}
