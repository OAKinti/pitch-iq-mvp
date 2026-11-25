import type { SupabaseClient } from '@supabase/supabase-js';
import type { DebriefRequest, DebriefResponse } from '../../types/contracts';

export const DEBRIEF_TIMEOUT_MS = 12_000;

export interface DebriefTransport {
  requestDebrief(
    request: DebriefRequest,
  ): Promise<{ text: string; audioUri: string | null; inputTokens: number; outputTokens: number }>;
}

/** One invoke per debrief, no retries (ECON-6). Every failure rejects; the coach falls back to the template. */
export function createEdgeFunctionTransport(client: SupabaseClient): DebriefTransport {
  return {
    async requestDebrief(request) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('voice-debrief timed out')), DEBRIEF_TIMEOUT_MS);
      });
      try {
        const { data, error } = await Promise.race([
          client.functions.invoke('voice-debrief', { body: request }),
          timeout,
        ]);
        if (error) throw new Error(`voice-debrief failed: ${error.message}`);
        const res = (data ?? null) as DebriefResponse | null;
        if (!res || res.ok !== true || typeof res.text !== 'string' || res.text.length === 0) {
          throw new Error('voice-debrief returned no usable text');
        }
        return {
          text: res.text,
          audioUri: res.audioUrl ?? null,
          inputTokens: res.usage?.inputTokens ?? 0,
          outputTokens: res.usage?.outputTokens ?? 0,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
