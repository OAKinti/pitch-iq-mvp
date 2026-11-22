import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoachPersona } from '../../types/contracts';

export interface DebriefTransport {
  requestDebrief(
    prompt: { system: string; user: string },
    persona: CoachPersona,
  ): Promise<{ text: string; audioUri: string | null; inputTokens: number; outputTokens: number }>;
}

interface EdgeResponse {
  text?: string | null;
  refused?: boolean;
  audioUrl?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createEdgeFunctionTransport(client: SupabaseClient): DebriefTransport {
  return {
    async requestDebrief(prompt, persona) {
      const { data, error } = await client.functions.invoke('voice-debrief', {
        body: { system: prompt.system, user: prompt.user, persona },
      });
      if (error) throw new Error(`voice-debrief failed: ${error.message}`);
      const res = (data ?? {}) as EdgeResponse;
      if (res.refused === true || typeof res.text !== 'string' || res.text.length === 0) {
        throw new Error('voice-debrief returned no usable text');
      }
      return {
        text: res.text,
        audioUri: res.audioUrl ?? null,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      };
    },
  };
}
