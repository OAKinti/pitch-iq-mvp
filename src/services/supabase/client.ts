import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config';

let cached: { url: string; client: SupabaseClient } | null = null;

/** Lazy singleton per url. Returns null in demo mode. */
export function getSupabaseClient(config: AppConfig): SupabaseClient | null {
  if (config.demoMode || !config.supabaseUrl || !config.supabaseAnonKey) return null;
  if (cached && cached.url === config.supabaseUrl) return cached.client;
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    // Anonymous session survives restarts so auth.uid() (and RLS ownership) is stable (D-9A).
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: AsyncStorage,
    },
  });
  cached = { url: config.supabaseUrl, client };
  return client;
}

/** Test helper. */
export function resetSupabaseClientForTests(): void {
  cached = null;
}
