import fs from 'fs';
import path from 'path';

const MOD = '../../../../modules/highlight-encoder';
const mockEncode = jest.fn();
jest.mock(
  '../../../../modules/highlight-encoder',
  () => ({ encodeHighlightClip: (o: unknown) => mockEncode(o) }),
  {
    virtual: true,
  },
);

import {
  CLIP_DURATION_SLACK_MS,
  createNativeClipEncoder,
  isHighlightEncoderAvailable,
} from '../../../services/highlight/highlightEncoderBinding';
import {
  HIGHLIGHT_CLIP_SPEC,
  type ClipEncodeRequest,
} from '../../../services/highlight/clipEncoder';

const req: ClipEncodeRequest = {
  inputUri: 'file:///cache/in.mov',
  outputUri: 'file:///cache/out.mp4',
  startMs: 0,
  durationMs: 8000,
  spec: HIGHLIGHT_CLIP_SPEC,
};
const echo = (over: Record<string, unknown> = {}) => ({
  outputUri: 'file:///cache/out.mp4',
  durationMs: 8000,
  videoCodec: 'h264',
  audioCodec: 'aac',
  pixelFormat: 'yuv420p',
  fastStart: true,
  ...over,
});

describe('highlightEncoderBinding', () => {
  beforeEach(() => mockEncode.mockReset());

  it('is available and encodes with the spec when the module is present', async () => {
    mockEncode.mockResolvedValue(echo({ durationMs: 8000 + CLIP_DURATION_SLACK_MS }));
    const enc = createNativeClipEncoder();
    expect(enc.isAvailable()).toBe(true);
    expect(isHighlightEncoderAvailable()).toBe(true);
    const r = await enc.encode(req);
    expect(r).toEqual({ ok: true, outputUri: 'file:///cache/out.mp4', durationMs: 8050 });
    expect(mockEncode).toHaveBeenCalledWith({
      inputUri: req.inputUri,
      outputUri: req.outputUri,
      startMs: 0,
      durationMs: 8000,
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      fastStart: true,
    });
  });

  it('invalid request never reaches native', async () => {
    const r = await createNativeClipEncoder().encode({ ...req, startMs: -1 });
    expect(r).toEqual({ ok: false, reason: 'invalid_request' });
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('native rejection or throw is encode_failed', async () => {
    mockEncode.mockRejectedValueOnce(new Error('x'));
    expect(await createNativeClipEncoder().encode(req)).toEqual({
      ok: false,
      reason: 'encode_failed',
    });
    mockEncode.mockImplementationOnce(() => {
      throw new Error('sync');
    });
    expect(await createNativeClipEncoder().encode(req)).toEqual({
      ok: false,
      reason: 'encode_failed',
    });
  });

  it('any echo outside the spec is spec_mismatch', async () => {
    const bad = [
      echo({ videoCodec: 'hevc' }),
      echo({ audioCodec: 'mp3' }),
      echo({ pixelFormat: 'yuv444p' }),
      echo({ fastStart: false }),
      echo({ durationMs: 8000 + CLIP_DURATION_SLACK_MS + 1 }),
      echo({ durationMs: NaN }),
      echo({ outputUri: '/cache/out.mp4' }),
      echo({ outputUri: 5 }),
      undefined,
    ];
    for (const b of bad) {
      mockEncode.mockResolvedValueOnce(b);
      expect(await createNativeClipEncoder().encode(req)).toEqual({
        ok: false,
        reason: 'spec_mismatch',
      });
    }
  });

  const isolated = (factory: (() => unknown) | null) => {
    let out: typeof import('../../../services/highlight/highlightEncoderBinding') | undefined;
    jest.resetModules();
    if (factory) jest.doMock(MOD, factory, { virtual: true });
    else jest.dontMock(MOD);
    out = require('../../../services/highlight/highlightEncoderBinding');
    return out!;
  };

  it('unavailable when the module throws on require, lacks the function, is a non-object, or accepts default export', async () => {
    const thrower = isolated(() => {
      throw new Error('native missing');
    });
    expect(thrower.isHighlightEncoderAvailable()).toBe(false);
    expect(await thrower.createNativeClipEncoder().encode(req)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(isolated(() => ({ other: 1 })).isHighlightEncoderAvailable()).toBe(false);
    expect(isolated(() => ({ encodeHighlightClip: 'nope' })).isHighlightEncoderAvailable()).toBe(
      false,
    );
    expect(isolated(() => null).isHighlightEncoderAvailable()).toBe(false);
    expect(isolated(() => 5).isHighlightEncoderAvailable()).toBe(false);
    expect(
      isolated(() => ({
        default: { encodeHighlightClip: jest.fn() },
      })).isHighlightEncoderAvailable(),
    ).toBe(true);
  });

  it('unavailable when modules/highlight-encoder does not exist at all', () => {
    const real = path.resolve(__dirname, '../../../../modules/highlight-encoder');
    if (fs.existsSync(real)) return; // device work landed; the missing case no longer applies
    expect(isolated(null).isHighlightEncoderAvailable()).toBe(false);
  });

  it('only the binding references modules/highlight-encoder and only clipFiles references expo-file-system', () => {
    const dir = path.resolve(__dirname, '../../../services/highlight');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src.includes('highlight-encoder')).toBe(f === 'highlightEncoderBinding.ts');
      expect(src.includes('expo-file-system')).toBe(f === 'clipFiles.ts');
    }
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
        return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
      });
    const src = path.resolve(__dirname, '../../..');
    for (const file of walk(src)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('modules/highlight-encoder')) {
        expect(path.basename(file)).toBe('highlightEncoderBinding.ts');
      }
    }
  });
});
