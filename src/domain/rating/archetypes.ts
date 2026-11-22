import {
  ATTRIBUTE_KEYS,
  type Archetype,
  type ArchetypeMatch,
  type AttributeVector,
} from '../../types/contracts';

const profile = (v: readonly number[]): AttributeVector => ({
  pace: v[0]!,
  agility: v[1]!,
  ballControl: v[2]!,
  balance: v[3]!,
  rhythm: v[4]!,
  endurance: v[5]!,
});

/** Generic playing-style prototypes (deliberately no real player names). Order: pace, agility, ballControl, balance, rhythm, endurance. */
export const PRO_ARCHETYPES: readonly Archetype[] = [
  {
    id: 'maestro',
    name: 'The Maestro',
    tagline: 'Dictates tempo with silky touch and rhythm.',
    profile: profile([60, 70, 95, 75, 92, 70]),
  },
  {
    id: 'speedster',
    name: 'The Speedster',
    tagline: 'Pure acceleration; defenders never catch up.',
    profile: profile([97, 82, 65, 60, 62, 70]),
  },
  {
    id: 'engine',
    name: 'The Engine',
    tagline: 'Covers every blade of grass for ninety minutes.',
    profile: profile([75, 70, 72, 75, 75, 96]),
  },
  {
    id: 'wall',
    name: 'The Wall',
    tagline: 'Immovable base, impossible to knock off the ball.',
    profile: profile([70, 72, 58, 96, 65, 85]),
  },
  {
    id: 'magician',
    name: 'The Magician',
    tagline: 'Twisting, turning, and gone before you blink.',
    profile: profile([80, 96, 92, 70, 80, 62]),
  },
  {
    id: 'sweeper_keeper',
    name: 'The Sweeper-Keeper',
    tagline: 'Quick reactions and a rock-solid stance.',
    profile: profile([65, 92, 60, 90, 60, 72]),
  },
];

function centredUnit(v: AttributeVector): number[] {
  const values = ATTRIBUTE_KEYS.map((k) => v[k]);
  const m = values.reduce((s, x) => s + x, 0) / values.length;
  const centred = values.map((x) => x - m);
  const norm = Math.sqrt(centred.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? centred.map(() => 0) : centred.map((x) => x / norm);
}

/** Cosine similarity of mean-centred, L2-normalised vectors (shape, not level). Zero norm gives 0. */
export function cosineSimilarity(a: AttributeVector, b: AttributeVector): number {
  const ua = centredUnit(a);
  const ub = centredUnit(b);
  return ua.reduce((s, x, i) => s + x * ub[i]!, 0);
}

export function matchArchetypes(attributes: AttributeVector, k = 3): ArchetypeMatch[] {
  return PRO_ARCHETYPES.map((archetype) => ({
    archetype,
    similarity: cosineSimilarity(attributes, archetype.profile),
  }))
    .sort((x, y) => y.similarity - x.similarity || x.archetype.id.localeCompare(y.archetype.id))
    .slice(0, k);
}
