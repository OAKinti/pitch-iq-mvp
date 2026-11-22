// Deno edge function: Tier 2 debrief (Claude Haiku 5.5 text + ElevenLabs Flash TTS).
// Not type-checked by tsc. Secrets come from env only:
//   ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_CAPTAIN,
//   ELEVENLABS_VOICE_DRILL_SERGEANT, ELEVENLABS_VOICE_HYPE, SUPABASE_SERVICE_ROLE_KEY
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
const MAX_CHARS = 400;
const VOICE_ENV: Record<string, string> = {
  captain: "ELEVENLABS_VOICE_CAPTAIN",
  drill_sergeant: "ELEVENLABS_VOICE_DRILL_SERGEANT",
  hype: "ELEVENLABS_VOICE_HYPE",
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS);
  const i = cut.lastIndexOf(" ");
  return (i > MAX_CHARS / 2 ? cut.slice(0, i) : cut).trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Verify the caller's JWT.
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  let body: { system?: unknown; user?: unknown; persona?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { system, user, persona } = body;
  if (typeof system !== "string" || typeof user !== "string" || typeof persona !== "string" || !(persona in VOICE_ENV)) {
    return json({ error: "invalid_request" }, 400);
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
  let text: string;
  let usage: { input_tokens: number; output_tokens: number };
  try {
    // No temperature/top_p/top_k or thinking budget: those return 400 on current models.
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (msg.stop_reason === "refusal") return json({ text: null, refused: true });
    text = truncate(
      msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("")
        .trim(),
    );
    usage = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: "llm_error", status: err.status }, 502);
    throw err;
  }
  if (!text) return json({ text: null, refused: true });

  // ElevenLabs TTS (best effort: text is still returned if audio fails).
  let audioUrl: string | null = null;
  const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const voiceId = Deno.env.get(VOICE_ENV[persona]!);
  if (voiceId) {
    try {
      const tts = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": Deno.env.get("ELEVENLABS_API_KEY")!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: Deno.env.get("ELEVENLABS_MODEL_ID") ?? "eleven_flash_v2_5",
          }),
        },
      );
      if (tts.ok) {
        const mp3 = new Uint8Array(await tts.arrayBuffer());
        const path = `${userId}/${crypto.randomUUID()}.mp3`;
        const up = await service.storage.from("debrief-audio").upload(path, mp3, {
          contentType: "audio/mpeg",
        });
        if (!up.error) {
          const signed = await service.storage.from("debrief-audio").createSignedUrl(path, 3600);
          audioUrl = signed.data?.signedUrl ?? null;
        }
      }
    } catch (_e) {
      audioUrl = null;
    }
  }

  // Track monthly usage (service role; clients are read-only via RLS).
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const { data: row } = await service
    .from("voice_usage")
    .select("debrief_chars_used")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  await service.from("voice_usage").upsert(
    { user_id: userId, month, debrief_chars_used: (row?.debrief_chars_used ?? 0) + text.length },
    { onConflict: "user_id,month" },
  );

  return json({ text, audioUrl, usage });
});
