import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TARGET_FPS,
  type CueId,
  type DrillEngine,
  type DrillResult,
  type DrillSnapshot,
  type DrillType,
  type PoseFrame,
} from '../types/contracts';
import { createDrillEngine, createMockPoseStream, type MockPoseStream } from '../domain';

export interface DrillRunner {
  snapshot: DrillSnapshot | null;
  latestFrame: PoseFrame | null;
  latestCue: CueId | null;
  running: boolean;
  result: DrillResult | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/** Drives a DrillEngine from the mock pose stream. Live camera replaces the stream on the Dev Client build. */
export function useDrillRunner(drillType: DrillType, seed = 7): DrillRunner {
  const [snapshot, setSnapshot] = useState<DrillSnapshot | null>(null);
  const [latestFrame, setLatestFrame] = useState<PoseFrame | null>(null);
  const [latestCue, setLatestCue] = useState<CueId | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DrillResult | null>(null);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const engine = useRef<DrillEngine | null>(null);
  const stream = useRef<MockPoseStream | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const stop = useCallback(() => {
    clear();
    setRunning(false);
  }, [clear]);

  const reset = useCallback(() => {
    clear();
    engine.current = null;
    stream.current = null;
    setRunning(false);
    setSnapshot(null);
    setLatestFrame(null);
    setLatestCue(null);
    setResult(null);
  }, [clear]);

  const start = useCallback(() => {
    clear();
    const eng = createDrillEngine(drillType);
    const str = createMockPoseStream({ scenario: drillType, seed });
    engine.current = eng;
    stream.current = str;
    const startedAt = new Date().toISOString();
    setSnapshot(null);
    setLatestFrame(null);
    setLatestCue(null);
    setResult(null);
    setRunning(true);
    timer.current = setInterval(() => {
      const frame = str.next();
      const snap = eng.push(frame);
      setLatestFrame(frame);
      setSnapshot(snap);
      if (snap.cue) setLatestCue(snap.cue);
      if (snap.phase === 'complete') {
        clear();
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
    }, 1000 / TARGET_FPS);
  }, [clear, drillType, seed]);

  return { snapshot, latestFrame, latestCue, running, result, start, stop, reset };
}
