// Deno edge function: nightly purge of raw video past its <= 90 day TTL.
// Not type-checked by tsc. Invoke from pg_cron / Supabase scheduler with the service role key.
// The paging + "clear a pointer only after its object is deleted" logic lives in
// ../_shared/purgeCore.ts (jest-tested). This file only wires Supabase into it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { purgeExpiredRawVideos, type ExpiredVideoRow } from '../_shared/purgeCore.ts';

Deno.serve(async (req: Request) => {
  // Only the service role may trigger a purge.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!serviceKey || !timingSafeEqual(bearer, serviceKey)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  const result = await purgeExpiredRawVideos({
    async listExpired(limit) {
      const { data, error } = await service
        .from('drill_sessions')
        .select('id, raw_video_path')
        .not('raw_video_path', 'is', null)
        .lte('raw_video_expires_at', new Date().toISOString())
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw new Error('list failed');
      return (data ?? []).map((r: { id: string; raw_video_path: string }): ExpiredVideoRow => ({
        id: r.id,
        path: r.raw_video_path,
      }));
    },
    async removeObjects(paths) {
      // Storage remove() succeeds for already-missing objects, so a retried run is idempotent.
      const { error } = await service.storage.from('raw-video').remove([...paths]);
      if (error) throw new Error('remove failed');
    },
    async clearPaths(ids) {
      const { data, error } = await service
        .from('drill_sessions')
        .update({ raw_video_path: null })
        .in('id', [...ids])
        .select('id');
      if (error) throw new Error('clear failed');
      return data?.length ?? 0;
    },
  });

  // Never echo upstream error text; the stage is enough to diagnose from function logs.
  if (!result.ok) {
    return new Response(JSON.stringify({ error: 'purge_failed', ...result }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});

/** Constant-time string compare so the service-key check does not leak a prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
