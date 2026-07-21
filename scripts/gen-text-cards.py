#!/usr/bin/env python3
"""Render watch-sized promo-reel text cards (black bg / white text) per platform.

One card per caption id (themes/graph/status), at the platform's native resolution,
written to screenshot/<version>/promo/frames/<platform>/card-<id>.png. Caption copy
mirrors CARDS in scripts/gen-reel-fixtures.js — keep the two in sync. Needs Pillow.

Usage:  python3 scripts/gen-text-cards.py <version> [platform ...]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = REPO_ROOT / "screenshot" / "fonts" / "Poppins-Regular.ttf"

# native resolution per platform
RES = {"aplite": (144, 168), "basalt": (144, 168), "flint": (144, 168), "emery": (200, 228)}
# theme count per platform (mirror themesFor() in gen-reel-fixtures.js)
THEME_COUNT = {"emery": 4, "basalt": 4, "flint": 2, "aplite": 0}
# radar/health availability (mirror PLATFORM_CAPS)
HAS_RADAR = {"emery": True, "basalt": True, "flint": True, "aplite": False}

BG = (0, 0, 0)
FG = (255, 255, 255)


def card_copy(card_id, platform):
    """Return the list of caption lines, or None if the card doesn't apply."""
    if card_id == "themes":
        n = THEME_COUNT[platform]
        return None if n == 0 else ["Try %d themes" % n]
    if card_id == "graph":
        metrics = "precip · UV · temp · wind · gusts"
        if HAS_RADAR[platform]:
            metrics += " · radar · health"
        return ["Build your own", "graph", metrics]
    if card_id == "status":
        return ["Status slots", "track what matters"]
    raise ValueError(card_id)


def fit_font(draw, text, max_w, start_size):
    """Largest font size (<= start_size) whose text width fits max_w."""
    size = start_size
    while size > 8:
        font = ImageFont.truetype(str(FONT_PATH), size)
        if draw.textlength(text, font=font) <= max_w:
            return font
        size -= 1
    return ImageFont.truetype(str(FONT_PATH), 8)


def render_card(lines, size):
    w, h = size
    img = Image.new("RGB", size, BG)
    draw = ImageDraw.Draw(img)
    margin = round(w * 0.08)
    # size the first (headline) line larger, remaining lines smaller
    fonts = []
    for i, line in enumerate(lines):
        start = round(h * (0.16 if i == 0 else 0.10))
        fonts.append(fit_font(draw, line, w - 2 * margin, start))
    gap = round(h * 0.04)
    heights = [f.getbbox(line)[3] - f.getbbox(line)[1] for line, f in zip(lines, fonts)]
    total = sum(heights) + gap * (len(lines) - 1)
    y = (h - total) // 2
    for line, font, lh in zip(lines, fonts, heights):
        tw = draw.textlength(line, font=font)
        draw.text(((w - tw) // 2, y), line, font=font, fill=FG)
        y += lh + gap
    return img


def main():
    if len(sys.argv) < 2:
        print("usage: gen-text-cards.py <version> [platform ...]")
        sys.exit(64)
    version = sys.argv[1]
    platforms = sys.argv[2:] or list(RES.keys())
    for platform in platforms:
        out_dir = REPO_ROOT / "screenshot" / version / "promo" / "frames" / platform
        out_dir.mkdir(parents=True, exist_ok=True)
        for card_id in ("themes", "graph", "status"):
            lines = card_copy(card_id, platform)
            if lines is None:
                continue
            img = render_card(lines, RES[platform])
            out = out_dir / ("card-%s.png" % card_id)
            img.save(out)
            print("wrote %s" % out)


if __name__ == "__main__":
    main()
