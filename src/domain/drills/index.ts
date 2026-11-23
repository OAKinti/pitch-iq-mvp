import type { DrillEngine, DrillType } from '../../types/contracts';
import { createAgilityShuttleEngine } from './agilityShuttle';
import { createBallMasteryEngine } from './ballMastery';

export { DEFAULT_BALL_MASTERY_CONFIG, createBallMasteryEngine } from './ballMastery';
export { DEFAULT_AGILITY_SHUTTLE_CONFIG, createAgilityShuttleEngine } from './agilityShuttle';

export function createDrillEngine(type: DrillType): DrillEngine {
  return type === 'ball_mastery' ? createBallMasteryEngine() : createAgilityShuttleEngine();
}
