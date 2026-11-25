import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HudButton, HudPanel, OptionChip, ScreenFrame, SectionLabel } from '../components';
import { useNavigation } from '../navigation/NavigationContext';
import { useAppState } from '../state/AppStateContext';
import { classifyAge } from '../domain';
import { PERSONAS } from '../services';
import type { CoachPersona, PlayerPosition } from '../types/contracts';
import { borders, colors, opacity, radii, sizes, spacing, typography } from '../theme/tokens';

type Step = 'age' | 'consent' | 'profile';

const PERSONA_ORDER: readonly CoachPersona[] = ['captain', 'drill_sergeant', 'hype'];
const POSITIONS: readonly { id: PlayerPosition; label: string }[] = [
  { id: 'GK', label: 'Goalkeeper' },
  { id: 'DEF', label: 'Defender' },
  { id: 'MID', label: 'Midfielder' },
  { id: 'FWD', label: 'Forward' },
];
const YEAR_DIGITS = 4;
const MONTH_DIGITS = 2;

export function OnboardingScreen() {
  const app = useAppState();
  const nav = useNavigation();
  const [step, setStep] = useState<Step>('age');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [agreed, setAgreed] = useState(false);

  // AUTH-4: once an age bracket is persisted the age step is locked and skipped on every later launch.
  useEffect(() => {
    if (!app.ageLocked) return;
    setStep((s) => (s !== 'age' ? s : app.hasConsent('camera_skeletal_tracking') ? 'profile' : 'consent'));
  }, [app]);

  const bracket = classifyAge(Number(year), Number(month), app.now());
  const parent = app.requiresParent;

  const continueAge = () => {
    if (!bracket) return;
    app.setAge(bracket);
    setStep('consent');
  };

  const accept = () => {
    app.grantConsent('camera_skeletal_tracking');
    setStep('profile');
  };

  const finish = () => nav.replace('Combine');

  const stepNumber = step === 'age' ? '1' : step === 'consent' ? '2' : '3';

  return (
    <ScreenFrame
      testID="screen-onboarding"
      kicker={`Setup · step ${stepNumber} of 3`}
      title={step === 'age' ? 'Who is training?' : step === 'consent' ? 'Motion tracking release' : 'Pick your coach'}
    >
      {step === 'age' && app.hydrated && (
        <HudPanel title="Birth date">
          <Text style={styles.body}>
            Enter the birth month and year of the person who will train. We use it only to set up the right account
            protections.
          </Text>
          <View style={styles.row}>
            <View style={styles.field}>
              <SectionLabel text="Year" />
              <TextInput
                testID="age-year-input"
                accessibilityLabel="Birth year"
                style={styles.input}
                value={year}
                onChangeText={setYear}
                keyboardType="number-pad"
                placeholder="YYYY"
                placeholderTextColor={colors.textMuted}
                maxLength={YEAR_DIGITS}
              />
            </View>
            <View style={styles.field}>
              <SectionLabel text="Month" />
              <TextInput
                testID="age-month-input"
                accessibilityLabel="Birth month"
                style={styles.input}
                value={month}
                onChangeText={setMonth}
                keyboardType="number-pad"
                placeholder="MM"
                placeholderTextColor={colors.textMuted}
                maxLength={MONTH_DIGITS}
              />
            </View>
          </View>
          <HudButton testID="age-continue" label="Continue" onPress={continueAge} disabled={bracket === null} />
        </HudPanel>
      )}

      {step === 'consent' && (
        <>
          {parent ? (
            <HudPanel accent title="Parent or guardian">
              <Text style={styles.privateBadge} testID="private-account-notice">
                Private account · parental verification pending
              </Text>
              <Text style={styles.body}>
                Parent or guardian: please read this release with your child. Live camera tracking stays locked until
                you verify. Practice with the simulated drill is available right away.
              </Text>
            </HudPanel>
          ) : null}
          <HudPanel title="Electronic release">
            <Text style={styles.body}>
              {parent ? 'Your child’s' : 'Your'} camera is used to follow body joints only (a skeleton of dots).
            </Text>
            <Text style={styles.bullet}>· Only skeletal joint positions are tracked.</Text>
            <Text style={styles.bullet}>· No facial geometry, faceprints or voiceprints are collected.</Text>
            <Text style={styles.bullet}>· Raw video is deleted automatically within 90 days.</Text>
            <Text style={styles.bullet}>· You can revoke this consent at any time.</Text>
            <Pressable
              testID="consent-checkbox"
              accessibilityRole="checkbox"
              accessibilityLabel="I have read and agree to the electronic release"
              accessibilityState={{ checked: agreed }}
              onPress={() => setAgreed((v) => !v)}
              style={styles.checkRow}
            >
              <View style={[styles.box, agreed && styles.boxOn]}>
                {agreed ? <View style={styles.boxMark} /> : null}
              </View>
              <Text style={styles.checkText}>
                {parent
                  ? 'I am the parent or guardian and I agree to this release.'
                  : 'I have read this release and I agree.'}
              </Text>
            </Pressable>
            <HudButton testID="consent-accept" label="Accept and continue" onPress={accept} disabled={!agreed} />
          </HudPanel>
        </>
      )}

      {step === 'profile' && (
        <>
          {parent ? (
            <Text style={styles.privateBadge} testID="private-account-notice">
              Private account · parental verification pending
            </Text>
          ) : null}
          <SectionLabel text="Coach voice" tone="accent" />
          <View style={styles.stack}>
            {PERSONA_ORDER.map((p) => (
              <OptionChip
                key={p}
                testID={`persona-option-${p}`}
                label={PERSONAS[p].label}
                sublabel={PERSONAS[p].tagline}
                selected={app.persona === p}
                onPress={() => app.setPersona(p)}
              />
            ))}
          </View>
          <SectionLabel text="Position" tone="accent" />
          <View style={styles.wrapRow}>
            {POSITIONS.map((p) => (
              <View key={p.id} style={styles.half}>
                <OptionChip
                  testID={`position-option-${p.id}`}
                  label={p.id}
                  sublabel={p.label}
                  selected={app.position === p.id}
                  onPress={() => app.setPosition(p.id)}
                />
              </View>
            ))}
          </View>
          <HudButton testID="onboarding-finish" label="Enter the combine" onPress={finish} />
        </>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.textSecondary, fontSize: typography.size.body, lineHeight: typography.size.body * typography.lineHeight.normal },
  bullet: { color: colors.textPrimary, fontSize: typography.size.body },
  row: { flexDirection: 'row', gap: spacing.md },
  field: { flex: 1, gap: spacing.xs },
  input: {
    minHeight: sizes.touchTarget,
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHigh,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    fontFamily: typography.family.mono,
    fontSize: typography.size.title,
    ...typography.tabular,
  },
  privateBadge: {
    color: colors.warning,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    letterSpacing: typography.letterSpacing.wide,
  },
  checkRow: { minHeight: sizes.touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  box: {
    width: sizes.iconMd,
    height: sizes.iconMd,
    borderRadius: radii.sm,
    borderWidth: borders.thick,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  boxMark: { width: sizes.iconSm / 2, height: sizes.iconSm / 2, backgroundColor: colors.accent },
  checkText: { flex: 1, color: colors.textPrimary, fontSize: typography.size.body, opacity: opacity.full },
  stack: { gap: spacing.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  half: { width: '48%' },
});
