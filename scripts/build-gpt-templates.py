"""
Build 1674x940 GPT-input templates with magenta background and per-frame
bounding boxes, embedding the underwear reference figure into each cell so
ChatGPT can re-render the figure clothed without ambiguity.

Outputs to: assets/gpt-export/<base>/templates/template-<slug>.png

Each template has 6 cols x 3 rows of cells:
  Row 1-2 : 6x2 running frames  (from running-<dir-pair>.png)
  Row 3   : 3 attack-A frames + 3 attack-B frames

Cell size in template = 1674/6 x 940/3 = 279 x ~313

Usage:
    python scripts/build-gpt-templates.py [base-name]   # default: underwear
"""

from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

BASE_NAME    = sys.argv[1] if len(sys.argv) > 1 else "underwear"
SHEETS_ROOT  = Path("packages/web-client/public/sprites/hero/sheets")
SRC_DIR      = SHEETS_ROOT / BASE_NAME
OUT_DIR      = Path("assets/gpt-export") / BASE_NAME / "templates"

# Source frame size
FW, FH       = 171, 192
RUN_COLS     = 6
ATK_COLS     = 3

# GPT template size (matches what ChatGPT actually emits at high quality)
TPL_W, TPL_H = 1674, 940
COLS, ROWS   = 6, 3
CELL_W       = TPL_W // COLS         # 279
CELL_H       = TPL_H // ROWS         # 313  (last row absorbs +1)

MAGENTA      = (255, 0, 255, 255)
BOX_COLOR    = (0, 0, 0, 255)        # black box outlines (1 px) — ChatGPT respects them
BOX_WIDTH    = 2
GHOST_ALPHA  = 110                   # 0..255, lower = fainter

PAIRS: list[tuple[str, str, str, str, str, str]] = [
    # (slug, run_stem, atk_a_stem, atk_b_stem, row1_label, row2_label)
    ("ew",   "running-east-west",   "attack-east",      "attack-west",      "EAST",      "WEST"),
    ("nenw", "running-ne-nw",       "attack-northeast", "attack-northwest", "NORTHEAST", "NORTHWEST"),
    ("ns",   "running-north-south", "attack-north",     "attack-south",     "NORTH-row1","SOUTH-row2"),
    ("sesw", "running-se-sw",       "attack-southeast", "attack-southwest", "SOUTHEAST", "SOUTHWEST"),
]

# Neutral-idle 8-direction layout: 4 cols x 2 rows, square cells.
# Source sheet: 1776 x 888 (cell 444 x 444).
# Direction order matches packages/web-client/public/sprites/hero/metadata.json.
IDLE_STEM    = "neutral-idle-8dir"
IDLE_TPL_W   = 1776
IDLE_TPL_H   = 888
IDLE_COLS    = 4
IDLE_ROWS    = 2
IDLE_CELL_W  = IDLE_TPL_W // IDLE_COLS   # 444
IDLE_CELL_H  = IDLE_TPL_H // IDLE_ROWS   # 444
IDLE_FRAME_W = 444   # source frame size (matches 1776/4, 888/2)
IDLE_FRAME_H = 444
IDLE_DIRECTIONS: list[tuple[int, int, str]] = [
    (0, 0, "SOUTH"),
    (0, 1, "SOUTHWEST"),
    (0, 2, "EAST"),
    (0, 3, "NORTHWEST"),
    (1, 0, "NORTH"),
    (1, 1, "NORTHEAST"),
    (1, 2, "WEST"),
    (1, 3, "SOUTHEAST"),
]


def fit_into_cell(src: Image.Image, cell_w: int, cell_h: int) -> Image.Image:
    """Scale src (transparent bg) to fit cell_w x cell_h preserving aspect."""
    sw, sh = src.size
    scale = min(cell_w / sw, cell_h / sh)
    nw = max(1, int(round(sw * scale)))
    nh = max(1, int(round(sh * scale)))
    return src.resize((nw, nh), Image.LANCZOS)


def to_ghost(src: Image.Image, alpha: int) -> Image.Image:
    """Convert an RGBA frame to a high-contrast dark silhouette overlay so
    it reads clearly against the magenta background and gives ChatGPT an
    unambiguous pose guide."""
    arr = np.array(src.convert("RGBA"))
    a = arr[..., 3].astype(np.float32) / 255.0
    rgb = arr[..., :3].astype(np.float32)
    # Luminance, then map to a dark grey ramp (~30..160) for visible detail
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])
    lum = (lum / 255.0).clip(0, 1)
    grey = (30 + lum * 130).astype(np.uint8)
    out_rgb = np.stack([grey, grey, grey], axis=-1)
    out_a = (a * 255.0).astype(np.uint8)  # full opacity where the figure exists
    out = np.concatenate([out_rgb, out_a[..., None]], axis=-1)
    return Image.fromarray(out, "RGBA")


def cell_box(c: int, r: int) -> tuple[int, int, int, int]:
    x0 = c * CELL_W
    y0 = r * CELL_H
    # Last column / row stretches to template edge to absorb rounding
    x1 = (c + 1) * CELL_W if c < COLS - 1 else TPL_W
    y1 = (r + 1) * CELL_H if r < ROWS - 1 else TPL_H
    return x0, y0, x1, y1


def paste_centered(canvas: Image.Image, fitted: Image.Image,
                   box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    cw = x1 - x0
    ch = y1 - y0
    nw, nh = fitted.size
    dst_x = x0 + (cw - nw) // 2
    # Anchor feet near bottom of cell with a small margin
    dst_y = y1 - nh - 4
    if dst_y < y0:
        dst_y = y0
    canvas.paste(fitted, (dst_x, dst_y), fitted)


def split_run_sheet(stem: str) -> list[list[Image.Image]]:
    """Returns 2 rows of 6 frames each (size FW x FH)."""
    img = Image.open(SRC_DIR / f"{stem}.png").convert("RGBA")
    rows = []
    for r in range(2):
        row = []
        for c in range(RUN_COLS):
            row.append(img.crop((c * FW, r * FH, c * FW + FW, r * FH + FH)))
        rows.append(row)
    return rows


def split_attack_strip(stem: str) -> list[Image.Image]:
    img = Image.open(SRC_DIR / f"{stem}.png").convert("RGBA")
    return [img.crop((c * FW, 0, c * FW + FW, FH)) for c in range(ATK_COLS)]


def draw_label(d: ImageDraw.ImageDraw, text: str, box: tuple[int, int, int, int]) -> None:
    x0, y0, _, _ = box
    try:
        font = ImageFont.truetype("arial.ttf", 16)
    except Exception:
        font = ImageFont.load_default()
    d.rectangle([x0 + 2, y0 + 2, x0 + 90, y0 + 22], fill=(255, 255, 255, 220))
    d.text((x0 + 6, y0 + 4), text, fill=(0, 0, 0, 255), font=font)


def build_template(slug: str, run_stem: str, atk_a_stem: str, atk_b_stem: str,
                   row1_label: str, row2_label: str) -> None:
    canvas = Image.new("RGBA", (TPL_W, TPL_H), MAGENTA)
    d = ImageDraw.Draw(canvas)

    run_rows = split_run_sheet(run_stem)
    atk_a    = split_attack_strip(atk_a_stem)
    atk_b    = split_attack_strip(atk_b_stem)

    # Running rows 1 & 2
    for r in range(2):
        for c in range(RUN_COLS):
            box = cell_box(c, r)
            ghost = to_ghost(run_rows[r][c], GHOST_ALPHA)
            fitted = fit_into_cell(ghost, box[2] - box[0] - 8, box[3] - box[1] - 28)
            paste_centered(canvas, fitted, box)

    # Attack row (row index 2): atk_a [0..2], atk_b [3..5]
    for c in range(ATK_COLS):
        box = cell_box(c, 2)
        ghost = to_ghost(atk_a[c], GHOST_ALPHA)
        fitted = fit_into_cell(ghost, box[2] - box[0] - 8, box[3] - box[1] - 28)
        paste_centered(canvas, fitted, box)
    for c in range(ATK_COLS):
        box = cell_box(c + ATK_COLS, 2)
        ghost = to_ghost(atk_b[c], GHOST_ALPHA)
        fitted = fit_into_cell(ghost, box[2] - box[0] - 8, box[3] - box[1] - 28)
        paste_centered(canvas, fitted, box)

    # Bounding boxes + labels (drawn over the ghosts so ChatGPT sees them clearly)
    for r in range(ROWS):
        for c in range(COLS):
            box = cell_box(c, r)
            d.rectangle(list(box), outline=BOX_COLOR, width=BOX_WIDTH)

    # Row labels (top-left of first cell in each row)
    labels = [
        f"ROW 1: RUN {row1_label}",
        f"ROW 2: RUN {row2_label}",
        f"ROW 3: ATTACK {row1_label} (cols 1-3)  |  ATTACK {row2_label} (cols 4-6)",
    ]
    try:
        font = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        font = ImageFont.load_default()
    for r, text in enumerate(labels):
        x0, y0, _, _ = cell_box(0, r)
        pad = 4
        tw = d.textlength(text, font=font)
        d.rectangle([x0 + pad, y0 + pad, x0 + pad + int(tw) + 8, y0 + pad + 24],
                    fill=(255, 255, 255, 230))
        d.text((x0 + pad + 4, y0 + pad + 2), text, fill=(0, 0, 0, 255), font=font)

    # Save (RGB only — magenta key works on RGB; alpha not needed)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"template-{slug}.png"
    canvas.convert("RGB").save(out_path, "PNG")
    print(f"  wrote {out_path}  ({TPL_W}x{TPL_H})")


def build_idle_template() -> None:
    """Build a 4x2 magenta-bg template for the 8-direction neutral-idle sheet.

    Layout matches packages/web-client/public/sprites/hero/metadata.json:
        Row 0: south, southwest, east, northwest
        Row 1: north, northeast, west, southeast
    """
    src_path = SRC_DIR / f"{IDLE_STEM}.png"
    if not src_path.exists():
        print(f"  [skip] missing {src_path}")
        return
    src = Image.open(src_path).convert("RGBA")
    if src.size != (IDLE_TPL_W, IDLE_TPL_H):
        # Resize source to canonical idle dimensions before slicing.
        src = src.resize((IDLE_TPL_W, IDLE_TPL_H), Image.LANCZOS)

    canvas = Image.new("RGBA", (IDLE_TPL_W, IDLE_TPL_H), MAGENTA)
    d = ImageDraw.Draw(canvas)

    for row, col, _label in IDLE_DIRECTIONS:
        sx = col * IDLE_FRAME_W
        sy = row * IDLE_FRAME_H
        cell = src.crop((sx, sy, sx + IDLE_FRAME_W, sy + IDLE_FRAME_H))
        ghost = to_ghost(cell, GHOST_ALPHA)
        x0 = col * IDLE_CELL_W
        y0 = row * IDLE_CELL_H
        x1 = x0 + IDLE_CELL_W if col < IDLE_COLS - 1 else IDLE_TPL_W
        y1 = y0 + IDLE_CELL_H if row < IDLE_ROWS - 1 else IDLE_TPL_H
        fitted = fit_into_cell(ghost, x1 - x0 - 8, y1 - y0 - 28)
        paste_centered(canvas, fitted, (x0, y0, x1, y1))

    # Cell bounding boxes
    for row, col, _ in IDLE_DIRECTIONS:
        x0 = col * IDLE_CELL_W
        y0 = row * IDLE_CELL_H
        x1 = x0 + IDLE_CELL_W if col < IDLE_COLS - 1 else IDLE_TPL_W
        y1 = y0 + IDLE_CELL_H if row < IDLE_ROWS - 1 else IDLE_TPL_H
        d.rectangle([x0, y0, x1, y1], outline=BOX_COLOR, width=BOX_WIDTH)

    # Per-cell direction labels (top-left, white box for legibility)
    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    for row, col, label in IDLE_DIRECTIONS:
        x0 = col * IDLE_CELL_W
        y0 = row * IDLE_CELL_H
        pad = 6
        tw = d.textlength(label, font=font)
        d.rectangle([x0 + pad, y0 + pad, x0 + pad + int(tw) + 12, y0 + pad + 28],
                    fill=(255, 255, 255, 230))
        d.text((x0 + pad + 6, y0 + pad + 4), label, fill=(0, 0, 0, 255), font=font)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "template-idle.png"
    canvas.convert("RGB").save(out_path, "PNG")
    print(f"  wrote {out_path}  ({IDLE_TPL_W}x{IDLE_TPL_H})")


def main() -> None:
    if not SRC_DIR.is_dir():
        sys.exit(f"ERROR: source dir not found: {SRC_DIR}")
    print(f"Source : {SRC_DIR}")
    print(f"Output : {OUT_DIR}")
    print(f"Size   : {TPL_W}x{TPL_H}  cells {CELL_W}x{CELL_H}\n")
    for slug, run, a, b, l1, l2 in PAIRS:
        print(f"--- template-{slug} ---")
        build_template(slug, run, a, b, l1, l2)
    print(f"--- template-idle ---")
    build_idle_template()


if __name__ == "__main__":
    main()
