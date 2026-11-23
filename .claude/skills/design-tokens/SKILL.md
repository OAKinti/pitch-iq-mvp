---
name: design-tokens
description: Enforces the PitchIQ dark-mode broadcast HUD design system from src/theme/tokens.ts and bans raw hex/rgba colors and magic spacing in screens and components. Use whenever creating or editing anything in src/screens, src/components, or App.tsx.
---

Use this skill before writing any UI in PitchIQ; every color, size, radius, font and duration comes from `src/theme/tokens.ts`.

## Visual direction: "live broadcast telemetry"
- **Surfaces:** obsidian `colors.bg` sits under carbon panels (`surface` → `surfaceRaised` → `surfaceHigh`). Panels get hairline `colors.border` edges and corner brackets, not drop shadows.
- **Accents:** use pitch-lime `colors.accent` for primary actions, "go" states and OVR. Use ice-cyan `colors.telemetry` for live numbers, skeleton joints and framing. Use amber `warning` for out-of-frame/caution and crimson `danger` for errors. Lime is a highlight, so keep it under about 10 % of any screen.
- **Typography:** labels are UPPERCASE `typography.family.mono` at `size.micro`/`caption` with `letterSpacing.hud`. Live numerals always spread `typography.tabular` so digits do not jitter. Hero numbers (OVR, timer) use `size.hero`/`display` with `weight.black`.
- **Motion:** Reanimated only. Press feedback uses `withSpring` to `motion.pressScale` with `motion.spring`. Number count-ups use `motion.duration.count`. Entering panels fade and translate over `motion.duration.base`. Never animate layout on every frame of a 30 FPS stream; animate derived values instead.
- **Anti-slop:** no purple gradients, no glassmorphism blobs, no emoji as icons, no centred-everything marketing layouts, no generic "Welcome!" hero. Density and hierarchy should feel like a TV sports graphics package.

## Steps
1. Import tokens: `import { colors, spacing, radii, borders, typography, sizes, motion, opacity } from '../theme/tokens';`.
2. Build styles with `StyleSheet.create` and token references only. `0`, `flex: 1`, percentage strings, `'auto'`, `StyleSheet.hairlineWidth` and `StyleSheet.absoluteFillObject` are fine. Any other number on a spacing/size/typography key is a violation.
3. Put a `testID` on every screen root and interactive element, matching `docs/INTERFACE_CONTRACTS.md`. Add `accessibilityRole` and `accessibilityLabel` to buttons and toggles. Touch targets must be at least `sizes.touchTarget`.
4. Reuse the shared components in `src/components/` (`HudPanel`, `HudButton`, `TelemetryReadout`, `StatBar`, `HudToggle`, `ScreenFrame`, `SectionLabel`) before making new ones.
5. If a value you need does not exist, stop. Tokens are frozen for slice builders: report the missing token instead of inlining a value. The orchestrator adds it to `tokens.ts` in a contract commit.
6. Run `npm run lint:tokens` and fix every violation before committing. Then run `npm run typecheck` and the UI tests.

## Contrast floor
`textPrimary`, `textSecondary` and `accent` text on `bg`/`surface` all pass WCAG AA. Use `textMuted` only for secondary captions of `size.caption` and above, never for body copy.
