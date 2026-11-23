import {
  createStreamingLowpass,
  designButterworthLowpass,
  filtfilt,
  zeroPhaseLowpass,
} from '../../domain/filters/butterworth';
import { cv, mean, median, meanVisibility, midPoint, std, toImageHeightUnits } from '../../domain/drills/poseMath';
import { generateFrames } from '../../domain/mock/mockPoseGenerator';

const FS = 30;
const sine = (f: number, n: number, phase = 0): number[] =>
  Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * (i / FS) + phase));
const rms = (xs: number[], lo: number, hi: number): number =>
  Math.sqrt(xs.slice(lo, hi).reduce((s, x) => s + x * x, 0) / (hi - lo));
const gain = (f: number): number => {
  const x = sine(f, 600);
  return rms(zeroPhaseLowpass(x), 200, 400) / rms(x, 200, 400);
};

describe('butterworth design', () => {
  it('has unity DC gain and uses Winter correction for two passes', () => {
    for (const passes of [1, 2] as const) {
      const c = designButterworthLowpass(8, FS, passes);
      expect((c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2)).toBeCloseTo(1, 10);
    }
    const single = designButterworthLowpass(8, FS);
    const dual = designButterworthLowpass(8, FS, 2);
    expect(dual.b0).not.toBeCloseTo(single.b0, 3);
  });
});

describe('zeroPhaseLowpass', () => {
  it('preserves DC', () => {
    const out = zeroPhaseLowpass(Array.from({ length: 100 }, () => 3.7));
    for (const v of out) expect(v).toBeCloseTo(3.7, 9);
  });
  it('passes 1 Hz within 2 %', () => {
    expect(Math.abs(gain(1) - 1)).toBeLessThan(0.02);
  });
  it('has 0.707 gain at 8 Hz (+/- 0.03)', () => {
    expect(Math.abs(gain(8) - Math.SQRT1_2)).toBeLessThan(0.03);
  });
  it('attenuates 14 Hz below 0.2', () => {
    expect(gain(14)).toBeLessThan(0.2);
  });
  it('has zero phase lag', () => {
    const x = sine(2, 300);
    const y = zeroPhaseLowpass(x);
    const peak = (a: number[]): number => a.indexOf(Math.max(...a.slice(60, 90)), 60);
    expect(Math.abs(peak(y) - peak(x))).toBeLessThanOrEqual(1);
  });
  it('honours custom cutoff and sample rate', () => {
    const x = Array.from({ length: 600 }, (_, i) => Math.sin(2 * Math.PI * 4 * (i / 60)));
    const y = zeroPhaseLowpass(x, { cutoffHz: 4, sampleRateHz: 60 });
    expect(rms(y, 200, 400) / rms(x, 200, 400)).toBeCloseTo(Math.SQRT1_2, 1);
  });
  it('handles short signals', () => {
    expect(zeroPhaseLowpass([])).toEqual([]);
    expect(zeroPhaseLowpass([5])).toEqual([5]);
    const two = zeroPhaseLowpass([1, 1]);
    expect(two).toHaveLength(2);
    expect(two[0]).toBeCloseTo(1, 9);
    const five = zeroPhaseLowpass([2, 2, 2, 2, 2]);
    expect(five).toHaveLength(5);
    for (const v of five) expect(v).toBeCloseTo(2, 9);
    const copy = [1, 2, 3];
    expect(filtfilt(copy, designButterworthLowpass(8, FS, 2))).toHaveLength(3);
    expect(filtfilt([7], designButterworthLowpass(8, FS))).not.toBe(copy);
  });
  it('does not mutate its input', () => {
    const x = sine(1, 50);
    const snapshot = [...x];
    zeroPhaseLowpass(x);
    expect(x).toEqual(snapshot);
  });
});

describe('streaming lowpass', () => {
  it('converges to DC with no startup transient, and resets', () => {
    const f = createStreamingLowpass(8, FS);
    expect(f.step(4)).toBeCloseTo(4, 9);
    for (let i = 0; i < 20; i++) expect(f.step(4)).toBeCloseTo(4, 9);
    f.reset();
    expect(f.step(-2)).toBeCloseTo(-2, 9);
  });
  it('converges to a new level after a step and lags causally', () => {
    const f = createStreamingLowpass(8, FS);
    f.step(0);
    const first = f.step(1);
    expect(first).toBeLessThan(1);
    let y = first;
    for (let i = 0; i < 40; i++) y = f.step(1);
    expect(y).toBeCloseTo(1, 6);
  });
});

describe('poseMath', () => {
  it('statistics helpers', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(std([2, 2, 2])).toBe(0);
    expect(std([1, 3])).toBe(1);
    expect(cv([0, 0])).toBe(0);
    expect(cv([1, 3])).toBe(0.5);
  });
  it('geometry helpers are aspect-correct', () => {
    const [frame] = generateFrames({ scenario: 'idle', noise: 0 }, 1);
    const p = toImageHeightUnits(frame!, 23);
    expect(p.x).toBeCloseTo(frame!.landmarks[23]!.x * (720 / 1280), 12);
    expect(p.y).toBe(frame!.landmarks[23]!.y);
    expect(midPoint({ x: 0, y: 2 }, { x: 4, y: 4 })).toEqual({ x: 2, y: 3 });
    expect(meanVisibility(frame!, [23, 24])).toBeCloseTo(0.99, 12);
  });
});
