"""
Remove chroma-key background from costumed chunk PNGs in-place.

Supports two background modes (auto-detected from corner pixels):
  - Magenta (#FF00FF): recommended — single-pass, no fringe artifacts
  - Green (#00FF00): per-cell flood fill + global second pass

Ask ChatGPT for magenta (#FF00FF) background for best results.
Run this once after dropping GPT outputs into the costumed folder,
before running ingest-gpt-costume.py.

Uses per-frame-cell flood fill so that green in gaps between limbs
(arm/torso gap, between legs, etc.) is caught from each cell's own edges,
not just the overall sheet edges.

Usage:
    python scripts/remove-green.py [costumed-dir]
    python scripts/remove-green.py assets/gpt-export/underwear/costumed   # default
"""
from __future__ import annotations
import sys
import numpy as np
from PIL import Image
from pathlib import Path
from collections import deque

COSTUMED_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("assets/gpt-export/underwear/costumed")

# Chunk layout (same for all 4 direction chunks)
CHUNK_COLS = 6
CHUNK_ROWS = 3   # 2 run rows + 1 attack row

# Primary threshold: green must beat red AND blue by this margin
GREEN_MARGIN = 5
# Second-pass global kill: any pixel where G > R AND G > B gets nuked (zero margin)
GLOBAL_GREEN_MIN_G = 1     # skip pure black (0,0,0)
GLOBAL_GREEN_MARGIN = 0    # no tolerance — green beats both = gone


def flood_fill_cell(green_mask: np.ndarray,
                    out_alpha: np.ndarray,
                    y0: int, y1: int,
                    x0: int, x1: int) -> None:
    """Flood-fill from the 4 edges of a single cell, zeroing alpha for green pixels."""
    visited = np.zeros((y1 - y0, x1 - x0), dtype=bool)
    queue: deque = deque()

    def seed(ly: int, lx: int) -> None:
        if green_mask[ly, lx] and not visited[ly - y0, lx - x0]:
            visited[ly - y0, lx - x0] = True
            queue.append((ly, lx))

    for x in range(x0, x1):
        seed(y0, x)
        seed(y1 - 1, x)
    for y in range(y0, y1):
        seed(y, x0)
        seed(y, x1 - 1)

    while queue:
        cy, cx = queue.popleft()
        out_alpha[cy, cx] = 0
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = cy + dy, cx + dx
            if y0 <= ny < y1 and x0 <= nx < x1:
                if not visited[ny - y0, nx - x0] and green_mask[ny, nx]:
                    visited[ny - y0, nx - x0] = True
                    queue.append((ny, nx))


def detect_background(arr: np.ndarray) -> str:
    """Sample the 4 corners to decide if background is magenta or green."""
    corners = [(0, 0), (0, -1), (-1, 0), (-1, -1)]
    votes_magenta = 0
    for y, x in corners:
        r, g, b = int(arr[y, x, 0]), int(arr[y, x, 1]), int(arr[y, x, 2])
        if r > 160 and b > 160 and g < 100:
            votes_magenta += 1
    return "magenta" if votes_magenta >= 2 else "green"


def remove_magenta(arr: np.ndarray) -> Image.Image:
    """Single-pass magenta kill: R>160 AND B>160 AND G<100."""
    r = arr[:, :, 0].astype(np.int32)
    g = arr[:, :, 1].astype(np.int32)
    b = arr[:, :, 2].astype(np.int32)
    mask = (r > 160) & (b > 160) & (g < 100)
    result = arr.copy()
    result[mask, 3] = 0
    return Image.fromarray(result, "RGBA")


def remove_green(img: Image.Image) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    h, w = arr.shape[:2]

    r = arr[:, :, 0].astype(np.int32)
    g = arr[:, :, 1].astype(np.int32)
    b = arr[:, :, 2].astype(np.int32)
    green_mask = (g - r > GREEN_MARGIN) & (g - b > GREEN_MARGIN)

    out_alpha = arr[:, :, 3].copy()

    # Cell boundary positions (evenly distributed, handles non-integer sizes)
    col_edges = [round(w * c / CHUNK_COLS) for c in range(CHUNK_COLS + 1)]
    row_edges = [round(h * r / CHUNK_ROWS) for r in range(CHUNK_ROWS + 1)]

    for row in range(CHUNK_ROWS):
        for col in range(CHUNK_COLS):
            flood_fill_cell(
                green_mask, out_alpha,
                row_edges[row], row_edges[row + 1],
                col_edges[col], col_edges[col + 1],
            )

    result = arr.copy()
    result[:, :, 3] = out_alpha

    # Second pass: globally nuke any pixel that's still bright green
    # (enclosed background pockets that flood fill couldn't reach)
    res_r = result[:, :, 0].astype(np.int32)
    res_g = result[:, :, 1].astype(np.int32)
    res_b = result[:, :, 2].astype(np.int32)
    still_green = (
        (result[:, :, 3] > 0) &
        (res_g >= GLOBAL_GREEN_MIN_G) &
        (res_g - res_r >= GLOBAL_GREEN_MARGIN) &
        (res_g - res_b >= GLOBAL_GREEN_MARGIN) &
        (res_g > res_r) &
        (res_g > res_b)
    )
    result[still_green, 3] = 0

    return Image.fromarray(result, "RGBA")


def main() -> None:
    if not COSTUMED_DIR.is_dir():
        sys.exit(f"ERROR: directory not found: {COSTUMED_DIR}")

    pngs = sorted(COSTUMED_DIR.glob("*.png"))
    if not pngs:
        sys.exit(f"No PNG files found in {COSTUMED_DIR}")

    for path in pngs:
        img = Image.open(path)
        arr = np.array(img.convert("RGBA"))
        bg = detect_background(arr)
        print(f"  {path.name}  {img.width}×{img.height}  [{bg}] ...", end=" ", flush=True)
        if bg == "magenta":
            result = remove_magenta(arr)
        else:
            result = remove_green(img)
        result.save(path, "PNG")
        removed = int(np.sum(np.array(result)[:, :, 3] == 0))
        print(f"done  ({removed} transparent px)")

    print(f"\nGreen removed from {len(pngs)} file(s) in {COSTUMED_DIR}")


if __name__ == "__main__":
    main()
