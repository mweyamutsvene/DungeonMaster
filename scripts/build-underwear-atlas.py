"""
Build a single combined sprite-sheet atlas from all PNGs in the underwear sheets folder.

Layout strategy
---------------
Packed layout to minimise vertical space:

  Row 1  neutral-idle-8dir      1776 × 888   (full width)
  Row 2  female-hero-profile    1369 × 1149  (left-aligned)
  Row 3  running-east-west       1026 × 384  + attack-east / attack-west  stacked (513 × 192 each)
  Row 4  running-ne-nw           1026 × 384  + attack-northeast / attack-northwest
  Row 5  running-north-south     1026 × 384  + attack-north / attack-south
  Row 6  running-se-sw           1026 × 384  + attack-southeast / attack-southwest

Each run sheet is exactly 384 px tall = 2 × 192, so two attack strips stack perfectly in
the 750 px right gutter (1776 − 1026 = 750 ≥ 513).

Canvas: 1776 × 3573  (vs the previous 1776 × 5109 — saves ~1536 px / ~30 %)

Outputs
-------
  packages/web-client/public/sprites/hero/sheets/underwear-atlas.png
  packages/web-client/public/sprites/hero/sheets/underwear-atlas.json

JSON manifest format
--------------------
{
  "atlasWidth": <int>,
  "atlasHeight": <int>,
  "sheets": {
    "<stem>": { "x": <int>, "y": <int>, "width": <int>, "height": <int>, "file": "<orig-filename>" },
    ...
  }
}
"""

import json
from pathlib import Path
from PIL import Image

UNDERWEAR_DIR = (
    Path(__file__).parent.parent
    / "packages/web-client/public/sprites/hero/sheets/underwear"
)
OUT_IMAGE = UNDERWEAR_DIR.parent / "underwear-atlas.png"
OUT_JSON  = UNDERWEAR_DIR.parent / "underwear-atlas.json"

ATK_H = 192   # height of one attack strip
RUN_W = 1026  # width of every run sheet


def load(stem: str) -> Image.Image:
    path = UNDERWEAR_DIR / f"{stem}.png"
    img = Image.open(path).convert("RGBA")
    print(f"  loaded  {path.name}: {img.width}x{img.height}")
    return img


# Run rows paired with the two attack strips that share their right gutter.
# Pairing is directionally logical but functionally arbitrary (each sprite is
# independently addressed by its own manifest entry).
RUN_ATTACK_PAIRS: list[tuple[str, str, str]] = [
    ("running-east-west",    "attack-east",      "attack-west"),
    ("running-ne-nw",        "attack-northeast",  "attack-northwest"),
    ("running-north-south",  "attack-north",      "attack-south"),
    ("running-se-sw",        "attack-southeast",  "attack-southwest"),
]


def main() -> None:
    ATLAS_W = 1776  # locked by neutral-idle-8dir

    placements: list[tuple[str, int, int, Image.Image]] = []  # (stem, x, y, img)
    y = 0

    # Row 1 — full-width idle sheet
    img = load("neutral-idle-8dir")
    placements.append(("neutral-idle-8dir", 0, y, img))
    y += img.height   # 888

    # Row 2 — profile portrait, left-aligned
    img = load("female-hero-profile")
    placements.append(("female-hero-profile", 0, y, img))
    y += img.height   # 1149

    # Rows 3-6 — run sheet (1026 × 384) with two attack strips stacked in right gutter
    for run_stem, atk1_stem, atk2_stem in RUN_ATTACK_PAIRS:
        run_img  = load(run_stem)
        atk1_img = load(atk1_stem)
        atk2_img = load(atk2_stem)

        assert run_img.height == ATK_H * 2, (
            f"{run_stem}: expected height {ATK_H * 2}, got {run_img.height}"
        )
        assert run_img.width == RUN_W, (
            f"{run_stem}: expected width {RUN_W}, got {run_img.width}"
        )

        placements.append((run_stem,  0,          y,          run_img))
        placements.append((atk1_stem, RUN_W,      y,          atk1_img))  # top half
        placements.append((atk2_stem, RUN_W,      y + ATK_H,  atk2_img))  # bottom half
        y += run_img.height   # 384

    ATLAS_H = y
    print(f"\nAtlas canvas: {ATLAS_W}×{ATLAS_H}")

    atlas = Image.new("RGBA", (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
    manifest: dict = {"atlasWidth": ATLAS_W, "atlasHeight": ATLAS_H, "sheets": {}}

    for stem, x, yy, img in placements:
        atlas.paste(img, (x, yy))
        manifest["sheets"][stem] = {
            "x": x,
            "y": yy,
            "width":  img.width,
            "height": img.height,
            "file":   f"{stem}.png",
        }
        print(f"  placed  '{stem}' at ({x}, {yy})  {img.width}×{img.height}")

    atlas.save(OUT_IMAGE, "PNG")
    print(f"\nSaved atlas    → {OUT_IMAGE}")

    with open(OUT_JSON, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved manifest → {OUT_JSON}")


if __name__ == "__main__":
    main()
