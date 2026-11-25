const mockDelete = jest.fn();
let mockExists = true;
const mockUris: string[] = [];

jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
      mockUris.push(uri);
    }
    get exists() {
      return mockExists;
    }
    delete() {
      mockDelete();
    }
  },
}));

import { createExpoClipFiles } from '../../../services/highlight/clipFiles';

describe('clipFiles', () => {
  beforeEach(() => {
    mockDelete.mockClear();
    mockExists = true;
  });

  it('cacheDir is a file:// directory URI ending in a slash', () => {
    expect(createExpoClipFiles().cacheDir()).toBe('file:///cache/');
  });

  it('exists reflects the file and remove deletes only existing files', async () => {
    const files = createExpoClipFiles();
    expect(await files.exists('file:///cache/a.mp4')).toBe(true);
    await files.remove('file:///cache/a.mp4');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    mockExists = false;
    expect(await files.exists('file:///cache/a.mp4')).toBe(false);
    await files.remove('file:///cache/a.mp4');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockUris).toContain('file:///cache/a.mp4');
  });
});
