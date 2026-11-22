import type {
  ArchetypeMatch,
  Badge,
  CoachPersona,
  DrillResult,
  OvrResult,
  WearableDailySummary,
} from '../../types/contracts';
import { assertAiSafeSources } from '../wearables/aiSafety';
import { DEBRIEF_MAX_CHARS } from './costModel';

export interface DebriefInput {
  persona: CoachPersona;
  result: DrillResult;
  ovr: OvrResult;
  badges: readonly Badge[];
  topArchetype?: ArchetypeMatch;
  wearables?: readonly WearableDailySummary[];
}

const PERSONA_VOICE: Record<CoachPersona, string> = {
  captain: 'You are "The Captain", a calm, composed team leader. Speak steadily and encouragingly.',
  drill_sergeant: 'You are "The Drill Sergeant", intense and demanding but never abusive. Short, punchy sentences.',
  hype: 'You are "The Hype Coach", bursting with energy and enthusiasm. Celebrate effort.',
};

const r1 = (n: number): number => Math.round(n * 10) / 10;

function compactMetrics(result: DrillResult): Record<string, unknown> {
  const m = result.metrics;
  if (m.drillType === 'ball_mastery') {
    return {
      drill: 'ball_mastery',
      touches: m.touches,
      touchesPerMinute: r1(m.touchesPerMinute),
      footBalance: r1(m.footBalance),
      rhythmCv: Math.round(m.rhythmCv * 100) / 100,
      hipSway: Math.round(m.hipSway * 100) / 100,
    };
  }
  return {
    drill: 'agility_shuttle',
    totalTimeS: r1(m.totalTimeMs / 1000),
    legs: m.splitTimesMs.length,
    peakSpeedMps: r1(m.peakSpeedMps),
    meanTurnTimeMs: Math.round(m.meanTurnTimeMs),
    splitCv: Math.round(m.splitCv * 100) / 100,
    fatigueIndex: Math.round(m.fatigueIndex * 100) / 100,
  };
}

/** Builds the Tier 2 prompt. Never includes user ids or names. Throws on non-AI-safe wearable sources. */
export function buildDebriefPrompt(input: DebriefInput): { system: string; user: string } {
  assertAiSafeSources(input.wearables ?? []);

  const system = [
    PERSONA_VOICE[input.persona],
    'You are a soccer coach giving a short spoken debrief after a drill.',
    `Reply with 2 to 3 sentences, at most ${DEBRIEF_MAX_CHARS} characters in total, plain text only.`,
    'Include exactly one concrete drill tip the player can try next session.',
    'Never make medical claims or diagnose injuries, and never mention health conditions.',
    'Do not ask for or mention personal information, names, or identifiers.',
    'Use only the JSON data provided by the user message.',
  ].join(' ');

  const payload = {
    metrics: compactMetrics(input.result),
    ovr: { value: input.ovr.ovr, band: input.ovr.band, position: input.ovr.position, attributes: input.ovr.attributes },
    badges: input.badges.map((b) => b.id),
    archetype: input.topArchetype
      ? { name: input.topArchetype.archetype.name, similarity: Math.round(input.topArchetype.similarity * 100) / 100 }
      : null,
    wearables: (input.wearables ?? []).map((w) => ({
      source: w.source,
      date: w.date,
      restingHr: w.restingHeartRateBpm,
      hrv: w.hrvRmssdMs,
      sleepMin: w.sleepMinutes,
      recovery: w.recoveryScore,
      strain: w.strain,
    })),
  };
  return { system, user: JSON.stringify(payload) };
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.\-!?]+$/, '');
}
export { truncateAtWord };

const TIP_BALL: Record<CoachPersona, string> = {
  captain: 'Next session, try ten slow touches per foot before you build speed.',
  drill_sergeant: 'Next session: twenty weak-foot touches before anything else.',
  hype: 'Next time, add a quick weak-foot warm-up and watch the card jump!',
};
const TIP_AGILITY: Record<CoachPersona, string> = {
  captain: 'Next session, work on dropping your hips lower into each turn.',
  drill_sergeant: 'Next session: sixty seconds of low plant-and-cut reps. No shortcuts.',
  hype: 'Next time, practise sharp turns with a low hip drop for extra flash!',
};

/** Deterministic zero-key Demo Mode debrief. */
export function templateDebrief(input: DebriefInput): string {
  const m = input.result.metrics;
  const ovr = input.ovr.ovr.toFixed(1);
  const badge = input.badges[0]?.label;
  let stat: string;
  let tip: string;
  if (m.drillType === 'ball_mastery') {
    stat = `${m.touches} touches at ${Math.round(m.touchesPerMinute)} per minute`;
    tip = TIP_BALL[input.persona];
  } else {
    stat = `${m.splitTimesMs.length} legs in ${(m.totalTimeMs / 1000).toFixed(1)} seconds, peak ${m.peakSpeedMps.toFixed(1)} m/s`;
    tip = TIP_AGILITY[input.persona];
  }
  const badgeBit = badge ? ` You earned ${badge}.` : '';
  const openers: Record<CoachPersona, string> = {
    captain: `Solid work: ${stat}, OVR ${ovr}.${badgeBit}`,
    drill_sergeant: `Report: ${stat}. OVR ${ovr}.${badgeBit} Good, but not done.`,
    hype: `Huge session! ${stat}, OVR ${ovr}!${badgeBit}`,
  };
  return truncateAtWord(`${openers[input.persona]} ${tip}`, DEBRIEF_MAX_CHARS);
}
