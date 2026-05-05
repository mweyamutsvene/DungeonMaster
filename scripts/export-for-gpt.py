"""
Export 4 direction-pair chunks from a character's source sheets for ChatGPT costuming.

Each chunk (1026×576) contains:
  - top    384px : run-direction pair (2 animation rows × 6 frames = 1026px wide)
  - bottom 192px : two matching attack strips side-by-side (3 frames × 2 = 1026px wide)

Usage
-----
    python scripts/export-for-gpt.py [base-name]
    python scripts/export-for-gpt.py underwear          # default

Reads source PNGs from:
    packages/web-client/public/sprites/hero/sheets/<base-name>/

Outputs 4 chunks to:
    assets/gpt-export/<base-name>/
        chunk-ew.png      (east + west run/attack pair)
        chunk-nenw.png    (northeast + northwest)
        chunk-ns.png      (north + south)
        chunk-sesw.png    (southeast + southwest)

Frame constants (must match source sheets):
    FW=171  FH=192  per frame cell
    Run sheet:   1026×384  (6 cols × 2 rows)
    Attack strip: 513×192  (3 cols × 1 row)
"""

from __future__ import annotations
import sys
import numpy as np
from PIL import Image
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_NAME   = sys.argv[1] if len(sys.argv) > 1 else "underwear"
SHEETS_ROOT = Path("packages/web-client/public/sprites/hero/sheets")
SRC_DIR     = SHEETS_ROOT / BASE_NAME
OUT_DIR     = Path("assets/gpt-export") / BASE_NAME

FW, FH      = 171, 192
RUN_COLS    = 6
ATK_COLS    = 3
CHUNK_W     = FW * RUN_COLS    # 1026
CHUNK_H     = FH * 3           # 576  (2 run rows + 1 combined attack row)

# Direction pairs: (chunk-slug, run-stem, atk-A-stem, atk-B-stem)
PAIRS: list[tuple[str, str, str, str]] = [
    ("ew",    "running-east-west",   "attack-east",      "attack-west"),
    ("nenw",  "running-ne-nw",       "attack-northeast", "attack-northwest"),
    ("ns",    "running-north-south", "attack-north",     "attack-south"),
    ("sesw",  "running-se-sw",       "attack-southeast", "attack-southwest"),
]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load(stem: str) -> np.ndarray:
    path = SRC_DIR / f"{stem}.png"
    img  = Image.open(path).convert("RGBA")
    print(f"  loaded  {path.name}  {img.width}×{img.height}")
    return np.array(img)


def make_chunk(run_arr: np.ndarray,
               atk_a_arr: np.ndarray,
               atk_b_arr: np.ndarray) -> Image.Image:
    """Combine run + two attack strips into one 1026×576 RGBA chunk."""
    chunk = np.zeros((CHUNK_H, CHUNK_W, 4), dtype=np.uint8)
    # Top 384px: run sheet (1026×384)
    chunk[0:FH*2, 0:CHUNK_W] = run_arr
    # Bottom 192px: attack-A left | attack-B right
    atk_w = FW * ATK_COLS   # 513
    chunk[FH*2:FH*3, 0:atk_w]        = atk_a_arr
    chunk[FH*2:FH*3, atk_w:CHUNK_W]  = atk_b_arr
    return Image.fromarray(chunk, "RGBA")


def main() -> None:
    if not SRC_DIR.is_dir():
        sys.exit(f"ERROR: source dir not found: {SRC_DIR}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Source : {SRC_DIR}")
    print(f"Output : {OUT_DIR}")
    print(f"Chunk  : {CHUNK_W}×{CHUNK_H} px\n")

    for slug, run_stem, atk_a_stem, atk_b_stem in PAIRS:
        print(f"--- chunk-{slug} ---")
        run_arr   = load(run_stem)
        atk_a_arr = load(atk_a_stem)
        atk_b_arr = load(atk_b_stem)

        # Validate dimensions
        assert run_arr.shape   == (FH*2, CHUNK_W, 4), \
            f"{run_stem}: expected {CHUNK_W}×{FH*2}, got {run_arr.shape[1]}×{run_arr.shape[0]}"
        assert atk_a_arr.shape == (FH, FW*ATK_COLS, 4), \
            f"{atk_a_stem}: expected {FW*ATK_COLS}×{FH}"
        assert atk_b_arr.shape == (FH, FW*ATK_COLS, 4), \
            f"{atk_b_stem}: expected {FW*ATK_COLS}×{FH}"

        chunk_img = make_chunk(run_arr, atk_a_arr, atk_b_arr)
        out_path  = OUT_DIR / f"chunk-{slug}.png"
        chunk_img.save(out_path, "PNG")
        print(f"  saved  {out_path}  {chunk_img.width}×{chunk_img.height}\n")

    print("Done. Upload the 4 chunks to ChatGPT with:")
    print()
    print('  "Apply [COSTUME NAME] to this sprite sheet character.')
    print('   The background is transparent. Do not resize the image."')
    print()
    print("Then place GPT outputs in:")
    print(f"  assets/gpt-export/{BASE_NAME}/costumed/chunk-ew.png  (etc.)")
    print("And run: python scripts/ingest-gpt-costume.py <costume-id>")


if __name__ == "__main__":
    main()
