// Deno edge function: nightly purge of raw video past its <= 90 day TTL.
// Not type-checked by tsc. Invoke from pg_cron / Supabase scheduler with the service role key.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Only the service role may trigger a purge.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const { data, error } = await service
    .from("drill_sessions")
    .select("raw_video_path")
    .not("raw_video_path", "is", null)
    .lte("raw_video_expires_at", new Date().toISOString());
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const paths = (data ?? []).map((r: { raw_video_path: string }) => r.raw_video_path);
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const res = await service.storage.from("raw-video").remove(batch);
    if (res.error) return new Response(JSON.stringify({ error: res.error.message }), { status: 500 });
    removed += res.data?.length ?? 0;
  }

  const { data: purged, error: rpcError } = await service.rpc("purge_expired_raw_videos");
  if (rpcError) return new Response(JSON.stringify({ error: rpcError.message }), { status: 500 });

  return new Response(JSON.stringify({ storageObjectsRemoved: removed, rowsCleared: purged }), {
    headers: { "Content-Type": "application/json" },
  });
});
