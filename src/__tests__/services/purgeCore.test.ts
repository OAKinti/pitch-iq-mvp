import {
  PURGE_MAX_PAGES,
  PURGE_PAGE_SIZE,
  STORAGE_REMOVE_BATCH,
  purgeExpiredRawVideos,
  sweepStaleObjects,
  type ExpiredVideoRow,
  type PurgeDeps,
} from '../../../supabase/functions/_shared/purgeCore';

/** In-memory drill_sessions + raw-video bucket; listExpired mimics the ordered, limited select. */
function fakeStore(count: number) {
  const rows = new Map<string, string | null>();
  const objects = new Set<string>();
  for (let i = 0; i < count; i++) {
    const id = `s${String(i).padStart(6, '0')}`;
    const path = `u1/${id}.mp4`;
    rows.set(id, path);
    objects.add(path);
  }
  const calls = { list: 0, remove: 0, clear: 0 };
  const deps: PurgeDeps = {
    async listExpired(limit) {
      calls.list++;
      const out: ExpiredVideoRow[] = [];
      for (const [id, path] of [...rows.entries()].sort()) {
        if (path !== null) out.push({ id, path });
        if (out.length === limit) break;
      }
      return out;
    },
    async removeObjects(paths) {
      calls.remove++;
      expect(paths.length).toBeLessThanOrEqual(STORAGE_REMOVE_BATCH);
      for (const p of paths) objects.delete(p);
    },
    async clearPaths(ids) {
      calls.clear++;
      let n = 0;
      for (const id of ids) {
        if (rows.get(id) !== null) {
          rows.set(id, null);
          n++;
        }
      }
      return n;
    },
  };
  return { rows, objects, calls, deps };
}

describe('purgeExpiredRawVideos (90-day raw video TTL)', () => {
  it('purges more rows than one PostgREST page (2 345 > 1 000) in a single run', async () => {
    const s = fakeStore(2345);
    const r = await purgeExpiredRawVideos(s.deps);
    expect(r).toEqual({ ok: true, storageObjectsRemoved: 2345, rowsCleared: 2345, pages: 5 });
    expect(s.objects.size).toBe(0);
    expect([...s.rows.values()].every((p) => p === null)).toBe(true);
  });

  it('does nothing on an empty table', async () => {
    const s = fakeStore(0);
    expect(await purgeExpiredRawVideos(s.deps)).toEqual({
      ok: true,
      storageObjectsRemoved: 0,
      rowsCleared: 0,
      pages: 0,
    });
    expect(s.calls).toEqual({ list: 1, remove: 0, clear: 0 });
  });

  it('an exact multiple of the page size stops on the following empty page', async () => {
    const s = fakeStore(PURGE_PAGE_SIZE * 2);
    const r = await purgeExpiredRawVideos(s.deps);
    expect(r).toMatchObject({ ok: true, rowsCleared: PURGE_PAGE_SIZE * 2, pages: 2 });
    expect(s.calls.list).toBe(3);
  });

  it('never clears a pointer whose storage delete failed (retried next run)', async () => {
    const s = fakeStore(250);
    let n = 0;
    const deps: PurgeDeps = {
      ...s.deps,
      async removeObjects(paths) {
        if (++n === 2) throw new Error('storage 503');
        return s.deps.removeObjects(paths);
      },
    };
    const r = await purgeExpiredRawVideos(deps);
    expect(r).toEqual({ ok: false, stage: 'remove', storageObjectsRemoved: 100, rowsCleared: 100 });
    // every row whose object still exists keeps its pointer
    for (const [, path] of s.rows) if (path !== null) expect(s.objects.has(path)).toBe(true);
    expect([...s.rows.values()].filter((p) => p !== null)).toHaveLength(150);
    // a later run finishes the job
    expect(await purgeExpiredRawVideos(s.deps)).toMatchObject({ ok: true, rowsCleared: 150 });
    expect(s.objects.size).toBe(0);
  });

  it('reports list and clear failures without throwing', async () => {
    const s = fakeStore(10);
    await expect(
      purgeExpiredRawVideos({ ...s.deps, listExpired: () => Promise.reject(new Error('pg down')) }),
    ).resolves.toEqual({ ok: false, stage: 'list', storageObjectsRemoved: 0, rowsCleared: 0 });
    await expect(
      purgeExpiredRawVideos({ ...s.deps, clearPaths: () => Promise.reject(new Error('pg down')) }),
    ).resolves.toEqual({ ok: false, stage: 'clear', storageObjectsRemoved: 10, rowsCleared: 0 });
  });

  it('stops after PURGE_MAX_PAGES even if the list never drains', async () => {
    const full = Array.from({ length: PURGE_PAGE_SIZE }, (_, i) => ({
      id: `x${i}`,
      path: `p${i}`,
    }));
    const deps: PurgeDeps = {
      listExpired: jest.fn(async () => full),
      removeObjects: jest.fn(async () => undefined),
      clearPaths: jest.fn(async () => 0),
    };
    const r = await purgeExpiredRawVideos(deps);
    expect(r).toMatchObject({ ok: true, pages: PURGE_MAX_PAGES });
    expect(deps.listExpired).toHaveBeenCalledTimes(PURGE_MAX_PAGES);
  });
});

describe('sweepStaleObjects (B-6: orphans and debrief-audio TTL)', () => {
  function fakeBuckets(raw: number, audio: number) {
    const buckets: Record<string, Set<string>> = {
      'raw-video': new Set(Array.from({ length: raw }, (_, i) => `u1/old-${i}.mp4`)),
      'debrief-audio': new Set(Array.from({ length: audio }, (_, i) => `u1/old-${i}.mp3`)),
    };
    const rowPaths = new Set(['u1/old-0.mp4', 'u1/old-1.mp4']); // two rows still point at stale objects
    const deps = {
      listStaleObjects: jest.fn(async (bucket: 'raw-video' | 'debrief-audio', limit: number) =>
        [...buckets[bucket]!].slice(0, limit),
      ),
      removeFromBucket: jest.fn(async (bucket: 'raw-video' | 'debrief-audio', names: readonly string[]) => {
        expect(names.length).toBeLessThanOrEqual(STORAGE_REMOVE_BATCH);
        for (const n of names) buckets[bucket]!.delete(n);
      }),
      clearPathsByName: jest.fn(async (names: readonly string[]) => {
        let n = 0;
        for (const p of names) if (rowPaths.delete(p)) n++;
        return n;
      }),
    };
    return { buckets, rowPaths, deps };
  }

  it('deletes every stale object in both buckets across pages and clears dangling raw-video pointers', async () => {
    const f = fakeBuckets(PURGE_PAGE_SIZE + 37, 12);
    expect(await sweepStaleObjects(f.deps)).toEqual({
      ok: true,
      removed: { 'raw-video': PURGE_PAGE_SIZE + 37, 'debrief-audio': 12 },
      rowsCleared: 2,
    });
    expect(f.buckets['raw-video']!.size).toBe(0);
    expect(f.buckets['debrief-audio']!.size).toBe(0);
    expect(f.rowPaths.size).toBe(0);
    // pointers are only cleared for raw-video
    expect(f.deps.clearPathsByName.mock.calls.flat(2).every((n) => String(n).endsWith('.mp4'))).toBe(true);
  });

  it('stops at the failing stage without throwing', async () => {
    const f = fakeBuckets(3, 3);
    await expect(
      sweepStaleObjects({ ...f.deps, removeFromBucket: () => Promise.reject(new Error('503')) }),
    ).resolves.toMatchObject({ ok: false, stage: 'remove', bucket: 'raw-video' });
    await expect(
      sweepStaleObjects({ ...f.deps, listStaleObjects: () => Promise.reject(new Error('pg')) }),
    ).resolves.toMatchObject({ ok: false, stage: 'list', bucket: 'raw-video' });
    const g = fakeBuckets(3, 0);
    await expect(
      sweepStaleObjects({ ...g.deps, clearPathsByName: () => Promise.reject(new Error('pg')) }),
    ).resolves.toMatchObject({ ok: false, stage: 'clear', bucket: 'raw-video' });
  });
});
