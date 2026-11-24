// Deno edge function: Tier 2 debrief (Claude Haiku 5.5 text + ElevenLabs Flash TTS).
// Thin wiring only; all decisions live in ../_shared/voiceCore.ts. Not type-checked by tsc.
// Secrets come from env only:
//   ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_CAPTAIN,
//   ELEVENLABS_VOICE_DRILL_SERGEANT, ELEVENLABS_VOICE_HYPE, SUPABASE_SERVICE_ROLE_KEY
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleDebrief, type CompletionResult, type DebriefDeps } from '../_shared/voiceCore.ts';

const MODEL = 'claude-haiku-5-5';
const VOICE_ENV: Record<string, string> = {
  captain: 'ELEVENLABS_VOICE_CAPTAIN',
  drill_sergeant: 'ELEVENLABS_VOICE_DRILL_SERGEANT',
  hype: 'ELEVENLABS_VOICE_HYPE',
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  // The user id comes ONLY from the verified JWT (SEC-7), never from the body.
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData.user) return json({ ok: false, reason: 'unauthorized' }, 401);
  const userId = userData.user.id;

  const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

  const deps: DebriefDeps = {
    async reserveChars(uid, chars) {
      const { data, error } = await service.rpc('reserve_debrief_chars', {
        p_user_id: uid,
        p_chars: chars,
      });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },
    async refundChars(uid, month, chars) {
      const { error } = await service.rpc('refund_debrief_chars', {
        p_user_id: uid,
        p_month: month,
        p_chars: chars,
      });
      if (error) throw new Error(error.message);
    },
    async complete(prompt): Promise<CompletionResult> {
      try {
        // No temperature/top_p/top_k or thinking budget: those return 400 on current models.
        const msg = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 2000,
          output_config: { effort: 'low' },
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        });
        if (msg.stop_reason === 'refusal') return { kind: 'refused' };
        const text = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { type: 'text'; text: string }).text)
          .join('')
          .trim();
        return {
          kind: 'ok',
          text,
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
        };
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) return { kind: 'rate_limited' };
        return { kind: 'llm_error' };
      }
    },
    async tts(text, persona) {
      const voiceId = Deno.env.get(VOICE_ENV[persona] ?? '');
      if (!voiceId) return null;
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': Deno.env.get('ELEVENLABS_API_KEY')!,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text,
              model_id: Deno.env.get('ELEVENLABS_MODEL_ID') ?? 'eleven_flash_v2_5',
            }),
          },
        );
        if (!res.ok) return null;
        const mp3 = new Uint8Array(await res.arrayBuffer());
        const path = `${userId}/${crypto.randomUUID()}.mp3`;
        const up = await service.storage
          .from('debrief-audio')
          .upload(path, mp3, { contentType: 'audio/mpeg' });
        if (up.error) return null;
        const signed = await service.storage.from('debrief-audio').createSignedUrl(path, 3600);
        return signed.data?.signedUrl ?? null;
      } catch (_e) {
        return null;
      }
    },
  };

  try {
    const out = await handleDebrief(await req.text(), userId, deps);
    return json(out.body, out.status);
  } catch (_e) {
    return json({ ok: false, reason: 'llm_error' }, 502);
  }
});
