import type { ClipFiles } from './highlightClip';

/** Only file that references expo-file-system (SDK 58 object API: Paths.cache, File#exists, File#delete). */
export function createExpoClipFiles(): ClipFiles {
  const fs = require('expo-file-system') as typeof import('expo-file-system');
  return {
    cacheDir(): string {
      const uri = fs.Paths.cache.uri;
      return uri.endsWith('/') ? uri : `${uri}/`;
    },
    async exists(uri: string): Promise<boolean> {
      return new fs.File(uri).exists;
    },
    async remove(uri: string): Promise<void> {
      const file = new fs.File(uri);
      if (file.exists) file.delete();
    },
  };
}
