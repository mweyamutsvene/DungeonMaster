---
name: chroma-key-remove
description: 'Remove a solid chroma-key background color from a PNG sprite, making it transparent. USE FOR: cleaning AI-generated sprite sheets with lime green / hot pink / blue screen backgrounds, removing green fringe and blended edge pixels from pixel-art or painted sprites. DO NOT USE FOR: removing complex backgrounds, inpainting missing pixels, or resizing/cropping images.'
argument-hint: 'Path to the PNG file and optionally the background color (limegreen, hotpink, bluescreen, etc.)'
---

# Chroma-Key Background Removal

Remove a solid background color from a PNG, producing a transparent-background sprite ready for game use.

The authoritative script lives at:

```
scripts/chroma-key-remove.py
```

It uses a **two-pass approach** which handles both hard fills and blended fringe/edge pixels:

1. **Tolerance pass** — exact RGB match within ±N per channel (default ±40). Removes the solid background field.
2. **HSV hue sweep** — removes remaining fringe pixels that were blended between character and background at generation time. Targets only pixels whose hue falls in the background color's hue band AND whose saturation exceeds a floor (default 0.07).

## Quick Usage

```powershell
# Lime green (default) — saves to <input>-clean.png
python scripts/chroma-key-remove.py path/to/sprite.png

# Hot pink, explicit output
python scripts/chroma-key-remove.py path/to/sprite.png path/to/sprite-clean.png --color hotpink

# Custom hex color
python scripts/chroma-key-remove.py path/to/sprite.png --color "#00FF7F"

# Blue screen
python scripts/chroma-key-remove.py path/to/sprite.png --color bluescreen
```

## Built-in Color Presets

| Preset        | RGB              | Notes                                 |
|---------------|------------------|---------------------------------------|
| `limegreen`   | (147, 226, 38)   | AI-generated chroma key default       |
| `greenscreen` | (0, 177, 64)     | Classic broadcast green screen        |
| `bluescreen`  | (0, 119, 188)    | Classic broadcast blue screen         |
| `hotpink`     | (255, 0, 127)    | Hot pink / magenta chroma key         |
| `magenta`     | (255, 0, 255)    | Pure magenta                          |
| `white`       | (255, 255, 255)  | White background                      |
| `black`       | (0, 0, 0)        | Black background                      |

Unknown `--color` values are parsed as `#RRGGBB` hex and the hue sweep range is auto-derived.

## Tuning Flags

| Flag           | Default | Effect                                                         |
|----------------|---------|----------------------------------------------------------------|
| `--tolerance`  | 40      | Per-channel RGB tolerance for pass 1. Increase if BG varies.  |
| `--hue-sat`    | 0.07    | Minimum HSV saturation for pass 2. Lower = more aggressive.   |

### Typical Tuning Sequence (if green still visible)

Start with defaults. If fringe remains, progressively lower `--hue-sat`:

```powershell
# Default (usually sufficient)
python scripts/chroma-key-remove.py sprite.png

# Slightly more aggressive
python scripts/chroma-key-remove.py sprite.png --hue-sat 0.05

# Maximum (removes nearly all hue-matched pixels)
python scripts/chroma-key-remove.py sprite.png --hue-sat 0.02
```

> **Safety**: The hue sweep only removes pixels in the background's hue band. Character colors — skin (orange/red hue ~0.05), black outlines (zero saturation), brown hair (~0.07 hue) — do not fall in the green band (0.13–0.52) so they are never touched by the green presets.

## How It Was Derived

This algorithm was developed iteratively against an AI-generated pixel-art sprite with a lime green background (`female-hero-profile.png`, 1369×1149). After the tolerance pass removed the bulk (1.36M pixels), 4+ rounds of hue-sweep tuning were needed to clear:
- Fully saturated fringe (sv > 0.7, caught at hue 0.22–0.42)
- Dark near-black blended outline pixels (sv > 0.15, same hue band)
- Residual low-saturation tints (sv > 0.07, widened to 0.13–0.52)

The final clean image (`female-hero-profile-clean5.png`) had zero remaining green-hue pixels.

## Environment

Requires Python 3 + Pillow (already installed in the project venv):

```powershell
# Activate venv if not already active
& .venv\Scripts\Activate.ps1

python scripts/chroma-key-remove.py --help
```
