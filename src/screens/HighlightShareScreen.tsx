import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HudButton, HudPanel, NavBackButton, OvrSticker, ScreenFrame, SectionLabel } from '../components';
import { useAppState } from '../state/AppStateContext';
import { selectPeakStreakWindow } from '../domain';
import {
  INSTAGRAM_EXPORT_SPEC,
  STICKER_SPEC,
  buildHighlightClipArgs,
  getShareConfig,
  toFfmpegCommand,
} from '../services';
import type { DrillResult, HighlightWindow, ShareTarget } from '../types/contracts';
import { borders, colors, radii, spacing, typography } from '../theme/tokens';

const INPUT_PATH = 'PitchIQ Drill.mp4';
const OUTPUT_PATH = 'PitchIQ Highlight.mp4';
const MS_PER_SECOND = 1000;

const TARGETS: readonly { id: ShareTarget; label: string }[] = [
  { id: 'instagram_stories', label: 'Instagram Stories' },
  { id: 'instagram_reels', label: 'Instagram Reels' },
  { id: 'tiktok', label: 'TikTok' },
];

const SPEC_CHIPS: readonly string[] = [
  'H.264',
  'AAC',
  INSTAGRAM_EXPORT_SPEC.pixelFormat,
  'progressive',
  '+faststart',
  `sticker ${STICKER_SPEC.width}×${STICKER_SPEC.height} PNG`,
];

function windowFor(result: DrillResult): HighlightWindow {
  const m = result.metrics;
  if (m.drillType === 'ball_mastery') return selectPeakStreakWindow(m.touchTimestampsMs, m.durationMs);
  let elapsed = 0;
  const boundaries = m.splitTimesMs.map((s) => (elapsed += s));
  return selectPeakStreakWindow(boundaries, m.totalTimeMs);
}

const seconds = (ms: number): string => (ms / MS_PER_SECOND).toFixed(1);

export function HighlightShareScreen() {
  const { results, ovr, badges, ageBracket } = useAppState();
  const [pressed, setPressed] = useState<ShareTarget | null>(null);
  const latest = results.length > 0 ? results[results.length - 1] : undefined;
  const config = useMemo(() => getShareConfig(), []);
  const locked = ageBracket === null || ageBracket === 'under_13';
  const nativeConfigured = (target: ShareTarget): boolean =>
    target === 'tiktok' ? config.tiktokClientKey !== null : config.facebookAppId !== null;

  const window = useMemo(() => (latest ? windowFor(latest) : null), [latest]);
  const command = useMemo(
    () =>
      window
        ? toFfmpegCommand(buildHighlightClipArgs({ inputPath: INPUT_PATH, outputPath: OUTPUT_PATH, window }))
        : '',
    [window],
  );

  const share = (target: ShareTarget) => {
    if (locked) return;
    setPressed(target);
  };
  const pressedLabel = TARGETS.find((t) => t.id === pressed)?.label ?? '';

  return (
    <ScreenFrame testID="screen-highlight" kicker="Highlight export" title="Share your best streak">
      <NavBackButton />
      {!latest || !window ? (
        <Text testID="highlight-empty" style={styles.body}>
          No drill yet. Finish a drill to generate a highlight window.
        </Text>
      ) : (
        <>
          <HudPanel title="Peak window" accent>
            <Text testID="highlight-window" style={styles.window}>
              {`${seconds(window.startMs)}s – ${seconds(window.endMs)}s · ${window.eventCount} ${
                latest.drillType === 'ball_mastery' ? 'touches' : 'legs'
              }`}
            </Text>
          </HudPanel>

          <HudPanel title="Clip command">
            <View style={styles.codeBlock}>
              <Text testID="ffmpeg-command" style={styles.code} selectable>
                {command}
              </Text>
            </View>
            <View style={styles.chips}>
              {SPEC_CHIPS.map((c) => (
                <View key={c} style={styles.chip}>
                  <Text style={styles.chipText}>{c.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </HudPanel>
        </>
      )}

      {ovr ? (
        <HudPanel title="Sticker">
          <OvrSticker ovr={ovr} badges={badges} />
        </HudPanel>
      ) : null}

      <HudPanel title="Share to">
        {TARGETS.map((t) => (
          <HudButton
            key={t.id}
            testID={`share-${t.id}`}
            label={t.label}
            variant={t.id === 'instagram_stories' ? 'primary' : 'secondary'}
            onPress={() => share(t.id)}
            disabled={!latest || locked}
          />
        ))}
        {locked ? (
          <Text testID="share-age-locked" style={styles.body}>
            Sharing is off for under-13 profiles.
          </Text>
        ) : null}
        {pressed ? (
          <View testID="share-summary" style={styles.summary}>
            <SectionLabel text={`Prepared · ${pressedLabel}`} tone="telemetry" />
            <Text style={styles.code}>
              {nativeConfigured(pressed) ? 'native handoff configured' : 'OS share sheet fallback'}
            </Text>
            <Text style={styles.body}>Native handoff ships Day 6 (dev build)</Text>
          </View>
        ) : null}
      </HudPanel>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.textSecondary, fontSize: typography.size.body },
  window: {
    color: colors.accent,
    fontFamily: typography.family.mono,
    fontSize: typography.size.title,
    fontWeight: typography.weight.bold,
    ...typography.tabular,
  },
  codeBlock: {
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  code: {
    color: colors.telemetry,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    lineHeight: typography.size.caption * typography.lineHeight.normal,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: {
    color: colors.textSecondary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.micro,
    letterSpacing: typography.letterSpacing.wide,
  },
  summary: { gap: spacing.xs },
});
