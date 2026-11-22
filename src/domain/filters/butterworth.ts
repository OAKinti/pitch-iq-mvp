/**
 * Butterworth low-pass (biquad) with Winter's multi-pass correction.
 * Pure TypeScript; see skill soccer-cv-math §1.
 */

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Bilinear-transform biquad, Q = 1/sqrt(2), pre-warped, Winter correction for `passes`. */
export function designButterworthLowpass(
  cutoffHz: number,
  sampleRateHz: number,
  passes: 1 | 2 = 1,
): BiquadCoefficients {
  const correction = Math.pow(Math.pow(2, 1 / passes) - 1, 0.25);
  const k = Math.tan((Math.PI * cutoffHz) / sampleRateHz) / correction;
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm;
  return {
    b0,
    b1: 2 * b0,
    b2: b0,
    a1: 2 * (k * k - 1) * norm,
    a2: (1 - Math.SQRT2 * k + k * k) * norm,
  };
}

/** Direct-Form-II-Transposed state initialised to the steady state for constant input `x0`. */
function steadyState(c: BiquadCoefficients, x0: number): { z1: number; z2: number } {
  return { z1: (c.b1 + c.b2 - c.a1 - c.a2) * x0, z2: (c.b2 - c.a2) * x0 };
}

function runSection(input: readonly number[], c: BiquadCoefficients): number[] {
  const x0 = input[0]!;
  const s = steadyState(c, x0);
  let z1 = s.z1;
  let z2 = s.z2;
  return input.map((x) => {
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    return y;
  });
}

/** Forward-backward filtering with odd-reflection padding. Zero phase. */
export function filtfilt(signal: readonly number[], c: BiquadCoefficients): number[] {
  const n = signal.length;
  if (n < 2) return signal.slice();
  const padLen = Math.min(9, n - 1);
  const first = signal[0]!;
  const last = signal[n - 1]!;
  const padded: number[] = [];
  for (let i = padLen; i >= 1; i--) padded.push(2 * first - signal[i]!);
  for (let i = 0; i < n; i++) padded.push(signal[i]!);
  for (let i = 1; i <= padLen; i++) padded.push(2 * last - signal[n - 1 - i]!);
  const forward = runSection(padded, c);
  const backward = runSection(forward.reverse(), c).reverse();
  return backward.slice(padLen, padLen + n);
}

/** 8 Hz @ 30 FPS by default; −3 dB point of the combined forward/backward response is exactly cutoffHz. */
export function zeroPhaseLowpass(
  signal: readonly number[],
  opts: { cutoffHz?: number; sampleRateHz?: number } = {},
): number[] {
  const { cutoffHz = 8, sampleRateHz = 30 } = opts;
  return filtfilt(signal, designButterworthLowpass(cutoffHz, sampleRateHz, 2));
}

export interface StreamingFilter {
  step(x: number): number;
  reset(): void;
}

/** Causal single-pass low-pass for live telemetry. Primes to the first sample (no startup transient). */
export function createStreamingLowpass(cutoffHz: number, sampleRateHz: number): StreamingFilter {
  const c = designButterworthLowpass(cutoffHz, sampleRateHz, 1);
  let primed = false;
  let z1 = 0;
  let z2 = 0;
  return {
    step(x: number): number {
      if (!primed) {
        const s = steadyState(c, x);
        z1 = s.z1;
        z2 = s.z2;
        primed = true;
      }
      const y = c.b0 * x + z1;
      z1 = c.b1 * x - c.a1 * y + z2;
      z2 = c.b2 * x - c.a2 * y;
      return y;
    },
    reset(): void {
      primed = false;
      z1 = 0;
      z2 = 0;
    },
  };
}
