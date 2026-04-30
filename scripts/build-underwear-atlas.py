"""
Build a single combined sprite-sheet atlas from all PNGs in the underwear sheets folder.

Layout strategy
---------------
Each source sheet is placed as a full row (left-aligned) in a vertically-stacked atlas.
Canvas width  = max width across all sheets.
Canvas height = sum of all sheet heights.

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
    "<stem>": { "x": 0, "y": <int>, "width": <int>, "height": <int>, "file": "<orig-filename>" },
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

# Deterministic order: alphabetical by filename stem
INCLUDE_ORDER = sorted(UNDERWEAR_DIR.glob("*.png"), key=lambda p: p.stem)


def main() -> None:
    sheets: list[tuple[Path, Image.Image]] = []
    for path in INCLUDE_ORDER:
        img = Image.open(path).convert("RGBA")
        sheets.append((path, img))
        print(f"  {path.name}: {img.width}x{img.height}")

    atlas_w = max(img.width  for _, img in sheets)
    atlas_h = sum(img.height for _, img in sheets)
    print(f"\nAtlas canvas: {atlas_w}x{atlas_h}")

    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))

    manifest: dict = {"atlasWidth": atlas_w, "atlasHeight": atlas_h, "sheets": {}}

    y_cursor = 0
    for path, img in sheets:
        atlas.paste(img, (0, y_cursor))
        manifest["sheets"][path.stem] = {
            "x": 0,
            "y": y_cursor,
            "width": img.width,
            "height": img.height,
            "file": path.name,
        }
        print(f"  placed '{path.stem}' at y={y_cursor}")
        y_cursor += img.height

    atlas.save(OUT_IMAGE, "PNG")
    print(f"\nSaved atlas  → {OUT_IMAGE}")

    with open(OUT_JSON, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved manifest → {OUT_JSON}")


if __name__ == "__main__":
    main()
