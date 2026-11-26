import { STICKER_SPEC } from '../../../services/share/shareTargets';
import {
  STICKER_CAPTURE_OPTIONS,
  createStickerCapture,
  type StickerCaptureDeps,
} from '../../../services/share/stickerCapture';

const mockCaptureRef = jest.fn();
const mockRelease = jest.fn();
jest.mock('react-native-view-shot', () => ({
  captureRef: (...a: unknown[]) => mockCaptureRef(...a),
  releaseCapture: (...a: unknown[]) => mockRelease(...a),
}));

function fakeDeps(result: () => Promise<string>) {
  return { captureRef: jest.fn(result), releaseCapture: jest.fn() } satisfies StickerCaptureDeps;
}

beforeEach(() => {
  mockCaptureRef.mockReset();
  mockRelease.mockReset();
});

describe('stickerCapture', () => {
  it('captures png 640x480 tmpfile with options read from STICKER_SPEC', async () => {
    expect(STICKER_CAPTURE_OPTIONS).toEqual({
      format: STICKER_SPEC.format,
      width: STICKER_SPEC.width,
      height: STICKER_SPEC.height,
      quality: 1,
      result: 'tmpfile',
    });
    expect(STICKER_CAPTURE_OPTIONS).toEqual({
      format: 'png',
      width: 640,
      height: 480,
      quality: 1,
      result: 'tmpfile',
    });
    const deps = fakeDeps(async () => '/data/cache/ViewShot/abc.png');
    const target = { current: {} };
    const res = await createStickerCapture(deps).capture(target);
    expect(res).toEqual({ ok: true, uri: 'file:///data/cache/ViewShot/abc.png' });
    expect(deps.captureRef).toHaveBeenCalledTimes(1);
    expect(deps.captureRef).toHaveBeenCalledWith(target, STICKER_CAPTURE_OPTIONS);
    expect(
      await createStickerCapture(fakeDeps(async () => 'file:///tmp/x.PNG')).capture(1),
    ).toEqual({
      ok: true,
      uri: 'file:///tmp/x.PNG',
    });
    expect(await createStickerCapture(fakeDeps(async () => 'tmp/x.png')).capture(1)).toEqual({
      ok: true,
      uri: 'file:///tmp/x.png',
    });
  });

  it('null target -> not_ready without a capture call', async () => {
    const deps = fakeDeps(async () => '/a.png');
    const cap = createStickerCapture(deps);
    expect(await cap.capture(null)).toEqual({ ok: false, reason: 'not_ready' });
    expect(await cap.capture(undefined)).toEqual({ ok: false, reason: 'not_ready' });
    expect(deps.captureRef).not.toHaveBeenCalled();
  });

  it('rejection, throw, empty or non-png result -> capture_failed', async () => {
    const failed = { ok: false, reason: 'capture_failed' };
    expect(
      await createStickerCapture(fakeDeps(() => Promise.reject(new Error('x')))).capture({}),
    ).toEqual(failed);
    expect(
      await createStickerCapture({
        captureRef: () => {
          throw new Error('sync');
        },
        releaseCapture: jest.fn(),
      }).capture({}),
    ).toEqual(failed);
    expect(await createStickerCapture(fakeDeps(async () => '')).capture({})).toEqual(failed);
    expect(await createStickerCapture(fakeDeps(async () => '/a.jpg')).capture({})).toEqual(failed);
    expect(
      await createStickerCapture(fakeDeps(async () => undefined as unknown as string)).capture({}),
    ).toEqual(failed);
  });

  it('release calls releaseCapture once and swallows errors', () => {
    const deps = fakeDeps(async () => '/a.png');
    createStickerCapture(deps).release('file:///a.png');
    expect(deps.releaseCapture).toHaveBeenCalledTimes(1);
    const throwing: StickerCaptureDeps = {
      captureRef: async () => '/a.png',
      releaseCapture: () => {
        throw new Error('boom');
      },
    };
    expect(() => createStickerCapture(throwing).release('x')).not.toThrow();
  });

  it('default deps use the lazily required library', async () => {
    mockCaptureRef.mockResolvedValue('/cache/s.png');
    const cap = createStickerCapture();
    expect(await cap.capture({})).toEqual({ ok: true, uri: 'file:///cache/s.png' });
    expect(mockCaptureRef).toHaveBeenCalledWith({}, STICKER_CAPTURE_OPTIONS);
    cap.release('file:///cache/s.png');
    expect(mockRelease).toHaveBeenCalledWith('file:///cache/s.png');
  });

  it('default deps report capture_failed when the library is missing', async () => {
    jest.resetModules();
    jest.doMock('react-native-view-shot', () => {
      throw new Error('Cannot find module');
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh =
        require('../../../services/share/stickerCapture') as typeof import('../../../services/share/stickerCapture');
      const cap = fresh.createStickerCapture();
      expect(await cap.capture({})).toEqual({ ok: false, reason: 'capture_failed' });
      expect(() => cap.release('x')).not.toThrow();
    } finally {
      jest.dontMock('react-native-view-shot');
    }
  });
});
