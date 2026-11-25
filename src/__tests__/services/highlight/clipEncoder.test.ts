import fs from 'fs';
import path from 'path';
import {
  HIGHLIGHT_CLIP_SPEC,
  buildClipEncodeRequest,
  isValidClipRequest,
  type ClipEncodeRequest,
} from '../../../services/highlight/clipEncoder';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const base = (over: Partial<ClipEncodeRequest> = {}): ClipEncodeRequest => ({
  inputUri: 'file:///cache/in.mov',
  outputUri: 'file:///cache/out.mp4',
  startMs: 1000,
  durationMs: 8000,
  spec: HIGHLIGHT_CLIP_SPEC,
  ...over,
});

describe('clipEncoder', () => {
  it('accepts a well-formed request', () => {
    expect(isValidClipRequest(base())).toBe(true);
    expect(isValidClipRequest(base({ durationMs: 15000, startMs: 0 }))).toBe(true);
  });

  it('rejects malformed requests', () => {
    const bad: Partial<ClipEncodeRequest>[] = [
      { inputUri: 'http-no' },
      { outputUri: '/tmp/x.mp4' },
      { outputUri: 'file:///cache/in.mov' },
      { startMs: -1 },
      { startMs: NaN },
      { durationMs: 0 },
      { durationMs: Infinity },
      { durationMs: 15001 },
    ];
    for (const b of bad) expect(isValidClipRequest(base(b))).toBe(false);
    expect(isValidClipRequest(null as unknown as ClipEncodeRequest)).toBe(false);
    expect(isValidClipRequest({ ...base(), inputUri: 5 as unknown as string })).toBe(false);
  });

  it('buildClipEncodeRequest clamps the window', () => {
    const r = buildClipEncodeRequest({
      inputUri: 'file:///a',
      outputUri: 'file:///b',
      window: { startMs: -5, endMs: 30000, eventCount: 2 },
    });
    expect(r.startMs).toBe(0);
    expect(r.durationMs).toBe(15000);
    expect(
      buildClipEncodeRequest({
        inputUri: 'a',
        outputUri: 'b',
        window: { startMs: 9, endMs: 3, eventCount: 0 },
      }).durationMs,
    ).toBe(0);
  });

  it('agnostic files import no native, camera, pose or encoder package', () => {
    for (const f of ['clipEncoder.ts', 'highlightClip.ts', 'cameraMode.ts']) {
      const src = read(`src/services/highlight/${f}`);
      const imports = [...src.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)].map(
        (m) => m[1] as string,
      );
      for (const i of imports) {
        expect(i).not.toMatch(
          /expo-|react-native|mediapipe|ffmpeg-|vision-camera|highlight-encoder|\/cv/,
        );
      }
    }
  });

  it('package.json has no ffmpeg, vision-camera or nitro dependency', () => {
    const pkg = JSON.parse(read('package.json')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    expect(names.filter((n) => /ffmpeg|vision-camera|nitro/i.test(n))).toEqual([]);
  });
});
