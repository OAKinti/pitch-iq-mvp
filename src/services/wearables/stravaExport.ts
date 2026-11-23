import type { DrillResult } from '../../types/contracts';
import type { ExportAdapter } from './types';

/** Write-only: this module only ever creates activities. It never reads Strava data. */
export const STRAVA_CREATE_ACTIVITY_URL = 'https://www.strava.com/api/v3/activities';

const DRILL_NAMES = { ball_mastery: 'Ball Mastery', agility_shuttle: 'Agility Shuttle' } as const;

export function buildStravaActivityPayload(result: DrillResult): Record<string, string | number> {
  const m = result.metrics;
  if (m.drillType === 'ball_mastery') {
    return {
      name: `PitchIQ ${DRILL_NAMES.ball_mastery}`,
      sport_type: 'Soccer',
      start_date_local: result.startedAt,
      elapsed_time: Math.max(1, Math.round(m.durationMs / 1000)),
      description: `${m.touches} touches (${Math.round(m.touchesPerMinute)}/min), foot balance ${Math.round(m.footBalance * 100)}%. Tracked with PitchIQ.`,
    };
  }
  return {
    name: `PitchIQ ${DRILL_NAMES.agility_shuttle}`,
    sport_type: 'Soccer',
    start_date_local: result.startedAt,
    elapsed_time: Math.max(1, Math.round(m.totalTimeMs / 1000)),
    description: `${m.splitTimesMs.length} legs, peak ${m.peakSpeedMps.toFixed(1)} m/s. Tracked with PitchIQ.`,
  };
}

export function createStravaExportAdapter(opts: {
  accessToken: string;
  post: (
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ) => Promise<{ id?: number | string }>;
}): ExportAdapter {
  return {
    destination: 'strava',
    exportDrill: async (result) => {
      const res = await opts.post(STRAVA_CREATE_ACTIVITY_URL, buildStravaActivityPayload(result), {
        Authorization: `Bearer ${opts.accessToken}`,
      });
      return { remoteId: res.id === undefined ? null : String(res.id) };
    },
  };
}
