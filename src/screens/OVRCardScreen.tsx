import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HudButton, HudPanel, NavBackButton, ScreenFrame, SectionLabel, StatBar } from '../components';
import { useNavigation } from '../navigation/NavigationContext';
import { useAppState } from '../state/AppStateContext';
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS } from '../types/contracts';
import { borders, colors, radii, spacing, typography } from '../theme/tokens';

const PERCENT = 100;

export function OVRCardScreen() {
  const { ovr, badges, archetypes, debrief } = useAppState();
  const nav = useNavigation();

  if (!ovr) {
    return (
      <ScreenFrame testID="screen-ovr" kicker="Player card" title="No results yet">
        <NavBackButton />
        <Text testID="ovr-empty" style={styles.body}>
          Finish a drill in the Combine to generate your overall rating.
        </Text>
        <HudButton testID="ovr-to-combine" label="Go to combine" onPress={() => nav.goBack()} variant="secondary" />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      testID="screen-ovr"
      kicker="Player card"
      title="Overall rating"
      footer={
        <View style={styles.footerRow}>
          <View style={styles.flex}>
            <HudButton testID="ovr-group" label="Group" variant="secondary" onPress={() => nav.navigate('GroupSession')} />
          </View>
          <View style={styles.flex}>
            <HudButton testID="ovr-share" label="Share highlight" onPress={() => nav.navigate('HighlightShare')} />
          </View>
        </View>
      }
    >
      <NavBackButton />
      <HudPanel accent>
        <View style={styles.heroRow}>
          <Text testID="ovr-value" style={styles.hero} accessibilityLabel={`Overall rating ${ovr.ovr.toFixed(1)}`}>
            {ovr.ovr.toFixed(1)}
          </Text>
          <View style={styles.heroMeta}>
            <Text testID="ovr-band" style={styles.band}>
              {ovr.band.toUpperCase()}
            </Text>
            <Text testID="ovr-position" style={styles.position}>
              {ovr.position}
            </Text>
          </View>
        </View>
      </HudPanel>

      <HudPanel title="Attributes">
        {ATTRIBUTE_KEYS.map((key) => (
          <StatBar key={key} testID={`attr-${key}`} label={ATTRIBUTE_LABELS[key]} value={ovr.attributes[key]} />
        ))}
      </HudPanel>

      {badges.length > 0 ? (
        <HudPanel title="Badges">
          <View style={styles.badgeRow}>
            {badges.map((b) => (
              <View key={b.id} testID={`badge-${b.id}`} style={styles.badge} accessibilityLabel={`${b.label}: ${b.description}`}>
                <Text style={styles.badgeLabel}>{b.label.toUpperCase()}</Text>
                <Text style={styles.badgeDesc}>{b.description}</Text>
              </View>
            ))}
          </View>
        </HudPanel>
      ) : null}

      <HudPanel title="Playing style match">
        {archetypes.map((m, i) => (
          <View key={m.archetype.id} testID={`archetype-${i}`} style={styles.archRow}>
            <View style={styles.flex}>
              <Text style={i === 0 ? styles.archTop : styles.archName}>{m.archetype.name}</Text>
              <Text style={styles.archTag}>{m.archetype.tagline}</Text>
            </View>
            <Text style={styles.archPct}>{Math.round(m.similarity * PERCENT)}%</Text>
          </View>
        ))}
      </HudPanel>

      <HudPanel title="Coach debrief">
        <Text testID="debrief-text" style={styles.body}>
          {debrief ? debrief.text : 'Coach is reviewing your session…'}
        </Text>
        {debrief ? <SectionLabel text={`Source · ${debrief.source}`} /> : null}
      </HudPanel>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.textSecondary, fontSize: typography.size.bodyLg },
  flex: { flex: 1 },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  hero: {
    color: colors.accent,
    fontFamily: typography.family.display,
    fontSize: typography.size.hero,
    fontWeight: typography.weight.black,
    letterSpacing: typography.letterSpacing.tight,
    ...typography.tabular,
  },
  heroMeta: { gap: spacing.xs, paddingBottom: spacing.md },
  band: {
    color: colors.telemetry,
    fontFamily: typography.family.mono,
    fontSize: typography.size.bodyLg,
    letterSpacing: typography.letterSpacing.hud,
    fontWeight: typography.weight.bold,
  },
  position: {
    color: colors.textPrimary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.title,
    fontWeight: typography.weight.black,
  },
  badgeRow: { gap: spacing.sm },
  badge: {
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHigh,
    padding: spacing.md,
    gap: spacing.xxs,
  },
  badgeLabel: {
    color: colors.crownGold,
    fontFamily: typography.family.mono,
    fontSize: typography.size.caption,
    letterSpacing: typography.letterSpacing.wide,
    fontWeight: typography.weight.bold,
  },
  badgeDesc: { color: colors.textSecondary, fontSize: typography.size.caption },
  archRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  archTop: { color: colors.accent, fontSize: typography.size.title, fontWeight: typography.weight.black },
  archName: { color: colors.textPrimary, fontSize: typography.size.bodyLg, fontWeight: typography.weight.medium },
  archTag: { color: colors.textMuted, fontSize: typography.size.caption },
  archPct: {
    color: colors.telemetry,
    fontFamily: typography.family.mono,
    fontSize: typography.size.title,
    fontWeight: typography.weight.bold,
    ...typography.tabular,
  },
});
