"""
Transpose original hero heads onto a ChatGPT-restyled action-sprites sheet.

Strategy per frame cell (171×192 in the original coordinate space):
  1. Find the sprite bounding box in the original (non-background pixels).
  2. Define the head zone as the top HEAD_FRAC of the sprite's height.
  3. Build a vertical gradient mask: fully opaque at the top, fading to
     transparent at the bottom of the head zone (feather_rows of blend).
  4. Alpha-composite the original head region over the restyled frame.

The ChatGPT image is rescaled to exactly match the original canvas first,
then the result is saved as a new PNG.
"""

from __future__ import annotations
import numpy as np
from PIL import Image
from pathlib import Path

SHEETS_DIR  = Path("packages/web-client/public/sprites/hero/sheets")
ORIG_PATH   = SHEETS_DIR / "action-sprites.png"
GPT_PATH    = SHEETS_DIR / "bbdbaa4d-4946-4c5f-8a77-3bce82577ee7.png"
OUT_PATH    = SHEETS_DIR / "action-sprites-headed.png"

# Layout of action-sprites.png
FW, FH      = 171, 192   # frame cell size in original
RUN_COLS    = 6
RUN_ROWS    = 2
RUN_SHEETS  = 4          # stacked vertically on the left
ATK_COLS    = 3
ATK_ROWS    = 1
ATK_STRIPS  = 8          # stacked vertically on the right, x = 1026
RUN_W       = FW * RUN_COLS   # 1026
ATK_X       = RUN_W           # 1026

# Head compositing parameters
HEAD_FRAC   = 0.40   # top 40% of sprite bounding-box height is "head"
FEATHER     = 0.10   # bottom 10% of head zone fades out (blend seam)

# Background detection: treat near-white OR fully-transparent as background
BG_ALPHA_THRESH = 20    # alpha < this → background
BG_WHITE_THRESH = 230   # R,G,B all > this AND alpha > 0 → white background


def is_background(arr: np.ndarray) -> np.ndarray:
    """Return boolean mask (H,W) True where pixel is background."""
    if arr.shape[2] == 4:
        transparent = arr[:, :, 3] < BG_ALPHA_THRESH
        white = (
            (arr[:, :, 0] > BG_WHITE_THRESH) &
            (arr[:, :, 1] > BG_WHITE_THRESH) &
            (arr[:, :, 2] > BG_WHITE_THRESH)
        )
        return transparent | white
    else:
        # RGB only — treat near-white as background
        return (
            (arr[:, :, 0] > BG_WHITE_THRESH) &
            (arr[:, :, 1] > BG_WHITE_THRESH) &
            (arr[:, :, 2] > BG_WHITE_THRESH)
        )


def build_head_mask(orig_cell: np.ndarray) -> np.ndarray:
    """
    Return a float32 alpha mask (H,W) in [0,1] covering the head region.
    Fully 1 at the top, feathers to 0 at the bottom of the head zone.
    Returns None if the sprite has no visible content.
    """
    h, w = orig_cell.shape[:2]
    bg    = is_background(orig_cell)
    sprite_rows = np.where(~bg.all(axis=1))[0]
    if len(sprite_rows) == 0:
        return None

    top_row    = int(sprite_rows[0])
    bot_row    = int(sprite_rows[-1])
    sprite_h   = bot_row - top_row + 1

    head_bot   = top_row + int(sprite_h * HEAD_FRAC)
    feather_h  = max(1, int(sprite_h * FEATHER))
    fade_start = head_bot - feather_h

    mask = np.zeros((h, w), dtype=np.float32)
    # Fully opaque above fade zone
    if fade_start > top_row:
        mask[top_row:fade_start, :] = 1.0
    # Feather (linear fade) inside fade zone
    for r in range(fade_start, head_bot):
        if r < 0 or r >= h:
            continue
        frac = 1.0 - (r - fade_start) / feather_h
        mask[r, :] = frac

    # Zero out background pixels so we don't paint nothing over clothes
    mask[bg] = 0.0

    return mask


def composite_heads(orig: np.ndarray, styled: np.ndarray) -> np.ndarray:
    """Process all frame cells in-place on `styled` (copy). Returns result."""
    result = styled.copy().astype(np.float32)
    orig_f = orig.astype(np.float32)

    def process_cell(ox: int, oy: int):
        cell_orig = orig_f[oy:oy+FH, ox:ox+FW]
        mask = build_head_mask(orig[oy:oy+FH, ox:ox+FW])
        if mask is None:
            return
        m = mask[:, :, np.newaxis]          # (H,W,1)
        src = cell_orig                      # RGBA float
        dst = result[oy:oy+FH, ox:ox+FW]   # RGBA float
        result[oy:oy+FH, ox:ox+FW] = src * m + dst * (1.0 - m)

    # Run sheets (left side)
    for sheet_idx in range(RUN_SHEETS):
        base_y = sheet_idx * FH * RUN_ROWS
        for row in range(RUN_ROWS):
            for col in range(RUN_COLS):
                ox = col * FW
                oy = base_y + row * FH
                process_cell(ox, oy)

    # Attack strips (right side)
    for strip_idx in range(ATK_STRIPS):
        base_y = strip_idx * FH
        for col in range(ATK_COLS):
            ox = ATK_X + col * FW
            oy = base_y
            process_cell(ox, oy)

    return np.clip(result, 0, 255).astype(np.uint8)


def main():
    orig_img = Image.open(ORIG_PATH).convert("RGBA")
    gpt_img  = Image.open(GPT_PATH).convert("RGBA")

    OW, OH = orig_img.size
    print(f"Original : {OW}×{OH}")
    print(f"ChatGPT  : {gpt_img.width}×{gpt_img.height}")

    # Scale ChatGPT image to match original canvas exactly
    if gpt_img.size != (OW, OH):
        print(f"Rescaling ChatGPT image → {OW}×{OH} ...")
        gpt_img = gpt_img.resize((OW, OH), Image.LANCZOS)

    orig_arr = np.array(orig_img)
    gpt_arr  = np.array(gpt_img)

    print("Compositing heads ...")
    result_arr = composite_heads(orig_arr, gpt_arr)

    Image.fromarray(result_arr, "RGBA").save(OUT_PATH, "PNG")
    print(f"Saved → {OUT_PATH}")


if __name__ == "__main__":
    main()
