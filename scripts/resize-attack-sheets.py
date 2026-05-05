"""
Resize attack-{direction}.png strips in sheets/underwear so each frame matches
the running sheets' per-frame size (171x192), feet-anchored to the bottom and
horizontally centered. Source strips are 3 frames wide of arbitrary size.
"""

from pathlib import Path
from PIL import Image

UND = Path(__file__).parent.parent / "packages/web-client/public/sprites/hero/sheets/underwear"

DST_FW, DST_FH = 171, 192
COLS = 3
FEET_ANCHOR_Y = 0.99
H_CENTER_X = 0.5


def resize_strip(src: Path) -> None:
    im = Image.open(src).convert("RGBA")
    src_fw = im.width // COLS
    src_fh = im.height
    out = Image.new("RGBA", (COLS * DST_FW, DST_FH), (0, 0, 0, 0))

    for c in range(COLS):
        frame = im.crop((c * src_fw, 0, (c + 1) * src_fw, src_fh))
        bbox = frame.getchannel("A").getbbox()
        if bbox is None:
            continue
        cropped = frame.crop(bbox)
        cw, ch = cropped.size
        scale = min(DST_FW / cw, DST_FH / ch)
        nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
        scaled = cropped.resize((nw, nh), Image.LANCZOS)

        dst_x = c * DST_FW + int(round(H_CENTER_X * DST_FW - nw / 2))
        feet_y = int(round(FEET_ANCHOR_Y * DST_FH))
        dst_y = feet_y - nh
        out.paste(scaled, (dst_x, dst_y), scaled)

    out.save(src, "PNG")
    print(f"resized {src.name} -> {out.size}")


def main() -> None:
    for p in sorted(UND.glob("attack-*.png")):
        resize_strip(p)


if __name__ == "__main__":
    main()
