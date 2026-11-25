import fs from 'fs';
import path from 'path';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { CAMERA_CONSENT, renderNavigator, simulateResult } from './helpers';

const ball = simulateResult('ball_mastery');
const SRC = path.join(__dirname, '..', '..');
const ADULT = { ageBracket: 'adult_18_plus' as const, consents: [{ ...CAMERA_CONSENT }] };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('HighlightShareScreen v2', () => {
  it('mounts ovr-sticker when an OVR exists (UI-2)', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', seed: [ball], initial: ADULT });
    await waitFor(() => expect(screen.getByTestId('ovr-sticker')).toBeTruthy());
    expect(screen.getByTestId('highlight-window')).toBeTruthy();
    expect(screen.getByTestId('ffmpeg-command')).toBeTruthy();
    for (const t of ['instagram_stories', 'instagram_reels', 'tiktok'])
      expect(screen.getByTestId(`share-${t}`)).toBeTruthy();
  });

  it('never mounts the sticker without an OVR', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', initial: ADULT });
    expect(screen.getByTestId('highlight-empty')).toBeTruthy();
    expect(screen.queryByTestId('ovr-sticker')).toBeNull();
  });

  it('share-summary names the target and states OS share fallback when ids are unset', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', seed: [ball], initial: ADULT });
    await fireEvent.press(screen.getByTestId('share-instagram_stories'));
    expect(screen.getByTestId('share-summary')).toHaveTextContent(/Instagram Stories/i);
    expect(screen.getByTestId('share-summary')).toHaveTextContent(/OS share sheet fallback/);
    await fireEvent.press(screen.getByTestId('share-tiktok'));
    expect(screen.getByTestId('share-summary')).toHaveTextContent(/TikTok/i);
    expect(screen.queryByTestId('share-age-locked')).toBeNull();
  });

  it('reports native handoff configured when ids are present', async () => {
    const prevApp = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
    process.env.EXPO_PUBLIC_FACEBOOK_APP_ID = '1234567890';
    try {
      await renderNavigator({ initialRoute: 'HighlightShare', seed: [ball], initial: ADULT });
      await fireEvent.press(screen.getByTestId('share-instagram_reels'));
      expect(screen.getByTestId('share-summary')).toHaveTextContent(/native handoff configured/);
    } finally {
      if (prevApp === undefined) delete process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
      else process.env.EXPO_PUBLIC_FACEBOOK_APP_ID = prevApp;
    }
  });

  it('under-13 sees share-age-locked and disabled share buttons', async () => {
    await renderNavigator({
      initialRoute: 'HighlightShare',
      seed: [ball],
      initial: { ageBracket: 'under_13', consents: [CAMERA_CONSENT] },
    });
    expect(screen.getByTestId('share-age-locked')).toHaveTextContent(/under-13/);
    for (const t of ['instagram_stories', 'instagram_reels', 'tiktok']) {
      expect(screen.getByTestId(`share-${t}`).props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(screen.getByTestId(`share-${t}`));
    }
    expect(screen.queryByTestId('share-summary')).toBeNull();
  });

  it('unknown age is locked too', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', seed: [ball] });
    expect(screen.getByTestId('share-age-locked')).toBeTruthy();
    expect(screen.getByTestId('share-tiktok').props.accessibilityState.disabled).toBe(true);
  });

  it('screens and components contain no process.env and no placeholder id', () => {
    const files = [...walk(path.join(SRC, 'screens')), ...walk(path.join(SRC, 'components'))];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      expect({ f, hit: /process\.env|demo-app-id|demo-client-key/.test(text) }).toEqual({
        f,
        hit: false,
      });
    }
  });
});
