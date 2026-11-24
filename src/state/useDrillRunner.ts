import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CueId,
  type DrillEngine,
  type DrillResult,
  type DrillSnapshot,
  type DrillType,
  type PoseFrame,
  type PoseSource,
} from '../types/contracts';
import { createDrillEngine } from '../domain';
import {
  createFpsMeter,
  isMediapipeAvailable,
  selectPoseSource,
  type FpsMeter,
  type PoseSourceError,
  type PoseSourceProvider,
  type PoseSourceUnavailableReason,
} from '../services/cv';

export interface DrillRunnerOptions {
  simulate: boolean;
  consentGranted: boolean;
  liveAllowed: boolean;
  seed?: number;
  /** Defaults to isMediapipeAvailable(). */
  nativeAvailable?: boolean;
  /** Called synchronously for every new snapshot cue (Tier 1 playback; never batched away). */
  onCue?: (cue: CueId) => void;
}

export interface DrillRunner {
  snapshot: DrillSnapshot | null;
  latestFrame: PoseFrame | null;
  latestCue: CueId | null;
  running: boolean;
  result: DrillResult | null;
  /** Returns false when nothing started; sourceError then says why. */
  start: () => boolean;
  stop: () => void;
  reset: () => void;
  readonly sourceKind: PoseSource | null;
  readonly provider: PoseSourceProvider | null;
  readonly fps: number;
  readonly sourceError: PoseSourceError | PoseSourceUnavailableReason | null;
}

/**
 * Drives a DrillEngine from exactly one PoseSourceProvider per drill (CON-2). Live never falls back
 * to mock (FAIL-2); native errors stop the provider and surface as sourceError (FAIL-5).
 */
export function useDrillRunner(drillType: DrillType, opts: DrillRunnerOptions): DrillRunner {
  const [snapshot, setSnapshot] = useState<DrillSnapshot | null>(null);
  const [latestFrame, setLatestFrame] = useState<PoseFrame | null>(null);
  const [latestCue, setLatestCue] = useState<CueId | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [provider, setProvider] = useState<PoseSourceProvider | null>(null);
  const [fps, setFps] = useState(0);
  const [sourceError, setSourceError] = useState<DrillRunner['sourceError']>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const active = useRef<PoseSourceProvider | null>(null);
  const meter = useRef<FpsMeter | null>(null);

  const teardown = useCallback(() => {
    const p = active.current;
    active.current = null;
    if (p) p.stop();
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    teardown();
    setRunning(false);
  }, [teardown]);

  const reset = useCallback(() => {
    teardown();
    setRunning(false);
    setSnapshot(null);
    setLatestFrame(null);
    setLatestCue(null);
    setResult(null);
    setProvider(null);
    setFps(0);
    setSourceError(null);
  }, [teardown]);

  const start = useCallback((): boolean => {
    teardown();
    const o = optsRef.current;
    const selection = selectPoseSource({
      simulate: o.simulate,
      consentGranted: o.consentGranted,
      liveAllowed: o.liveAllowed,
      nativeAvailable: o.nativeAvailable ?? isMediapipeAvailable(),
      scenario: drillType,
      ...(o.seed === undefined ? {} : { seed: o.seed }),
    });
    setSnapshot(null);
    setLatestFrame(null);
    setLatestCue(null);
    setResult(null);
    setFps(0);
    if (!selection.ok) {
      setProvider(null);
      setRunning(false);
      setSourceError(selection.reason);
      return false;
    }
    const src = selection.provider;
    const eng: DrillEngine = createDrillEngine(drillType);
    const fpsMeter = createFpsMeter();
    meter.current = fpsMeter;
    const startedAt = new Date().toISOString();
    active.current = src;
    setProvider(src);
    setSourceError(null);
    setRunning(true);

    src.start(
      (frame) => {
        if (active.current !== src) return;
        const snap = eng.push(frame);
        setFps(fpsMeter.push(frame.timestampMs));
        setLatestFrame(frame);
        setSnapshot(snap);
        if (snap.cue) {
          setLatestCue(snap.cue);
          optsRef.current.onCue?.(snap.cue);
        }
        if (snap.phase === 'complete') {
          teardown();
          setRunning(false);
          const metrics = eng.result();
          if (metrics) {
            setResult({
              id: `drill-${drillType}-${startedAt}`,
              sport: 'soccer',
              drillType,
              startedAt,
              metrics,
            });
          }
        }
      },
      (error) => {
        if (active.current !== src) return;
        teardown();
        setRunning(false);
        setSourceError(error);
      },
    );
    return true;
  }, [drillType, teardown]);

  return {
    snapshot,
    latestFrame,
    latestCue,
    running,
    result,
    start,
    stop,
    reset,
    sourceKind: provider ? provider.kind : null,
    provider,
    fps,
    sourceError,
  };
}
