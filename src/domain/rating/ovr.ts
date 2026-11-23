import {
  ATTRIBUTE_KEYS,
  ELITE_BAND_FLOOR,
  RATING_CEILING,
  type AttributeVector,
  type OvrResult,
  type PlayerPosition,
  type RatingBand,
} from '../../types/contracts';

export const POSITION_WEIGHTS: Readonly<Record<PlayerPosition, AttributeVector>> = {
  GK: { pace: 0.1, agility: 0.3, ballControl: 0.1, balance: 0.25, rhythm: 0.1, endurance: 0.15 },
  DEF: { pace: 0.2, agility: 0.2, ballControl: 0.1, balance: 0.25, rhythm: 0.05, endurance: 0.2 },
  MID: { pace: 0.1, agility: 0.15, ballControl: 0.25, balance: 0.1, rhythm: 0.2, endurance: 0.2 },
  FWD: { pace: 0.3, agility: 0.2, ballControl: 0.2, balance: 0.1, rhythm: 0.1, endurance: 0.1 },
};

const ELITE_SPAN = RATING_CEILING - ELITE_BAND_FLOOR;

/** Identity up to 95, then asymptotic approach to 99.9 with slope 1 at the join. */
export function compressEliteBand(raw: number): number {
  if (raw <= ELITE_BAND_FLOOR) return raw;
  return ELITE_BAND_FLOOR + ELITE_SPAN * (1 - Math.exp(-(raw - ELITE_BAND_FLOOR) / ELITE_SPAN));
}

function bandFor(ovr: number): RatingBand {
  if (ovr < 60) return 'developing';
  if (ovr < ELITE_BAND_FLOOR) return 'standard';
  return 'elite';
}

export function computeOvr(attributes: AttributeVector, position: PlayerPosition): OvrResult {
  const w = POSITION_WEIGHTS[position];
  let raw = 0;
  for (const key of ATTRIBUTE_KEYS) raw += w[key] * attributes[key];
  const clamped = Math.min(RATING_CEILING, Math.max(0, compressEliteBand(raw)));
  const ovr = Math.round(clamped * 10) / 10;
  return { sport: 'soccer', position, ovr, band: bandFor(ovr), attributes };
}
