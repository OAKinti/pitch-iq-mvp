import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shareColors } from '../../../theme/tokens';
import type { AgeBracket, ShareTarget } from '../../../types/contracts';
import {
  createSocialHandoff,
  type NativeSocialHandoff,
  type SocialHandoffDeps,
  type SocialShareRequest,
} from '../../../services/share/socialHandoff';

const SRC = join(__dirname, '..', '..', '..');
const VIDEO = 'file:///cache/clip.mp4';
const STICKER = 'file:///cache/sticker.png';

type FakeDeps = SocialHandoffDeps & {
  isTargetInstalled: jest.Mock;
  shareInstagramStories: jest.Mock;
  saveToLibrary: jest.Mock;
  openOsShare: jest.Mock;
  native: { shareToInstagramReels: jest.Mock; shareToTikTok: jest.Mock } | null;
};

function makeDeps(over: Partial<SocialHandoffDeps> = {}): FakeDeps {
  return {
    platform: 'android',
    config: { facebookAppId: '1234567890', tiktokClientKey: 'clientkey1' },
    tiktokRedirectUri: 'pitchiq://share',
    isTargetInstalled: jest.fn(async () => true),
    shareInstagramStories: jest.fn(async () => undefined),
    native: {
      shareToInstagramReels: jest.fn(async () => undefined),
      shareToTikTok: jest.fn(async () => undefined),
    },
    saveToLibrary: jest.fn(async () => 'PH-ID/L0/001'),
    openOsShare: jest.fn(async () => 'shared' as const),
    ...over,
  } as FakeDeps;
}

function calls(d: FakeDeps): number {
  const fns = [d.isTargetInstalled, d.shareInstagramStories, d.saveToLibrary, d.openOsShare];
  if (d.native) fns.push(d.native.shareToInstagramReels, d.native.shareToTikTok);
  return fns.reduce((n, f) => n + f.mock.calls.length, 0);
}

const req = (over: Partial<SocialShareRequest> = {}): SocialShareRequest => ({
  target: 'instagram_stories',
  videoUri: VIDEO,
  stickerUri: STICKER,
  ageBracket: 'adult_18_plus',
  ...over,
});

describe('socialHandoff', () => {
  it('Stories payload has only allowed keys', async () => {
    const d = makeDeps();
    const res = await createSocialHandoff(d).share(
      req({ attributionUrl: 'https://pitchiq.app/x' }),
    );
    expect(res).toEqual({ ok: true, via: 'native' });
    expect(d.shareInstagramStories).toHaveBeenCalledTimes(1);
    const payload = d.shareInstagramStories.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        'appId',
        'attributionURL',
        'backgroundBottomColor',
        'backgroundTopColor',
        'backgroundVideo',
        'stickerImage',
      ].sort(),
    );
    expect(payload.backgroundTopColor).toBe(shareColors.storyTop);
    expect(payload.backgroundBottomColor).toBe(shareColors.storyBottom);
    expect(payload.appId).toBe('1234567890');
    expect(d.openOsShare).not.toHaveBeenCalled();

    const d2 = makeDeps();
    await createSocialHandoff(d2).share(req({ videoUri: null }));
    expect(Object.keys(d2.shareInstagramStories.mock.calls[0]?.[0] as object)).not.toContain(
      'backgroundVideo',
    );
  });

  it('attributionURL key is absent unless a non-empty https URL is given', async () => {
    for (const url of [undefined, '', '   ', 'http://pitchiq.app', 'ftp://x', 'pitchiq://x']) {
      const d = makeDeps();
      await createSocialHandoff(d).share(req(url === undefined ? {} : { attributionUrl: url }));
      const payload = d.shareInstagramStories.mock.calls[0]?.[0] as object;
      expect('attributionURL' in payload).toBe(false);
    }
    const d = makeDeps();
    await createSocialHandoff(d).share(req({ attributionUrl: 'https://pitchiq.app/p' }));
    expect(
      (d.shareInstagramStories.mock.calls[0]?.[0] as Record<string, unknown>).attributionURL,
    ).toBe('https://pitchiq.app/p');
  });

  it('under_13 or unknown age -> age_restricted with zero dependency calls', async () => {
    for (const age of ['under_13', null] as (AgeBracket | null)[]) {
      for (const target of ['instagram_stories', 'instagram_reels', 'tiktok'] as ShareTarget[]) {
        const d = makeDeps();
        expect(await createSocialHandoff(d).share(req({ target, ageBracket: age }))).toEqual({
          ok: false,
          reason: 'age_restricted',
        });
        expect(calls(d)).toBe(0);
      }
    }
  });

  it('non-file media -> invalid_media with zero dependency calls', async () => {
    const bad: Partial<SocialShareRequest>[] = [
      { stickerUri: 'https://x.test/s.png' },
      { stickerUri: '/cache/s.png' },
      { videoUri: 'https://x.test/v.mp4' },
      { target: 'instagram_reels', videoUri: null },
      { target: 'tiktok', videoUri: null },
    ];
    for (const over of bad) {
      const d = makeDeps();
      expect(await createSocialHandoff(d).share(req(over))).toEqual({
        ok: false,
        reason: 'invalid_media',
      });
      expect(calls(d)).toBe(0);
    }
  });

  it('native path succeeds for reels and tiktok', async () => {
    const d = makeDeps();
    expect(await createSocialHandoff(d).share(req({ target: 'instagram_reels' }))).toEqual({
      ok: true,
      via: 'native',
    });
    expect(d.native?.shareToInstagramReels).toHaveBeenCalledWith({
      videoUri: VIDEO,
      stickerUri: STICKER,
      facebookAppId: '1234567890',
    });
    const a = makeDeps();
    expect(await createSocialHandoff(a).share(req({ target: 'tiktok' }))).toEqual({
      ok: true,
      via: 'native',
    });
    expect(a.native?.shareToTikTok).toHaveBeenCalledWith({
      clientKey: 'clientkey1',
      redirectUri: 'pitchiq://share',
      mediaUri: VIDEO,
    });
    expect(a.saveToLibrary).not.toHaveBeenCalled();
    const i = makeDeps({ platform: 'ios' });
    expect(await createSocialHandoff(i).share(req({ target: 'tiktok' }))).toEqual({
      ok: true,
      via: 'native',
    });
    expect(i.saveToLibrary).toHaveBeenCalledWith(VIDEO);
    expect(i.native?.shareToTikTok).toHaveBeenCalledWith({
      clientKey: 'clientkey1',
      redirectUri: 'pitchiq://share',
      mediaUri: 'PH-ID/L0/001',
    });
  });

  it('falls back to OS share exactly once when not installed, not configured, module missing, redirect missing on iOS, library save null, or native rejects', async () => {
    const cases: { name: string; target: ShareTarget; deps: Partial<SocialHandoffDeps> }[] = [
      {
        name: 'not installed',
        target: 'instagram_stories',
        deps: { isTargetInstalled: jest.fn(async () => false) },
      },
      {
        name: 'install check rejects',
        target: 'instagram_reels',
        deps: {
          isTargetInstalled: jest.fn(async () => {
            throw new Error('x');
          }),
        },
      },
      {
        name: 'no app id stories',
        target: 'instagram_stories',
        deps: { config: { facebookAppId: null, tiktokClientKey: 'clientkey1' } },
      },
      {
        name: 'no app id reels',
        target: 'instagram_reels',
        deps: { config: { facebookAppId: null, tiktokClientKey: null } },
      },
      {
        name: 'no client key',
        target: 'tiktok',
        deps: { config: { facebookAppId: '12345', tiktokClientKey: null } },
      },
      { name: 'module missing reels', target: 'instagram_reels', deps: { native: null } },
      { name: 'module missing tiktok', target: 'tiktok', deps: { native: null } },
      {
        name: 'ios no redirect',
        target: 'tiktok',
        deps: { platform: 'ios', tiktokRedirectUri: null },
      },
      {
        name: 'library save null',
        target: 'tiktok',
        deps: { platform: 'ios', saveToLibrary: jest.fn(async () => null) },
      },
      {
        name: 'library save rejects',
        target: 'tiktok',
        deps: {
          platform: 'ios',
          saveToLibrary: jest.fn(async () => {
            throw new Error('x');
          }),
        },
      },
      {
        name: 'stories rejects',
        target: 'instagram_stories',
        deps: {
          shareInstagramStories: jest.fn(async () => {
            throw new Error('x');
          }),
        },
      },
      { name: 'web', target: 'instagram_stories', deps: { platform: 'web' } },
      {
        name: 'native rejects',
        target: 'instagram_reels',
        deps: {
          native: {
            shareToInstagramReels: jest.fn(async () => {
              throw new Error('x');
            }),
            shareToTikTok: jest.fn(async () => undefined),
          } as NativeSocialHandoff,
        },
      },
    ];
    for (const c of cases) {
      const d = makeDeps(c.deps);
      const res = await createSocialHandoff(d).share(req({ target: c.target }));
      expect({ name: c.name, res }).toEqual({ name: c.name, res: { ok: true, via: 'os_share' } });
      expect(d.openOsShare).toHaveBeenCalledTimes(1);
      expect(d.openOsShare).toHaveBeenCalledWith({ url: VIDEO, type: 'video/mp4' });
    }
    const d = makeDeps({ isTargetInstalled: jest.fn(async () => false) });
    await createSocialHandoff(d).share(req({ videoUri: null }));
    expect(d.openOsShare).toHaveBeenCalledWith({ url: STICKER, type: 'image/png' });
  });

  it('share never rejects', async () => {
    const dismissed = makeDeps({
      isTargetInstalled: jest.fn(async () => false),
      openOsShare: jest.fn(async () => 'dismissed' as const),
    });
    expect(await createSocialHandoff(dismissed).share(req())).toEqual({
      ok: false,
      reason: 'cancelled',
    });
    const rejecting = makeDeps({
      isTargetInstalled: jest.fn(async () => false),
      openOsShare: jest.fn(async () => {
        throw new Error('x');
      }),
    });
    expect(await createSocialHandoff(rejecting).share(req())).toEqual({
      ok: false,
      reason: 'failed',
    });
    const throwing = makeDeps({
      isTargetInstalled: jest.fn(() => {
        throw new Error('sync');
      }),
      openOsShare: jest.fn(() => {
        throw new Error('sync');
      }),
    });
    await expect(createSocialHandoff(throwing).share(req())).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('second share while one is in flight -> busy', async () => {
    let release: (v: boolean) => void = () => undefined;
    const d = makeDeps({
      isTargetInstalled: jest.fn(
        () =>
          new Promise<boolean>((r) => {
            release = r;
          }),
      ),
    });
    const handoff = createSocialHandoff(d);
    const first = handoff.share(req());
    const before = calls(d);
    const second = await handoff.share(req({ target: 'tiktok' }));
    expect(second).toEqual({ ok: false, reason: 'busy' });
    expect(calls(d)).toBe(before);
    release(true);
    expect(await first).toEqual({ ok: true, via: 'native' });
    // flag cleared in finally
    d.isTargetInstalled.mockImplementation(async () => true);
    expect(await handoff.share(req())).toEqual({ ok: true, via: 'native' });
  });

  it('share sources and OvrSticker never mention strava or wearables', () => {
    const files = [
      ...readdirSync(join(SRC, 'services', 'share')).map((n) => join(SRC, 'services', 'share', n)),
      join(SRC, 'components', 'OvrSticker.tsx'),
    ];
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect({ f, hit: /strava|wearable/i.test(text) }).toEqual({ f, hit: false });
    }
  });
});
