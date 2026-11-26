import { Linking } from 'react-native';
import type { ShareTarget } from '../../types/contracts';
import { getShareConfig } from './shareConfig';
import type {
  InstagramStoriesPayload,
  NativeSocialHandoff,
  SocialHandoffDeps,
} from './socialHandoff';

/**
 * The only file that references modules/social-handoff, react-native-share and
 * expo-media-library. Every one is required lazily inside try/catch so Expo Go, Jest and web
 * never crash; a missing library routes the handoff to the OS share sheet.
 */

interface ShareLib {
  Social: { InstagramStories: unknown };
  shareSingle(options: Record<string, unknown>): Promise<unknown>;
  open(options: Record<string, unknown>): Promise<{ success?: boolean; dismissedAction?: boolean }>;
  isPackageInstalled(name: string): Promise<{ isInstalled?: boolean }>;
}

interface MediaLib {
  createAssetAsync(localUri: string): Promise<{ id?: string }>;
}

export function getNativeSocialHandoff(): NativeSocialHandoff | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../modules/social-handoff') as Partial<NativeSocialHandoff> | null;
    if (
      !mod ||
      typeof mod.shareToInstagramReels !== 'function' ||
      typeof mod.shareToTikTok !== 'function'
    ) {
      return null;
    }
    const impl = mod as NativeSocialHandoff;
    return {
      shareToInstagramReels: (o) => impl.shareToInstagramReels(o),
      shareToTikTok: (o) => impl.shareToTikTok(o),
    };
  } catch {
    return null;
  }
}

function loadShare(): { lib: ShareLib; social: ShareLib['Social'] } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-share') as Partial<ShareLib> & { default?: ShareLib };
  const lib = mod.default ?? (mod as ShareLib);
  if (!lib || typeof lib.open !== 'function') throw new Error('share unavailable');
  return { lib, social: lib.Social ?? (mod.Social as ShareLib['Social']) };
}

function loadMedia(): MediaLib {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-media-library/legacy') as MediaLib;
  if (typeof mod.createAssetAsync !== 'function') throw new Error('media library unavailable');
  return mod;
}

const ANDROID_PACKAGES: Readonly<Record<ShareTarget, readonly string[]>> = {
  instagram_stories: ['com.instagram.android'],
  instagram_reels: ['com.instagram.android'],
  tiktok: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'],
};

const IOS_SCHEMES: Readonly<Record<ShareTarget, string>> = {
  instagram_stories: 'instagram-stories://',
  instagram_reels: 'instagram-reels://',
  tiktok: 'tiktokopensdk://',
};

export function createDefaultSocialHandoffDeps(opts: {
  platform: 'ios' | 'android' | 'web';
  tiktokRedirectUri?: string | null;
  env?: Record<string, string | undefined>;
}): SocialHandoffDeps {
  const { platform } = opts;
  return {
    platform,
    config: getShareConfig(opts.env),
    tiktokRedirectUri: opts.tiktokRedirectUri ?? null,
    native: platform === 'web' ? null : getNativeSocialHandoff(),
    async isTargetInstalled(target) {
      if (platform === 'ios') return Linking.canOpenURL(IOS_SCHEMES[target]);
      if (platform === 'android') {
        const { lib } = loadShare();
        for (const pkg of ANDROID_PACKAGES[target]) {
          const res = await lib.isPackageInstalled(pkg);
          if (res?.isInstalled === true) return true;
        }
      }
      return false;
    },
    async shareInstagramStories(payload: InstagramStoriesPayload) {
      const { lib, social } = loadShare();
      await lib.shareSingle({ ...payload, social: social.InstagramStories });
    },
    async saveToLibrary(fileUri) {
      const asset = await loadMedia().createAssetAsync(fileUri);
      return typeof asset?.id === 'string' && asset.id.length > 0 ? asset.id : null;
    },
    async openOsShare({ url, type }) {
      const res = await loadShare().lib.open({ url, type, failOnCancel: false });
      return res?.success === false || res?.dismissedAction === true ? 'dismissed' : 'shared';
    },
  };
}
