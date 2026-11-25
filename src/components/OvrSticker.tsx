import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { STICKER_SPEC } from '../services';
import { borders, colors, radii, spacing, typography } from '../theme/tokens';
import { ATTRIBUTE_LABELS, ATTRIBUTE_KEYS, type Badge, type OvrResult } from '../types/contracts';

export interface OvrStickerProps {
  ovr: OvrResult;
  badges: readonly Badge[];
  testID?: string;
}

const MAX_BADGES = 3;

/** Transparent 4:3 card captured to a 640x480 PNG for Stories / Reels / TikTok. */
export const OvrSticker = forwardRef<React.ComponentRef<typeof View>, OvrStickerProps>(function OvrSticker(
  { ovr, badges, testID = 'ovr-sticker' },
  ref,
) {
  return (
    <View ref={ref} collapsable={false} testID={testID} style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.brand}>PITCHIQ</Text>
        <Text testID="ovr-sticker-value" style={styles.value}>
          {ovr.ovr.toFixed(1)}
        </Text>
        <Text testID="ovr-sticker-band" style={styles.band}>
          {ovr.band.toUpperCase()}
        </Text>
        <Text testID="ovr-sticker-position" style={styles.position}>
          {ovr.position}
        </Text>
        <View style={styles.attrs}>
          {ATTRIBUTE_KEYS.map((key) => (
            <View key={key} style={styles.attr}>
              <Text style={styles.attrLabel}>{ATTRIBUTE_LABELS[key]}</Text>
              <Text style={styles.attrValue}>{Math.round(ovr.attributes[key])}</Text>
            </View>
          ))}
        </View>
        {badges.length > 0 ? (
          <View style={styles.badges}>
            {badges.slice(0, MAX_BADGES).map((b) => (
              <Text key={b.id} style={styles.badge}>
                {b.label}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    width: '100%',
    maxWidth: STICKER_SPEC.width,
    aspectRatio: STICKER_SPEC.width / STICKER_SPEC.height,
    backgroundColor: colors.transparent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
    borderWidth: borders.thick,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  brand: {
    color: colors.textSecondary,
    fontFamily: typography.family.display,
    fontSize: typography.size.caption,
    letterSpacing: typography.letterSpacing.hud,
    fontWeight: typography.weight.bold,
  },
  value: {
    color: colors.accent,
    fontFamily: typography.family.display,
    fontSize: typography.size.hero,
    fontWeight: typography.weight.black,
    ...typography.tabular,
  },
  band: {
    color: colors.textPrimary,
    fontFamily: typography.family.display,
    fontSize: typography.size.bodyLg,
    letterSpacing: typography.letterSpacing.wide,
    fontWeight: typography.weight.bold,
  },
  position: {
    color: colors.textSecondary,
    fontFamily: typography.family.display,
    fontSize: typography.size.body,
    fontWeight: typography.weight.medium,
  },
  attrs: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  attr: { alignItems: 'center' },
  attrLabel: {
    color: colors.textSecondary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.micro,
  },
  attrValue: {
    color: colors.textPrimary,
    fontFamily: typography.family.mono,
    fontSize: typography.size.bodyLg,
    fontWeight: typography.weight.bold,
    ...typography.tabular,
  },
  badges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  badge: {
    color: colors.textPrimary,
    fontFamily: typography.family.display,
    fontSize: typography.size.caption,
    fontWeight: typography.weight.medium,
  },
});
