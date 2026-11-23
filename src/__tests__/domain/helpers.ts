import type { DrillEngine, DrillSnapshot, PoseFrame } from '../../types/contracts';
import type { MockPoseStream } from '../../domain/mock/mockPoseGenerator';

export interface DriveResult {
  snapshots: DrillSnapshot[];
  cues: string[];
  frames: number;
}

/** Push frames until the engine reports complete (or maxFrames). */
export function drive(engine: DrillEngine, stream: MockPoseStream, maxFrames = 4000): DriveResult {
  const snapshots: DrillSnapshot[] = [];
  const cues: string[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const s = engine.push(stream.next());
    snapshots.push(s);
    if (s.cue !== null) cues.push(s.cue);
    if (s.phase === 'complete') break;
  }
  return { snapshots, cues, frames: snapshots.length };
}

export function driveFrames(engine: DrillEngine, frames: readonly PoseFrame[]): DriveResult {
  const snapshots: DrillSnapshot[] = [];
  const cues: string[] = [];
  for (const f of frames) {
    const s = engine.push(f);
    snapshots.push(s);
    if (s.cue !== null) cues.push(s.cue);
  }
  return { snapshots, cues, frames: snapshots.length };
}

export const count = (xs: readonly string[], v: string): number => xs.filter((x) => x === v).length;
