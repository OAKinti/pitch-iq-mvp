import React, { useEffect } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borders, colors, motion, opacity, radii, sizes, spacing, typography } from '../theme/tokens';

/* ───────────────────────── ScreenFrame ───────────────────────── */

export function ScreenFrame({
  testID,
  kicker,
  title,
  children,
  footer,
  scroll = true,
}: {
  testID: string;
  kicker?: string;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
}) {
  const body = (
    <>
      {(kicker || title) && (
        <View style={styles.header}>
          {kicker ? <SectionLabel text={kicker} tone="telemetry" /> : null}
          {title ? <Text style={styles.title}>{title}</Text> : null}
        </View>
      )}
      {children}
    </>
  );
  return (
    <SafeAreaView testID={testID} style={styles.screen} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        <View style={styles.staticBody}>{body}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/* ───────────────────────── SectionLabel ───────────────────────── */

type Tone = 'muted' | 'telemetry' | 'accent' | 'warning' | 'danger';
const toneColor: Record<Tone, string> = {
  muted: colors.textMuted,
  telemetry: colors.telemetry,
  accent: colors.accent,
  warning: colors.warning,
  danger: colors.danger,
};

export function SectionLabel({ text, tone = 'muted', testID }: { text: string; tone?: Tone; testID?: string }) {
  return (
    <Text testID={testID} style={[styles.label, { color: toneColor[tone] }]}>
      {text.toUpperCase()}
    </Text>
  );
}

/* ───────────────────────── HudPanel ───────────────────────── */

export function HudPanel({
  title,
  children,
  style,
  testID,
  accent = false,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accent?: boolean;
}) {
  const bracket = accent ? colors.accent : colors.telemetry;
  return (
    <View testID={testID} style={[styles.panel, style]}>
      <View style={[styles.corner, styles.cornerTL, { borderColor: bracket }]} />
      <View style={[styles.corner, styles.cornerTR, { borderColor: bracket }]} />
      <View style={[styles.corner, styles.cornerBL, { borderColor: bracket }]} />
      <View style={[styles.corner, styles.cornerBR, { borderColor: bracket }]} />
      {title ? (
        <View style={styles.panelTitle}>
          <SectionLabel text={title} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

/* ───────────────────────── HudButton ───────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function HudButton({
  label,
  onPress,
  testID,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      onPressIn={() => {
        if (reduced) return;
        scale.value = withSpring(motion.pressScale, motion.spring);
      }}
      onPressOut={() => {
        if (reduced) return;
        scale.value = withSpring(1, motion.spring);
      }}
    >
      <Animated.View
        style={[
          styles.button,
          variant === 'primary' && styles.buttonPrimary,
          variant === 'secondary' && styles.buttonSecondary,
          variant === 'ghost' && styles.buttonGhost,
          disabled && styles.disabled,
          animated,
        ]}
      >
        <Text
          style={[
            styles.buttonText,
            { color: variant === 'primary' ? colors.textOnAccent : colors.textPrimary },
          ]}
        >
          {label.toUpperCase()}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/* ───────────────────────── HudToggle ───────────────────────── */

export function HudToggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testID: string;
}) {
  const reduced = useReducedMotion();
  const knob = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    knob.value = reduced ? (value ? 1 : 0) : withTiming(value ? 1 : 0, { duration: motion.duration.fast });
  }, [value, knob, reduced]);
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knob.value * (sizes.toggleWidth - sizes.toggleKnob - spacing.xs) }],
  }));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <Text style={styles.toggleLabel}>{label.toUpperCase()}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <Animated.View style={[styles.toggleKnob, value && styles.toggleKnobOn, knobStyle]} />
      </View>
    </Pressable>
  );
}

/* ───────────────────────── OptionChip ───────────────────────── */

export function OptionChip({
  label,
  sublabel,
  selected,
  onPress,
  testID,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
      {sublabel ? <Text style={styles.chipSub}>{sublabel}</Text> : null}
    </Pressable>
  );
}

/* ───────────────────────── TelemetryReadout ───────────────────────── */

export function TelemetryReadout({
  label,
  value,
  unit,
  tone = 'telemetry',
  testID,
  large = false,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  testID?: string;
  large?: boolean;
}) {
  return (
    <View style={styles.readout}>
      <SectionLabel text={label} />
      <View style={styles.readoutValueRow}>
        <Text
          testID={testID}
          style={[styles.readoutValue, large && styles.readoutValueLarge, { color: toneColor[tone] }]}
        >
          {value}
        </Text>
        {unit ? <Text style={styles.readoutUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

/* ───────────────────────── StatBar ───────────────────────── */

export function StatBar({ label, value, testID }: { label: string; value: number; testID?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const reduced = useReducedMotion();
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = reduced ? pct : withTiming(pct, { duration: motion.duration.slow });
  }, [pct, fill, reduced]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value}%` }));
  return (
    <View testID={testID} style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statTrack}>
        <Animated.View style={[styles.statFill, pct >= 80 && styles.statFillHigh, fillStyle]} />
      </View>
      <Text style={styles.statValue}>{Math.round(value)}</Text>
    </View>
  );
}

/* ───────────────────────── styles ───────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollBody: { padding: spacing.gutter, gap: spacing.lg },
  staticBody: { flex: 1, padding: spacing.gutter, gap: spacing.lg },
  footer: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  header: { gap: spacing.xs },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.family.display,
    fontSize: typography.size.headline,
    fontWeight: typography.weight.black,
    letterSpacing: typography.letterSpacing.tight,
  },
  label: {
    fontFamily: typography.family.mono,
    fontSize: typography.size.micro,
    letterSpacing: typography.letterSpacing.hud,
    fontWeight: typography.weight.medium,
  },
  panel: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelTitle: { marginBottom: spacing.xxs },
  corner: { position: 'absolute', width: sizes.hudCorner, height: sizes.hudCorner },
  cornerTL: { top: -borders.hairline, left: -borders.hairline, borderTopWidth: borders.thick, borderLeftWidth: borders.thick },
  cornerTR: { top: -borders.hairline, right: -borders.hairline, borderTopWidth: borders.thick, borderRightWidth: borders.thick },
  cornerBL: { bottom: -borders.hairline, left: -borders.hairline, borderBottomWidth: borders.thick, borderLeftWidth: borders.thick },
  cornerBR: { bottom: -borders.hairline, right: -borders.hairline, borderBottomWidth: borders.thick, borderRightWidth: borders.thick },
  button: {
    minHeight: sizes.buttonHeight,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: {
    backgroundColor: colors.surfaceHigh,
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
  },
  buttonGhost: { backgroundColor: colors.transparent },
  buttonText: {
    fontFamily: typography.family.mono,
    fontSize: typography.size.body,
    fontWeight: typography.weight.bold,
    letterSpacing: typography.letterSpacing.wide,
  },
  disabled: { opacity: opacity.disabled },
  toggleRow: {
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleLabel: {
    color: colors.textPrimary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    letterSpacing: typography.letterSpacing.wide,
    flexShrink: 1,
  },
  toggleTrack: {
    width: sizes.toggleWidth,
    height: sizes.toggleHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceHigh,
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
  },
  toggleTrackOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  toggleKnob: {
    width: sizes.toggleKnob,
    height: sizes.toggleKnob,
    borderRadius: radii.pill,
    backgroundColor: colors.textMuted,
  },
  toggleKnobOn: { backgroundColor: colors.accent },
  chip: {
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceHigh,
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  chipLabel: {
    color: colors.textPrimary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.body,
    fontWeight: typography.weight.bold,
    letterSpacing: typography.letterSpacing.wide,
  },
  chipLabelSelected: { color: colors.accent },
  chipSub: { color: colors.textSecondary, fontSize: typography.size.caption },
  readout: { minWidth: sizes.telemetryMinWidth, gap: spacing.xxs },
  readoutValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  readoutValue: {
    fontFamily: typography.family.mono,
    fontSize: typography.size.headline,
    fontWeight: typography.weight.bold,
    ...typography.tabular,
  },
  readoutValueLarge: { fontSize: typography.size.display, fontWeight: typography.weight.black },
  readoutUnit: {
    color: colors.textMuted,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
  },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statLabel: {
    width: sizes.avatar,
    color: colors.textSecondary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    fontWeight: typography.weight.bold,
    letterSpacing: typography.letterSpacing.wide,
  },
  statTrack: {
    flex: 1,
    height: sizes.statBarHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
  },
  statFill: { height: '100%', backgroundColor: colors.telemetry, borderRadius: radii.pill },
  statFillHigh: { backgroundColor: colors.accent },
  statValue: {
    width: sizes.avatar,
    textAlign: 'right',
    color: colors.textPrimary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.body,
    fontWeight: typography.weight.bold,
    ...typography.tabular,
  },
});
