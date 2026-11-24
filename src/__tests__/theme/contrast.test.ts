import { colors } from '../../theme/tokens';

type ColorToken = keyof typeof colors;

const HEX = /^#[0-9A-Fa-f]{6}$/;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_FG: ColorToken[] = [
  'textPrimary', 'textSecondary', 'textMuted', 'accent', 'telemetry', 'warning', 'danger', 'crownGold', 'crownSilver',
];
const SURFACES: ColorToken[] = ['bg', 'surface', 'surfaceRaised', 'surfaceHigh'];

type Pair = readonly [fg: ColorToken, bg: ColorToken, min: number];
const pairs: Pair[] = [];
for (const fg of TEXT_FG) for (const bg of SURFACES) pairs.push([fg, bg, 4.5]);
for (const bg of ['accent', 'accentPressed'] as const) pairs.push(['textOnAccent', bg, 4.5]);
for (const fg of ['textPrimary', 'textSecondary', 'accent'] as const) pairs.push([fg, 'accentDim', 4.5]);
for (const fg of ['skeletonJoint', 'skeletonBone'] as const) for (const bg of ['bg', 'surfaceRaised'] as const) pairs.push([fg, bg, 3]);
for (const fg of ['accent', 'telemetry'] as const) pairs.push([fg, 'surfaceHigh', 3]);

describe('WCAG 2.1 contrast of frozen tokens (A11Y-1)', () => {
  it('computes known reference ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('every token in the table resolves to #RRGGBB', () => {
    const names = new Set<ColorToken>(pairs.flatMap(([fg, bg]) => [fg, bg]));
    for (const n of names) expect(colors[n]).toMatch(HEX);
  });

  it.each(pairs.map((p) => [p[0], p[1], p[2]] as const))('%s on %s >= %s:1', (fg, bg, min) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(min);
  });

  it('documents why own-row rank may not use textMuted (A11Y-3)', () => {
    expect(contrastRatio(colors.textMuted, colors.accentDim)).toBeLessThan(4.5);
  });

  it('reports the lowest ratio', () => {
    const lowest = pairs
      .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrastRatio(colors[fg], colors[bg]) }))
      .sort((a, b) => a.ratio - b.ratio)[0];
    expect(lowest).toBeDefined();
    console.info(`lowest contrast: ${lowest?.fg} on ${lowest?.bg} = ${lowest?.ratio.toFixed(2)}`);
  });
});
