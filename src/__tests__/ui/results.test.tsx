import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ATTRIBUTE_KEYS } from '../../types/contracts';
import { selectPeakStreakWindow } from '../../domain';
import { DEMO_USER_ID } from '../../services';
import { CAMERA_CONSENT, renderNavigator, simulateResult } from './helpers';

const ball = simulateResult('ball_mastery');
const shuttle = simulateResult('agility_shuttle');

describe('OVRCardScreen', () => {
  it('handles no results yet', async () => {
    await renderNavigator({ initialRoute: 'OVRCard' });
    expect(screen.getByTestId('screen-ovr')).toBeTruthy();
    expect(screen.getByTestId('ovr-empty')).toBeTruthy();
  });

  it('renders every required testID from a simulated drill', async () => {
    await renderNavigator({ initialRoute: 'OVRCard', seed: [ball] });
    await waitFor(() => expect(screen.getByTestId('debrief-text')).not.toHaveTextContent(/reviewing/));
    expect(screen.getByTestId('ovr-value').props.children).toMatch(/^\d{1,2}\.\d$/);
    expect(screen.getByTestId('ovr-band')).toBeTruthy();
    for (const key of ATTRIBUTE_KEYS) expect(screen.getByTestId(`attr-${key}`)).toBeTruthy();
    expect(screen.getByTestId('archetype-0')).toBeTruthy();
    expect(screen.getByTestId('archetype-1')).toBeTruthy();
    expect(screen.getByTestId('archetype-2')).toBeTruthy();
    expect(screen.getByText(/Source · template/i)).toBeTruthy();
    expect(screen.getByTestId('ovr-share')).toBeTruthy();
    expect(screen.getByTestId('ovr-group')).toBeTruthy();
  });

  it('shows the reviewing placeholder until the debrief arrives', async () => {
    const never = { persona: 'captain', cue: jest.fn(), qa: {}, debrief: () => new Promise(() => undefined) };
    await renderNavigator({
      initialRoute: 'OVRCard',
      seed: [ball],
      voiceCoach: never as never,
    });
    expect(screen.getByTestId('debrief-text')).toHaveTextContent('Coach is reviewing your session…');
  });
});

describe('GroupSessionScreen', () => {
  it('shows leaderboard, crowns and rivalry derived from the repository', async () => {
    await renderNavigator({ initialRoute: 'GroupSession', seed: [ball] });
    await waitFor(() => expect(screen.getByTestId(`leaderboard-row-${DEMO_USER_ID}`)).toBeTruthy());
    expect(screen.getByTestId('leaderboard-row-demo-jonas')).toBeTruthy();
    expect(screen.getByTestId('crown-performance')).toHaveTextContent(/Jonas Weber|You/);
    expect(screen.getByTestId('crown-consistency')).toHaveTextContent(/Maya Rivera/);
    expect(screen.getByTestId('crown-consistency')).toHaveTextContent(/active days/);
    expect(screen.getByTestId('rivalry-objective')).toBeTruthy();
    expect(screen.getByTestId('rivalry-progress')).toBeTruthy();
  });
});

describe('HighlightShareScreen', () => {
  it('derives the peak window and ffmpeg command from a ball mastery result', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', seed: [ball] });
    const m = ball.metrics;
    if (m.drillType !== 'ball_mastery') throw new Error('unexpected');
    const w = selectPeakStreakWindow(m.touchTimestampsMs, m.durationMs);
    await waitFor(() => expect(screen.getByTestId('highlight-window')).toBeTruthy());
    expect(screen.getByTestId('highlight-window')).toHaveTextContent(new RegExp(`${w.eventCount} touches`));
    expect(screen.getByTestId('ffmpeg-command')).toHaveTextContent(/libx264/);
    expect(screen.getByTestId('ffmpeg-command')).toHaveTextContent(/faststart/);
    expect(screen.getByText('YUV420P')).toBeTruthy();
  });

  it('supports shuttle results (cumulative split boundaries)', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', seed: [shuttle] });
    await waitFor(() => expect(screen.getByTestId('highlight-window')).toHaveTextContent(/legs/));
  });

  it('builds share payloads without native calls', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', seed: [ball] });
    await fireEvent.press(screen.getByTestId('share-instagram_stories'));
    expect(screen.getByTestId('share-summary')).toHaveTextContent(/instagram-stories:\/\/share/);
    expect(screen.getByTestId('share-summary')).toHaveTextContent(/Native handoff ships Day 6/);
    await fireEvent.press(screen.getByTestId('share-instagram_reels'));
    expect(screen.getByTestId('share-summary')).toHaveTextContent(/instagram-reels:\/\/share/);
    await fireEvent.press(screen.getByTestId('share-tiktok'));
    expect(screen.getByTestId('share-summary')).toHaveTextContent(/video · normal/);
  });

  it('degrades gracefully with no result', async () => {
    await renderNavigator({ initialRoute: 'HighlightShare', initial: { consents: [CAMERA_CONSENT] } });
    expect(screen.getByTestId('highlight-empty')).toBeTruthy();
    expect(screen.getByTestId('share-tiktok').props.accessibilityState.disabled).toBe(true);
  });
});
