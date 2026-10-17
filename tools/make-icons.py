#!/usr/bin/env python3
"""Draw the app icons (the Recipe Grid logo on charcoal) into icons/.

Usage: python3 tools/make-icons.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

INK = (23, 24, 26)
PAPER = (244, 242, 237)
ACCENT = (194, 65, 12)
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(size, glyph_share, rounded=False):
    """The logo is a 26-unit grid: a frame, an ingredient column split in
    three, and an accent finish column. `glyph_share` is the fraction of the
    icon it fills (smaller for maskable icons, which get cropped)."""
    scale = 4  # draw large, then downsample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.18), fill=INK)
    else:
        d.rectangle([0, 0, s, s], fill=INK)

    g = s * glyph_share
    u = g / 26  # one logo unit
    ox = oy = (s - g) / 2

    def box(x0, y0, x1, y1, color):
        d.rectangle([ox + x0 * u, oy + y0 * u, ox + x1 * u, oy + y1 * u], fill=color)

    box(16.5, 0.5, 25.5, 25.5, ACCENT)  # finish column
    w = 2  # stroke width in units
    box(0, 0, 26, w, PAPER)  # frame
    box(0, 26 - w, 26, 26, PAPER)
    box(0, 0, w, 26, PAPER)
    box(26 - w, 0, 26, 26, PAPER)
    box(8, 0, 8 + w, 26, PAPER)  # ingredient column edge
    box(0, 8, 9, 8 + w, PAPER)  # ingredient rows
    box(0, 16, 9, 16 + w, PAPER)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    draw(192, 0.62).save(OUT / "icon-192.png")
    draw(512, 0.62).save(OUT / "icon-512.png")
    draw(512, 0.5).save(OUT / "maskable-512.png")
    draw(180, 0.62).convert("RGB").save(OUT / "apple-touch-icon.png")
    draw(64, 0.7, rounded=True).save(OUT / "favicon-64.png")
    print("Wrote icons to", OUT)


if __name__ == "__main__":
    main()
