export interface QaBudget {
  readonly capSeconds: number;
  remainingSeconds(): number;
  canStart(): boolean;
  consume(seconds: number): number;
}

export function createQaBudget(opts: { capMinutes: number; usedSeconds?: number }): QaBudget {
  const capMinutes = Math.min(10, Math.max(5, Number.isFinite(opts.capMinutes) ? opts.capMinutes : 5));
  const capSeconds = Math.round(capMinutes * 60);
  let used = Math.min(capSeconds, Math.max(0, opts.usedSeconds ?? 0));
  return {
    capSeconds,
    remainingSeconds: () => capSeconds - used,
    canStart: () => capSeconds - used > 0,
    consume(seconds: number): number {
      const want = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      const granted = Math.min(want, capSeconds - used);
      used += granted;
      return granted;
    },
  };
}
