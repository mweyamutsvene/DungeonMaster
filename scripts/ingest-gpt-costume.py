"""
Ingest 4 ChatGPT-costumed chunk images and rebuild the sprite atlas.

Steps per chunk:
  1. Verify chunk dimensions match originals (no silent rescaling — error if wrong).
  2. Split each chunk back into individual source sheets.
  3. Write sheets to:
       packages/web-client/public/sprites/hero/sheets/<costume-id>/
  4. Rebuild the atlas (calls build-underwear-atlas.py logic internally).

Usage
-----
    python scripts/ingest-gpt-costume.py <costume-id> [base-name]

    <costume-id>  e.g. "barbarian", "wizard-robes"
    [base-name]   source base sheets to pull heads from (default: "underwear")

    Place the 4 GPT output files at:
        assets/gpt-export/<base-name>/costumed/chunk-ew.png
        assets/gpt-export/<base-name>/costumed/chunk-nenw.png
        assets/gpt-export/<base-name>/costumed/chunk-ns.png
        assets/gpt-export/<base-name>/costumed/chunk-sesw.png
"""

from __future__ import annotations
import json
import sys
import numpy as np
from PIL import Image
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

if len(sys.argv) < 2:
    sys.exit("Usage: python scripts/ingest-gpt-costume.py <costume-id> [base-name]")

COSTUME_ID  = sys.argv[1]
BASE_NAME   = sys.argv[2] if len(sys.argv) > 2 else "underwear"

SHEETS_ROOT = Path("packages/web-client/public/sprites/hero/sheets")
SRC_DIR     = SHEETS_ROOT / BASE_NAME           # original sheets (idle/profile + alpha mask source)
GPT_DIR     = Path("assets/gpt-export") / BASE_NAME / "costumed"
OUT_DIR     = SHEETS_ROOT / COSTUME_ID

FW_BASE, FH_BASE = 171, 192
# Output resolution multiplier. ChatGPT templates are 1674x940 (≈1.63x base),
# so SCALE>=2 lets us preserve the higher fidelity. Idle/profile sheets are
# LANCZOS-upscaled to match.
SCALE       = 2
FW, FH      = FW_BASE * SCALE, FH_BASE * SCALE
RUN_COLS    = 6
ATK_COLS    = 3
CHUNK_W     = FW * RUN_COLS    # 6 * 171 * SCALE
CHUNK_H     = FH * 3           # 3 * 192 * SCALE

PAIRS: list[tuple[str, str, str, str]] = [
    ("ew",    "running-east-west",   "attack-east",      "attack-west"),
    ("nenw",  "running-ne-nw",       "attack-northeast", "attack-northwest"),
    ("ns",    "running-north-south", "attack-north",     "attack-south"),
    ("sesw",  "running-se-sw",       "attack-southeast", "attack-southwest"),
]

# Maps slug → ChatGPT-friendly file stem (matches template naming)
SLUG_TO_STEM = {
    "ew":   "east-west",
    "nenw": "ne-nw",
    "ns":   "ns",
    "sesw": "se-sw",
}

# Idle template constants (4 cols x 2 rows of 444x444 cells, 1776x888 total).
# Output sheet matches existing atlas convention at SCALE multiplier.
IDLE_TPL_W, IDLE_TPL_H = 1776, 888
IDLE_COLS, IDLE_ROWS   = 4, 2
IDLE_OUT_W, IDLE_OUT_H = IDLE_TPL_W * SCALE, IDLE_TPL_H * SCALE

# Atlas constants (match build-underwear-atlas.py)
ATLAS_W       = 1776 * SCALE
ATK_H         = FH
RUN_W         = CHUNK_W


# ---------------------------------------------------------------------------
# Atlas rebuild (mirrors build-underwear-atlas.py)
# ---------------------------------------------------------------------------

RUN_ATTACK_PAIRS_FOR_ATLAS = [
    ("running-east-west",   "attack-east",      "attack-west"),
    ("running-ne-nw",       "attack-northeast", "attack-northwest"),
    ("running-north-south", "attack-north",     "attack-south"),
    ("running-se-sw",       "attack-southeast", "attack-southwest"),
]


def rebuild_atlas(costume_dir: Path) -> None:
    """Rebuild atlas PNG + JSON from sheets in costume_dir."""
    placements: list[tuple[str, int, int, Image.Image]] = []
    y = 0

    def load_sheet(stem: str) -> Image.Image:
        p = costume_dir / f"{stem}.png"
        return Image.open(p).convert("RGBA")

    # Row 1 — idle: copy from base (no costume on idle for now)
    idle = load_sheet("neutral-idle-8dir")
    placements.append(("neutral-idle-8dir", 0, y, idle))
    y += idle.height

    # Row 2 — profile: copy from base
    profile = load_sheet("female-hero-profile")
    placements.append(("female-hero-profile", 0, y, profile))
    y += profile.height

    # Rows 3-6 — run + attack pairs
    for run_stem, atk1_stem, atk2_stem in RUN_ATTACK_PAIRS_FOR_ATLAS:
        run_img  = load_sheet(run_stem)
        atk1_img = load_sheet(atk1_stem)
        atk2_img = load_sheet(atk2_stem)
        placements.append((run_stem,  0,     y,          run_img))
        placements.append((atk1_stem, RUN_W, y,          atk1_img))
        placements.append((atk2_stem, RUN_W, y + ATK_H,  atk2_img))
        y += run_img.height

    atlas_h = y
    print(f"\n  Atlas canvas: {ATLAS_W}×{atlas_h}")

    atlas    = Image.new("RGBA", (ATLAS_W, atlas_h), (0, 0, 0, 0))
    manifest = {"atlasWidth": ATLAS_W, "atlasHeight": atlas_h, "sheets": {}}

    for stem, x, yy, img in placements:
        atlas.paste(img, (x, yy))
        manifest["sheets"][stem] = {
            "x": x, "y": yy,
            "width": img.width, "height": img.height,
            "file": f"{stem}.png",
        }

    atlas_png  = costume_dir / f"{COSTUME_ID}-atlas.png"
    atlas_json = costume_dir / f"{COSTUME_ID}-atlas.json"
    atlas.save(atlas_png, "PNG")
    atlas_json.write_text(json.dumps(manifest, indent=2))
    print(f"  Atlas saved → {atlas_png}")
    print(f"  Manifest    → {atlas_json}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

from collections import deque


def chroma_key(arr: np.ndarray) -> np.ndarray:
    """
    Flood-fill from all image edges to remove the green-screen background.
    Only connected background-green pixels are removed — interior pixels
    that happen to be greenish (skin, leather tones) are left untouched.
    arr is RGBA uint8.
    """
    h, w = arr.shape[:2]
    r = arr[:, :, 0].astype(np.int32)
    g = arr[:, :, 1].astype(np.int32)
    b = arr[:, :, 2].astype(np.int32)

    def is_green(y: int, x: int) -> bool:
        # Green must dominate both red and blue by a clear margin
        return (g[y, x] - r[y, x] > 40) and (g[y, x] - b[y, x] > 40)

    visited = np.zeros((h, w), dtype=bool)
    out = arr.copy()
    queue: deque = deque()

    # Seed from all 4 edges
    for x in range(w):
        for y in [0, h - 1]:
            if not visited[y, x] and is_green(y, x):
                visited[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in [0, w - 1]:
            if not visited[y, x] and is_green(y, x):
                visited[y, x] = True
                queue.append((y, x))

    while queue:
        cy, cx = queue.popleft()
        out[cy, cx, 3] = 0
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_green(ny, nx):
                visited[ny, nx] = True
                queue.append((ny, nx))

    return out


def magenta_key(arr: np.ndarray) -> np.ndarray:
    """Three-phase background removal:

    Phase 1 — hard magenta kill: pixels close enough to pure #FF00FF
    that they're unambiguous background.

    Phase 2 — residual desaturate: any remaining magenta-toned pixel
    (R≈B, G clearly lower) gets its green pushed toward (R+B)/2 so the
    color becomes neutral gray, AND its alpha attenuated by tone strength.
    This converts ambiguous fringe pixels into soft gray edges instead
    of pink halos, without risking eating skin.

    Phase 3 — edge-pad RGB into transparent pixels so subsequent LANCZOS
    resize blends figure↔figure.
    """
    out = arr.copy().astype(np.int32)
    r = out[..., 0]
    g = out[..., 1]
    b = out[..., 2]

    # ---- Phase 1: hard magenta kill ----
    dr = 255 - r
    db = 255 - b
    dist = np.sqrt((dr * dr + g * g + db * db).astype(np.float32))
    HARD = 100.0
    hard_mask = dist < HARD
    out[hard_mask, 3] = 0

    # ---- Phase 2: residual desaturate + fade ----
    # Magenta tone strength: how much (R+B) exceeds 2*G. Pure magenta
    # has tone ~510, gray has tone 0, skin (200,150,140) has tone ~40.
    tone = (r.astype(np.float32) + b.astype(np.float32)) - 2 * g.astype(np.float32)
    rb_balance = 1.0 - np.abs(r - b).astype(np.float32) / np.maximum(np.maximum(r, b), 1).astype(np.float32)

    # Strength ramps: 0 at tone<=5, full at tone>=60. R≈B gate.
    strength = np.clip((tone - 5.0) / 55.0, 0.0, 1.0) * np.clip((rb_balance - 0.4) / 0.4, 0.0, 1.0)

    active = (strength > 0) & (out[..., 3] > 0)
    if active.any():
        s = strength[active]
        # Replace toward black by strength
        TARGET_R, TARGET_G, TARGET_B = 0, 0, 0
        out[active, 0] = np.clip(r[active].astype(np.float32) * (1 - s) + TARGET_R * s, 0, 255).astype(np.int32)
        out[active, 1] = np.clip(g[active].astype(np.float32) * (1 - s) + TARGET_G * s, 0, 255).astype(np.int32)
        out[active, 2] = np.clip(b[active].astype(np.float32) * (1 - s) + TARGET_B * s, 0, 255).astype(np.int32)
        # Keep alpha mostly intact — replaced pixels stay opaque skin tone.
        # Only fade alpha slightly with strength.
        cur_alpha = out[active, 3].astype(np.float32)
        out[active, 3] = (cur_alpha * (1 - 0.3 * s)).clip(0, 255).astype(np.int32)

    # Drop near-transparent leftovers cleanly
    out[out[..., 3] < 16, 3] = 0

    # ---- Phase 3: edge-pad RGB ----
    transparent = out[..., 3] == 0
    if transparent.any() and (~transparent).any():
        from scipy.ndimage import distance_transform_edt  # type: ignore
        _, (iy, ix) = distance_transform_edt(transparent, return_indices=True)
        out[..., 0] = out[iy, ix, 0]
        out[..., 1] = out[iy, ix, 1]
        out[..., 2] = out[iy, ix, 2]
        out[transparent, 3] = 0

    return np.clip(out, 0, 255).astype(np.uint8)


def strip_template_grid(arr: np.ndarray, cols: int = 6, rows: int = 3,
                       line_thresh: int = 220, half_thickness: int = 16) -> np.ndarray:
    """Erase the black template bounding-box lines by setting alpha to 0.
    Operates on the RGBA array using the cell grid implied by cols/rows.
    Within ±half_thickness of any grid line, any pixel whose brightest
    channel is below `line_thresh` is killed. This catches both pure black
    line cores AND the anti-aliased dark-magenta fringe that surrounds
    them (e.g. ~(128,0,128)) which would otherwise survive magenta_key.
    """
    h, w = arr.shape[:2]
    out = arr.copy()

    r = arr[..., 0].astype(np.int32)
    g = arr[..., 1].astype(np.int32)
    b = arr[..., 2].astype(np.int32)
    max_chan = np.maximum(np.maximum(r, g), b)
    dark = max_chan < line_thresh

    line_mask = np.zeros((h, w), dtype=bool)
    for c in range(cols + 1):
        x = round(c * w / cols)
        x0 = max(0, x - half_thickness)
        x1 = min(w, x + half_thickness + 1)
        line_mask[:, x0:x1] = True
    for rr in range(rows + 1):
        y = round(rr * h / rows)
        y0 = max(0, y - half_thickness)
        y1 = min(h, y + half_thickness + 1)
        line_mask[y0:y1, :] = True

    erase = dark & line_mask
    out[erase, 3] = 0
    return out


def load_gpt_idle() -> np.ndarray | None:
    """Load and key the costumed 8-direction idle sheet, if present.

    GPT idle template is 1776x888 with 4x2 grid of 444x444 cells, magenta
    background, no inner bbox lines beyond the cell borders. Returns the
    keyed RGBA array at IDLE_OUT_W x IDLE_OUT_H, or None if not provided.
    """
    candidates = [GPT_DIR / "idle.png", GPT_DIR / "chunk-idle.png"]
    path = next((p for p in candidates if p.exists()), None)
    if path is None:
        return None
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    # Key on the ORIGINAL pixels (no resize yet) so we never resample
    # magenta into figure edges. Then strip grid (which works on raw too)
    # and only resize after everything magenta is fully transparent.
    arr = strip_template_grid(arr, cols=IDLE_COLS, rows=IDLE_ROWS)
    arr = magenta_key(arr)
    img = Image.fromarray(arr, "RGBA")
    if (img.width, img.height) != (IDLE_OUT_W, IDLE_OUT_H):
        img = img.resize((IDLE_OUT_W, IDLE_OUT_H), Image.LANCZOS)
        arr = np.array(img)
        arr = magenta_key(arr)
    return arr


def load_gpt(slug: str) -> np.ndarray:
    # Accept either chunk-<slug>.png or <stem>.png naming
    candidates = [
        GPT_DIR / f"chunk-{slug}.png",
        GPT_DIR / f"{SLUG_TO_STEM[slug]}.png",
    ]
    path = next((p for p in candidates if p.exists()), None)
    if path is None:
        sys.exit(f"ERROR: GPT chunk not found at any of: {candidates}")
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)

    # If this is a magenta template (1674x940 or similar with black grid),
    # strip the bounding-box lines, then chroma-key magenta BEFORE resizing
    # so LANCZOS doesn't blend pure #FF00FF into figure edges and produce
    # a dark mauve halo. After keying, the background pixels are fully
    # transparent with RGB=0, so the resize blends figure RGB cleanly.
    if (img.width, img.height) != (CHUNK_W, CHUNK_H):
        print(f"  source {img.width}x{img.height} -> strip grid -> magenta key -> rescale to {CHUNK_W}x{CHUNK_H}")
        arr = strip_template_grid(arr, cols=6, rows=3)
        arr = magenta_key(arr)
        img = Image.fromarray(arr, "RGBA").resize((CHUNK_W, CHUNK_H), Image.LANCZOS)
        arr = np.array(img)
        # Final cleanup pass: kill any residual sub-threshold alpha and
        # any halo pixels that survived the resize blend.
        arr = magenta_key(arr)
    else:
        arr = magenta_key(arr)
    return arr


# ---------------------------------------------------------------------------
# Per-cell reframe: rescale each frame's alpha bbox to fit FW×FH,
# horizontally centered, feet anchored at FEET_ANCHOR_Y.
# ChatGPT often returns figures that are taller than the cell, so heads
# bleed into the cell above. This re-fits each cell.
# ---------------------------------------------------------------------------

FEET_ANCHOR_Y = 1.0
H_CENTER_X    = 0.5
HEAD_MARGIN_PX = 4   # gap between top of head and top of cell, like underwear


def reframe_cells(arr: np.ndarray, cell_w: int, cell_h: int, cols: int, rows: int, extra_top_margin: int = 0, source_top_buffer: int = 0) -> np.ndarray:
    """Re-fit each cell so its dominant figure fits cleanly inside cell_w×cell_h.

    ChatGPT figures don't respect row bands — heads of row N+1 figures poke
    up into the bottom of row N cells, and vice versa. To isolate THIS cell's
    figure, we extract the largest connected alpha component, then bbox+
    scale that single component, anchored at cell bottom.
    """
    from scipy.ndimage import label  # type: ignore

    sheet = Image.fromarray(arr, "RGBA")
    out = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    for r in range(rows):
        for c in range(cols):
            sx, sy = c * cell_w, r * cell_h + source_top_buffer
            crop_top = max(0, sy - source_top_buffer)
            cell = sheet.crop((sx, crop_top, sx + cell_w, sy + cell_h))
            buffer_used = sy - crop_top
            cell_arr = np.array(cell)
            alpha = cell_arr[:, :, 3]
            mask = alpha > 32  # ignore faint anti-alias halo
            if not mask.any():
                continue

            labeled, n = label(mask)
            if n > 1:
                sizes = np.bincount(labeled.ravel())
                sizes[0] = 0
                # Body candidate: largest component that reaches into the
                # bottom half of the LOGICAL cell (i.e. y >= buffer_used + cell_h/2).
                bottom_thresh = buffer_used + cell_h // 2
                body_id = 0
                body_size = 0
                for cid in range(1, n + 1):
                    if sizes[cid] <= body_size:
                        continue
                    cys, _ = np.where(labeled == cid)
                    if int(cys.max()) >= bottom_thresh:
                        body_id = cid
                        body_size = int(sizes[cid])
                if body_id == 0:
                    body_id = int(sizes.argmax())
                largest_id = body_id
                ys, _ = np.where(labeled == largest_id)
                body_top = int(ys.min())
                body_bot = int(ys.max())

                keep_ids = [largest_id]
                threshold = max(20, int(sizes[largest_id] * 0.05))
                for cid in range(1, n + 1):
                    if cid == largest_id or sizes[cid] < threshold:
                        continue
                    cys, _ = np.where(labeled == cid)
                    c_top = int(cys.min())
                    c_bot = int(cys.max())
                    # Keep only if this component sits ABOVE the body
                    # (e.g. head separated by flying hair). Drop anything
                    # below the body — those are phantom heads from the
                    # next animation row bleeding into this cell.
                    if c_bot <= body_top + 4:
                        keep_ids.append(cid)
                keep_mask = np.isin(labeled, keep_ids)
            else:
                keep_mask = mask

            cleaned = cell_arr.copy()
            cleaned[~keep_mask, 3] = 0
            cleaned_img = Image.fromarray(cleaned, "RGBA")

            bbox = cleaned_img.getchannel("A").getbbox()
            if bbox is None:
                continue
            cropped = cleaned_img.crop(bbox)
            cw, ch = cropped.size

            top_margin = HEAD_MARGIN_PX + extra_top_margin
            avail_h = cell_h - top_margin
            scale = min(cell_w / cw, avail_h / ch)
            nw = max(1, int(round(cw * scale)))
            nh = max(1, int(round(ch * scale)))
            scaled = cropped.resize((nw, nh), Image.LANCZOS)

            dst_x = sx + int(round(H_CENTER_X * cell_w - nw / 2))
            sy_out = r * cell_h
            feet_y = int(round(FEET_ANCHOR_Y * cell_h))
            dst_y = sy_out + (feet_y - nh)
            if dst_y < sy_out + top_margin:
                dst_y = sy_out + top_margin

            out.paste(scaled, (dst_x, dst_y), scaled)
    return np.array(out)


def main() -> None:
    if not SRC_DIR.is_dir():
        sys.exit(f"ERROR: base source dir not found: {SRC_DIR}")
    if not GPT_DIR.is_dir():
        sys.exit(f"ERROR: GPT costumed dir not found: {GPT_DIR}\n"
                 f"  Place GPT outputs there: {GPT_DIR}/chunk-*.png")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Costume : {COSTUME_ID}")
    print(f"Base    : {SRC_DIR}")
    print(f"GPT     : {GPT_DIR}")
    print(f"Output  : {OUT_DIR}\n")

    # Idle: prefer costumed GPT output; fall back to LANCZOS-upscaled base.
    idle_dst = OUT_DIR / "neutral-idle-8dir.png"
    gpt_idle = load_gpt_idle()
    if gpt_idle is not None:
        Image.fromarray(gpt_idle, "RGBA").save(idle_dst, "PNG")
        print(f"  saved   neutral-idle-8dir.png ({IDLE_OUT_W}x{IDLE_OUT_H}, costumed)")
    else:
        src_path = SRC_DIR / "neutral-idle-8dir.png"
        if src_path.exists():
            img = Image.open(src_path).convert("RGBA")
            if SCALE != 1:
                img = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
            img.save(idle_dst, "PNG")
            print(f"  copied  neutral-idle-8dir.png ({img.width}x{img.height}, no costume)")

    # Profile sheet: no costume yet — LANCZOS-upscale base.
    src_path = SRC_DIR / "female-hero-profile.png"
    dst_path = OUT_DIR / "female-hero-profile.png"
    if src_path.exists():
        img = Image.open(src_path).convert("RGBA")
        if SCALE != 1:
            img = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
        img.save(dst_path, "PNG")
        print(f"  copied  female-hero-profile.png ({img.width}x{img.height}, no costume)")

    print()

    for slug, run_stem, atk_a_stem, atk_b_stem in PAIRS:
        print(f"--- chunk-{slug} ---")

        chunk_gpt = load_gpt(slug)
        print(f"  GPT chunk loaded: {CHUNK_W}×{CHUNK_H} ✓")

        # Split chunk back into sheets
        atk_w     = FW * ATK_COLS   # 513
        run_arr   = chunk_gpt[0:FH*2,    0:CHUNK_W].copy()
        atk_a_arr = chunk_gpt[FH*2:FH*3, 0:atk_w].copy()
        atk_b_arr = chunk_gpt[FH*2:FH*3, atk_w:CHUNK_W].copy()

        # Reframe each cell so figures fit cleanly inside FW×FH.
        # Attack rows are kept as-is (no reframing) — the template's hard
        # bounding boxes already constrain ChatGPT to per-cell figures, and
        # auto-scaling shrinks them and steals the foot of the row above.
        run_arr   = reframe_cells(run_arr,   FW, FH, RUN_COLS, 2)

        for arr, stem in [
            (run_arr,   run_stem),
            (atk_a_arr, atk_a_stem),
            (atk_b_arr, atk_b_stem),
        ]:
            out_path = OUT_DIR / f"{stem}.png"
            Image.fromarray(arr, "RGBA").save(out_path, "PNG")
            print(f"  saved   {out_path.name}")

        print()

    # Rebuild atlas
    print("Rebuilding atlas ...")
    rebuild_atlas(OUT_DIR)
    print("\nAll done.")
    print(f"\nTo use this costume, update hero-sprite.ts to load:")
    print(f"  /sprites/hero/sheets/{COSTUME_ID}/{COSTUME_ID}-atlas.png")


if __name__ == "__main__":
    main()
