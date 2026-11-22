"""PitchIQ panoramic shield — single source of truth for every CAD dimension (mm, degrees).

Run `python hardware/glasses/params.py` to print derived values and spec checks.
Stdlib only, so it runs anywhere; build scripts / build123d-mcp sessions import it.
"""
from __future__ import annotations

import math

# ── Shield / optics ───────────────────────────────────────────────────────
SHIELD_WIDTH_PROJECTED = 138.0  # front-view chord width
SHIELD_HEIGHT = 56.0            # along the (vertical) cylinder axis
BASE_CURVE = 6                  # ophthalmic base; R = 530 / base (n = 1.53 convention)
LENS_THICKNESS = 2.0            # clear polycarbonate sheet, cold-bent
PANTO_TILT_DEG = 10.0
FACE_FORM_TARGET_DEG = (15.0, 18.0)
VERTEX_MM = (12.0, 14.0)
PD_MM = 63.0
LENS_LIP_ENGAGEMENT = 1.5       # lens overlap onto the rear lip, per edge

# ── Frame / impact rules ──────────────────────────────────────────────────
BROW_WALL_MIN = 2.5
REAR_LIP_MIN = 2.0
LENS_GROOVE_EXTRA = 0.2         # groove width = LENS_THICKNESS + this
VENT_COUNT = 9
VENT_W = 1.5
VENT_L = 6.0
BUMPER_RECESS = 3.0

# ── Temples ───────────────────────────────────────────────────────────────
TEMPLE_LENGTH = 135.0
BALLAST_G_TOTAL = 25.0
STEEL_SHOT_DENSITY_G_CM3 = 7.8  # packed shot is lower (~4.5–5); see derived value

# ── Print (Formlabs Fuse 1+) ──────────────────────────────────────────────
ASSEMBLY_CLEARANCE = 0.30       # allowed band 0.25–0.35
ASSEMBLY_CLEARANCE_BAND = (0.25, 0.35)
MAX_Z_HEIGHT = 60.0
BED_XY = (165.0, 165.0)
MIN_WALL_NYLON11 = 0.8
MIN_WALL_TPU90A = 1.0
POWDER_ESCAPE_HOLE_MIN = 4.0

# ── Derived ───────────────────────────────────────────────────────────────
PC_COLD_CURVE_GUIDELINE_FACTOR = 100  # supplier rule of thumb: R_min ≈ 100 × t
PC_YIELD_STRAIN = 0.06
PACKED_SHOT_DENSITY_G_CM3 = 4.8


def radius(base: float = BASE_CURVE) -> float:
    return 530.0 / base


def half_angle_rad(base: float = BASE_CURVE) -> float:
    return math.asin((SHIELD_WIDTH_PROJECTED / 2) / radius(base))


def arc_length(base: float = BASE_CURVE) -> float:
    return 2 * radius(base) * half_angle_rad(base)


def sagitta(base: float = BASE_CURVE) -> float:
    r = radius(base)
    return r - math.sqrt(r * r - (SHIELD_WIDTH_PROJECTED / 2) ** 2)


def wrap_at_pupil_deg(base: float = BASE_CURVE) -> float:
    return math.degrees(math.asin((PD_MM / 2) / radius(base)))


def lens_strain(base: float = BASE_CURVE, t: float = LENS_THICKNESS) -> float:
    return t / (2 * radius(base))


def ballast_cavity_cm3_per_temple() -> float:
    return BALLAST_G_TOTAL / 2 / PACKED_SHOT_DENSITY_G_CM3


def report() -> list[tuple[str, str, bool | None]]:
    lo, hi = FACE_FORM_TARGET_DEG
    wrap = wrap_at_pupil_deg()
    r_min_guideline = PC_COLD_CURVE_GUIDELINE_FACTOR * LENS_THICKNESS
    eps = lens_strain()
    rows: list[tuple[str, str, bool | None]] = [
        ("radius R (530/base)", f"{radius():.1f} mm", None),
        ("shield sagitta (depth of curve)", f"{sagitta():.1f} mm", None),
        ("lens flat-pattern width (arc)", f"{arc_length():.1f} mm", None),
        ("lens flat-pattern width incl. lip", f"{arc_length() + 2 * LENS_LIP_ENGAGEMENT:.1f} mm", None),
        ("face-form wrap at pupils", f"{wrap:.1f}° (target {lo:.0f}–{hi:.0f}°)", lo <= wrap <= hi),
        ("lens outer-fibre strain t/2R", f"{eps * 100:.2f} % (PC yield ≈ {PC_YIELD_STRAIN * 100:.0f} %)", eps < PC_YIELD_STRAIN),
        ("cold-curve guideline R ≥ 100·t", f"R {radius():.1f} vs {r_min_guideline:.0f} mm", radius() >= r_min_guideline),
        ("ballast cavity per temple (packed shot)", f"{ballast_cavity_cm3_per_temple():.2f} cm³", None),
        ("clearance in band", f"{ASSEMBLY_CLEARANCE} mm", ASSEMBLY_CLEARANCE_BAND[0] <= ASSEMBLY_CLEARANCE <= ASSEMBLY_CLEARANCE_BAND[1]),
    ]
    for b in (4, 5, 6):
        rows.append((f"  alt base {b}: R / wrap / strain",
                     f"{radius(b):.1f} mm / {wrap_at_pupil_deg(b):.1f}° / {lens_strain(b) * 100:.2f} %", None))
    return rows


if __name__ == "__main__":
    for name, value, ok in report():
        flag = "     " if ok is None else (" OK  " if ok else " !!  ")
        print(f"{flag}{name:<42} {value}")
