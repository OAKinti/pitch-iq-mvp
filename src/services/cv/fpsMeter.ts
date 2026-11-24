export interface FpsMeter {
  /** Feed a delivered frame timestamp; returns frames per second over the trailing window. */
  push(timestampMs: number): number;
  reset(): void;
  /** Last computed value (0 after reset). */
  current(): number;
}

export function createFpsMeter(windowMs: number = 1000): FpsMeter {
  const win = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 1000;
  let stamps: number[] = [];
  let last = -Infinity;
  let value = 0;

  return {
    push(timestampMs: number): number {
      if (!Number.isFinite(timestampMs) || timestampMs <= last) return value;
      last = timestampMs;
      stamps.push(timestampMs);
      const cutoff = timestampMs - win;
      let drop = 0;
      while (drop < stamps.length && stamps[drop]! <= cutoff) drop += 1;
      if (drop > 0) stamps = stamps.slice(drop);
      value = (stamps.length * 1000) / win;
      return value;
    },
    reset(): void {
      stamps = [];
      last = -Infinity;
      value = 0;
    },
    current(): number {
      return value;
    },
  };
}
