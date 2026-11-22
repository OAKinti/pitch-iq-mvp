---
name: soccer-cv-math
description: Reference formulas for PitchIQ drill math — 8 Hz zero-phase Butterworth, Ball Mastery and Agility Shuttle state machines, position-weighted OVR with the 95–99.9 elite band, decoupled badges, and cosine archetype matching. Use when editing or reviewing anything in src/domain/.
---

Use this skill whenever you touch `src/domain/**` or tests under `src/__tests__/domain/**`; never invent thresholds that contradict it — change this file first if calibration demands it.

## 0. Ground rules
1. Pure TypeScript only. No React, timers, `Date.now()` or randomness without a seed.
2. Time always comes from `PoseFrame.timestampMs`, never frame counts.
3. Work in **image-height units**: `X = x · imageWidth / imageHeight`, `Y = y`. This keeps math aspect-correct for portrait and landscape.
4. Never read landmarks 1–10 (redacted face keypoints). Use `sanitizePoseFrame` on any externally supplied frame.
5. Every threshold below is a Day-1 prior; Day 7 field calibration may tune them here.

## 1. Butterworth low-pass (8 Hz @ 30 FPS)
1. Biquad via bilinear transform with pre-warping, Q = 1/√2:
   `K = tan(π·fc/fs) / C`, `norm = 1/(1 + √2·K + K²)`
   `b0 = K²·norm, b1 = 2·b0, b2 = b0, a1 = 2(K² − 1)·norm, a2 = (1 − √2·K + K²)·norm`
2. `C` is Winter's multi-pass correction: `C = (2^(1/n) − 1)^(1/4)`. Single pass `n = 1` → `C = 1`. Dual pass `n = 2` → `C ≈ 0.8022`.
3. **"4th-order zero-phase" = the biomechanics convention**: a 2nd-order section run forward then backward (`filtfilt`) with `n = 2` correction, so the combined −3 dB point stays at exactly 8 Hz (gain ≈ 0.707) and phase lag is zero.
4. `filtfilt`: odd-reflect pad `padLen = min(9, N − 1)` samples at each end (`2·x0 − x[i]`), initialise the Direct-Form-II-Transposed state to steady state for the first sample (`z2 = (b2 − a2)·x0`, `z1 = (b1 + b2 − a1 − a2)·x0`), filter forward, reverse, repeat, reverse, strip padding. `N < 2` → return a copy.
5. Live telemetry uses `createStreamingLowpass` (single pass, `n = 1`, causal). Final shuttle timing uses `zeroPhaseLowpass` on the buffered series.
6. Required tests: DC preserved; 1 Hz sine amplitude within 2 %; 8 Hz gain 0.707 ± 0.03 (measure on the middle of a long signal); 14 Hz attenuated below 0.2; zero phase (peak of filtered 2 Hz sine within one sample of the raw peak).

## 2. Ball Mastery state machine (`ball_mastery`)
Required joints: 23, 24 (hips), 25, 26 (knees), 27, 28 (ankles), 31, 32 (foot index). Visible when their mean visibility ≥ `minVisibility` (0.5).

Phases: `idle → calibrating → ready → active → complete`; `out_of_frame` overlays any phase except `complete` and returns to the prior phase.
1. **idle → calibrating** on the first visible frame (cue `calibrate_hold_still`).
2. **calibrating**: collect `calibrationFrames` (15) *consecutive* visible frames (an invisible frame restarts the count). Then compute per foot: `baselineY = median(mean(ankle.y, footIndex.y))`; `legLength = median(|hip.y − ankle.y|)` (mean of both sides); `bodyHeight = median(|shoulderMid.y − ankleMid.y|)`. → **ready** (cue `ready_go`).
3. **Lift height** per foot: `h = (baselineY − footY) / legLength`, smoothed with a per-foot causal 8 Hz streaming filter.
4. **Touch hysteresis** per foot: `down → up` when `h > liftThreshold (0.08)`; `up → down` when `h < landThreshold (0.03)` — that landing registers ONE touch at the frame timestamp.
5. **ready → active** when either foot first goes `up`; the clock starts at that frame.
6. **active → complete** when `elapsed ≥ durationMs` (30 000), cue `drill_complete`. Out-of-frame time still counts toward the clock; touches are not detected while out of frame.
7. Cues (each emitted once on its transition frame, `null` otherwise): `out_of_frame`, `back_in_frame`, `halfway` (elapsed ≥ duration/2), `ten_seconds` (elapsed ≥ duration − 10 s), `switch_feet` (last 6 touches all the same foot; re-arms after a touch from the other foot).
8. **Metrics**: `touchesPerMinute = touches / (durationMs / 60 000)`; `rhythmCv = std/mean` of inter-touch intervals (population std; 0 if < 3 touches); `footBalance = min(L,R)/max(L,R)` (0 if no touches); `hipSway = std(hipMid.X during active) / bodyHeight`; `touchTimestampsMs` relative to active start.
9. Snapshot: `count = touches`, `liveRate = touches / max(elapsed, 1 s) · 60 000`.

## 3. Agility Shuttle state machine (`agility_shuttle`)
Required joints: 11, 12, 23, 24, 27, 28. Signal: hip-centre `X` (image-height units). Speeds in body-heights/s; `m/s = bh/s · athleteHeightM · 0.80` (shoulder-to-ankle ≈ 80 % of stature).
1. Calibration identical in spirit to §2 (consecutive visible frames → `bodyHeight`). → **ready**.
2. **ready → active** when causal-filtered `|v| > startSpeedThreshold` (0.5 bh/s); start time = that frame.
3. **Turn detection (live)**: track the running extreme in the current direction. When `X` retreats from the extreme by > 0.15 bh AND `|extreme − lastTurnX| ≥ minLegSpanBodyHeights` (0.6), register a turn at the extreme's timestamp; one leg completes. Emit `final_push` when legs completed = `legs − 1`.
4. **Final leg ends** when, after travelling ≥ min span from the last turn, speed drops below `startSpeedThreshold`. → **complete** (cue `drill_complete`).
5. **Final metrics** from `zeroPhaseLowpass` of the buffered `X`: refine each boundary — turns = extremum within ±300 ms of the live estimate; start = first sample with zero-phase speed > threshold; stop = first sample after the last turn + min span with speed < threshold. `splitTimesMs` = boundary differences; `totalTimeMs` = stop − start; `peakSpeedMps` = max central-difference speed; `meanTurnTimeMs` = mean contiguous time around each turn where speed < 0.35 · peak; `splitCv` = std/mean; `fatigueIndex = last/first − 1`.
6. Snapshot: `count` = completed legs, `liveRate` = current speed m/s.

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
