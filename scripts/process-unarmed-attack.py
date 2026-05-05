"""
Process Unprocessed/ unarmed-attack sheets:
  - Chroma-key out the lime-green background
  - Extract only the TOP ROW (3 frames of 512x512) per direction
  - Save as attack-{direction}.png 3-frame strips (1536x512) into sheets/underwear/

Run: python scripts/process-unarmed-attack.py
"""

import subprocess
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent.parent
UNPROCESSED = ROOT / "packages/web-client/public/sprites/hero/sheets/Unprocessed"
OUT_DIR = ROOT / "packages/web-client/public/sprites/hero/sheets/underwear"
CHROMA_SCRIPT = ROOT / "scripts/chroma-key-remove.py"

SRC_FW, SRC_FH = 512, 512
COLS = 3

# Filename → output direction key
DIR_MAP = {
    "unarmed-attack-east.png":       "east",
    "unarmed-attack-north.png":      "north",
    "unarmed-attack-south.png":      "south",
    "unarmed-attack-north-east.png": "northeast",
    "unarmed-attack-south-east.png": "southeast",
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for fname, dir_key in DIR_MAP.items():
        src = UNPROCESSED / fname
        if not src.exists():
            print(f"[skip] missing {src}")
            continue

        # Chroma-key to a temp file alongside the source.
        cleaned = src.with_name(src.stem + "-clean.png")
        print(f"[chroma] {src.name} → {cleaned.name}")
        subprocess.run(
            [sys.executable, str(CHROMA_SCRIPT), str(src), str(cleaned), "--color", "limegreen"],
            check=True,
        )

        # Crop top row.
        img = Image.open(cleaned).convert("RGBA")
        top_row = img.crop((0, 0, COLS * SRC_FW, SRC_FH))

        out_path = OUT_DIR / f"attack-{dir_key}.png"
        top_row.save(out_path, "PNG")
        print(f"[save] {out_path}  ({top_row.width}x{top_row.height})")

        cleaned.unlink()  # tidy

    print("\nDone.")


if __name__ == "__main__":
    main()
