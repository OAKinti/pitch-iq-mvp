import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config';

let cached: { url: string; client: SupabaseClient } | null = null;

/** Lazy singleton per url. Returns null in demo mode. */
export function getSupabaseClient(config: AppConfig): SupabaseClient | null {
  if (config.demoMode || !config.supabaseUrl || !config.supabaseAnonKey) return null;
  if (cached && cached.url === config.supabaseUrl) return cached.client;
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    // Day 1: in-memory session. Person B adds AsyncStorage persistence on Day 2-3.
    auth: { persistSession: false },
  });
  cached = { url: config.supabaseUrl, client };
  return client;
}

/** Test helper. */
export function resetSupabaseClientForTests(): void {
  cached = null;
}
