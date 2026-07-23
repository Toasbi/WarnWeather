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


# Height-fraction (of card height) used to size each line's starting font, keyed by role.
# options matches subtitle ("track what matters") so both secondary lines read the same size.
SIZE_FRACTION = {"headline": 0.16, "subtitle": 0.10, "options": 0.10}
# Line-gap height-fraction: TIGHT between two consecutive headline lines (they read as one
# broken title), NORMAL otherwise.
GAP_TIGHT = 0.01
GAP_NORMAL = 0.05


def card_copy(card_id, platform):
    """Return the list of (role, text) lines, or None if the card doesn't apply.

    `role` keys into SIZE_FRACTION to pick that line's starting font size.
    """
    if card_id == "themes":
        n = THEME_COUNT[platform]
        return None if n == 0 else [("headline", "Try %d themes" % n)]
    if card_id == "graph":
        metrics = "precip · UV · temp · wind · gusts"
        if HAS_RADAR[platform]:
            metrics += " · radar · health"
        return [("headline", "Build your"), ("headline", "own graph"), ("options", metrics)]
    if card_id == "status":
        return [("headline", "Status slots"), ("subtitle", "track what matters")]
    raise ValueError(card_id)


def wrap_to_width(draw, text, font, max_w, delimiter=" · "):
    """Split text on `delimiter` into the fewest lines that each fit max_w at `font`."""
    words = text.split(delimiter)
    lines = []
    current = words[0]
    for word in words[1:]:
        candidate = current + delimiter + word
        if draw.textlength(candidate, font=font) <= max_w:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def fit_line(draw, text, max_w, start_size):
    """Largest font (<= start_size, floor 8) that fits `text` in max_w, wrapping on ' · '
    rather than shrinking further once wrapping alone makes it fit.

    Shrinking a long line all the way down to fit on one line makes it read far smaller
    than start_size; wrapping into multiple lines keeps the font close to the requested
    size instead. Only shrinks below start_size when even wrapping doesn't fit (e.g. a
    single word wider than max_w on its own line). Returns (font, physical_lines).
    """
    size = start_size
    while size >= 8:
        font = ImageFont.truetype(str(FONT_PATH), size)
        if draw.textlength(text, font=font) <= max_w:
            return font, [text]
        wrapped = wrap_to_width(draw, text, font, max_w)
        if all(draw.textlength(w, font=font) <= max_w for w in wrapped):
            return font, wrapped
        size -= 1
    font = ImageFont.truetype(str(FONT_PATH), 8)
    return font, wrap_to_width(draw, text, font, max_w)


def render_card(lines, size):
    """`lines` is a list of (role, text) pairs; role sizes via SIZE_FRACTION."""
    w, h = size
    img = Image.new("RGB", size, BG)
    draw = ImageDraw.Draw(img)
    margin = round(w * 0.08)
    max_w = w - 2 * margin
    # a line that still overflows at the smallest size wraps into multiple physical lines
    fonts = []
    roles = []
    physical_lines = []
    for role, line in lines:
        start = round(h * SIZE_FRACTION[role])
        font, wrapped = fit_line(draw, line, max_w, start)
        for wline in wrapped:
            fonts.append(font)
            roles.append(role)
            physical_lines.append(wline)
    lines = physical_lines
    # Tight gap between two consecutive headline lines (one title broken across lines);
    # normal gap everywhere else (e.g. headline -> options/subtitle).
    gaps = [GAP_TIGHT if roles[i] == roles[i - 1] == "headline" else GAP_NORMAL
            for i in range(1, len(lines))]
    gaps_px = [round(h * g) for g in gaps]
    heights = [f.getbbox(line)[3] - f.getbbox(line)[1] for line, f in zip(lines, fonts)]
    total = sum(heights) + sum(gaps_px)
    y = (h - total) // 2
    for i, (line, font, lh) in enumerate(zip(lines, fonts, heights)):
        tw = draw.textlength(line, font=font)
        draw.text(((w - tw) // 2, y), line, font=font, fill=FG)
        if i < len(gaps_px):
            y += lh + gaps_px[i]
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
