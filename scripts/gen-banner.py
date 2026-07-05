#!/usr/bin/env python3
"""Regenerate the three README/store banners (resources/banner-*.png).

Rebuilds each banner's gradient background from clean reference pixels (so
the old device mockup and tagline can be erased without a visible seam),
redraws the tagline text, then composites a phone mockup (running the
current settings UI) and a watch mockup (running a captured scene) on top.
The watch/phone mockups are rendered via screenshot/composite_svg.sh, so
resvg and the screenshot/frames/*.svg frames are required.

Usage (run from the repo root):

    python3 scripts/gen-banner.py <version> <scene> <phone-screenshot>

    python3 scripts/gen-banner.py v1.6.2 3 "resources/app screenshot.jpeg"

<version>/<scene> select the watch screenshot from
screenshot/<version>/showcase/frames/<platform>/scene_<scene>.png (produced by
`mise capture-screenshots`). Edit TAGLINE_LINE1/2 below and re-run to change
the banner copy. Needs Pillow (`pip install pillow`) — no other Pebble
tooling touches Python image libs, so it isn't part of the mise toolchain.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parent.parent
TMP_DIR = REPO_ROOT / "screenshot" / "tmp"

FONT_PATH = REPO_ROOT / "screenshot" / "fonts" / "Poppins-Regular.ttf"
FONT_SIZE = 15
TEXT_COLOR = (212, 218, 226)
TAGLINE_LINE1 = "Weather, calendar, health & radar"
TAGLINE_LINE2 = "on your wrist"
TAGLINE_LEFT_X = 38
TAGLINE_LINE1_Y = 159
TAGLINE_LINE2_Y = 182
TAGLINE_ERASE_BOX = (25, 155, 380, 212)  # x0, y0, x1, y1
TAGLINE_REF_TOP_Y = 150
TAGLINE_REF_BOTTOM_Y = 218

DEVICE_ERASE_X0 = 315  # everything right of here is the old phone/watch mockup

PHONE_FRAME = "phone-black"
PHONE_TARGET_H = 300
PHONE_POS = (475, 12)

WATCH_TARGET_H = 250
WATCH_POS = (335, 320 - WATCH_TARGET_H - 5)

# (banner filename, capture platform, composite_svg.sh frame name)
VARIANTS = [
    ("banner-pebble-time-red.png", "basalt", "pebble-time-red"),
    ("banner-pebble-time2-red.png", "emery", "pebble-time2-red"),
    ("banner-pebble2-duo-white.png", "flint", "pebble2-duo-white"),
]


def composite_frame(frame, screenshot, output):
    # composite_svg.sh always base64-embeds the source as `image/png`, so a
    # JPEG (or anything else) input has to be normalized to a real PNG first
    # or resvg silently fails to decode it and the screen renders blank.
    png_screenshot = TMP_DIR / "gen-banner-src.png"
    Image.open(screenshot).convert("RGB").save(png_screenshot)
    subprocess.run(
        ["screenshot/composite_svg.sh", frame, str(png_screenshot), str(output)],
        cwd=REPO_ROOT,
        check=True,
    )


def redraw_tagline(rgb, font):
    x0, y0, x1, y1 = TAGLINE_ERASE_BOX
    top_row = [rgb.getpixel((x, TAGLINE_REF_TOP_Y)) for x in range(x0, x1)]
    bot_row = [rgb.getpixel((x, TAGLINE_REF_BOTTOM_Y)) for x in range(x0, x1)]
    px = rgb.load()
    for y in range(y0, y1):
        t = (y - TAGLINE_REF_TOP_Y) / (TAGLINE_REF_BOTTOM_Y - TAGLINE_REF_TOP_Y)
        for i, x in enumerate(range(x0, x1)):
            tc, bc = top_row[i], bot_row[i]
            px[x, y] = tuple(round(tc[c] * (1 - t) + bc[c] * t) for c in range(3))

    draw = ImageDraw.Draw(rgb)
    draw.text((TAGLINE_LEFT_X, TAGLINE_LINE1_Y), TAGLINE_LINE1, font=font, fill=TEXT_COLOR)
    draw.text((TAGLINE_LEFT_X, TAGLINE_LINE2_Y), TAGLINE_LINE2, font=font, fill=TEXT_COLOR)


def erase_device_region(rgb):
    """Reconstruct the background under the old phone/watch mockup.

    Anchors every row to its own last clean pixel (just left of the erase
    boundary) and extrapolates rightward using the y=0 row's horizontal
    gradient shape. A simpler additive row+column model drifts by several
    RGB units away from the anchor and leaves a visible seam.
    """
    w, h = rgb.size
    px = rgb.load()
    row0 = [rgb.getpixel((x, 0)) for x in range(w)]
    anchor_col = [rgb.getpixel((DEVICE_ERASE_X0 - 1, y)) for y in range(h)]
    row0_anchor = row0[DEVICE_ERASE_X0 - 1]
    for y in range(h):
        a = anchor_col[y]
        for x in range(DEVICE_ERASE_X0, w):
            r0 = row0[x]
            px[x, y] = tuple(max(0, min(255, a[c] + (r0[c] - row0_anchor[c]))) for c in range(3))


def main():
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <version> <scene> <phone-screenshot>")
        print('Example: python3 scripts/gen-banner.py v1.6.2 3 "resources/app screenshot.jpeg"')
        sys.exit(64)
    version, scene, phone_screenshot = sys.argv[1], sys.argv[2], sys.argv[3]

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(FONT_PATH), FONT_SIZE)

    phone_out = TMP_DIR / "gen-banner-phone.png"
    composite_frame(PHONE_FRAME, phone_screenshot, phone_out)
    phone_src = Image.open(phone_out).convert("RGBA")
    phone_scale = PHONE_TARGET_H / phone_src.height
    phone_img = phone_src.resize(
        (round(phone_src.width * phone_scale), PHONE_TARGET_H), Image.LANCZOS
    )

    for fname, platform, frame in VARIANTS:
        watch_src_path = (
            REPO_ROOT / "screenshot" / version / "showcase" / "frames" / platform / f"scene_{scene}.png"
        )
        if not watch_src_path.is_file():
            print(f"Missing watch screenshot: {watch_src_path}")
            sys.exit(66)

        watch_out = TMP_DIR / f"gen-banner-{frame}.png"
        composite_frame(frame, watch_src_path, watch_out)
        watch_src = Image.open(watch_out).convert("RGBA")
        watch_scale = WATCH_TARGET_H / watch_src.height
        watch_img = watch_src.resize(
            (round(watch_src.width * watch_scale), WATCH_TARGET_H), Image.LANCZOS
        )

        banner_path = REPO_ROOT / "resources" / fname
        banner = Image.open(banner_path)
        has_alpha = banner.mode == "RGBA"
        rgb = banner.convert("RGB")

        redraw_tagline(rgb, font)
        erase_device_region(rgb)

        canvas = rgb.convert("RGBA")
        canvas.alpha_composite(phone_img, dest=PHONE_POS)
        canvas.alpha_composite(watch_img, dest=WATCH_POS)
        if not has_alpha:
            canvas = canvas.convert("RGB")

        canvas.save(banner_path)
        print(f"wrote {banner_path}")


if __name__ == "__main__":
    main()
