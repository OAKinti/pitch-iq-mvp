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
