import { shareColors } from '../../theme/tokens';
import type { AgeBracket, ShareTarget } from '../../types/contracts';
import type { ShareConfig } from './shareConfig';

export type SocialHandoffResult =
  | { readonly ok: true; readonly via: 'native' | 'os_share' }
  | {
      readonly ok: false;
      readonly reason: 'age_restricted' | 'invalid_media' | 'busy' | 'cancelled' | 'failed';
    };

export interface SocialShareRequest {
  readonly target: ShareTarget;
  readonly videoUri: string | null;
  readonly stickerUri: string;
  readonly ageBracket: AgeBracket | null;
  readonly attributionUrl?: string;
}

export interface InstagramStoriesPayload {
  readonly appId: string;
  readonly stickerImage: string;
  readonly backgroundVideo?: string;
  readonly backgroundTopColor: string;
  readonly backgroundBottomColor: string;
  readonly attributionURL?: string;
}

export interface NativeSocialHandoff {
  shareToInstagramReels(options: {
    videoUri: string;
    stickerUri: string;
    facebookAppId: string;
  }): Promise<void>;
  shareToTikTok(options: { clientKey: string; redirectUri: string; mediaUri: string }): Promise<void>;
}

export interface SocialHandoffDeps {
  readonly platform: 'ios' | 'android' | 'web';
  readonly config: ShareConfig;
  readonly tiktokRedirectUri: string | null;
  isTargetInstalled(target: ShareTarget): Promise<boolean>;
  shareInstagramStories(payload: InstagramStoriesPayload): Promise<void>;
  readonly native: NativeSocialHandoff | null;
  /** iOS PHAsset localIdentifier, used for TikTok on iOS only. */
  saveToLibrary(fileUri: string): Promise<string | null>;
  openOsShare(options: { url: string; type: 'video/mp4' | 'image/png' }): Promise<'shared' | 'dismissed'>;
}

export interface SocialHandoff {
  share(request: SocialShareRequest): Promise<SocialHandoffResult>;
}

const isFileUri = (u: string): boolean => u.startsWith('file://');

function buildStoriesPayload(
  appId: string,
  request: SocialShareRequest,
): InstagramStoriesPayload {
  const payload: {
    -readonly [K in keyof InstagramStoriesPayload]: InstagramStoriesPayload[K];
  } = {
    appId,
    stickerImage: request.stickerUri,
    backgroundTopColor: shareColors.storyTop,
    backgroundBottomColor: shareColors.storyBottom,
  };
  if (request.videoUri !== null) payload.backgroundVideo = request.videoUri;
  const url = request.attributionUrl?.trim();
  if (url && url.startsWith('https://')) payload.attributionURL = url;
  return payload;
}

export function createSocialHandoff(deps: SocialHandoffDeps): SocialHandoff {
  let inFlight = false;

  const installed = async (target: ShareTarget): Promise<boolean> => {
    try {
      return (await deps.isTargetInstalled(target)) === true;
    } catch {
      return false;
    }
  };

  /** Returns true when the native path completed; false when a precondition failed. Throws on native rejection. */
  async function tryNative(request: SocialShareRequest): Promise<boolean> {
    if (deps.platform === 'web') return false;
    const { facebookAppId, tiktokClientKey } = deps.config;
    const { videoUri, stickerUri } = request;
    switch (request.target) {
      case 'instagram_stories': {
        if (!facebookAppId || !(await installed(request.target))) return false;
        await deps.shareInstagramStories(buildStoriesPayload(facebookAppId, request));
        return true;
      }
      case 'instagram_reels': {
        if (!facebookAppId || !deps.native || videoUri === null) return false;
        if (!(await installed(request.target))) return false;
        await deps.native.shareToInstagramReels({ videoUri, stickerUri, facebookAppId });
        return true;
      }
      case 'tiktok': {
        if (!tiktokClientKey || !deps.native || videoUri === null) return false;
        if (deps.platform === 'ios' && !deps.tiktokRedirectUri) return false;
        if (!(await installed(request.target))) return false;
        let mediaUri: string | null = videoUri;
        if (deps.platform === 'ios') {
          mediaUri = await deps.saveToLibrary(videoUri);
          if (!mediaUri) return false;
        }
        await deps.native.shareToTikTok({
          clientKey: tiktokClientKey,
          redirectUri: deps.tiktokRedirectUri ?? '',
          mediaUri,
        });
        return true;
      }
      default:
        return false;
    }
  }

  async function run(request: SocialShareRequest): Promise<SocialHandoffResult> {
    if (request.ageBracket === null || request.ageBracket === 'under_13') {
      return { ok: false, reason: 'age_restricted' };
    }
    const needsVideo = request.target === 'instagram_reels' || request.target === 'tiktok';
    if (
      !isFileUri(request.stickerUri) ||
      (request.videoUri !== null && !isFileUri(request.videoUri)) ||
      (needsVideo && request.videoUri === null)
    ) {
      return { ok: false, reason: 'invalid_media' };
    }
    try {
      if (await tryNative(request)) return { ok: true, via: 'native' };
    } catch {
      /* native rejected: degrade to the OS share sheet */
    }
    try {
      const outcome = await deps.openOsShare(
        request.videoUri !== null
          ? { url: request.videoUri, type: 'video/mp4' }
          : { url: request.stickerUri, type: 'image/png' },
      );
      return outcome === 'shared' ? { ok: true, via: 'os_share' } : { ok: false, reason: 'cancelled' };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  return {
    async share(request) {
      if (inFlight) return { ok: false, reason: 'busy' };
      inFlight = true;
      try {
        return await run(request);
      } catch {
        return { ok: false, reason: 'failed' };
      } finally {
        inFlight = false;
      }
    },
  };
}
