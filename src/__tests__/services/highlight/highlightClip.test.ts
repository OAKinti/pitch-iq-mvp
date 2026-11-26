import fs from 'fs';
import path from 'path';
import {
  HIGHLIGHT_CLIP_SPEC,
  type ClipEncoder,
  type ClipEncodeResult,
} from '../../../services/highlight/clipEncoder';
import {
  createHighlightClipService,
  type ClipFiles,
} from '../../../services/highlight/highlightClip';

const REC = 'file:///cache/rec.mov';
const input = {
  recordingUri: REC,
  eventTimestampsMs: [10_000, 12_000, 14_000, 40_000],
  totalDurationMs: 60_000,
};

function setup(
  result: ClipEncodeResult | (() => Promise<ClipEncodeResult>) = {
    ok: true,
    outputUri: 'file:///cache/highlight-7.mp4',
    durationMs: 15000,
  },
) {
  const present = new Set<string>([REC]);
  const removed: string[] = [];
  const files: ClipFiles = {
    cacheDir: () => 'file:///cache/',
    exists: jest.fn(async (u: string) => present.has(u)),
    remove: jest.fn(async (u: string) => {
      removed.push(u);
      present.delete(u);
    }),
  };
  const encode = jest.fn(async (req) => {
    present.add(req.outputUri); // partial output exists
    return typeof result === 'function' ? result() : result;
  });
  const encoder: ClipEncoder = { isAvailable: () => true, encode };
  return {
    files,
    encoder,
    encode,
    removed,
    present,
    svc: createHighlightClipService({ encoder, files, now: () => 7 }),
  };
}

describe('highlightClip', () => {
  it('non-file recording URI -> invalid_input without calling the encoder', async () => {
    const s = setup();
    for (const bad of [
      { ...input, recordingUri: '/tmp/x.mov' },
      { ...input, totalDurationMs: 0 },
      { ...input, totalDurationMs: NaN },
    ]) {
      expect(await s.svc.makeClip(bad)).toEqual({ ok: false, reason: 'invalid_input' });
    }
    expect(s.encode).not.toHaveBeenCalled();
    expect(s.removed).toEqual([]);
  });

  it('output is written under cacheDir and success returns the window', async () => {
    const s = setup();
    const r = await s.svc.makeClip(input);
    expect(r).toMatchObject({
      ok: true,
      clipUri: 'file:///cache/highlight-7.mp4',
      durationMs: 15000,
    });
    const req = s.encode.mock.calls[0]![0];
    expect(req.outputUri).toBe('file:///cache/highlight-7.mp4');
    expect(req.inputUri).toBe(REC);
    expect(req.spec).toBe(HIGHLIGHT_CLIP_SPEC);
    expect(req.durationMs).toBe(15000);
  });

  it('adds a trailing slash to a bare cache dir and defaults now to Date.now', async () => {
    const s = setup();
    const files = { ...s.files, cacheDir: () => 'file:///c' };
    const svc = createHighlightClipService({ encoder: s.encoder, files });
    await svc.makeClip(input);
    expect(s.encode.mock.calls[0]![0].outputUri).toMatch(/^file:\/\/\/c\/highlight-\d+\.mp4$/);
  });

  it('raw recording is removed after success and after failure', async () => {
    const ok = setup();
    await ok.svc.makeClip(input);
    expect(ok.removed).toEqual([REC]);

    for (const reason of ['encode_failed', 'spec_mismatch', 'unavailable'] as const) {
      const f = setup({ ok: false, reason });
      expect(await f.svc.makeClip(input)).toEqual({ ok: false, reason });
      expect(f.removed).toContain(REC);
      expect(f.removed).toContain('file:///cache/highlight-7.mp4');
    }
  });

  it('never rejects: a throwing encoder is encode_failed, cleanup errors are swallowed', async () => {
    const s = setup(() => Promise.reject(new Error('native')));
    expect(await s.svc.makeClip(input)).toEqual({ ok: false, reason: 'encode_failed' });
    expect(s.removed).toContain(REC);

    const t = setup({ ok: false, reason: 'encode_failed' });
    (t.files.exists as jest.Mock).mockRejectedValue(new Error('io'));
    (t.files.remove as jest.Mock).mockRejectedValue(new Error('io'));
    expect(await t.svc.makeClip(input)).toEqual({ ok: false, reason: 'encode_failed' });

    const u = setup();
    (u.files as { cacheDir: () => string }).cacheDir = () => {
      throw new Error('no cache');
    };
    expect(await u.svc.makeClip(input)).toEqual({ ok: false, reason: 'encode_failed' });
    expect(u.removed).toContain(REC);
  });

  it('a second makeClip while one is in flight resolves busy and touches no file', async () => {
    let release!: (r: ClipEncodeResult) => void;
    let calls = 0;
    const s = setup(() => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ ok: true, outputUri: 'file:///cache/highlight-7.mp4', durationMs: 1 } as ClipEncodeResult);
      return new Promise<ClipEncodeResult>((res) => (release = res));
    });
    const first = s.svc.makeClip(input);
    await Promise.resolve();
    const second = await s.svc.makeClip({ ...input, recordingUri: 'file:///cache/other.mov' });
    expect(second).toEqual({ ok: false, reason: 'busy' });
    expect(s.removed).toEqual([]);
    expect(s.encode).toHaveBeenCalledTimes(1);
    release({ ok: true, outputUri: 'file:///cache/highlight-7.mp4', durationMs: 100 });
    expect((await first).ok).toBe(true);
    expect(s.removed).toEqual([REC]);
    expect((await s.svc.makeClip(input)).ok).toBe(true);
  });

  it('highlight sources contain no network API', () => {
    const dir = path.resolve(__dirname, '../../../services/highlight');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/fetch\(|XMLHttpRequest|https?:\/\/|supabase|strava|wearable/i);
    }
  });
});
