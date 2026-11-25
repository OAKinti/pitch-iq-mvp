import { shareColors } from '../../theme/tokens';
import {
  INSTAGRAM_EXPORT_SPEC,
  buildHighlightClipArgs,
  toFfmpegCommand,
} from '../../services/share/ffmpegCommands';
import {
  STICKER_SPEC,
  buildInstagramReelsShare,
  buildInstagramStoriesShare,
  buildTikTokShareRequest,
} from '../../services/share/shareTargets';
import * as barrel from '../../services';

const arg = (a: string[], flag: string) => a[a.indexOf(flag) + 1];

describe('ffmpeg highlight clip', () => {
  const args = buildHighlightClipArgs({
    inputPath: '/in/a.mov',
    outputPath: '/out/b.mp4',
    window: { startMs: 1234, endMs: 11234, eventCount: 12 },
  });

  it('encodes H.264 + AAC, yuv420p, progressive, faststart', () => {
    expect(arg(args, '-c:v')).toBe('libx264');
    expect(arg(args, '-c:a')).toBe('aac');
    expect(arg(args, '-pix_fmt')).toBe('yuv420p');
    expect(arg(args, '-vf')).toContain('format=yuv420p');
    expect(arg(args, '-vf')).toContain('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30');
    expect(arg(args, '-field_order')).toBe('progressive');
    expect(args.join(' ')).toContain('-movflags +faststart');
    expect(arg(args, '-profile:v')).toBe('high');
    expect(arg(args, '-level:v')).toBe('4.1');
    expect(args[args.length - 1]).toBe('/out/b.mp4');
    expect(args[args.length - 2]).toBe('-y');
  });

  it('formats start and duration with 3 decimals', () => {
    expect(arg(args, '-ss')).toBe('1.234');
    expect(arg(args, '-t')).toBe('10.000');
  });

  it('clamps the duration to 15 seconds and handles inverted/negative windows', () => {
    const long = buildHighlightClipArgs({ inputPath: 'i', outputPath: 'o', window: { startMs: 0, endMs: 60000, eventCount: 1 } });
    expect(arg(long, '-t')).toBe('15.000');
    const bad = buildHighlightClipArgs({ inputPath: 'i', outputPath: 'o', window: { startMs: -5, endMs: -10, eventCount: 0 } });
    expect(arg(bad, '-ss')).toBe('0.000');
    expect(arg(bad, '-t')).toBe('0.000');
  });

  it('quotes args containing spaces', () => {
    const cmd = toFfmpegCommand(
      buildHighlightClipArgs({ inputPath: 'D:/my videos/in.mov', outputPath: 'D:/out dir/o.mp4', window: { startMs: 0, endMs: 1000, eventCount: 1 } }),
    );
    expect(cmd).toContain('"D:/my videos/in.mov"');
    expect(cmd).toContain('"D:/out dir/o.mp4"');
    expect(cmd).toContain('-c:v libx264');
    expect(toFfmpegCommand(['a"b c'])).toBe('"a\\"b c"');
  });

  it('exposes specs', () => {
    expect(INSTAGRAM_EXPORT_SPEC).toMatchObject({ videoCodec: 'libx264', audioCodec: 'aac', pixelFormat: 'yuv420p', maxDurationSec: 15 });
    expect(STICKER_SPEC).toEqual({ width: 640, height: 480, format: 'png', transparent: true });
  });
});

describe('share targets', () => {
  const o = { facebookAppId: '12345', videoUri: 'file:///v.mp4', stickerUri: 'file:///s.png' };

  it('builds Instagram Stories pasteboard share', () => {
    const s = buildInstagramStoriesShare(o);
    expect(s.url).toBe('instagram-stories://share?source_application=12345');
    expect(s.expirationSeconds).toBe(300);
    expect(s.pasteboardItems).toHaveLength(1);
    expect(s.pasteboardItems[0]).toEqual({
      'com.instagram.sharedSticker.backgroundVideo': o.videoUri,
      'com.instagram.sharedSticker.stickerImage': o.stickerUri,
      'com.instagram.sharedSticker.backgroundTopColor': shareColors.storyTop,
      'com.instagram.sharedSticker.backgroundBottomColor': shareColors.storyBottom,
    });
  });

  it('builds Instagram Reels share without gradient keys', () => {
    const s = buildInstagramReelsShare(o);
    expect(s.url).toBe('instagram-reels://share?source_application=12345');
    expect(Object.keys(s.pasteboardItems[0]!).sort()).toEqual([
      'com.instagram.sharedSticker.backgroundVideo',
      'com.instagram.sharedSticker.stickerImage',
    ]);
  });

  it('builds a TikTok Share Kit v2 request', () => {
    expect(buildTikTokShareRequest({ clientKey: 'ck', redirectUri: 'pitchiq://tt', mediaPath: '/v.mp4' })).toEqual({
      mediaType: 'video', mediaPaths: ['/v.mp4'], shareFormat: 'normal', redirectUri: 'pitchiq://tt', clientKey: 'ck',
    });
  });
});

describe('barrel', () => {
  it('exports the contract surface', () => {
    for (const k of [
      'getAppConfig', 'getSupabaseClient', 'createRepository', 'DEMO_GROUP_ID', 'PERSONAS', 'getCachedCue',
      'DEBRIEF_MAX_CHARS', 'TTS_USD_PER_1K_CHARS', 'HAIKU_MODEL_ID', 'estimateDebriefCostUsd', 'buildDebriefRequest', 'DEBRIEF_TIMEOUT_MS',
      'templateDebrief', 'createEdgeFunctionTransport', 'createQaBudget', 'createVoiceCoach',
      'createHealthKitAdapter', 'createHealthConnectAdapter', 'createWhoopAdapter', 'mapWhoopRecovery',
      'assertAiSafeSources', 'createStravaExportAdapter', 'buildStravaActivityPayload',
      'INSTAGRAM_EXPORT_SPEC', 'STICKER_SPEC', 'buildHighlightClipArgs', 'toFfmpegCommand',
      'buildInstagramStoriesShare', 'buildInstagramReelsShare', 'buildTikTokShareRequest',
    ]) {
      expect(barrel).toHaveProperty(k);
    }
  });
});
