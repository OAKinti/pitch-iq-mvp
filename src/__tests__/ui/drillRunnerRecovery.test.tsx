/**
 * Wave-2 audit regressions for useDrillRunner v2:
 *  - REC-1: a 'stalled' error keeps the provider and engine running, and the next valid frame clears it.
 *  - Terminal errors (permission_denied, camera_error) still tear the source down.
 */
import { act, renderHook } from '@testing-library/react-native';
import type { PoseFrame } from '../../types/contracts';
import type { PoseSourceError, PoseSourceProvider } from '../../services/cv';
import { generateFrames } from '../../domain/mock/mockPoseGenerator';
import { useDrillRunner } from '../../state/useDrillRunner';

type Handlers = { onFrame: (f: PoseFrame) => void; onError: (e: PoseSourceError) => void };

const mockState: { handlers: Handlers | null; stop: jest.Mock } = {
  handlers: null,
  stop: jest.fn(),
};

jest.mock('../../services/cv', () => {
  const actual = jest.requireActual('../../services/cv');
  return {
    ...actual,
    selectPoseSource: () => {
      const provider: PoseSourceProvider = {
        kind: 'mediapipe',
        start: (onFrame, onError) => {
          mockState.handlers = { onFrame, onError };
        },
        stop: mockState.stop,
        ingest: () => undefined,
        reportNativeError: () => undefined,
        stats: () => ({ delivered: 0, dropped: 0 }),
      };
      return { ok: true, provider };
    },
  };
});

const frames = generateFrames({ scenario: 'ball_mastery', fps: 30, seed: 7 } as never, 6);

async function startRunner() {
  const hook = await renderHook(() =>
    useDrillRunner('ball_mastery', {
      simulate: false,
      consentGranted: true,
      liveAllowed: true,
      nativeAvailable: true,
    }),
  );
  await act(async () => {
    expect(hook.result.current.start()).toBe(true);
  });
  return hook;
}

beforeEach(() => {
  mockState.handlers = null;
  mockState.stop.mockClear();
});

describe('useDrillRunner error recovery', () => {
  it('REC-1: stalled keeps running and the next frame clears the error', async () => {
    const { result } = await startRunner();
    await act(async () => mockState.handlers!.onFrame(frames[0]!));
    const before = result.current.snapshot;

    await act(async () => mockState.handlers!.onError('stalled'));
    expect(result.current.sourceError).toBe('stalled');
    expect(result.current.running).toBe(true);
    expect(mockState.stop).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBe(before); // engine not reset

    await act(async () => mockState.handlers!.onFrame(frames[1]!));
    expect(result.current.sourceError).toBeNull();
    expect(result.current.running).toBe(true);
  });

  it.each(['permission_denied', 'camera_error'] as const)(
    '%s still tears the source down',
    async (err) => {
      const { result } = await startRunner();
      await act(async () => mockState.handlers!.onError(err));
      expect(result.current.sourceError).toBe(err);
      expect(result.current.running).toBe(false);
      expect(mockState.stop).toHaveBeenCalled();
      // a late frame after teardown neither clears the terminal error nor restarts the drill
      await act(async () => mockState.handlers!.onFrame(frames[2]!));
      expect(result.current.sourceError).toBe(err);
      expect(result.current.running).toBe(false);
    },
  );
});
