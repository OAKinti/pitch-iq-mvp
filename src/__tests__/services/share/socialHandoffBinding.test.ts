import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Linking } from 'react-native';

type Binding = typeof import('../../../services/share/socialHandoffBinding');

const SRC = join(__dirname, '..', '..', '..');

const mockShareSingle = jest.fn();
const mockOpen = jest.fn();
const mockInstalled = jest.fn();
const mockCreateAsset = jest.fn();

function mockLibs() {
  jest.doMock('react-native-share', () => ({
    __esModule: true,
    default: { shareSingle: mockShareSingle, open: mockOpen, isPackageInstalled: mockInstalled },
    Social: { InstagramStories: 'instagramstories' },
  }));
  jest.doMock('expo-media-library/legacy', () => ({ createAssetAsync: mockCreateAsset }));
}

function load(native?: unknown | 'throw'): Binding {
  jest.resetModules();
  mockLibs();
  if (native === 'throw') {
    jest.doMock(
      '../../../../modules/social-handoff',
      () => {
        throw new Error('Cannot find module');
      },
      { virtual: true },
    );
  } else if (native !== undefined) {
    jest.doMock('../../../../modules/social-handoff', () => native, { virtual: true });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../services/share/socialHandoffBinding') as Binding;
}

beforeEach(() => {
  mockShareSingle.mockReset().mockResolvedValue({ success: true, message: '' });
  mockOpen.mockReset().mockResolvedValue({ success: true, message: '' });
  mockInstalled.mockReset().mockResolvedValue({ isInstalled: true, message: '' });
  mockCreateAsset.mockReset().mockResolvedValue({ id: 'PH-1' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('socialHandoffBinding', () => {
  it('getNativeSocialHandoff returns null when the module is missing, throws or is incomplete', async () => {
    expect(load().getNativeSocialHandoff()).toBeNull(); // not on disk
    expect(load('throw').getNativeSocialHandoff()).toBeNull();
    expect(load({ shareToTikTok: jest.fn() }).getNativeSocialHandoff()).toBeNull();
    expect(load({ shareToInstagramReels: jest.fn() }).getNativeSocialHandoff()).toBeNull();
    expect(
      load({ shareToInstagramReels: 1, shareToTikTok: 2 }).getNativeSocialHandoff(),
    ).toBeNull();

    const reels = jest.fn(async () => undefined);
    const tiktok = jest.fn(async () => undefined);
    const native = load({
      shareToInstagramReels: reels,
      shareToTikTok: tiktok,
    }).getNativeSocialHandoff();
    expect(native).not.toBeNull();
    await native?.shareToInstagramReels({
      videoUri: 'file:///v.mp4',
      stickerUri: 'file:///s.png',
      facebookAppId: '12345',
    });
    await native?.shareToTikTok({ clientKey: 'abcdef', redirectUri: 'r://x', mediaUri: 'id' });
    expect(reels).toHaveBeenCalledTimes(1);
    expect(tiktok).toHaveBeenCalledTimes(1);
  });

  it('default deps read the share config from the env override', () => {
    const b = load();
    const deps = b.createDefaultSocialHandoffDeps({
      platform: 'android',
      env: { EXPO_PUBLIC_FACEBOOK_APP_ID: '1234567', EXPO_PUBLIC_TIKTOK_CLIENT_KEY: 'bad key' },
    });
    expect(deps.config).toEqual({ facebookAppId: '1234567', tiktokClientKey: null });
    expect(deps.tiktokRedirectUri).toBeNull();
    expect(
      b.createDefaultSocialHandoffDeps({ platform: 'web', tiktokRedirectUri: 'r://x', env: {} })
        .native,
    ).toBeNull();
  });

  it('checks installation through packages on android and schemes on ios, false on web', async () => {
    const b = load();
    const android = b.createDefaultSocialHandoffDeps({ platform: 'android', env: {} });
    mockInstalled.mockImplementation(async (pkg: string) => ({
      isInstalled: pkg === 'com.ss.android.ugc.trill',
    }));
    expect(await android.isTargetInstalled('tiktok')).toBe(true);
    expect(await android.isTargetInstalled('instagram_stories')).toBe(false);
    expect(mockInstalled).toHaveBeenCalledWith('com.instagram.android');
    expect(mockInstalled).toHaveBeenCalledWith('com.zhiliaoapp.musically');

    const can = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const ios = b.createDefaultSocialHandoffDeps({ platform: 'ios', env: {} });
    expect(await ios.isTargetInstalled('instagram_reels')).toBe(true);
    expect(can).toHaveBeenCalledWith('instagram-reels://');
    await ios.isTargetInstalled('tiktok');
    expect(can).toHaveBeenCalledWith('tiktokopensdk://');

    const web = b.createDefaultSocialHandoffDeps({ platform: 'web', env: {} });
    expect(await web.isTargetInstalled('tiktok')).toBe(false);
  });

  it('shares Stories through shareSingle, opens the OS sheet without failing on cancel, saves to the library', async () => {
    const b = load();
    const deps = b.createDefaultSocialHandoffDeps({ platform: 'ios', env: {} });
    const payload = {
      appId: '1234567',
      stickerImage: 'file:///s.png',
      backgroundTopColor: 'a',
      backgroundBottomColor: 'b',
    };
    await deps.shareInstagramStories(payload);
    expect(mockShareSingle).toHaveBeenCalledWith({ ...payload, social: 'instagramstories' });

    expect(await deps.openOsShare({ url: 'file:///v.mp4', type: 'video/mp4' })).toBe('shared');
    expect(mockOpen).toHaveBeenCalledWith({
      url: 'file:///v.mp4',
      type: 'video/mp4',
      failOnCancel: false,
    });
    mockOpen.mockResolvedValueOnce({ success: false, dismissedAction: true, message: '' });
    expect(await deps.openOsShare({ url: 'file:///v.mp4', type: 'video/mp4' })).toBe('dismissed');

    expect(await deps.saveToLibrary('file:///v.mp4')).toBe('PH-1');
    mockCreateAsset.mockResolvedValueOnce({});
    expect(await deps.saveToLibrary('file:///v.mp4')).toBeNull();
  });

  it('rejects cleanly when the libraries are missing so the service can degrade', async () => {
    jest.resetModules();
    jest.doMock('react-native-share', () => {
      throw new Error('missing');
    });
    jest.doMock('expo-media-library/legacy', () => {
      throw new Error('missing');
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const b = require('../../../services/share/socialHandoffBinding') as Binding;
    const deps = b.createDefaultSocialHandoffDeps({ platform: 'android', env: {} });
    await expect(deps.openOsShare({ url: 'file:///a', type: 'image/png' })).rejects.toThrow();
    await expect(deps.saveToLibrary('file:///a')).rejects.toThrow();
    await expect(deps.isTargetInstalled('tiktok')).rejects.toThrow();
  });

  it('native share packages are referenced only by the binding and stickerCapture', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p);
        return /\.(ts|tsx)$/.test(n) ? [p] : [];
      });
    const refs = (needle: RegExp): string[] =>
      walk(SRC)
        .filter((f) => needle.test(readFileSync(f, 'utf8')))
        .map((f) => relative(SRC, f).replace(/\\/g, '/'));
    expect(refs(/react-native-share|expo-media-library|modules\/social-handoff/)).toEqual([
      'services/share/socialHandoffBinding.ts',
    ]);
    expect(refs(/react-native-view-shot/)).toEqual(['services/share/stickerCapture.ts']);
  });
});
