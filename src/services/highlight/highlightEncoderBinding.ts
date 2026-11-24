import {
  isValidClipRequest,
  type ClipEncoder,
  type ClipEncodeRequest,
  type ClipEncodeResult,
} from './clipEncoder';

export interface NativeHighlightEncoder {
  encodeHighlightClip(options: {
    inputUri: string;
    outputUri: string;
    startMs: number;
    durationMs: number;
    width: number;
    height: number;
    fps: number;
    videoCodec: 'h264';
    audioCodec: 'aac';
    pixelFormat: 'yuv420p';
    fastStart: true;
  }): Promise<{
    outputUri: string;
    durationMs: number;
    videoCodec: string;
    audioCodec: string;
    pixelFormat: string;
    fastStart: boolean;
  }>;
}

export const CLIP_DURATION_SLACK_MS = 50;

function load(): NativeHighlightEncoder | null {
  try {
    const mod = require('../../../modules/highlight-encoder') as unknown;
    if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) return null;
    const m = mod as { encodeHighlightClip?: unknown; default?: { encodeHighlightClip?: unknown } };
    if (typeof m.encodeHighlightClip === 'function') return m as unknown as NativeHighlightEncoder;
    if (m.default && typeof m.default.encodeHighlightClip === 'function') {
      return m.default as unknown as NativeHighlightEncoder;
    }
    return null;
  } catch {
    return null;
  }
}

export function isHighlightEncoderAvailable(): boolean {
  return load() !== null;
}

export function createNativeClipEncoder(): ClipEncoder {
  return {
    isAvailable: isHighlightEncoderAvailable,
    async encode(request: ClipEncodeRequest): Promise<ClipEncodeResult> {
      if (!isValidClipRequest(request)) return { ok: false, reason: 'invalid_request' };
      const native = load();
      if (!native) return { ok: false, reason: 'unavailable' };
      let echo: Awaited<ReturnType<NativeHighlightEncoder['encodeHighlightClip']>>;
      try {
        echo = await native.encodeHighlightClip({
          inputUri: request.inputUri,
          outputUri: request.outputUri,
          startMs: request.startMs,
          durationMs: request.durationMs,
          width: request.spec.width,
          height: request.spec.height,
          fps: request.spec.fps,
          videoCodec: request.spec.videoCodec,
          audioCodec: request.spec.audioCodec,
          pixelFormat: request.spec.pixelFormat,
          fastStart: request.spec.fastStart,
        });
      } catch {
        return { ok: false, reason: 'encode_failed' };
      }
      const good =
        !!echo &&
        echo.videoCodec === 'h264' &&
        echo.audioCodec === 'aac' &&
        echo.pixelFormat === 'yuv420p' &&
        echo.fastStart === true &&
        typeof echo.outputUri === 'string' &&
        echo.outputUri.startsWith('file://') &&
        Number.isFinite(echo.durationMs) &&
        echo.durationMs <= request.durationMs + CLIP_DURATION_SLACK_MS;
      if (!good) return { ok: false, reason: 'spec_mismatch' };
      return { ok: true, outputUri: echo.outputUri, durationMs: echo.durationMs };
    },
  };
}
