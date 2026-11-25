import * as fs from 'fs';
import * as path from 'path';
import { buildDebriefRequest } from '../../services/voice/debriefPrompt';
import { AI_SAFE_SOURCES } from '../../services/wearables/aiSafety';
import {
  STRAVA_CREATE_ACTIVITY_URL,
  buildStravaActivityPayload,
  createStravaExportAdapter,
} from '../../services/wearables/stravaExport';
import { archetype, badges, ballResult, ovr, shuttleResult } from './fixtures';

const servicesDir = path.join(__dirname, '..', '..', 'services');

function listTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listTs(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('Strava is write-only', () => {
  it('(a) exposes only destination + exportDrill', () => {
    const adapter = createStravaExportAdapter({ accessToken: 't', post: async () => ({}) });
    expect(Object.keys(adapter).sort()).toEqual(['destination', 'exportDrill']);
    expect(adapter.destination).toBe('strava');
  });

  it('(b) every post targets the activities-create URL with a bearer token', async () => {
    const post = jest.fn().mockResolvedValue({ id: 123 });
    const adapter = createStravaExportAdapter({ accessToken: 'tok', post });
    const a = await adapter.exportDrill(ballResult);
    const b = await adapter.exportDrill(shuttleResult);
    expect(a.remoteId).toBe('123');
    expect(b.remoteId).toBe('123');
    expect(post).toHaveBeenCalledTimes(2);
    for (const call of post.mock.calls) {
      expect(call[0]).toBe('https://www.strava.com/api/v3/activities');
      expect(call[2]).toEqual({ Authorization: 'Bearer tok' });
    }
    expect(STRAVA_CREATE_ACTIVITY_URL).toBe('https://www.strava.com/api/v3/activities');
    const src = fs.readFileSync(path.join(servicesDir, 'wearables', 'stravaExport.ts'), 'utf8');
    expect(src).not.toContain('GET');
    expect(src).not.toContain('.get(');
  });

  it('returns a null remoteId when Strava gives no id', async () => {
    const adapter = createStravaExportAdapter({ accessToken: 't', post: async () => ({}) });
    expect((await adapter.exportDrill(ballResult)).remoteId).toBeNull();
  });

  it('builds the activity payload', () => {
    const p = buildStravaActivityPayload(ballResult);
    expect(Object.keys(p).sort()).toEqual([
      'description',
      'elapsed_time',
      'name',
      'sport_type',
      'start_date_local',
    ]);
    expect(p.sport_type).toBe('Soccer');
  });

  it('(c) buildDebriefRequest throws when wearables include strava', () => {
    const wearables = [{ source: 'strava' }] as never;
    expect(() =>
      buildDebriefRequest({
        persona: 'captain',
        result: ballResult,
        ovr,
        badges,
        topArchetype: archetype,
        wearables,
      }),
    ).toThrow();
  });

  it('(d) voice/ and supabase/ never import anything strava-related', () => {
    const files = [
      ...listTs(path.join(servicesDir, 'voice')),
      ...listTs(path.join(servicesDir, 'supabase')),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const imports =
        fs.readFileSync(f, 'utf8').match(/^\s*(?:import|export)\b[^;]*?from\s+['"][^'"]+['"]/gm) ??
        [];
      for (const line of imports) expect(line).not.toMatch(/strava/i);
    }
  });

  it('(e) AI_SAFE_SOURCES excludes strava', () => {
    expect(AI_SAFE_SOURCES as readonly string[]).not.toContain('strava');
  });
});
