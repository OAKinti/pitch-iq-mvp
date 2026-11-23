import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HudButton, HudPanel, HudToggle, NavBackButton, OptionChip, ScreenFrame, SectionLabel, TelemetryReadout } from '../components';
import { useNavigation } from '../navigation/NavigationContext';
import { useAppState } from '../state/AppStateContext';
import { useDrillRunner } from '../state/useDrillRunner';
import { PRIVACY_REDACTED_LANDMARKS, type DrillType } from '../types/contracts';
import { borders, colors, radii, sizes, spacing, typography } from '../theme/tokens';

const DRILLS: readonly { id: DrillType; label: string; sub: string }[] = [
  { id: 'ball_mastery', label: 'Ball Mastery', sub: '30 s touches, both feet' },
  { id: 'agility_shuttle', label: 'Agility Shuttle', sub: '6 legs, turn sharp' },
];

const MIN_JOINT_VISIBILITY = 0.5;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const TIMER_WIDTH = 4;

export function formatTimer(ms: number): string {
  const total = Math.max(0, ms) / MS_PER_SECOND;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  const seconds = (total % SECONDS_PER_MINUTE).toFixed(1).padStart(TIMER_WIDTH, '0');
  return `${String(minutes).padStart(2, '0')}:${seconds}`;
}

export function CombineDrillScreen({ seed }: { seed?: number }) {
  const app = useAppState();
  const nav = useNavigation();
  const [drill, setDrill] = useState<DrillType>('ball_mastery');
  const [simulate, setSimulate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const runner = useDrillRunner(drill, seed);

  const hasConsent = app.hasConsent('camera_skeletal_tracking');
  const parentLocked = app.requiresParent && !app.hasConsent('parental_verified');
  const { snapshot, latestFrame, latestCue, running, result } = runner;
  const metricsDone = result !== null;

  const selectDrill = (next: DrillType) => {
    if (running) return;
    runner.reset();
    setNotice(null);
    setDrill(next);
  };

  const start = () => {
    if (!hasConsent) return;
    if (!simulate) {
      setNotice(
        parentLocked
          ? 'Live camera stays locked until a parent verifies. Enable Simulate Live Drill to practice.'
          : 'Live camera needs the Dev Client build (Day 2–3) — enable Simulate Live Drill',
      );
      return;
    }
    setNotice(null);
    runner.start();
  };

  const viewResults = () => {
    if (!result) return;
    app.completeDrill(result);
    nav.navigate('OVRCard');
  };

  const isBall = drill === 'ball_mastery';
  const count = snapshot?.count ?? 0;
  const rate = snapshot?.liveRate ?? 0;
  const quality = snapshot?.framingQuality ?? 0;
  const phase = snapshot ? snapshot.phase : 'idle';
  const cueText = latestCue ? app.voiceCoach.cue(latestCue).text : 'Awaiting cue';

  return (
    <ScreenFrame testID="screen-combine" kicker="Combine · live telemetry" title="Drill stage">
      <NavBackButton />
      <View style={styles.wrapRow}>
        {DRILLS.map((d) => (
          <View key={d.id} style={styles.half}>
            <OptionChip
              testID={`drill-option-${d.id}`}
              label={d.label}
              sublabel={d.sub}
              selected={drill === d.id}
              onPress={() => selectDrill(d.id)}
            />
          </View>
        ))}
      </View>

      <HudToggle testID="simulate-toggle" label="Simulate Live Drill" value={simulate} onChange={setSimulate} />

      <View testID="drill-stage" style={styles.stage}>
        {latestFrame?.landmarks.map((lm, i) =>
          PRIVACY_REDACTED_LANDMARKS.includes(i) || lm.visibility < MIN_JOINT_VISIBILITY ? null : (
            <View
              key={i}
              testID={`joint-${i}`}
              style={[styles.joint, { left: `${lm.x * 100}%`, top: `${lm.y * 100}%` }]}
            />
          ),
        )}
        {!latestFrame ? <Text style={styles.stageHint}>Skeleton joints appear here</Text> : null}
      </View>

      <View style={styles.framing}>
        <SectionLabel text={`Framing ${Math.round(quality * 100)}%`} tone={quality < MIN_JOINT_VISIBILITY && snapshot ? 'warning' : 'muted'} />
        <View style={styles.framingTrack}>
          <View testID="framing-bar" style={[styles.framingFill, { width: `${quality * 100}%` }]} />
        </View>
      </View>

      <HudPanel title="Telemetry" accent={phase === 'active'}>
        <View style={styles.wrapRow}>
          <TelemetryReadout testID="telemetry-phase" label="Phase" value={phase.toUpperCase()} />
          <TelemetryReadout testID="telemetry-count" label={isBall ? 'Touches' : 'Legs'} value={String(count)} />
          <TelemetryReadout
            testID="telemetry-rate"
            label="Rate"
            value={isBall ? String(Math.round(rate)) : rate.toFixed(1)}
            unit={isBall ? 'touch/min' : 'm/s'}
          />
          <TelemetryReadout testID="telemetry-timer" label="Timer" value={formatTimer(snapshot?.elapsedMs ?? 0)} tone="accent" />
        </View>
        <Text testID="cue-caption" style={styles.cue}>
          {cueText}
        </Text>
      </HudPanel>

      {!hasConsent ? (
        <Text testID="consent-notice" style={styles.notice}>
          Motion-tracking consent is required before any drill. Complete the release in setup.
        </Text>
      ) : null}
      {notice ? (
        <Text testID="drill-notice" style={styles.notice}>
          {notice}
        </Text>
      ) : null}

      {metricsDone ? (
        <HudButton testID="drill-view-results" label="View results" onPress={viewResults} />
      ) : (
        <HudButton testID="drill-start" label={running ? 'Drill running' : 'Start drill'} onPress={start} disabled={!hasConsent || running} />
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  half: { width: '48%' },
  stage: {
    width: '100%',
    aspectRatio: sizes.stageAspect,
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageHint: {
    color: colors.textMuted,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    letterSpacing: typography.letterSpacing.wide,
  },
  joint: {
    position: 'absolute',
    width: sizes.jointDot,
    height: sizes.jointDot,
    marginLeft: -(sizes.jointDot / 2),
    marginTop: -(sizes.jointDot / 2),
    borderRadius: radii.pill,
    backgroundColor: colors.skeletonJoint,
  },
  framing: { gap: spacing.xs },
  framingTrack: {
    height: sizes.progressHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
  },
  framingFill: { height: '100%', backgroundColor: colors.telemetry },
  cue: {
    color: colors.accent,
    fontFamily: typography.family.mono,
    fontSize: typography.size.bodyLg,
    letterSpacing: typography.letterSpacing.wide,
  },
  notice: {
    color: colors.warning,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    letterSpacing: typography.letterSpacing.wide,
  },
});
