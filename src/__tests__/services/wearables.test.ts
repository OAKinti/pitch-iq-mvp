import { createHealthConnectAdapter } from '../../services/wearables/healthConnect';
import { createHealthKitAdapter } from '../../services/wearables/healthkit';
import { createWhoopAdapter, mapWhoopRecovery } from '../../services/wearables/whoop';
import { AI_SAFE_SOURCES, assertAiSafeSources } from '../../services/wearables/aiSafety';
import { buildStravaActivityPayload } from '../../services/wearables/stravaExport';
import { ballResult, shuttleResult } from './fixtures';

describe('stubs', () => {
  it('HealthKit and Health Connect are unavailable and empty', async () => {
    for (const [a, src] of [[createHealthKitAdapter(), 'healthkit'], [createHealthConnectAdapter(), 'health_connect']] as const) {
      expect(a.source).toBe(src);
      expect(await a.isAvailable()).toBe(false);
      expect(await a.fetchDailySummaries('2026-11-01', '2026-11-22')).toEqual([]);
    }
  });
});

describe('WHOOP', () => {
  const payload = {
    records: [
      { cycle_id: 1, created_at: '2026-11-20T06:30:00.000Z', score_state: 'SCORED', score: { recovery_score: 82, resting_heart_rate: 51, hrv_rmssd_milli: 74.5 } },
      { cycle_id: 2, created_at: '2026-11-21T06:30:00.000Z', score_state: 'PENDING_SCORE' },
      { cycle_id: 3, created_at: '2026-11-22T06:30:00.000Z', score_state: 'SCORED', score: { recovery_score: 'x' } },
      { cycle_id: 4, created_at: 5, score_state: 'SCORED', score: {} },
      null,
    ],
  };

  it('maps scored records only', () => {
    const out = mapWhoopRecovery(payload);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      source: 'whoop', date: '2026-11-20', restingHeartRateBpm: 51, hrvRmssdMs: 74.5,
      sleepMinutes: null, recoveryScore: 82, strain: null,
    });
    expect(out[1]?.recoveryScore).toBeNull();
  });
  it('returns [] for malformed payloads', () => {
    expect(mapWhoopRecovery(null)).toEqual([]);
    expect(mapWhoopRecovery({})).toEqual([]);
    expect(mapWhoopRecovery('x')).toEqual([]);
  });
  it('adapter is unavailable without fetchJson', async () => {
    const a = createWhoopAdapter({ fetchJson: null });
    expect(a.source).toBe('whoop');
    expect(await a.isAvailable()).toBe(false);
    expect(await a.fetchDailySummaries('2026-11-01', '2026-11-30')).toEqual([]);
  });
  it('adapter fetches via injected fetchJson and filters by date range', async () => {
    const fetchJson = jest.fn().mockResolvedValue(payload);
    const a = createWhoopAdapter({ fetchJson });
    expect(await a.isAvailable()).toBe(true);
    const out = await a.fetchDailySummaries('2026-11-20', '2026-11-20');
    expect(fetchJson.mock.calls[0][0]).toContain('/v2/recovery');
    expect(out.map((s) => s.date)).toEqual(['2026-11-20']);
  });
});

describe('aiSafety', () => {
  it('accepts ingestion sources and rejects others', () => {
    expect(() => assertAiSafeSources([])).not.toThrow();
    expect(() => assertAiSafeSources(AI_SAFE_SOURCES.map((source) => ({ source })))).not.toThrow();
    expect(() => assertAiSafeSources([{ source: 'fitbit' }])).toThrow(/not AI-safe/);
  });
});

describe('strava payload', () => {
  it('builds payloads for both drill types', () => {
    expect(buildStravaActivityPayload(ballResult)).toMatchObject({ sport_type: 'Soccer', elapsed_time: 30, start_date_local: ballResult.startedAt });
    expect(buildStravaActivityPayload(shuttleResult)).toMatchObject({ name: 'PitchIQ Agility Shuttle', elapsed_time: 10 });
  });
});
