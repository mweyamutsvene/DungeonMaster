"""
Stitch hero sprite animation frames into sprite sheets.
Layout: rows = directions (south, north, east, west), columns = frames (left→right)
Output: one PNG per animation in the sprite root folder.
"""

import json
import os
from pathlib import Path
from PIL import Image

SPRITE_ROOT = Path(__file__).parent.parent / "packages/web-client/public/sprites/hero"
METADATA_FILE = SPRITE_ROOT / "metadata.json"

def stitch_animation(name: str, directions: dict[str, list[str]], frame_size: tuple[int, int]) -> None:
    dir_order = ["south", "north", "east", "west"]
    present = [d for d in dir_order if d in directions]

    frame_count = max(len(directions[d]) for d in present)
    fw, fh = frame_size
    sheet_w = frame_count * fw
    sheet_h = len(present) * fh

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    for row, direction in enumerate(present):
        for col, rel_path in enumerate(directions[direction]):
            frame_path = SPRITE_ROOT / rel_path
            with Image.open(frame_path) as frame:
                frame = frame.convert("RGBA")
                sheet.paste(frame, (col * fw, row * fh))

    out_path = SPRITE_ROOT / f"{name}.png"
    sheet.save(out_path, "PNG")
    print(f"  Saved {out_path.name}  ({sheet_w}x{sheet_h}, {len(present)} rows × {frame_count} cols)")

def main() -> None:
    with open(METADATA_FILE) as f:
        meta = json.load(f)

    fw = meta["character"]["size"]["width"]
    fh = meta["character"]["size"]["height"]
    animations: dict[str, dict[str, list[str]]] = meta["frames"]["animations"]

    print(f"Frame size: {fw}x{fh}")
    print(f"Animations found: {list(animations.keys())}\n")

    for anim_name, directions in animations.items():
        print(f"Stitching '{anim_name}' ...")
        stitch_animation(anim_name, directions, (fw, fh))

    print("\nDone.")

if __name__ == "__main__":
    main()
