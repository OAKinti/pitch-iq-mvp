import { STICKER_SPEC } from './shareTargets';

export const STICKER_CAPTURE_OPTIONS = {
  format: STICKER_SPEC.format,
  width: STICKER_SPEC.width,
  height: STICKER_SPEC.height,
  quality: 1,
  result: 'tmpfile',
} as const;

export type StickerCaptureResult =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly reason: 'not_ready' | 'capture_failed' };

export interface StickerCaptureDeps {
  captureRef(target: unknown, options: typeof STICKER_CAPTURE_OPTIONS): Promise<string>;
  releaseCapture(uri: string): void;
}

export interface StickerCapture {
  capture(target: unknown): Promise<StickerCaptureResult>;
  release(uri: string): void;
}

interface ViewShotModule {
  captureRef(target: unknown, options: unknown): Promise<string>;
  releaseCapture(uri: string): void;
}

function defaultDeps(): StickerCaptureDeps {
  return {
    async captureRef(target, options) {
      let lib: ViewShotModule | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        lib = require('react-native-view-shot') as ViewShotModule;
      } catch {
        lib = null;
      }
      if (!lib || typeof lib.captureRef !== 'function') throw new Error('view-shot unavailable');
      return lib.captureRef(target, options);
    },
    releaseCapture(uri) {
      let lib: ViewShotModule | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        lib = require('react-native-view-shot') as ViewShotModule;
      } catch {
        lib = null;
      }
      if (lib && typeof lib.releaseCapture === 'function') lib.releaseCapture(uri);
    },
  };
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path.startsWith('/') ? '' : '/'}${path}`;
}

export function createStickerCapture(deps: StickerCaptureDeps = defaultDeps()): StickerCapture {
  return {
    async capture(target) {
      if (target === null || target === undefined) return { ok: false, reason: 'not_ready' };
      try {
        const path = await deps.captureRef(target, STICKER_CAPTURE_OPTIONS);
        if (typeof path !== 'string' || path.length === 0 || !/\.png$/i.test(path)) {
          return { ok: false, reason: 'capture_failed' };
        }
        return { ok: true, uri: toFileUri(path) };
      } catch {
        return { ok: false, reason: 'capture_failed' };
      }
    },
    release(uri) {
      try {
        deps.releaseCapture(uri);
      } catch {
        /* swallow */
      }
    },
  };
}
