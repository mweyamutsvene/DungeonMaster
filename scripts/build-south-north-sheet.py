"""
Re-export running-north-south sheet so its per-frame size matches the other
running direction sheets (171x192), so the atlas renderer draws them at the
same on-screen scale as east-west / diagonal frames and the idle sheet.

Source : sheets/underwear/running-north-south.png  (1020x512, 6x2 of 170x256)
Output : same path, replaced as 1026x384 (6x2 of 171x192)

Per frame: find the alpha bbox, scale uniformly to fit 171x192 with feet at
the bottom (matching feetAnchorY=0.99 in metadata) and horizontally centered.
"""

from pathlib import Path
from PIL import Image

SRC = (
    Path(__file__).parent.parent
    / "packages/web-client/public/sprites/hero/sheets/underwear/running-north-south.png"
)

SRC_COLS, SRC_ROWS = 6, 2
SRC_FW, SRC_FH = 170, 256

# Target geometry — match running-east-west.png (1026x384, 171x192 per frame).
DST_COLS, DST_ROWS = 6, 2
DST_FW, DST_FH = 171, 192
FEET_ANCHOR_Y = 0.99  # matches metadata.json
H_CENTER_X = 0.5


def reexport(src_path: Path) -> None:
    sheet = Image.open(src_path).convert("RGBA")
    assert sheet.size == (SRC_COLS * SRC_FW, SRC_ROWS * SRC_FH), f"unexpected source size {sheet.size}"

    out = Image.new("RGBA", (DST_COLS * DST_FW, DST_ROWS * DST_FH), (0, 0, 0, 0))

    for row in range(SRC_ROWS):
        for col in range(SRC_COLS):
            sx, sy = col * SRC_FW, row * SRC_FH
            frame = sheet.crop((sx, sy, sx + SRC_FW, sy + SRC_FH))

            bbox = frame.getchannel("A").getbbox()
            if bbox is None:
                continue
            cropped = frame.crop(bbox)
            cw, ch = cropped.size

            # Uniform scale to fit DST frame.
            scale = min(DST_FW / cw, DST_FH / ch)
            nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
            scaled = cropped.resize((nw, nh), Image.NEAREST)

            # Place: horizontal center, feet at FEET_ANCHOR_Y of frame height.
            dst_x = col * DST_FW + int(round(H_CENTER_X * DST_FW - nw / 2))
            feet_y = int(round(FEET_ANCHOR_Y * DST_FH))
            dst_y = row * DST_FH + (feet_y - nh)

            out.paste(scaled, (dst_x, dst_y), scaled)

    out.save(src_path, "PNG")
    print(f"Saved {src_path}  ({out.width}x{out.height})")


if __name__ == "__main__":
    reexport(SRC)
