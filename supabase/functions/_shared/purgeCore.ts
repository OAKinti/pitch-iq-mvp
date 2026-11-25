// Raw-video TTL purge core (D7.2) - zero imports, no Deno globals; jest-tested from
// src/__tests__/services/purgeCore.test.ts. The edge function wires Supabase into PurgeDeps.
//
// Invariant (CLAUDE.md #4, raw video TTL <= 90 days): a row's raw_video_path is cleared ONLY
// after its storage object was removed, so a pointer is never dropped while the file survives.
// Rows are processed in pages, so any number of expired sessions is purged in one run
// (PostgREST caps a single select at ~1000 rows).

export const PURGE_PAGE_SIZE = 500;
export const STORAGE_REMOVE_BATCH = 100;
export const PURGE_MAX_PAGES = 200; // 100 000 rows per run; the next nightly run continues

export interface ExpiredVideoRow {
  readonly id: string;
  readonly path: string;
}

export interface PurgeDeps {
  /** Up to `limit` expired rows (raw_video_path not null, raw_video_expires_at <= now), stable order. */
  listExpired(limit: number): Promise<ExpiredVideoRow[]>;
  /** Remove storage objects (already-missing objects count as removed); rejects on a storage error. */
  removeObjects(paths: readonly string[]): Promise<void>;
  /** Null raw_video_path for exactly these row ids. Returns the number of rows cleared. */
  clearPaths(ids: readonly string[]): Promise<number>;
}

export type PurgeResult =
  | {
      readonly ok: true;
      readonly storageObjectsRemoved: number;
      readonly rowsCleared: number;
      readonly pages: number;
    }
  | {
      readonly ok: false;
      readonly stage: 'list' | 'remove' | 'clear';
      readonly storageObjectsRemoved: number;
      readonly rowsCleared: number;
    };

export async function purgeExpiredRawVideos(deps: PurgeDeps): Promise<PurgeResult> {
  let storageObjectsRemoved = 0;
  let rowsCleared = 0;
  let pages = 0;

  while (pages < PURGE_MAX_PAGES) {
    let rows: ExpiredVideoRow[];
    try {
      rows = await deps.listExpired(PURGE_PAGE_SIZE);
    } catch {
      return { ok: false, stage: 'list', storageObjectsRemoved, rowsCleared };
    }
    if (rows.length === 0) break;
    pages += 1;

    for (let i = 0; i < rows.length; i += STORAGE_REMOVE_BATCH) {
      const batch = rows.slice(i, i + STORAGE_REMOVE_BATCH);
      try {
        await deps.removeObjects(batch.map((r) => r.path));
      } catch {
        // Storage failed: keep these pointers so the next run retries the delete.
        return { ok: false, stage: 'remove', storageObjectsRemoved, rowsCleared };
      }
      storageObjectsRemoved += batch.length;
      let cleared: number;
      try {
        cleared = await deps.clearPaths(batch.map((r) => r.id));
      } catch {
        return { ok: false, stage: 'clear', storageObjectsRemoved, rowsCleared };
      }
      rowsCleared += cleared;
    }

    // A short page means nothing is left; a full page loops (cleared rows drop out of the next list).
    if (rows.length < PURGE_PAGE_SIZE) break;
  }

  return { ok: true, storageObjectsRemoved, rowsCleared, pages };
}

// ── Phase 2 (B-6): object-age sweep ──
// Row-based purging misses objects no drill_sessions row points at (direct uploads, deleted rows,
// overwritten paths). Every object in a swept bucket has a hard maximum age (raw-video 90 days,
// debrief-audio 30 days, enforced by public.list_stale_storage_objects), so delete by age, then
// clear any raw_video_path still pointing at a deleted raw-video object.

export const SWEPT_BUCKETS = ['raw-video', 'debrief-audio'] as const;
export type SweptBucket = (typeof SWEPT_BUCKETS)[number];

export interface SweepDeps {
  /** Up to `limit` object names in `bucket` older than the bucket's maximum age, oldest first. */
  listStaleObjects(bucket: SweptBucket, limit: number): Promise<string[]>;
  /** Remove objects from `bucket`; rejects on a storage error. */
  removeFromBucket(bucket: SweptBucket, names: readonly string[]): Promise<void>;
  /** Null raw_video_path on rows pointing at these (now deleted) raw-video objects. */
  clearPathsByName(names: readonly string[]): Promise<number>;
}

export type SweepResult =
  | { readonly ok: true; readonly removed: Readonly<Record<SweptBucket, number>>; readonly rowsCleared: number }
  | {
      readonly ok: false;
      readonly stage: 'list' | 'remove' | 'clear';
      readonly bucket: SweptBucket;
      readonly removed: Readonly<Record<SweptBucket, number>>;
      readonly rowsCleared: number;
    };

export async function sweepStaleObjects(deps: SweepDeps): Promise<SweepResult> {
  const removed: Record<SweptBucket, number> = { 'raw-video': 0, 'debrief-audio': 0 };
  let rowsCleared = 0;

  for (const bucket of SWEPT_BUCKETS) {
    for (let page = 0; page < PURGE_MAX_PAGES; page++) {
      let names: string[];
      try {
        names = await deps.listStaleObjects(bucket, PURGE_PAGE_SIZE);
      } catch {
        return { ok: false, stage: 'list', bucket, removed, rowsCleared };
      }
      if (names.length === 0) break;

      for (let i = 0; i < names.length; i += STORAGE_REMOVE_BATCH) {
        const batch = names.slice(i, i + STORAGE_REMOVE_BATCH);
        try {
          await deps.removeFromBucket(bucket, batch);
        } catch {
          return { ok: false, stage: 'remove', bucket, removed, rowsCleared };
        }
        removed[bucket] += batch.length;
        if (bucket === 'raw-video') {
          try {
            rowsCleared += await deps.clearPathsByName(batch);
          } catch {
            return { ok: false, stage: 'clear', bucket, removed, rowsCleared };
          }
        }
      }
      if (names.length < PURGE_PAGE_SIZE) break;
    }
  }
  return { ok: true, removed, rowsCleared };
}
