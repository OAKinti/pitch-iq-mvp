/**
 * PitchIQ Broadcast HUD design tokens — the ONLY place raw colors and
 * magic numbers may live. `npm run lint:tokens` fails if a hex/rgba literal
 * or numeric spacing value appears in src/screens or src/components.
 *
 * Direction: dark-mode athletic broadcast telemetry. Obsidian/carbon surfaces,
 * electric pitch-lime for "go/primary", ice-cyan for live telemetry, amber for
 * warnings, crimson for errors. Numerals are tabular monospace.
 */
import { Platform } from 'react-native';

const palette = {
  obsidian950: '#07090B',
  obsidian900: '#0B0E11',
  carbon850: '#10151A',
  carbon800: '#151B21',
  carbon700: '#1D252D',
  carbon600: '#2A343E',
  slate400: '#7D8A97',
  slate300: '#A3AFBA',
  frost100: '#E8EEF2',
  white: '#FFFFFF',
  lime500: '#C6FF00',
  lime400: '#D4FF3D',
  lime900: '#2C3A00',
  cyan400: '#38E1FF',
  cyan900: '#06303A',
  amber400: '#FFB547',
  crimson500: '#FF3D5A',
  gold400: '#FFD54A',
  silver300: '#C9D3DC',
  transparent: 'transparent',
  scrim: 'rgba(7, 9, 11, 0.72)',
  limeGlow: 'rgba(198, 255, 0, 0.18)',
  cyanGlow: 'rgba(56, 225, 255, 0.16)',
  gridLine: 'rgba(232, 238, 242, 0.06)',
} as const;

export const colors = {
  bg: palette.obsidian950,
  surface: palette.obsidian900,
  surfaceRaised: palette.carbon850,
  surfaceHigh: palette.carbon800,
  border: palette.carbon700,
  borderStrong: palette.carbon600,
  gridLine: palette.gridLine,
  scrim: palette.scrim,

  textPrimary: palette.frost100,
  textSecondary: palette.slate300,
  textMuted: palette.slate400,
  textOnAccent: palette.obsidian950,

  accent: palette.lime500,
  accentPressed: palette.lime400,
  accentDim: palette.lime900,
  accentGlow: palette.limeGlow,

  telemetry: palette.cyan400,
  telemetryDim: palette.cyan900,
  telemetryGlow: palette.cyanGlow,

  warning: palette.amber400,
  danger: palette.crimson500,
  crownGold: palette.gold400,
  crownSilver: palette.silver300,

  skeletonJoint: palette.cyan400,
  skeletonBone: palette.lime500,

  transparent: palette.transparent,
  white: palette.white,
} as const;

/** 4-pt spacing scale. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  gutter: 16,
} as const;

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 14,
  pill: 999,
} as const;

export const borders = {
  hairline: 1,
  thick: 2,
  accent: 3,
} as const;

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const display = Platform.select({ ios: 'System', android: 'sans-serif-condensed', default: 'System' });

export const typography = {
  family: { mono, display },
  size: {
    micro: 10,
    caption: 12,
    body: 14,
    bodyLg: 16,
    title: 20,
    headline: 28,
    display: 44,
    hero: 88,
  },
  lineHeight: {
    tight: 1.05,
    normal: 1.35,
  },
  weight: {
    regular: '400',
    medium: '600',
    bold: '800',
    black: '900',
  },
  letterSpacing: {
    tight: -0.5,
    normal: 0,
    wide: 1.2,
    hud: 2.4,
  },
  /** Spread into any Text style that renders live numbers. */
  tabular: { fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
} as const;

export const sizes = {
  touchTarget: 48,
  buttonHeight: 52,
  iconSm: 16,
  iconMd: 24,
  jointDot: 8,
  statBarHeight: 6,
  hudCorner: 14,
  telemetryMinWidth: 96,
  stageAspect: 0.75,
  ovrCardWidth: 300,
  avatar: 36,
  progressHeight: 8,
  toggleWidth: 52,
  toggleHeight: 30,
  toggleKnob: 24,
} as const;

export const motion = {
  duration: { instant: 90, fast: 160, base: 240, slow: 420, count: 900 },
  pressScale: 0.96,
  spring: { damping: 18, stiffness: 220, mass: 0.8 },
} as const;

export const opacity = {
  disabled: 0.4,
  muted: 0.64,
  full: 1,
} as const;

export const zIndex = { base: 0, overlay: 10, toast: 20 } as const;

/** Instagram Stories pasteboard background gradient (hex strings required by IG). */
export const shareColors = {
  storyTop: palette.obsidian900,
  storyBottom: palette.carbon800,
} as const;

export const tokens = {
  colors,
  spacing,
  radii,
  borders,
  typography,
  sizes,
  motion,
  opacity,
  zIndex,
  shareColors,
} as const;
export type Tokens = typeof tokens;
export default tokens;
