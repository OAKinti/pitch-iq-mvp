// Deno edge function: Tier 3 Q&A quota enforcement (the single place Q&A seconds are granted).
// Thin wiring only; validation lives in ../_shared/voiceCore.ts. Not type-checked by tsc.
// Secrets: SUPABASE_SERVICE_ROLE_KEY; optional QA_CAP_SECONDS (default 300, clamped to [300, 600] in SQL).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleQa, type QaDeps } from '../_shared/voiceCore.ts';

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
  const parsedCap = Number.parseInt(Deno.env.get('QA_CAP_SECONDS') ?? '300', 10);
  const capSeconds = Number.isFinite(parsedCap) ? parsedCap : 300;

  const deps: QaDeps = {
    async tier2Status(uid) {
      // D-9C: under-13 without verifiable parental consent never reaches a third-party provider.
      const { data, error } = await service.rpc('voice_tier2_status', { p_user_id: uid });
      if (error) throw new Error('tier2_status_failed');
      return data === 'ok' || data === 'parental_consent_required' ? data : 'profile_required';
    },
    async consumeQa(uid, seconds) {
      const { data, error } = await service.rpc('consume_qa_seconds', {
        p_user_id: uid,
        p_seconds: seconds,
        p_cap_seconds: capSeconds,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as {
        granted?: number;
        remaining?: number;
      } | null;
      return { granted: row?.granted ?? 0, remaining: row?.remaining ?? 0 };
    },
  };

  try {
    const out = await handleQa(await req.text(), userId, deps);
    return json(out.body, out.status);
  } catch (_e) {
    return json({ ok: false, reason: 'llm_error' }, 502);
  }
});
