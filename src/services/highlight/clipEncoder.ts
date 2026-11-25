import type { HighlightWindow } from '../../types/contracts';
import { INSTAGRAM_EXPORT_SPEC } from '../share/ffmpegCommands';

export const HIGHLIGHT_CLIP_SPEC = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  pixelFormat: 'yuv420p',
  scan: 'progressive',
  fastStart: true,
  width: INSTAGRAM_EXPORT_SPEC.width,
  height: INSTAGRAM_EXPORT_SPEC.height,
  fps: INSTAGRAM_EXPORT_SPEC.fps,
  maxDurationMs: INSTAGRAM_EXPORT_SPEC.maxDurationSec * 1000,
} as const;

export interface ClipEncodeRequest {
  readonly inputUri: string;
  readonly outputUri: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly spec: typeof HIGHLIGHT_CLIP_SPEC;
}

export type ClipEncodeFailure =
  'unavailable' | 'invalid_request' | 'encode_failed' | 'spec_mismatch';

export type ClipEncodeResult =
  | { readonly ok: true; readonly outputUri: string; readonly durationMs: number }
  | { readonly ok: false; readonly reason: ClipEncodeFailure };

export interface ClipEncoder {
  isAvailable(): boolean;
  encode(request: ClipEncodeRequest): Promise<ClipEncodeResult>;
}

export function isValidClipRequest(request: ClipEncodeRequest): boolean {
  if (!request || typeof request.inputUri !== 'string' || typeof request.outputUri !== 'string')
    return false;
  return (
    request.inputUri.startsWith('file://') &&
    request.outputUri.startsWith('file://') &&
    request.inputUri !== request.outputUri &&
    Number.isFinite(request.startMs) &&
    Number.isFinite(request.durationMs) &&
    request.startMs >= 0 &&
    request.durationMs > 0 &&
    request.durationMs <= HIGHLIGHT_CLIP_SPEC.maxDurationMs
  );
}

export function buildClipEncodeRequest(opts: {
  inputUri: string;
  outputUri: string;
  window: HighlightWindow;
}): ClipEncodeRequest {
  const startMs = Math.max(0, opts.window.startMs);
  const durationMs = Math.min(
    HIGHLIGHT_CLIP_SPEC.maxDurationMs,
    Math.max(0, opts.window.endMs - opts.window.startMs),
  );
  return {
    inputUri: opts.inputUri,
    outputUri: opts.outputUri,
    startMs,
    durationMs,
    spec: HIGHLIGHT_CLIP_SPEC,
  };
}
