import { getAppConfig } from '../../services/config';

describe('getAppConfig', () => {
  it('is demo mode when keys are missing', () => {
    expect(getAppConfig({})).toEqual({ demoMode: true, supabaseUrl: null, supabaseAnonKey: null });
  });
  it('is demo mode when keys are blank', () => {
    const c = getAppConfig({ EXPO_PUBLIC_SUPABASE_URL: '  ', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' });
    expect(c.demoMode).toBe(true);
    expect(c.supabaseUrl).toBeNull();
  });
  it('is live when both keys exist', () => {
    const c = getAppConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' });
    expect(c).toEqual({ demoMode: false, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' });
  });
  it('forces demo when flag is true', () => {
    const c = getAppConfig({
      EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k',
      EXPO_PUBLIC_DEMO_MODE: 'true',
    });
    expect(c.demoMode).toBe(true);
  });
  it('reads process.env when no env arg is passed', () => {
    const saved = { ...process.env };
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://p.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'pk';
    delete process.env.EXPO_PUBLIC_DEMO_MODE;
    expect(getAppConfig().demoMode).toBe(false);
    process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
    expect(getAppConfig().demoMode).toBe(true);
    process.env = saved;
  });
});
