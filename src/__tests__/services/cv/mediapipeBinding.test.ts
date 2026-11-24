import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { LANDMARK_COUNT } from '../../../types/contracts';

type Binding = typeof import('../../../services/cv/mediapipeBinding');

function withLib(factory: () => unknown): Binding {
  jest.resetModules();
  jest.doMock('expo-mediapipe-pose', factory);
  return require('../../../services/cv/mediapipeBinding') as Binding;
}

const goodLib = () => ({ PoseCameraView: () => null, usePoseCamera: () => ({}) });

describe('isMediapipeAvailable', () => {
    it('returns false when the module throws or is empty', () => {
    expect(
      withLib(() => {
        throw new Error('Cannot find native module');
      }).isMediapipeAvailable(),
    ).toBe(false);
    expect(withLib(() => ({})).isMediapipeAvailable()).toBe(false);
    expect(withLib(() => null).isMediapipeAvailable()).toBe(false);
    expect(withLib(() => ({ PoseCameraView: () => null })).isMediapipeAvailable()).toBe(false);
  });

  it('returns true when the library exposes the camera view and hook', () => {
    const b = withLib(goodLib);
    expect(b.isMediapipeAvailable()).toBe(true);
    expect(b.getMediapipeModule()).not.toBeNull();
  });
});

describe('toRawPoseResult', () => {
  const { toRawPoseResult } = require('../../../services/cv/mediapipeBinding') as Binding;

  function libFrame() {
    const names = [
      'nose',
      'leftEyeInner',
      'leftEye',
      'leftEyeOuter',
      'rightEyeInner',
      'rightEye',
      'rightEyeOuter',
      'leftEar',
      'rightEar',
      'mouthLeft',
      'mouthRight',
      'leftShoulder',
      'rightShoulder',
      'leftElbow',
      'rightElbow',
      'leftWrist',
      'rightWrist',
      'leftPinky',
      'rightPinky',
      'leftIndex',
      'rightIndex',
      'leftThumb',
      'rightThumb',
      'leftHip',
      'rightHip',
      'leftKnee',
      'rightKnee',
      'leftAnkle',
      'rightAnkle',
      'leftHeel',
      'rightHeel',
      'leftFootIndex',
      'rightFootIndex',
    ];
    const landmarks: Record<string, unknown> = {};
    names.forEach((n, i) => {
      landmarks[n] = { x: i / 100, y: 0.5, z: 0.1, visibility: 0.8, presence: 1 };
    });
    return {
      landmarks,
      worldLandmarks: {},
      poses: [],
      timestampMs: 42,
      imageWidth: 480,
      imageHeight: 640,
      cameraFacing: 'front',
    };
  }

  it('orders joints by MediaPipe index and carries timing and size', () => {
    const raw = toRawPoseResult(libFrame() as never)!;
    expect(raw.landmarks).toHaveLength(LANDMARK_COUNT);
    expect(raw.landmarks[11]).toEqual({ x: 0.11, y: 0.5, z: 0.1, visibility: 0.8 });
    expect(raw.landmarks[32]!.x).toBeCloseTo(0.32);
    expect(raw.timestampMs).toBe(42);
    expect([raw.imageWidth, raw.imageHeight]).toEqual([480, 640]);
  });

  it('maps a missing joint to a zero-visibility point', () => {
    const f = libFrame();
    f.landmarks['leftAnkle'] = null;
    expect(toRawPoseResult(f as never)!.landmarks[27]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
  });

  it('returns null for unreadable frames', () => {
    expect(toRawPoseResult(null)).toBeNull();
    expect(toRawPoseResult(undefined)).toBeNull();
    expect(toRawPoseResult({} as never)).toBeNull();
  });
});

describe('mapFailureReason', () => {
  const { mapFailureReason } = require('../../../services/cv/mediapipeBinding') as Binding;
  it('maps permission failures and everything else to camera_error', () => {
    expect(mapFailureReason('cameraPermission')).toBe('permission_denied');
    for (const r of [
      'modelLoad',
      'cameraRuntime',
      'cameraConfiguration',
      'inferenceRuntime',
      'nativeViewInitialization',
      'unreadableEvent',
    ]) {
      expect(mapFailureReason(r)).toBe('camera_error');
    }
  });
});

describe('SEC-3', () => {
  function walk(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__' && name !== 'node_modules') walk(p, out);
      } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it('only binding files reference expo-mediapipe-pose', () => {
    const src = join(__dirname, '..', '..', '..');
    const refs = walk(src, [])
      .filter((f) => readFileSync(f, 'utf8').includes('expo-mediapipe-pose'))
      .map((f) => relative(src, f).replace(/\\/g, '/'))
      .sort();
    const allowed = ['services/cv/MediapipePoseView.tsx', 'services/cv/mediapipeBinding.ts'];
    expect(refs.filter((r) => !allowed.includes(r))).toEqual([]);
    expect(refs).toContain('services/cv/mediapipeBinding.ts');
  });
});
