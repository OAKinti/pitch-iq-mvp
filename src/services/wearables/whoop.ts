import type { WearableDailySummary } from '../../types/contracts';
import type { IngestionAdapter } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Map a WHOOP v2 `/v2/recovery` payload to canonical daily summaries. Unscored records are skipped. */
export function mapWhoopRecovery(payload: unknown): WearableDailySummary[] {
  if (!isObj(payload) || !Array.isArray(payload.records)) return [];
  const out: WearableDailySummary[] = [];
  for (const rec of payload.records as unknown[]) {
    if (!isObj(rec) || rec.score_state !== 'SCORED' || !isObj(rec.score)) continue;
    if (typeof rec.created_at !== 'string' || rec.created_at.length < 10) continue;
    out.push({
      source: 'whoop',
      date: rec.created_at.slice(0, 10),
      restingHeartRateBpm: num(rec.score.resting_heart_rate),
      hrvRmssdMs: num(rec.score.hrv_rmssd_milli),
      sleepMinutes: null,
      recoveryScore: num(rec.score.recovery_score),
      strain: null,
    });
  }
  return out;
}

export function createWhoopAdapter(opts: {
  fetchJson: ((path: string) => Promise<unknown>) | null;
}): IngestionAdapter {
  const { fetchJson } = opts;
  return {
    source: 'whoop',
    isAvailable: async () => fetchJson !== null,
    fetchDailySummaries: async (fromDate, toDate) => {
      if (!fetchJson) return [];
      const q = `start=${encodeURIComponent(`${fromDate}T00:00:00.000Z`)}&end=${encodeURIComponent(`${toDate}T23:59:59.999Z`)}`;
      const payload = await fetchJson(`/v2/recovery?${q}`);
      return mapWhoopRecovery(payload).filter((s) => s.date >= fromDate && s.date <= toDate);
    },
  };
}
