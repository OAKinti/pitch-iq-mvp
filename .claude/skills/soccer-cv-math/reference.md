# soccer-cv-math — reference tables (§4–§9)

Companion to SKILL.md. These values are the Day-1 priors implemented in src/domain/; tests in src/__tests__/domain/ derive expectations from them.

## 4. Attributes (piecewise-linear anchors, clamp to [0, 99.9])
Missing drill ⇒ attribute = `NEUTRAL_ATTRIBUTE` (50). Multiple results of the same drill ⇒ best value per attribute.
| Attribute | Metric | Anchors (metric → rating) |
|---|---|---|
| ballControl | touchesPerMinute | 30→35, 60→55, 90→75, 120→90, 150→99 |
| rhythm | rhythmCv (lower better) | 0.40→30, 0.25→55, 0.15→75, 0.08→90, 0.04→99 |
| balance | mean of footBalance (0.5→40, 0.8→70, 1.0→95) and hipSway (0.10→40, 0.05→70, 0.02→95) | |
| pace | peakSpeedMps | 2.5→35, 4→55, 5.5→75, 7→90, 8.5→99 |
| agility | meanTurnTimeMs (lower better) | 900→35, 650→55, 450→75, 300→90, 200→99 |
| endurance | fatigueIndex (lower better) | 0.30→30, 0.15→55, 0.08→75, 0.03→90, 0→99 |
Outside the anchor range, hold the end value (then clamp).

## 5. OVR
1. `raw = Σ w_pos[k] · a[k]`, weights sum to 1:
   | | PAC | AGI | CTL | BAL | RHY | END |
   |---|---|---|---|---|---|---|
   | GK | .10 | .30 | .10 | .25 | .10 | .15 |
   | DEF | .20 | .20 | .10 | .25 | .05 | .20 |
   | MID | .10 | .15 | .25 | .10 | .20 | .20 |
   | FWD | .30 | .20 | .20 | .10 | .10 | .10 |
2. **Elite band** `compressEliteBand(raw)`: `raw ≤ 95 → raw`; else `95 + 4.9 · (1 − e^(−(raw − 95)/4.9))`. Continuous, slope 1 at 95, strictly < 99.9. Clamp final to [0, 99.9].
3. `band`: `< 60` developing, `< 95` standard, else elite. Round `ovr` to 1 decimal.

## 6. Badges (decoupled — never read OVR, never feed OVR)
metronome `rhythmCv ≤ 0.08 && touches ≥ 20` · quick_feet `touchesPerMinute ≥ 100` · two_footed `footBalance ≥ 0.9 && touches ≥ 20` · rock_solid `hipSway ≤ 0.03` · brake_master `meanTurnTimeMs ≤ 350` · engine `fatigueIndex ≤ 0.05 && splits ≥ 4` · burst `peakSpeedMps ≥ 6.5`. Return each badge at most once, catalogue order.

## 7. Archetypes — cosine similarity
1. For vectors a, b in `ATTRIBUTE_KEYS` order: subtract each vector's own mean (shape, not level), L2-normalise, dot product. Zero norm ⇒ similarity 0.
2. `PRO_ARCHETYPES` (generic, no real player names — right-of-publicity safe):
   maestro [60,70,95,75,92,70] · speedster [97,82,65,60,62,70] · engine [75,70,72,75,75,96] · wall [70,72,58,96,65,85] · magician [80,96,92,70,80,62] · sweeper_keeper [65,92,60,90,60,72]
3. `matchArchetypes` sorts by similarity desc, ties by id asc, returns top k (default 3).

## 8. Age gate, crowns, rivalry, highlights
1. `classifyAge(year, month, now)`: integers only, month 1–12, not in the future, ≤ 120 years; else `null`. Conservative month math: `age = nowYear − year − (nowMonth ≤ month ? 1 : 0)` (born this month counts as not-yet-birthday). `<13` under_13, `<18` teen_13_17, else adult_18_plus. Under-13 ⇒ `private` + parental consent required.
2. `computeCrowns`: performance = max `bestOvr` (ties → first in input); consistency = most distinct `activeDays` in `(now − 90 d, now]` (ties → first). Empty input or zero days ⇒ `null`.
3. `computeRivalry`: `gap = max(0, round1(rival − me + 0.1))` when behind, else 0; `progress = ahead ? 1 : clamp(me / (rival + 0.1), 0, 1)`; description e.g. `"Gain 2.4 OVR to pass Sam"` / `"You lead Sam — defend it"`.
4. `selectPeakStreakWindow`: candidate starts = each event time clamped to `[0, max(0, total − window)]`; count events in `[start, start + window)`; max count, ties → earliest. `total < window` ⇒ `[0, total]`.

## 9. Mock pose generator
1. Seeded `mulberry32` PRNG + Box–Muller noise (σ = `noise`, default 0.004). Same options ⇒ byte-identical frames.
2. `ball_mastery`: portrait 720×1280, standing skeleton; alternating L/R half-sine foot lifts (amplitude ≈ 0.15 leg lengths, pulse width 60 % of the touch interval) at `touchesPerSecond` after `startDelayMs` (1000); small hip sway.
3. `agility_shuttle`: landscape 1280×720, whole skeleton translated between two x positions with cosine easing over `legDurationMs` per leg; each leg must span ≥ 1.5 body-heights; stand still after the final leg.
4. Inside `outOfFrameWindowMs`, all visibilities = 0.1. Face landmarks 1–10 always redacted.
5. Engines driven by the mock must reproduce configured parameters within tolerance (e.g. 2.5 touches/s × 30 s ⇒ 75 ± 3 touches; 6 legs ⇒ splits ≈ legDurationMs ± 10 %). Tests assert this — never hard-code expected outputs.
