import {
  buildHighlightClipArgs,
  INSTAGRAM_EXPORT_SPEC,
} from '../../../services/share/ffmpegCommands';
import {
  HIGHLIGHT_CLIP_SPEC,
  buildClipEncodeRequest,
} from '../../../services/highlight/clipEncoder';

const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('clip spec (MEDIA-1)', () => {
  it('buildHighlightClipArgs emits h264, aac, yuv420p, progressive and faststart', () => {
    const args = buildHighlightClipArgs({
      inputPath: 'in.mov',
      outputPath: 'out.mp4',
      window: { startMs: 1000, endMs: 9000, eventCount: 3 },
    });
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-c:a')).toBe('aac');
    expect(argAfter(args, '-pix_fmt')).toBe('yuv420p');
    expect(argAfter(args, '-vf')).toContain('format=yuv420p');
    expect(argAfter(args, '-field_order')).toBe('progressive');
    expect(argAfter(args, '-movflags')).toBe('+faststart');
    expect(Number(argAfter(args, '-t'))).toBeLessThanOrEqual(15);
  });

  it('HIGHLIGHT_CLIP_SPEC matches INSTAGRAM_EXPORT_SPEC', () => {
    expect(HIGHLIGHT_CLIP_SPEC).toMatchObject({
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      scan: 'progressive',
      fastStart: true,
      width: INSTAGRAM_EXPORT_SPEC.width,
      height: INSTAGRAM_EXPORT_SPEC.height,
      fps: INSTAGRAM_EXPORT_SPEC.fps,
      maxDurationMs: INSTAGRAM_EXPORT_SPEC.maxDurationSec * 1000,
    });
  });

  it('buildClipEncodeRequest start and duration equal -ss and -t for normal, long, inverted and negative windows', () => {
    const windows = [
      { startMs: 2000, endMs: 12000, eventCount: 1 },
      { startMs: 0, endMs: 40000, eventCount: 1 },
      { startMs: 9000, endMs: 3000, eventCount: 0 },
      { startMs: -500, endMs: 4500, eventCount: 0 },
    ];
    for (const window of windows) {
      const args = buildHighlightClipArgs({ inputPath: 'a', outputPath: 'b', window });
      const req = buildClipEncodeRequest({
        inputUri: 'file:///a.mov',
        outputUri: 'file:///b.mp4',
        window,
      });
      expect((req.startMs / 1000).toFixed(3)).toBe(argAfter(args, '-ss'));
      expect((req.durationMs / 1000).toFixed(3)).toBe(argAfter(args, '-t'));
      expect(req.spec).toBe(HIGHLIGHT_CLIP_SPEC);
    }
  });
});
