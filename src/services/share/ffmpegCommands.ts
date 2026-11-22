import type { HighlightWindow } from '../../types/contracts';

export const INSTAGRAM_EXPORT_SPEC = {
  videoCodec: 'libx264',
  audioCodec: 'aac',
  pixelFormat: 'yuv420p',
  width: 1080,
  height: 1920,
  fps: 30,
  maxDurationSec: 15,
} as const;

export function buildHighlightClipArgs(opts: {
  inputPath: string;
  outputPath: string;
  window: HighlightWindow;
}): string[] {
  const { width, height, fps, maxDurationSec } = INSTAGRAM_EXPORT_SPEC;
  const startSec = Math.max(0, opts.window.startMs) / 1000;
  const rawDur = Math.max(0, opts.window.endMs - opts.window.startMs) / 1000;
  const durSec = Math.min(maxDurationSec, rawDur);
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${fps}`,
    'format=yuv420p',
  ].join(',');
  return [
    '-ss', startSec.toFixed(3),
    '-i', opts.inputPath,
    '-t', durSec.toFixed(3),
    '-vf', vf,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level:v', '4.1',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-field_order', 'progressive',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    '-y',
    opts.outputPath,
  ];
}

/** Joins args into a shell-style command; args containing whitespace are double-quoted. */
export function toFfmpegCommand(args: readonly string[]): string {
  return args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
}
