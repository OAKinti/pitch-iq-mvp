import {
  CUE_AUDIO_MODE,
  createCuePlayer,
  type AudioPlayerLike,
  type CuePlayerDeps,
  type CueSourceMap,
} from '../../../services/audio/cuePlayer';
import { CUE_AUDIO_SOURCES } from '../../../services/audio/cueSources';

const sources: CueSourceMap = {
  captain: { ready_go: 1, halfway: 2 },
  drill_sergeant: { ready_go: 3 },
  hype: {},
};

function mkPlayer(): AudioPlayerLike & { calls: string[] } {
  const calls: string[] = [];
  let vol = 1;
  return {
    calls,
    play: jest.fn(() => void calls.push(`play@${vol}`)),
    pause: jest.fn(() => void calls.push('pause')),
    seekTo: jest.fn(async (s: number) => void calls.push(`seek${s}`)),
    get volume() {
      return vol;
    },
    set volume(v: number) {
      vol = v;
    },
    remove: jest.fn(() => void calls.push('remove')),
  };
}

function setup() {
  const made: { source: number; p: ReturnType<typeof mkPlayer> }[] = [];
  const deps: CuePlayerDeps = {
    createPlayer: jest.fn((source: number) => {
      const p = mkPlayer();
      made.push({ source, p });
      return p;
    }),
    setAudioMode: jest.fn(() => Promise.resolve()),
  };
  return { made, deps, cp: createCuePlayer({ sources, deps }) };
}

describe('cuePlayer', () => {
  it('ships empty bundled sources and only accepts module ids', async () => {
    expect(CUE_AUDIO_SOURCES.captain).toEqual({});
    const { deps } = setup();
    const bad = createCuePlayer({
      sources: {
        captain: { ready_go: 'https://x/y.mp3' as unknown as number },
        drill_sergeant: {},
        hype: {},
      },
      deps,
    });
    await bad.prepare('captain');
    expect(deps.createPlayer).not.toHaveBeenCalled();
    expect(bad.play('ready_go')).toBe(false);
  });

  it('returns false before prepare and for missing cue', async () => {
    const { cp } = setup();
    expect(cp.play('ready_go')).toBe(false);
    await cp.prepare('captain');
    expect(cp.play('turn_sharp')).toBe(false);
    expect(cp.play('ready_go')).toBe(true);
  });

  it('sets audio mode and pre-warms at volume 0 then restores 1', async () => {
    const { cp, made, deps } = setup();
    await cp.prepare('captain');
    expect(deps.setAudioMode).toHaveBeenCalledWith(CUE_AUDIO_MODE);
    expect(made).toHaveLength(2);
    for (const { p } of made) {
      expect(p.calls).toEqual(['play@0', 'pause', 'seek0']);
      expect(p.volume).toBe(1);
    }
  });

  it('second play stops the first; stopAll stops current', async () => {
    const { cp, made } = setup();
    await cp.prepare('captain');
    cp.play('ready_go');
    cp.play('halfway');
    const a = made[0]!.p;
    const b = made[1]!.p;
    expect(a.calls.slice(-2)).toEqual(['pause', 'seek0']);
    expect(b.calls.at(-1)).toBe('play@1');
    cp.stopAll();
    expect(b.calls.slice(-2)).toEqual(['pause', 'seek0']);
    cp.stopAll();
  });

  it('never throws when a player throws', async () => {
    const { cp, made } = setup();
    await cp.prepare('captain');
    (made[0]!.p.play as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(cp.play('ready_go')).toBe(false);
    cp.play('halfway');
    (made[1]!.p.pause as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => cp.play('ready_go')).not.toThrow();
  });

  it('survives throwing creation, prewarm, and audio mode', async () => {
    const p = mkPlayer();
    (p.play as jest.Mock).mockImplementation(() => {
      throw new Error('x');
    });
    const deps: CuePlayerDeps = {
      createPlayer: jest.fn((s: number) => {
        if (s === 1) throw new Error('create');
        return p;
      }),
      setAudioMode: jest.fn(() => Promise.reject(new Error('mode'))),
    };
    const cp = createCuePlayer({ sources, deps });
    await expect(cp.prepare('captain')).resolves.toBeUndefined();
    await expect(cp.reassertAudioMode()).resolves.toBeUndefined();
    expect(p.volume).toBe(1);
  });

  it('reassertAudioMode re-applies CUE_AUDIO_MODE', async () => {
    const { cp, deps } = setup();
    await cp.prepare('captain');
    await cp.reassertAudioMode();
    expect(deps.setAudioMode).toHaveBeenCalledTimes(2);
    expect(deps.setAudioMode).toHaveBeenLastCalledWith(CUE_AUDIO_MODE);
  });

  it('persona switch disposes old players', async () => {
    const { cp, made } = setup();
    await cp.prepare('captain');
    await cp.prepare('drill_sergeant');
    expect(made[0]!.p.remove).toHaveBeenCalled();
    expect(made[1]!.p.remove).toHaveBeenCalled();
    expect(cp.play('halfway')).toBe(false);
    expect(cp.play('ready_go')).toBe(true);
    cp.dispose();
    expect(made[2]!.p.remove).toHaveBeenCalled();
    expect(cp.play('ready_go')).toBe(false);
  });

  it('a superseded prepare discards its players', async () => {
    const { cp, made } = setup();
    const first = cp.prepare('captain');
    const second = cp.prepare('drill_sergeant');
    await Promise.all([first, second]);
    expect(made.slice(0, 2).every((m) => (m.p.remove as jest.Mock).mock.calls.length > 0)).toBe(
      true,
    );
    expect(cp.play('ready_go')).toBe(true);
  });

  it('default deps use expo-audio', async () => {
    const audio = jest.requireMock('expo-audio') as {
      createAudioPlayer: jest.Mock;
      setAudioModeAsync: jest.Mock;
    };
    const cp = createCuePlayer({ sources });
    await cp.prepare('captain');
    expect(audio.setAudioModeAsync).toHaveBeenCalled();
    expect(audio.createAudioPlayer).toHaveBeenCalledWith(1);
    expect(cp.play('ready_go')).toBe(true);
  });
});
