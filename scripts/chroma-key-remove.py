#!/usr/bin/env python3
"""
chroma-key-remove.py — Remove a solid background color from a PNG, making it transparent.

Uses a multi-pass approach:
  1. Tolerance match  — removes exact background pixels within a per-channel tolerance
  2. HSV hue sweep    — removes green-fringe / blended edge pixels by hue + saturation

Works with any background color. Pre-configured presets for common chroma-key colors.

Usage:
  python scripts/chroma-key-remove.py <input.png> [output.png] [--color COLOR] [--tolerance N] [--hue-sat N]

Examples:
  # Remove lime green (default) from a file, save to *-clean.png
  python scripts/chroma-key-remove.py assets/sprite.png

  # Remove hot pink, custom output path
  python scripts/chroma-key-remove.py assets/sprite.png assets/sprite-clean.png --color hotpink

  # Remove a custom hex color
  python scripts/chroma-key-remove.py assets/sprite.png --color "#00FF00"

  # Remove blue screen
  python scripts/chroma-key-remove.py assets/sprite.png --color bluescreen

Color presets:
  limegreen   (147, 226, 38)   — AI-generated lime green chroma key
  greenscreen (0, 177, 64)     — Classic broadcast green screen
  bluescreen  (0, 119, 188)    — Classic broadcast blue screen
  hotpink     (255, 0, 127)    — Hot pink / magenta chroma key
  magenta     (255, 0, 255)    — Pure magenta
  white       (255, 255, 255)  — White background
  black       (0, 0, 0)        — Black background

Options:
  --color      Preset name or hex color like #RRGGBB (default: limegreen)
  --tolerance  Per-channel tolerance for exact match pass (default: 40)
  --hue-sat    Minimum saturation for HSV hue sweep pass (default: 0.07)
               Set to 1.0 to disable the hue sweep pass.
"""

import argparse
import colorsys
import sys
from pathlib import Path
from PIL import Image

# ── Presets ──────────────────────────────────────────────────────────────────

PRESETS: dict[str, tuple[int, int, int]] = {
    "limegreen":   (147, 226,  38),
    "greenscreen": (  0, 177,  64),
    "bluescreen":  (  0, 119, 188),
    "hotpink":     (255,   0, 127),
    "magenta":     (255,   0, 255),
    "white":       (255, 255, 255),
    "black":       (  0,   0,   0),
}

# Hue ranges (in HSV 0–1 scale) for each preset's fringe sweep
# These are widened slightly beyond the pure hue to catch blended edges.
PRESET_HUE_RANGES: dict[str, tuple[float, float]] = {
    "limegreen":   (0.13, 0.52),  # yellow-green to cyan-green
    "greenscreen": (0.22, 0.55),  # green to teal
    "bluescreen":  (0.52, 0.72),  # cyan to blue-purple
    "hotpink":     (0.88, 1.00),  # wraps: also check 0.0 to 0.05
    "magenta":     (0.83, 1.00),
    "white":       (0.00, 1.00),  # all hues at near-white (handled by value)
    "black":       (0.00, 1.00),  # all hues at near-black (handled by value)
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_color(color_str: str) -> tuple[int, int, int]:
    s = color_str.strip().lower()
    if s in PRESETS:
        return PRESETS[s]
    s = s.lstrip("#")
    if len(s) == 6:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    raise ValueError(f"Unknown color '{color_str}'. Use a preset name or hex like #FF0080.")


def hue_range_for(color_str: str, bg: tuple[int, int, int]) -> tuple[float, float]:
    s = color_str.strip().lower()
    if s in PRESET_HUE_RANGES:
        return PRESET_HUE_RANGES[s]
    # Derive hue range automatically from the BG color ±0.12
    h, _, _ = colorsys.rgb_to_hsv(bg[0] / 255, bg[1] / 255, bg[2] / 255)
    return (max(0.0, h - 0.12), min(1.0, h + 0.12))


# ── Passes ────────────────────────────────────────────────────────────────────

def pass_tolerance(pixels, w: int, h: int, bg: tuple[int, int, int], tol: int) -> int:
    """Remove pixels within `tol` of the background color on each channel."""
    br, bg_, bb = bg
    removed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0 and abs(r - br) < tol and abs(g - bg_) < tol and abs(b - bb) < tol:
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1
    return removed


def pass_hue_sweep(pixels, w: int, h: int, hue_lo: float, hue_hi: float, sat_floor: float, val_floor: float) -> int:
    """Remove pixels whose HSV hue falls in [hue_lo, hue_hi], saturation >= sat_floor, and value >= val_floor.

    The value (brightness) floor prevents dark edge pixels (e.g. black bikini blended with green
    background) from being mistakenly removed — they have high HSV saturation but near-zero value.
    """
    removed = 0
    wraps = hue_hi > 1.0 or hue_lo < 0.0  # handle hues that wrap around 0/1
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0:
                hv, sv, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                in_range = hue_lo <= hv <= hue_hi
                if wraps:
                    lo2 = hue_lo % 1.0
                    hi2 = hue_hi % 1.0
                    in_range = in_range or (hv >= lo2 or hv <= hi2)
                if in_range and sv >= sat_floor and vv >= val_floor:
                    pixels[x, y] = (0, 0, 0, 0)
                    removed += 1
    return removed


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Remove a chroma-key background color from a PNG, making it transparent.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input", help="Input PNG file path")
    parser.add_argument("output", nargs="?", help="Output PNG file path (default: <input>-clean.png)")
    parser.add_argument("--color", default="limegreen",
                        help="Background color: preset name or hex #RRGGBB (default: limegreen)")
    parser.add_argument("--tolerance", type=int, default=40,
                        help="Per-channel tolerance for exact-match pass (default: 40)")
    parser.add_argument("--hue-sat", type=float, default=0.07,
                        help="Min saturation for HSV hue sweep pass (default: 0.07). Set 1.0 to disable.")
    parser.add_argument("--hue-val", type=float, default=0.15,
                        help="Min brightness (HSV value) for hue sweep pass (default: 0.15). Prevents dark edge pixels from being removed.")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output) if args.output else input_path.with_stem(input_path.stem + "-clean")

    bg = parse_color(args.color)
    hue_lo, hue_hi = hue_range_for(args.color, bg)

    print(f"Input:       {input_path}")
    print(f"Output:      {output_path}")
    print(f"BG color:    rgb{bg}  ({args.color})")
    print(f"Tolerance:   ±{args.tolerance} per channel")
    print(f"Hue sweep:   {hue_lo:.2f}–{hue_hi:.2f}  (sat ≥ {args.hue_sat}, val ≥ {args.hue_val})")

    img = Image.open(input_path).convert("RGBA")
    pixels = img.load()
    w, h = img.size
    print(f"Image size:  {w}×{h}")

    n1 = pass_tolerance(pixels, w, h, bg, args.tolerance)
    print(f"Pass 1 (tolerance):  removed {n1:,} pixels")

    n2 = pass_hue_sweep(pixels, w, h, hue_lo, hue_hi, args.hue_sat, args.hue_val)
    print(f"Pass 2 (hue sweep):  removed {n2:,} pixels")

    total_removed = n1 + n2
    total_pixels = w * h
    print(f"Total removed: {total_removed:,} / {total_pixels:,} ({100*total_removed/total_pixels:.1f}%)")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, "PNG")
    print(f"Saved → {output_path}")


if __name__ == "__main__":
    main()
