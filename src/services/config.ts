export interface AppConfig {
  demoMode: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Demo mode when either Supabase key is missing/blank or EXPO_PUBLIC_DEMO_MODE === 'true'.
 * Expo inlines EXPO_PUBLIC_* only for static dotted access, so each var is read literally
 * when no env override is given.
 */
export function getAppConfig(env?: Env): AppConfig {
  const url = clean(env ? env.EXPO_PUBLIC_SUPABASE_URL : process.env.EXPO_PUBLIC_SUPABASE_URL);
  const key = clean(
    env ? env.EXPO_PUBLIC_SUPABASE_ANON_KEY : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  );
  const flag = env ? env.EXPO_PUBLIC_DEMO_MODE : process.env.EXPO_PUBLIC_DEMO_MODE;
  const demoMode = url === null || key === null || flag?.trim() === 'true';
  return { demoMode, supabaseUrl: url, supabaseAnonKey: key };
}
