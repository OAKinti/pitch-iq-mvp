---
name: eyewear-cad-rulebook
description: Parametric CAD playbook for the PitchIQ Oakley-style 6-base cylindrical panoramic shield — build123d-mcp workflow, impact/fit rules, 4-part Formlabs Fuse 1+ SLS split, PNG inspection, validate(), STEP/STL/DXF export. Use for any work in hardware/glasses/.
---

Use this skill for every hardware-track task; never model the glasses from memory or with magic numbers outside `hardware/glasses/params.py`.

## 0. Safety framing (state this in every hardware report)
This is an unvalidated prototype. It is NOT certified eye protection (ASTM F803 / F3164 sports eyewear) until it has passed an impact test. Never call it "protective" in UI copy or docs.

## 1. Parameters — `hardware/glasses/params.py` (single source of truth)
| Name | Value | Notes |
|---|---|---|
| `SHIELD_WIDTH_PROJECTED` | 138 mm | front-view chord width |
| `SHIELD_HEIGHT` | 56 mm | along the cylinder axis (flat vertically) |
| `BASE_CURVE` | 6 | `R = 530 / BASE_CURVE` ⇒ 88.3 mm |
| `LENS_THICKNESS` | 2.0 mm | clear polycarbonate sheet, cold-bent |
| `BROW_WALL_MIN` | 2.5 mm | upper brow / rim |
| `REAR_LIP_MIN` | 2.0 mm | stepped rear lens-locking lip |
| `PANTO_TILT_DEG` | 10° | cylinder axis tilted, bottom toward face |
| `FACE_FORM_TARGET_DEG` | 15–18° | measured at the pupils (see §2) |
| `VERTEX_MM` | 12–14 mm | cornea to lens back surface |
| `PD_MM` | 63 mm | design pupillary distance |
| `VENT_COUNT`, `VENT_W`, `VENT_L` | 9, 1.5 mm, 6 mm | perimeter anti-fog slots |
| `BUMPER_RECESS` | 3.0 mm | inner brow/nose recess for the TPU part |
| `TEMPLE_LENGTH` | 135 mm | wrap temples with rear strap slots |
| `BALLAST_G_TOTAL` | 25 g | ≈ 3.2 cm³ steel shot total, split across both temples |
| `ASSEMBLY_CLEARANCE` | 0.30 mm | allowed 0.25–0.35 |
| `MAX_Z_HEIGHT` | 60 mm | per part, as oriented for printing |
`python hardware/glasses/params.py` prints derived values and spec checks.

## 2. Known spec conflicts — resolve before Rev-0.1 geometry
1. **Wrap vs. base curve.** On a cylinder of radius R, the face-form angle at a pupil offset x = PD/2 from the axis is `asin(x / R)`. 6-base (R 88.3) ⇒ `asin(31.5/88.3)` ≈ **20.9°**, not 15–18°. A 5-base (R 106 mm) gives ≈ 17.3°. Do not hack the geometry to fake both numbers. Model `BASE_CURVE` as a parameter and print the wrap check. The human picks the value in `SPRINT_STATE.md`. The default stays 6-base, as specified.
2. **Cold-bend strain.** Outer-fibre strain is `ε = t / (2R)`. 2.0 mm on R 88.3 gives ε ≈ 1.13 %. That is far below PC yield (~6 %). It is tighter than the common supplier guideline (minimum cold-curve radius ≈ 100 × t = 200 mm), so crazing under sweat, sunscreen or cleaners is a real risk. Before final assembly, bend a coupon of the actual sheet and leave it for 24 h. Fallbacks: 1.0 mm sheet (ε 0.57 %), a 5-base curve, or thermoforming on a printed buck.

## 3. Modelling steps (build123d via MCP `execute()`)
1. `install_skill(target="claude", skill="modeling")` once per machine if the server offers it.
2. Run `params.py` and paste the derived-value printout into the revision notes.
3. **Shield datum:** build a cylinder of radius R. Tilt its axis `PANTO_TILT_DEG` about X. Then trim it with a front-view outline: 138 × 56 mm projected, with a nose bridge cut-out and an Oakley-style swept brow. The outline is a spline in front-view coordinates, projected onto the cylinder.
4. **Frame chassis (Nylon 11):** offset a rim band around the lens aperture. Brow wall ≥ `BROW_WALL_MIN`. Add a stepped rear lip ≥ `REAR_LIP_MIN` deep, sitting *behind* the lens, so ball impact loads the frame and the lens can never be pushed toward the eye. Add a front retention groove 0.2 mm wider than `LENS_THICKNESS`. Add 9 vent slots on the perimeter, never in the optical zone. Add the 3 mm inner brow/nose recess with snap undercuts. Add temple hinge knuckles or snap sockets with `ASSEMBLY_CLEARANCE`.
5. **Temples ×2 (Nylon 11):** 135 mm wrap following the head curve. Put a rear elastic-strap slot at the tip. Add a hollow ballast cavity of about 1.6 cm³ each, either open-ended with a press-fit plug or with two Ø ≥ 4 mm powder-escape holes. Mirror for left/right; never model them separately.
6. **Bumper (TPU 90A):** a continuous brow-plus-nose cushion that snaps into the 3 mm recess, with 2–3 mm compressible ribs facing the face.
7. **Lens flat pattern:** unroll the aperture outline plus 1.5 mm of lip engagement per edge. Use `(θ, z) → (R·θ, z)`. Arc length is computed (≈ 158 mm for a 138 mm chord at 6-base); never type it in by hand. Export it as DXF in mm, with the outer outline as a single closed polyline.
8. `show()` each part under a stable name: `frame`, `temple_l`, `temple_r`, `bumper`, `lens_flat`.

## 4. Inspection gates (every revision)
1. Render isometric, front, side and top PNGs for the assembly and for each part. Open each PNG and look at it, checking the brow sweep, lip continuity, vent placement and hinge alignment. Save the images to `hardware/glasses/renders/rev-x.y/`.
2. Run `validate()` on every part. It must report a valid, closed, manifold solid with positive volume. Record the output verbatim.
3. Measure with `inspect_features` or bounding boxes: minimum brow wall, lip depth, vertex distance on a 63 mm PD headform proxy, wrap at the pupils, and Z-height in print orientation. Each part must be under `MAX_Z_HEIGHT` and the XY footprint must fit 165 × 165 mm (Fuse 1+ bed).
4. Check clearances. Mate the bumper and temples to the frame. The interference volume must be 0, with the gap within 0.25–0.35 mm.

## 5. Print & export (Formlabs Fuse 1+, Penn State OriginLabs)
1. **Orientation:** lay the frame on its back (front-view XY), so Z ≈ shield depth + rim < 60 mm. Lay the temples flat. SLS needs no supports, but keep walls ≥ 0.8 mm (Nylon 11) and ≥ 1.0 mm (TPU).
2. **Materials:** Nylon 11 for frame and temples, TPU 90A for the bumper. Nylon 11 and TPU are different powders and run in **separate builds**. Tell OriginLabs. If TPU is not available before closure, fall back to a die-cut EVA foam strip.
3. **Exports** go to `hardware/glasses/exports/rev-x.y/`: `assembly.step`, `frame_nylon11.stl`, `temple_left_nylon11.stl`, `temple_right_nylon11.stl`, `bumper_tpu90a.stl` (STL in mm, tolerance ≤ 0.01 mm), and `lens_flat_pc2mm.dxf`.
4. Write `hardware/glasses/exports/rev-x.y/PRINT_ORDER.md`. List each part with material, quantity, bounding box, volume and orientation, plus the "unvalidated prototype" note.

## 6. Revisions
- Rev-0.1: first full 4-part geometry, all gates run.
- Rev-0.2: fixes from Rev-0.1 inspection (wall, lip, vents, clearance). This is the revision submitted at HUMAN GATE 2.
- Rev-0.3 (Day 6): changes after the foam-headform ball-impact test.
Log each revision in `hardware/glasses/CHANGELOG.md`, with parameter deltas and the gate outputs, and update `SPRINT_STATE.md` per the `sprint-handoff` skill.

## 7. If the MCP server is not connected
Say so explicitly. Fall back to a local script, `uv run --python 3.12 --with build123d hardware/glasses/build.py`, which exports the same files and renders PNGs through `build123d`'s exporters. Never report a render or validation that did not actually run.
