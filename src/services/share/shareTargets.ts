import { shareColors } from '../../theme/tokens';

export const STICKER_SPEC = { width: 640, height: 480, format: 'png', transparent: true } as const;

export interface PasteboardShare {
  url: string;
  pasteboardItems: Record<string, string>[];
  expirationSeconds: number;
}

export interface TikTokShareRequest {
  mediaType: 'video';
  mediaPaths: string[];
  shareFormat: 'normal' | 'green_screen';
  redirectUri: string;
  clientKey: string;
}

interface IgOpts {
  facebookAppId: string;
  videoUri: string;
  stickerUri: string;
}

const PASTEBOARD_TTL_SECONDS = 300;

export function buildInstagramStoriesShare(opts: IgOpts): PasteboardShare {
  return {
    url: `instagram-stories://share?source_application=${encodeURIComponent(opts.facebookAppId)}`,
    pasteboardItems: [
      {
        'com.instagram.sharedSticker.backgroundVideo': opts.videoUri,
        'com.instagram.sharedSticker.stickerImage': opts.stickerUri,
        'com.instagram.sharedSticker.backgroundTopColor': shareColors.storyTop,
        'com.instagram.sharedSticker.backgroundBottomColor': shareColors.storyBottom,
      },
    ],
    expirationSeconds: PASTEBOARD_TTL_SECONDS,
  };
}

export function buildInstagramReelsShare(opts: IgOpts): PasteboardShare {
  return {
    url: `instagram-reels://share?source_application=${encodeURIComponent(opts.facebookAppId)}`,
    pasteboardItems: [
      {
        'com.instagram.sharedSticker.backgroundVideo': opts.videoUri,
        'com.instagram.sharedSticker.stickerImage': opts.stickerUri,
      },
    ],
    expirationSeconds: PASTEBOARD_TTL_SECONDS,
  };
}

/** TikTok Share Kit v2 request. */
export function buildTikTokShareRequest(opts: {
  clientKey: string;
  redirectUri: string;
  mediaPath: string;
}): TikTokShareRequest {
  return {
    mediaType: 'video',
    mediaPaths: [opts.mediaPath],
    shareFormat: 'normal',
    redirectUri: opts.redirectUri,
    clientKey: opts.clientKey,
  };
}
