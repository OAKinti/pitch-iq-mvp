import type { CueSourceMap } from './cuePlayer';

/**
 * Bundled Tier 1 cue clips (Metro asset ids). Empty until `scripts/generate-cue-audio.ts`
 * regenerates this file; an empty entry means caption-only for that cue.
 */
export const CUE_AUDIO_SOURCES: CueSourceMap = {
  captain: {},
  drill_sergeant: {},
  hype: {},
};
