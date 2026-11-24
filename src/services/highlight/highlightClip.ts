import { selectPeakStreakWindow } from '../../domain';
import type { HighlightWindow } from '../../types/contracts';
import { buildClipEncodeRequest, type ClipEncodeFailure, type ClipEncoder } from './clipEncoder';

export interface ClipFiles {
  cacheDir(): string;
  exists(uri: string): Promise<boolean>;
  remove(uri: string): Promise<void>;
}

export type HighlightClipResult =
  | {
      readonly ok: true;
      readonly clipUri: string;
      readonly window: HighlightWindow;
      readonly durationMs: number;
    }
  | { readonly ok: false; readonly reason: ClipEncodeFailure | 'invalid_input' | 'busy' };

export interface HighlightClipService {
  makeClip(input: {
    recordingUri: string;
    eventTimestampsMs: readonly number[];
    totalDurationMs: number;
  }): Promise<HighlightClipResult>;
}

export function createHighlightClipService(deps: {
  encoder: ClipEncoder;
  files: ClipFiles;
  now?: () => number;
}): HighlightClipService {
  const { encoder, files } = deps;
  const now = deps.now ?? Date.now;
  let busy = false;

  const safeRemove = async (uri: string, onlyIfExists: boolean): Promise<void> => {
    try {
      if (onlyIfExists && !(await files.exists(uri))) return;
      await files.remove(uri);
    } catch {
      // swallowed: cleanup must never reject (FAIL-13)
    }
  };

  return {
    async makeClip(input): Promise<HighlightClipResult> {
      if (busy) return { ok: false, reason: 'busy' };
      if (
        typeof input.recordingUri !== 'string' ||
        !input.recordingUri.startsWith('file://') ||
        !Number.isFinite(input.totalDurationMs) ||
        input.totalDurationMs <= 0
      ) {
        return { ok: false, reason: 'invalid_input' };
      }
      busy = true;
      let outputUri: string | null = null;
      try {
        const window = selectPeakStreakWindow(input.eventTimestampsMs, input.totalDurationMs);
        const dir = files.cacheDir();
        outputUri = `${dir.endsWith('/') ? dir : `${dir}/`}highlight-${now()}.mp4`;
        const result = await encoder.encode(
          buildClipEncodeRequest({ inputUri: input.recordingUri, outputUri, window }),
        );
        if (result.ok) {
          await safeRemove(input.recordingUri, false);
          return { ok: true, clipUri: result.outputUri, window, durationMs: result.durationMs };
        }
        await safeRemove(outputUri, true);
        await safeRemove(input.recordingUri, false);
        return { ok: false, reason: result.reason };
      } catch {
        if (outputUri) await safeRemove(outputUri, true);
        await safeRemove(input.recordingUri, false);
        return { ok: false, reason: 'encode_failed' };
      } finally {
        busy = false;
      }
    },
  };
}
