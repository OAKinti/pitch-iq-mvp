import type { CoachPersona, CueId } from '../../types/contracts';

/** Metro asset id from require('.../assets/audio/cues/<file>.mp3'). Never a URL (ECON-1). */
export type CueAudioSource = number;
export type CueSourceMap = Readonly<Record<CoachPersona, Partial<Record<CueId, CueAudioSource>>>>;

export interface AudioPlayerLike {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void> | void;
  volume: number;
  remove(): void;
}

export interface CuePlayerDeps {
  createPlayer(source: CueAudioSource): AudioPlayerLike;
  setAudioMode(mode: Record<string, unknown>): Promise<void>;
}

export interface CuePlayer {
  prepare(persona: CoachPersona): Promise<void>;
  play(id: CueId): boolean;
  stopAll(): void;
  reassertAudioMode(): Promise<void>;
  dispose(): void;
}

export const CUE_AUDIO_MODE = {
  playsInSilentMode: true,
  shouldPlayInBackground: false,
  interruptionMode: 'duckOthers',
  interruptionModeAndroid: 'duckOthers',
} as const;

function defaultDeps(): CuePlayerDeps {
  return {
    createPlayer: (source) => {
      const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
      return createAudioPlayer(source) as unknown as AudioPlayerLike;
    },
    setAudioMode: (mode) => {
      const { setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
      return setAudioModeAsync(mode as unknown as Parameters<typeof setAudioModeAsync>[0]);
    },
  };
}

function safe(fn: () => unknown): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === 'function')
      (r as Promise<unknown>).catch(() => undefined);
  } catch {
    /* FAIL-8: audio never throws into the drill path */
  }
}

export function createCuePlayer(opts: { sources: CueSourceMap; deps?: CuePlayerDeps }): CuePlayer {
  const deps = opts.deps ?? defaultDeps();
  let players = new Map<CueId, AudioPlayerLike>();
  let persona: CoachPersona | null = null;
  let current: AudioPlayerLike | null = null;
  let generation = 0;

  const applyMode = async (): Promise<void> => {
    try {
      await deps.setAudioMode({ ...CUE_AUDIO_MODE });
    } catch {
      /* caption-only is acceptable */
    }
  };

  const stopPlayer = (p: AudioPlayerLike): void => {
    safe(() => p.pause());
    safe(() => p.seekTo(0));
  };

  const disposePlayers = (): void => {
    current = null;
    for (const p of players.values()) safe(() => p.remove());
    players = new Map();
  };

  const prewarm = async (p: AudioPlayerLike): Promise<void> => {
    try {
      p.volume = 0;
      p.play();
      p.pause();
      await p.seekTo(0);
    } catch {
      /* ignore: play() falls back to false if the player is broken */
    } finally {
      try {
        p.volume = 1;
      } catch {
        /* ignore */
      }
    }
  };

  return {
    async prepare(next) {
      const gen = ++generation;
      disposePlayers();
      persona = null;
      await applyMode();
      const map = opts.sources[next] ?? {};
      const created = new Map<CueId, AudioPlayerLike>();
      for (const [id, source] of Object.entries(map) as [CueId, CueAudioSource | undefined][]) {
        if (typeof source !== 'number') continue; // ECON-1: module ids only
        try {
          created.set(id, deps.createPlayer(source));
        } catch {
          /* skip broken cue */
        }
      }
      await Promise.all([...created.values()].map(prewarm));
      if (gen !== generation) {
        for (const p of created.values()) safe(() => p.remove()); // superseded or disposed
        return;
      }
      players = created;
      persona = next;
    },

    play(id) {
      if (persona === null) return false;
      const player = players.get(id);
      if (!player) return false;
      try {
        if (current && current !== player) stopPlayer(current);
        current = null;
        player.seekTo(0);
        player.play();
        current = player;
        return true;
      } catch {
        return false;
      }
    },

    stopAll() {
      if (current) stopPlayer(current);
      current = null;
    },

    reassertAudioMode: applyMode,

    dispose() {
      generation++;
      persona = null;
      disposePlayers();
    },
  };
}
