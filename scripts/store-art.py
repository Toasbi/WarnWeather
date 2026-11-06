#!/usr/bin/env python3
"""WarnWeather's appstore set, per platform: the showcase GIF and five store screens.

    python3 -I scripts/store-art.py <version> [--refresh]

Reads the watch screens scripts/capture-store-art.sh captured from the scenes of
scripts/gen-store-art-fixtures.js (screenshot/<version>/store-art/frames/<platform>/<scene>.png)
and writes each platform's set in the order it is uploaded:

    screenshot/<version>/store-art/<platform>/1-showcase.gif
    screenshot/<version>/store-art/<platform>/2-forecast.png .. 6-layouts.png

and, to judge them, build/store-art/contact-sheet-<platform>.png (every 4th frame of the GIF)
and build/store-art/screens-<platform>.png (the five screens at 2x), and the whole set in one
file to hand over, build/store-art/warnweather-store-<version>.zip. The store's time-lapse GIFs
(a real day of weather, frame by frame) stay on the listing as they are; this set replaces the
old reel and the single screenshots.

THE SHOWCASE (about 30 s on emery, less where a watch has fewer settings, looping): the
watchface as the watch draws it, then a tour of what it can do. In a tour scene the big clock
steps aside and its band shows the setting being changed, drawn as the settings page draws it
(a section header and the setting's options, the picked one in WarnWeather's coral, then a
line of what it does, typed), while the rest of the screen is the watch's own capture of that
setting: graph lines, forecast length and the left axis (Pebble Time 2 only), the alerts, the
UV slot's Now / Day max / Both (and tomorrow's max, marked with a »), the calendar; then the
views and layouts whole, and an end card. Scenes change with the glitch of Shapeshifter's
showcase (rows torn and shoved sideways, scan lines, a red ghost); a changed setting re-renders
only the screen around the panel.

THE STORE SCREENS: a two-line headline over the watch's screen, like a Play Store carousel
(the forecast, the alerts, the rain radar, the UV slot's values, the layouts), each at the
platform's own screenshot size.

The look follows Shapeshifter's store art (github.com/Toasbi/face-switcher, design/), in
WarnWeather's colours: its coral (#FF5555, the banner's "Warn" and the settings page's accent on
Pebble's palette), white, and the headline's ghosts in rain blue and red. Only Pebble's 64
colours (black and white on diorite, flint and aplite), no anti-aliasing: Pebble's own Gothic
fonts (fetched from PebbleOS at a fixed commit, checked by sha256), the canvas and the GIF
writer as Shapeshifter's. Every text is measured and the build fails on one that doesn't fit;
nothing flashes more than 3 times a second; every GIF frame decodes to the frame it was written
from. The same frames give the same bytes.

Needs Python 3 with Pillow, Node (for the scene list) and, on its first run, the network (the
fonts land in build/store-art/src/; --refresh fetches them again).
"""
import argparse
import hashlib
import json
import os
import random
import struct
import subprocess
import sys
import urllib.request
import zipfile

from PIL import Image, ImageChops, ImageDraw, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build', 'store-art')
SRC = os.path.join(BUILD, 'src')

# Pebble's system fonts, from PebbleOS at a fixed commit (as Shapeshifter's store art pins
# them): name -> the resource set it lives in, its sha256. Fetched, not kept here: PebbleOS is
# Apache-2.0, but its Gothic fonts' own licence isn't stated.
PEBBLEOS = ('https://raw.githubusercontent.com/coredevices/PebbleOS/6768a9c34610995def6e864f817338f0f3ce0632/'
            'resources/')
SYSTEM_FONTS = {
    'GOTHIC_14': ('common', 'a8e82f9182d61198dbf52190c8192c678bec37acc5cd392a64765eeada30c224'),
    'GOTHIC_14_BOLD': ('normal', '2a177a0f20a7cbf01c0af6e523514ff3773070525a89d5bf72b4ec19a9f30584'),
    'GOTHIC_18': ('normal', '8beeca139ad28f24cde3feaeaedbd6fe73b8f443f32bf4d6088c9ac536b43339'),
    'GOTHIC_18_BOLD': ('common', 'f7ce213bf3d29018ed1168d47e3469f2c71438d4309d6281db9582aca84bd9da'),
    'GOTHIC_24_BOLD': ('normal', 'b5332e573999b539cf6dcfcabc8dfb4766b852f1355d50829e7d1f404fcfdc11'),
    'GOTHIC_28_BOLD': ('normal', '471dfa583b81e43c1747b2ecb7e31efea90f7d0e0e2cbb11a0ac651cf4c315fd'),
}

TICK_MS = 40                # 25 frames a second
LEVELS = (0, 85, 170, 255)  # Pebble's colour channels
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREY = (170, 170, 170)
DARK_GREY = (85, 85, 85)
CORAL = (255, 85, 85)       # WarnWeather's coral: the banner's "Warn", the settings page's accent
DIM_CORAL = (170, 85, 85)
RULE = (255, 0, 0)          # a header's rule and its tick
GHOST_RED = (255, 0, 0)
GHOST_BLUE = (0, 170, 255)  # the rain bars' blue

PLATFORMS = ('emery', 'basalt', 'diorite', 'flint', 'aplite')
LOOP_S = (14.0, 33.0)       # the showcase's length, s
GIF_BUDGET = 1 << 20        # bytes; the store took the old 41 s reel at 945 KB


def log(*parts):
    """One line of progress."""
    print('store-art:', *parts, flush=True)


# ---------------------------------------------------------------------------------------
# Pebble's fonts and a canvas of Pebble pixels (Shapeshifter's design/watch_pixels.py).

def sha256_of(path):
    """A file's sha256, in hex."""
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def fetch(url, path, pin):
    """The file at url, kept at path: downloaded once and kept only if its sha256 is `pin`; a
    kept one is checked again each time."""
    if not os.path.exists(path):
        log('fetching', url)
        request = urllib.request.Request(url, headers={'User-Agent': 'warnweather-store-art'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != pin:
            raise SystemExit('%s: its sha256 is %s, not the pinned %s' % (url, hashlib.sha256(data).hexdigest(), pin))
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.replace(path + '.part', path)
    elif sha256_of(path) != pin:
        raise SystemExit('%s: its sha256 is not the pinned %s: --refresh fetches it again' % (path, pin))
    return path


class PebbleFont:
    """A firmware font (.pbf, version 3, uncompressed): its glyphs and its line height."""

    def __init__(self, path):
        data = open(path, 'rb').read()
        version, self.height, count, wildcard, table, cp_bytes, size, features = struct.unpack_from('<BBHHBBBB', data)
        if version != 3 or features & 2:
            raise SystemExit('%s: not an uncompressed version 3 font' % path)
        entry = '<' + ('L' if cp_bytes == 4 else 'H') + ('H' if features & 1 else 'L')
        entry_size = struct.calcsize(entry)
        offsets = size + 4 * table
        self.data, self.glyphs, self.wildcard = data, offsets + entry_size * count, wildcard
        self.index, self.cache = {}, {}
        for i in range(table):
            _, n, offset = struct.unpack_from('<BBH', data, size + 4 * i)
            for k in range(n):
                codepoint, glyph = struct.unpack_from(entry, data, offsets + offset + k * entry_size)
                self.index[codepoint] = glyph

    def glyph(self, char):
        """(left, top, advance, inked pixels) of a character, or of the wildcard."""
        codepoint = ord(char) if ord(char) in self.index else self.wildcard
        if codepoint not in self.cache:
            at = self.glyphs + self.index[codepoint]
            w, h, left, top, advance = struct.unpack_from('<BBbbb', self.data, at)
            bits = self.data[at + 5:at + 5 + (w * h + 7) // 8]
            pixels = [(i % w, i // w) for i in range(w * h) if bits[i >> 3] >> (i & 7) & 1]
            self.cache[codepoint] = (left, top, advance, pixels)
        return self.cache[codepoint]

    def width(self, text):
        """The text's advance: what the firmware measures a line by."""
        return sum(self.glyph(c)[2] for c in text)

    def origins(self, text, x):
        """Each character's origin on a line that starts at x, and where the next one would go."""
        out = []
        for c in text:
            out.append(x)
            x += self.glyph(c)[2]
        return out, x

    def ink_rows(self, text):
        """The first and last rows the text inks, from the line's top."""
        rows = [top + y for left, top, adv, pixels in map(self.glyph, text) for x, y in pixels]
        return min(rows), max(rows)


def system_fonts(refresh=False):
    """Pebble's Gothic fonts, fetched once into build/store-art/src/."""
    os.makedirs(SRC, exist_ok=True)
    fonts = {}
    for name, (where, pin) in SYSTEM_FONTS.items():
        path = os.path.join(SRC, name + '.pbf')
        if refresh and os.path.exists(path):
            os.remove(path)
        fonts[name] = PebbleFont(fetch('%s%s/base/pbf/%s.pbf' % (PEBBLEOS, where, name), path, pin))
    return fonts


class Canvas:
    """An RGB image drawn pixel by pixel inside a clip box (x0, y0, x1, y1; x1 and y1 exclusive).
    Every text drawn is kept in `inked` (its pixels' box and its words), for the checks."""

    def __init__(self, image):
        self.image = image.convert('RGB').copy()
        self.px = self.image.load()
        self.w, self.h = self.image.size
        self.clip = (0, 0, self.w, self.h)
        self.inked = []

    def set(self, x, y, colour):
        if self.clip[0] <= x < self.clip[2] and self.clip[1] <= y < self.clip[3]:
            self.px[x, y] = colour

    def fill(self, x0, y0, x1, y1, colour):
        """A filled box, its corners included."""
        for y in range(max(y0, self.clip[1]), min(y1 + 1, self.clip[3])):
            for x in range(max(x0, self.clip[0]), min(x1 + 1, self.clip[2])):
                self.px[x, y] = colour

    def hline(self, x0, x1, y, colour):
        self.fill(min(x0, x1), y, max(x0, x1), y, colour)

    def vline(self, x, y0, y1, colour):
        self.fill(x, min(y0, y1), x, max(y0, y1), colour)

    def round_box(self, x0, y0, x1, y1, colour, fill=None):
        """A 1 px outline with its corners cut by a pixel (the settings page's rounded controls),
        filled inside with `fill`."""
        if fill is not None:
            self.fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, fill)
        self.hline(x0 + 1, x1 - 1, y0, colour)
        self.hline(x0 + 1, x1 - 1, y1, colour)
        self.vline(x0, y0 + 1, y1 - 1, colour)
        self.vline(x1, y0 + 1, y1 - 1, colour)

    def text(self, font, x, y, text, colour):
        """One line of text, its line box's top at y and its origin at x; returns the x after it."""
        start = x
        for c in text:
            left, top, advance, inked = font.glyph(c)
            for px, py in inked:
                self.set(x + left + px, y + top + py, colour)
            x += advance
        if text.strip():
            lo, hi = font.ink_rows(text)
            self.inked.append((start, y + lo, x - 1, y + hi, text))
        return x


def fit(font, text, width, what):
    """The text's width, failing when it is over `width`."""
    px = font.width(text)
    if px > width:
        raise SystemExit('%s: %r is %d px, over its %d px' % (what, text, px, width))
    return px


def centred(canvas, font, box, text, colour, what):
    """One line centred in box (x, y, w) that must fit. Returns its x and width."""
    x, y, w = box
    px = fit(font, text, w, what)
    canvas.text(font, x + (w - px) // 2, y, text, colour)
    return x + (w - px) // 2, px


# What `pebble screenshot` shows of each of Pebble's 64 colours (pebble-tool's
# commands/screenshot.py, _correct_colours: the display's own colours, applied unless
# --no-correction). The captures are corrected so, and so is everything drawn here, so a panel's
# coral sits in the same palette as the watch's own colours.
_LEVELS4 = [(r, g, b) for r in LEVELS for g in LEVELS for b in LEVELS]
_SHOWN = (
    (0, 0, 0), (0, 30, 65), (0, 67, 135), (0, 104, 202), (43, 74, 44), (39, 81, 79), (22, 99, 141),
    (0, 125, 206), (94, 152, 96), (92, 155, 114), (87, 165, 162), (76, 180, 219), (142, 227, 145),
    (142, 230, 158), (138, 235, 192), (132, 245, 241), (74, 22, 27), (72, 39, 72), (64, 72, 138),
    (47, 107, 204), (86, 78, 54), (84, 84, 84), (79, 103, 144), (65, 128, 208), (117, 154, 100),
    (117, 157, 118), (113, 166, 164), (105, 181, 221), (158, 229, 148), (157, 231, 160), (155, 236, 194),
    (149, 246, 242), (153, 53, 63), (152, 62, 90), (149, 86, 148), (143, 116, 210), (157, 91, 77),
    (157, 96, 100), (154, 112, 153), (149, 135, 213), (175, 160, 114), (174, 163, 130), (171, 171, 171),
    (167, 186, 226), (201, 232, 157), (201, 234, 167), (199, 240, 200), (195, 249, 247), (227, 84, 98),
    (226, 88, 116), (225, 106, 163), (222, 131, 220), (230, 110, 107), (230, 114, 124), (227, 127, 167),
    (225, 148, 223), (241, 170, 134), (241, 173, 147), (239, 181, 184), (236, 195, 235), (255, 238, 171),
    (255, 241, 181), (255, 246, 211), (255, 255, 255))
CORRECT = dict(zip(_LEVELS4, _SHOWN))
PALETTE = frozenset(_SHOWN)


def check_palette(image, what, colour=True):
    """Every pixel one of the 64 colours as the screenshot shows them (black or white on a
    black and white watch)."""
    colours = {c for _, c in image.getcolors(1 << 16)}
    bad = sorted(colours - PALETTE) if colour else sorted(colours - {BLACK, WHITE})
    if bad:
        raise SystemExit('%s: colours off the watch palette: %s' % (what, bad[:6]))


# ---------------------------------------------------------------------------------------
# The watches, and the watch screens captured for them.

class Watch:
    """A platform the set is made for: its screenshot size, colour or black and white, the type
    of its panels (header, options, hint), of its captions and headlines, and the line its
    words take (x0 to x1, exclusive)."""

    def __init__(self, name, size, colour, header, option, hint, caption, headline, margin):
        self.name, (self.w, self.h), self.colour = name, size, colour
        self.header, self.option, self.hint, self.caption, self.headline = header, option, hint, caption, headline
        self.x0, self.x1 = margin, size[0] - margin

    def ink(self, colour):
        """One of Pebble's colours as this watch's screenshot shows it: corrected on a colour
        watch, white in black and white."""
        return CORRECT[colour] if self.colour else WHITE

    def fill_ink(self, colour):
        """A filled block's colour: in black and white, white."""
        return self.ink(colour)

    def on_fill(self):
        """Text on a filled block."""
        return WHITE if self.colour else BLACK


# Pebble Time 2 (emery) takes the bigger sizes; the 144 px watches the smaller ones (the
# captions in regular weight: the bold ones run over the 134 px line), and black and white
# draws all of it white.
SMALL = ('GOTHIC_14_BOLD', 'GOTHIC_14_BOLD', 'GOTHIC_14', 'GOTHIC_14', 'GOTHIC_24_BOLD', 5)
WATCHES = {
    'emery': Watch('emery', (200, 228), True, 'GOTHIC_18_BOLD', 'GOTHIC_18_BOLD', 'GOTHIC_18', 'GOTHIC_18_BOLD',
                   'GOTHIC_28_BOLD', 6),
    'basalt': Watch('basalt', (144, 168), True, *SMALL),
    'diorite': Watch('diorite', (144, 168), False, *SMALL),
    'flint': Watch('flint', (144, 168), False, *SMALL),
    'aplite': Watch('aplite', (144, 168), False, *SMALL),
}
# Where a black and white watch takes a panel scene's band from: its layout is basalt's (the
# same 144 x 168 geometry), and only a colour watch draws its clock in black.
BAND_FROM = {'emery': 'emery', 'basalt': 'basalt', 'diorite': 'basalt', 'flint': 'basalt', 'aplite': 'basalt'}


def scene_manifest():
    """The scenes (scripts/gen-store-art-fixtures.js --manifest): id, mode, flicks, platforms."""
    out = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'gen-store-art-fixtures.js'), '--manifest'],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return {s['id']: s for s in json.loads(out)}


class Screens:
    """The captured watch screens of one version, per platform and scene."""

    def __init__(self, version, scenes):
        self.dir = os.path.join(ROOT, 'screenshot', version, 'store-art', 'frames')
        self.scenes = scenes
        self.cache = {}

    def has(self, platform, scene):
        """Whether the scene belongs on the platform (the manifest says where it is captured)."""
        return scene in self.scenes and platform in self.scenes[scene]['platforms']

    def shot(self, platform, scene):
        """A captured screen, as the watch drew it; fails when a scene of the platform is missing."""
        key = (platform, scene)
        if key not in self.cache:
            path = os.path.join(self.dir, platform, scene + '.png')
            if not os.path.exists(path):
                raise SystemExit('%s: missing; run scripts/capture-store-art.sh' % os.path.relpath(path, ROOT))
            image = Image.open(path).convert('RGB')
            w = WATCHES[platform]
            if image.size != (w.w, w.h):
                raise SystemExit('%s: %s, not %dx%d' % (path, image.size, w.w, w.h))
            check_palette(image, path, w.colour)
            self.cache[key] = image
        return self.cache[key]

    def band(self, platform, scene):
        """A panel scene's clock band (y0, y1; y1 exclusive): the longest run of blank rows between
        the screen's top and bottom rows in the capture whose clock is drawn in black (a colour
        watch's own; a black and white one takes basalt's, its layout's)."""
        if self.scenes[scene]['mode'] != 'panel':
            raise SystemExit('%s is a full scene: it has no band' % scene)
        image = self.shot(BAND_FROM[platform], scene)
        w, h = image.size
        bg = BLACK
        rows = image.tobytes()
        blank = [rows[y * w * 3:(y + 1) * w * 3] == bytes(bg) * w for y in range(h)]
        best, y = (0, 0), 0
        while y < h:
            if blank[y]:
                start = y
                while y < h and blank[y]:
                    y += 1
                if start > 0 and y < h and y - start > best[1] - best[0]:
                    best = (start, y)
            else:
                y += 1
        if best[1] - best[0] < 24:
            raise SystemExit('%s/%s: no clock band (the longest blank run is %d rows)' % (platform, scene,
                                                                                      best[1] - best[0]))
        return best


# ---------------------------------------------------------------------------------------
# The panel: the settings page's look in Pebble pixels, in the clock's band.

def header(canvas, fonts, watch, y, title, typed=None):
    """A section header: '//', the title in coral, and a rule (with a tick at its start)
    through the middle of the capitals to the right edge. `typed` cuts the title (and hides the
    rule) while it is being typed. Returns the row under it."""
    font = fonts[watch.header]
    text = title if typed is None else title[:typed]
    fit(font, '// ' + title, watch.x1 - watch.x0 - 14, '%s header' % watch.name)
    x = canvas.text(font, watch.x0, y, '//', watch.ink(DIM_CORAL))
    x = canvas.text(font, x + 4, y, text, watch.ink(CORAL))
    if typed is None or typed >= len(title):
        lo, hi = font.ink_rows('H')
        mid = y + (lo + hi) // 2
        canvas.hline(x + 6, watch.x1 - 1, mid, watch.ink(RULE))
        canvas.vline(x + 6, mid - 2, mid + 2, watch.ink(RULE))
    return y + font.height


def segmented(canvas, fonts, watch, y, options, picked):
    """The settings page's segmented control: one box split into the options, the picked one
    filled in coral. The options share the line in proportion to their words. Returns the row
    under it."""
    font = fonts[watch.option]
    lo, hi = font.ink_rows('Hgy')
    h = hi - lo + 1 + 6
    widths = [font.width(o) for o in options]
    room = watch.x1 - watch.x0 - 1
    pad = (room - sum(widths)) // len(options)
    if pad < 6:
        raise SystemExit('%s: the options %s need %d px of %d' % (watch.name, options, sum(widths) + 6 * len(options),
                                                                  room))
    xs, x = [], watch.x0
    for i, wd in enumerate(widths):
        right = watch.x1 - 1 if i == len(options) - 1 else x + wd + pad
        xs.append((x, right))
        x = right
    canvas.round_box(watch.x0, y, watch.x1 - 1, y + h - 1, watch.ink(DARK_GREY) if watch.colour else WHITE)
    for i, ((a, b), option) in enumerate(zip(xs, options)):
        if i == picked:
            canvas.fill(a + (1 if i == 0 else 0), y + 1, b - (1 if i == len(options) - 1 else 0), y + h - 2,
                        watch.fill_ink(CORAL))
            colour = watch.on_fill()
        else:
            colour = WHITE
            if i and i - 1 != picked:
                canvas.vline(a, y + 3, y + h - 4, watch.ink(DARK_GREY) if watch.colour else WHITE)
        tx = a + (b - a + 1 - widths[i]) // 2
        canvas.text(font, tx, y + 3 - lo, option, colour)
    return y + h


def typed_line(canvas, font, watch, y, text, typed, colour, cursor, centre=False):
    """A line typed on from the left (or centred where it will stand whole), the page's cursor
    after it while `cursor`. Returns the row under it."""
    width = fit(font, text, watch.x1 - watch.x0 - font.width('_'), '%s line' % watch.name)
    x = watch.x0 + ((watch.x1 - watch.x0 - width) // 2 if centre else 0)
    origins, end = font.origins(text, x)
    shown = text[:typed]
    canvas.text(font, x, y, shown, colour)
    if cursor:
        cx = origins[typed] if typed < len(text) else end
        canvas.text(font, cx, y, '_', watch.ink(CORAL))
    return y + font.height


GAP = 3   # rows between a panel's header, its control and its line


def panel_layout(fonts, watch, kind):
    """A panel's content by its ink: the header's (its title's capitals and the '//'), the
    control's box, the line's (with its descenders), each `GAP` apart. Returns the rows it takes
    and, from its top, where each part's line box starts: (height, header_y, control_y, line_y)."""
    head = fonts[watch.header]
    h_lo, h_hi = head.ink_rows('//H')
    text = fonts[watch.hint if kind == 'setting' else watch.caption]
    t_lo, t_hi = text.ink_rows('Hgy')
    header_y = -h_lo
    y = h_hi - h_lo + 1 + GAP
    control_y = None
    if kind == 'setting':
        o_lo, o_hi = fonts[watch.option].ink_rows('Hgy')
        control_y = y
        y += o_hi - o_lo + 7 + GAP
    line_y = y - t_lo
    return y + t_hi - t_lo + 1, header_y, control_y, line_y


def draw_panel(canvas, fonts, watch, band, state):
    """The panel over the clock's band: black, then its content centred in the band by its ink.
    `state`: kind ('setting' or 'steps'), title, the header typed so far, the options and the
    picked one, the line under them and how much of it is typed, the cursor."""
    y0, y1 = band
    canvas.fill(0, y0, watch.w - 1, y1 - 1, BLACK)
    need, header_y, control_y, line_y = panel_layout(fonts, watch, state['kind'])
    if need > y1 - y0:
        raise SystemExit('%s: the %s panel needs %d rows, its band has %d (%d to %d)'
                         % (watch.name, state['title'], need, y1 - y0, y0, y1))
    top = y0 + (y1 - y0 - need) // 2
    title_typed = state.get('title_typed')
    header(canvas, fonts, watch, top + header_y, state['title'], title_typed)
    done = title_typed is None or title_typed >= len(state['title'])
    if not done or not state.get('line'):
        return
    if state['kind'] == 'setting':
        segmented(canvas, fonts, watch, top + control_y, state['options'], state['picked'])
        typed_line(canvas, fonts[watch.hint], watch, top + line_y, state['line'], state['typed'], watch.ink(GREY),
                   state.get('cursor', False))
    else:
        typed_line(canvas, fonts[watch.caption], watch, top + line_y, state['line'], state['typed'], WHITE,
                   state.get('cursor', False))


def brackets(canvas, watch, box, colour=CORAL):
    """Corner brackets locked on to a box (x0, y0, x1, y1, inclusive), 2 px thick, just outside
    it and inside the screen."""
    x0, y0 = max(0, box[0] - 2), max(0, box[1] - 2)
    x1, y1 = min(watch.w - 1, box[2] + 2), min(watch.h - 1, box[3] + 2)
    arm = 6 if watch.w > 144 else 4
    ink = watch.ink(colour)
    for cx, cy, sx, sy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        canvas.fill(min(cx, cx + sx * arm), min(cy, cy + sy), max(cx, cx + sx * arm), max(cy, cy + sy), ink)
        canvas.fill(min(cx, cx + sx), min(cy, cy + sy * arm), max(cx, cx + sx), max(cy, cy + sy * arm), ink)


def ink_rows_from(image, y):
    """The first run of inked rows at or below row y (a status bar's row), as (y0, y1) with y1
    exclusive."""
    w, h = image.size
    data = image.tobytes()

    def blank(row):
        return data[row * w * 3:(row + 1) * w * 3] == bytes(3 * w)

    while y < h and blank(y):
        y += 1
    end = y
    while end < h and not blank(end):
        end += 1
    return y, end


def blank_row(image, y):
    """Whether a row is all black."""
    return image.crop((0, y, image.width, y + 1)).getbbox() is None


def next_blank(image, y):
    """The first all-black row at or below row y."""
    while y < image.height and not blank_row(image, y):
        y += 1
    return y


def right_slot(image, rows, gap=5):
    """A status bar's right slot in its rows (y0, y1): the rightmost ink and what joins it
    leftwards within `gap` px (its icon), as an inclusive box."""
    y0, y1 = rows
    px = image.load()
    cols = [x for x in range(image.width) if any(px[x, y] != BLACK for y in range(y0, y1))]
    if not cols:
        raise SystemExit('no slot in rows %d to %d' % rows)
    x1 = x0 = cols[-1]
    for x in reversed(cols[:-1]):
        if x0 - x > gap:
            break
        x0 = x
    return x0, y0, x1, y1 - 1


# ---------------------------------------------------------------------------------------
# The glitch (Shapeshifter's showcase: a screen torn off row by row, rows shoved sideways,
# scan lines, a red ghost pushed out).

def glitch(watch, under, over, strength, rng, rows):
    """`over` torn off `under` inside the row bands `rows` ((y0, y1), ...): each row of `over`
    gone (more often the stronger, showing `under`), shoved sideways or kept; every 4th row a
    scan line (its colours dimmed; in black and white cut to black); in colour a red ghost of
    the torn ink pushed out to the right."""
    w, h = over.size
    out = under.copy()
    ink = Image.new('L', (w, h), 0)
    for y0, y1 in rows:
        for y in range(y0, y1):
            roll = rng.random()
            if roll < strength * strength:
                continue
            dx = rng.choice((-1, 1)) * rng.randint(2, 4 + int(14 * strength)) if roll < strength * 1.6 else 0
            row = over.crop((0, y, w, y + 1))
            line = Image.new('RGB', (w, 1), BLACK)
            line.paste(row, (dx, 0))
            out.paste(line, (0, y))
            ink.paste(line.convert('L').point(lambda v: 255 if v else 0), (0, y))
        start = y0 + rng.randrange(4)
        px = out.load()
        for y in range(start, y1, 4):
            for x in range(w):
                px[x, y] = DIMMED.get(px[x, y], BLACK) if watch.colour else BLACK
    if watch.colour:
        shift = 2 + round(4 * strength)
        ghost = Image.new('L', (w, h), 0)
        ghost.paste(ink, (shift, 0))
        ghost = ImageChops.subtract(ghost, ink)
        out.paste(Image.new('RGB', (w, h), watch.ink(GHOST_RED)), (0, 0), ghost)
    return out


# A scan line: each colour's Pebble channels halved (as the watch's own glitch halves its
# clock's rows) and shown as the screenshot shows that colour; black and white cuts the row to
# black.
DIMMED = {CORRECT[c]: CORRECT[tuple(LEVELS[LEVELS.index(v) >> 1] for v in c)] for c in _LEVELS4}


class Reel:
    """The GIF's frames, a 40 ms tick each until merged, and the holds the checks look at."""

    def __init__(self, watch):
        self.watch, self.frames, self.holds = watch, [], []

    def add(self, image, ticks=1):
        self.frames.append({'image': image, 'ms': TICK_MS * ticks})

    def last(self):
        return self.frames[-1]['image']

    def cut(self, image, rng, ticks=4):
        """The screen torn off into the next: the last frame torn harder over the next, then the
        next torn in over the last."""
        a, h = self.last(), self.watch.h
        for k in range(ticks):
            if k < ticks // 2:
                self.add(glitch(self.watch, image, a, 0.45 + 0.4 * k, rng, ((0, h),)))
            else:
                self.add(glitch(self.watch, a, image, 0.85 - 0.4 * (k - ticks // 2), rng, ((0, h),)))
        self.add(image)

    def rerender(self, image, band, rng, ticks=2):
        """A changed setting: the screen around the panel torn off into the new one, the panel
        whole."""
        a, h = self.last(), self.watch.h
        rows = ((0, band[0]), (band[1], h))
        for k in range(ticks):
            self.add(glitch(self.watch, image, a, 0.75 - 0.3 * k, rng, rows))
        self.add(image)


# ---------------------------------------------------------------------------------------
# The storyboard. Each beat names its scenes (scripts/gen-store-art-fixtures.js); a beat or a
# step whose scene isn't captured on a watch is left out there (the manifest says where each
# is), so every watch shows only what it can do.
#
# ('open', scene)                     the watchface, whole
# ('steps', title, steps)             a caption per step: (scene, line, marks)
# ('setting', title, options, steps)  the options (None: the manifest's span labels), the picked one per step:
#                                     (scene, picked, line, marks)
# ('gallery', title, line, scenes)    a card, then the screens whole
# ('end',)                            the wordmark and what it does
#
# `marks` names where the brackets lock on: 'top' (the Watch Status Bar), 'slot' (the UV slot,
# the status bar's right slot under the panel), 'calendar' (the calendar over the panel), or None.
# The UV slot's lines name its numbers: the morning's UV 3 now and 8 at noon, the evening's 0
# and tomorrow's 7 (forecast-long.json's UV through gen-store-art-fixtures.js' windows).
STORY = (
    ('open', 'hero'),
    ('steps', 'GRAPH LINES', (
        ('lines-rain', 'Rain chance and amount', None),
        ('lines-wind', 'Wind and gusts', None),
        ('lines-mix', 'Up to four at once', None))),
    ('setting', 'FORECAST LENGTH', None, (
        ('span-12', 0, 'The next 12 hours', None),
        ('span-long', 2, 'Up to 66 hours ahead', None))),
    ('setting', 'LEFT AXIS', ('On axis', 'On graph', 'Off'), (
        ('axis-axis', 0, 'High and low on the axis', None),
        ('axis-graph', 1, 'High and low on the graph', None),
        ('axis-off', 2, 'No axis: the full width', None))),
    ('steps', 'ALERTS', (
        ('alerts-calm', 'Out of sight until needed', None),
        ('alerts-on', 'Rain soon, UV and gusts', 'top'),
        ('alerts-line', 'UV line only from 5 up', None))),
    ('setting', 'UV INDEX SLOT', ('Now', 'Day max', 'Both'), (
        ('max-now', 0, '3 is the UV index now', 'slot'),
        ('max-day', 1, '8 is the max left today', 'slot'),
        ('max-both', 2, 'Now and today\'s max', 'slot'),
        ('max-tomorrow', 2, '» marks tomorrow\'s max', 'slot'))),
    ('steps', 'CALENDAR', (
        ('calendar', 'Three weeks at a glance', 'calendar'),)),
    ('gallery', 'VIEWS & LAYOUTS', 'Flick for radar and health. Layouts and themes too.', (
        'view-radar', 'view-health', 'layout-weather', 'layout-light')),
    ('gallery', 'LAYOUTS', 'Calendar or a big graph', ('layout-full', 'layout-nocal')),
    ('end',),
)
WORDMARK = ('Warn', 'Weather')
SLOGAN = 'The forecast at a glance, alerts when it matters.'

OPEN_TICKS = 30           # the watchface whole, before the tour (1.2 s)
HEADER_RATE = 4           # characters a tick
LINE_RATE = 5
STEP_TICKS = {'steps': 26, 'setting': 25}   # a step held once its line is typed
SLOT_TICKS = 30           # the UV slot's steps, which carry the most to read
CARD_TICKS = 25
GALLERY_TICKS = 20
END_TICKS = 44
BLINK = 12                # the cursor: on 12 ticks, off 12


def wrap(font, text, width):
    """Words broken into lines that each fit `width` px (the firmware's measure)."""
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if font.width(trial) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    for line in lines:
        fit(font, line, width, 'a wrapped line')
    return lines


class Showcase:
    """One watch's showcase GIF, beat by beat."""

    def __init__(self, watch, screens, fonts, seed):
        self.watch, self.screens, self.fonts = watch, screens, fonts
        self.rng = random.Random(seed)
        self.reel = Reel(watch)

    def has(self, scene):
        return self.screens.has(self.watch.name, scene)

    def shot(self, scene):
        return self.screens.shot(self.watch.name, scene)

    def compose(self, scene, state, marks=()):
        """A scene's capture with the panel over its clock's band and the brackets on."""
        canvas = Canvas(self.shot(scene))
        draw_panel(canvas, self.fonts, self.watch, state['band'], state)
        for box in marks:
            brackets(canvas, self.watch, box)
        y0, y1 = state['band']
        for x0, ty0, x1, ty1, text in canvas.inked:
            if not (0 <= x0 and x1 < self.watch.w and y0 <= ty0 and ty1 < y1):
                raise SystemExit('%s: %r runs out of its panel' % (self.watch.name, text))
        return canvas.image

    def band(self, scenes):
        """The rows the panel takes through a beat: the band every step's capture leaves."""
        bands = [self.screens.band(self.watch.name, s) for s in scenes]
        return max(b[0] for b in bands), min(b[1] for b in bands)

    def marks(self, kind, scenes, i, band):
        """Where a step's brackets lock on (see STORY): 'top', the Watch Status Bar (the first
        inked rows); 'slot', the right slot of the status bar under the panel; 'calendar', all
        that is between the Watch Status Bar and the panel."""
        shot = self.shot(scenes[i])
        if kind == 'top':
            y0, y1 = ink_rows_from(shot, 0)
            return ((0, y0, self.watch.w - 1, y1 - 1),)
        if kind == 'slot':
            return (right_slot(shot, ink_rows_from(shot, band[1])),)
        if kind == 'calendar':
            strip_end = ink_rows_from(shot, 0)[1]
            x0, y0, x1, y1 = shot.crop((0, strip_end, self.watch.w, band[0])).getbbox()
            return ((x0, y0 + strip_end, x1 - 1, y1 - 1 + strip_end),)
        return ()

    def beat(self, kind, title, options, steps):
        """A tour beat: the panel's header typed in, then each step: its capture (the setting
        changed: the screen around the panel re-rendered), its line typed, held."""
        steps = [s for s in steps if self.has(s[0])]
        if not steps or kind == 'setting' and len(steps) < 2:
            return
        scenes = [s[0] for s in steps]
        band = self.band(scenes)
        if options is None:
            options = self.screens.scenes[scenes[0]]['spanLabels']
        base = {'kind': kind, 'title': title, 'band': band, 'options': options}
        self.reel.cut(self.compose(scenes[0], dict(base, title_typed=0)), self.rng)
        for k in range(HEADER_RATE, len(title) + HEADER_RATE, HEADER_RATE):
            self.reel.add(self.compose(scenes[0], dict(base, title_typed=min(k, len(title)))))
        for i, step in enumerate(steps):
            scene, line, mark = (step[0], step[-2], step[-1])
            state = dict(base, picked=step[1] if kind == 'setting' else None, line=line, typed=0, cursor=True)
            first = self.compose(scene, state)
            if i:
                self.reel.rerender(first, band, self.rng)
            else:
                self.reel.add(first)
            for k in range(LINE_RATE, len(line) + LINE_RATE, LINE_RATE):
                self.reel.add(self.compose(scene, dict(state, typed=min(k, len(line)))))
            marks = self.marks(mark, scenes, i, band) if mark else ()
            hold = SLOT_TICKS if mark == 'slot' else STEP_TICKS[kind]
            typed_at = len(self.reel.frames)
            for t in range(hold):
                self.reel.add(self.compose(scene, dict(state, typed=len(line), cursor=(t // BLINK) % 2 == 0), marks))
            self.reel.holds.append((title, line, typed_at, len(self.reel.frames)))

    def card(self, title, line, typed, cursor):
        """A gallery's card: the header and its line, typed, in the middle of a black screen."""
        w = self.watch
        canvas = Canvas(Image.new('RGB', (w.w, w.h), BLACK))
        font = self.fonts[w.caption]
        lines = wrap(font, line, w.x1 - w.x0 - font.width('_'))
        y = (w.h - self.fonts[w.header].height - 4 - font.height * len(lines)) // 2
        y = header(canvas, self.fonts, w, y, title, typed[0]) + 4
        left = typed[1]
        for k, text in enumerate(lines):
            last = k == len(lines) - 1 or left <= len(text)
            typed_line(canvas, font, w, y, text, min(left, len(text)), WHITE, cursor and last and left >= 0)
            if last:
                break
            left -= len(text)
            y += font.height
        return canvas.image

    def gallery(self, title, line, scenes):
        """A card, then each screen whole."""
        scenes = [s for s in scenes if self.has(s)]
        if not scenes:
            return
        n = len(line.replace(' ', '')) + line.count(' ')
        self.reel.cut(self.card(title, line, (0, 0), False), self.rng)
        for k in range(HEADER_RATE, len(title) + HEADER_RATE, HEADER_RATE):
            self.reel.add(self.card(title, line, (min(k, len(title)), 0), False))
        for k in range(LINE_RATE, n + LINE_RATE, LINE_RATE):
            self.reel.add(self.card(title, line, (None, min(k, n)), True))
        typed_at = len(self.reel.frames)
        for t in range(CARD_TICKS):
            self.reel.add(self.card(title, line, (None, n), (t // BLINK) % 2 == 0))
        self.reel.holds.append((title, line, typed_at, len(self.reel.frames)))
        for scene in scenes:
            self.reel.cut(self.shot(scene), self.rng)
            self.reel.add(self.shot(scene), GALLERY_TICKS - 1)

    def end_card(self, typed, cursor):
        """The wordmark (Warn in coral, Weather in white, the headline's ghosts behind it) and
        what WarnWeather does, typed under it."""
        w = self.watch
        canvas = Canvas(Image.new('RGB', (w.w, w.h), BLACK))
        mark = self.fonts[w.headline]
        font = self.fonts[w.caption]
        lines = wrap(font, SLOGAN, w.x1 - w.x0 - font.width('_'))
        total = mark.height + 6 + font.height * len(lines)
        y = (w.h - total) // 2 - 4
        width = fit(mark, ''.join(WORDMARK), w.x1 - w.x0, '%s wordmark' % w.name)
        x = (w.w - width) // 2
        ghosted(canvas, mark, w, x, y, WORDMARK)
        y += mark.height + 6
        left = typed
        for k, text in enumerate(lines):
            last = k == len(lines) - 1 or left <= len(text)
            typed_line(canvas, font, w, y, text, min(left, len(text)), WHITE if k < len(lines) - 1 else
                       w.ink(CORAL), cursor and last, centre=True)
            if last:
                break
            left -= len(text)
            y += font.height
        return canvas.image, sum(len(t) for t in lines)

    def build(self):
        """The whole loop: the watchface, the tour, the end card, and back into the watchface."""
        for beat in STORY:
            if beat[0] == 'open':
                self.reel.add(self.shot(beat[1]), OPEN_TICKS)
            elif beat[0] == 'steps':
                self.beat('steps', beat[1], None, beat[2])
            elif beat[0] == 'setting':
                self.beat('setting', beat[1], beat[2], beat[3])
            elif beat[0] == 'gallery':
                self.gallery(beat[1], beat[2], beat[3])
            elif beat[0] == 'end':
                image, n = self.end_card(0, False)
                self.reel.cut(image, self.rng)
                for k in range(LINE_RATE, n + LINE_RATE, LINE_RATE):
                    self.reel.add(self.end_card(min(k, n), True)[0])
                typed_at = len(self.reel.frames)
                for t in range(END_TICKS):
                    self.reel.add(self.end_card(n, (t // BLINK) % 2 == 0)[0])
                self.reel.holds.append(('end', SLOGAN, typed_at, len(self.reel.frames)))
        self.reel.cut(self.shot(STORY[0][1]), self.rng)
        # The loop's last frame is the watchface the first one shows: drop it, the first holds.
        self.reel.frames.pop()
        return self.reel


def ghosted(canvas, font, watch, x, y, parts):
    """A line in `parts` (the first in coral, the rest white) with the clock's ghosts a pixel
    either way on a colour watch: rain blue to the left, red to the right."""
    text = ''.join(parts)
    if watch.colour:
        canvas.text(font, x - 1, y, text, watch.ink(GHOST_BLUE))
        canvas.text(font, x + 1, y, text, watch.ink(GHOST_RED))
    for i, part in enumerate(parts):
        x = canvas.text(font, x, y, part, watch.ink(CORAL) if i == 0 and watch.colour else WHITE)
    return x


# ---------------------------------------------------------------------------------------
# The GIF (Shapeshifter's writer: one table of the colours used and a transparent one, codes
# as narrow as that allows, each frame after the first the box that changed).

def merge(frames):
    """Consecutive identical frames as one, their delays added."""
    out = []
    for f in frames:
        if out and out[-1]['image'].tobytes() == f['image'].tobytes():
            out[-1] = dict(out[-1], ms=out[-1]['ms'] + f['ms'])
        else:
            out.append(dict(f))
    return out


def gif_lzw(data, m):
    """GIF's LZW of a frame's colour indices (bytes) with minimum code size m, as its data
    sub-blocks: a clear code, the codes (m + 1 bits wide and wider as the table grows, to 12;
    a full table starts again after a clear code), the end code."""
    clear, end = 1 << m, (1 << m) + 1
    out = bytearray()
    acc, nbits = clear, m + 1
    width, nxt, table = m + 1, end + 1, {}
    prefix = data[0]
    for c in data[1:]:
        key = prefix << 8 | c
        code = table.get(key)
        if code is not None:
            prefix = code
            continue
        acc |= prefix << nbits
        nbits += width
        if nxt < 4096:
            table[key] = nxt
            nxt += 1
            if nxt > 1 << width and width < 12:
                width += 1
        else:
            acc |= clear << nbits
            nbits += width
            width, nxt, table = m + 1, end + 1, {}
        while nbits >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            nbits -= 8
        prefix = c
    acc |= prefix << nbits
    nbits += width
    if nxt < 4096 and nxt >= 1 << width and width < 12:
        width += 1
    acc |= end << nbits
    nbits += width
    out += acc.to_bytes((nbits + 7) // 8, 'little')
    return b''.join(bytes([len(out[i:i + 255])]) + out[i:i + 255] for i in range(0, len(out), 255)) + b'\0'


def save_gif(frames, path):
    """The frames, identical ones merged, as a looping GIF. Returns the merged frames."""
    frames = merge(frames)
    w, h = frames[0]['image'].size
    used = sorted({c for f in frames for _, c in f['image'].getcolors(1 << 16)})
    if len(used) > 255:
        raise SystemExit('%s: %d colours' % (path, len(used)))
    palette = Image.new('P', (1, 1))
    flat = [v for c in used for v in c]
    # Padded with a colour no frame uses, so every pixel maps to its own entry, never past them.
    palette.putpalette(flat + [1, 2, 3] * (256 - len(used)))
    transparent = len(used)
    m = max(2, transparent.bit_length())
    out = bytearray(struct.pack('<6sHHBBB', b'GIF89a', w, h, 0xF0 | (m - 1), 0, 0))
    out += bytes(flat + [0] * (3 * (1 << m) - len(flat)))
    out += b'\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00'
    prev = None
    for f in frames:
        q = f['image'].quantize(palette=palette, dither=Image.Dither.NONE)
        cur = Image.frombytes('L', (w, h), q.tobytes())
        if prev is None:
            box, data = (0, 0, w, h), gif_lzw(cur.tobytes(), m)
        else:
            changed = ImageChops.difference(cur, prev).point(lambda v: 255 if v else 0)
            box = changed.getbbox() or (0, 0, 1, 1)
            crop = cur.crop(box)
            clear = Image.composite(crop, Image.new('L', crop.size, transparent), changed.crop(box))
            data = min(gif_lzw(crop.tobytes(), m), gif_lzw(clear.tobytes(), m), key=len)
        x0, y0, x1, y1 = box
        out += struct.pack('<BBBBHBB', 0x21, 0xF9, 4, 1 << 2 | (prev is not None), f['ms'] // 10, transparent, 0)
        out += struct.pack('<BHHHHBB', 0x2C, x0, y0, x1 - x0, y1 - y0, 0, m) + data
        prev = cur
    with open(path, 'wb') as fp:
        fp.write(out + b';')
    return frames


def check_gif(path, frames, watch):
    """Size, length, frames and colours of a written GIF, as a line; fails on a wrong one and on
    a frame that doesn't decode to the frame it was written from."""
    gif = Image.open(path)
    total, colours = 0, set()
    if gif.n_frames != len(frames):
        raise SystemExit('%s: %d frames, written from %d' % (path, gif.n_frames, len(frames)))
    for i, f in enumerate(frames):
        gif.seek(i)
        total += gif.info['duration']
        image = gif.convert('RGB')
        if image.tobytes() != f['image'].tobytes() or gif.info['duration'] != f['ms']:
            raise SystemExit('%s: frame %d does not decode to the frame it was written from' % (path, i))
        colours.update(c for _, c in image.getcolors(1 << 16))
    length = os.path.getsize(path)
    bad = sorted(colours - (PALETTE if watch.colour else {BLACK, WHITE}))
    long_enough = LOOP_S[0] * 1000 <= total <= LOOP_S[1] * 1000
    if gif.size != (watch.w, watch.h) or bad or length >= GIF_BUDGET or not long_enough:
        raise SystemExit('%s: %s, %d bytes, %d ms, colours off the palette %s'
                         % (path, gif.size, length, total, bad[:6]))
    return '%s: %dx%d, %d frames, %.2f s, %d KB, %s' % (
        watch.name, gif.size[0], gif.size[1], gif.n_frames, total / 1000, length // 1024,
        '%d colours' % len(colours) if watch.colour else 'black and white')


def per_tick(frames):
    """The frames as one image a 40 ms tick."""
    out = []
    for f in frames:
        out += [f['image']] * max(1, f['ms'] // TICK_MS)
    return out


def check_flashes(images, watch):
    """Nothing flashes more than 3 times a second: in any second of the loop (round the loop),
    at most 6 changes from one frame to the next of the mean brightness by a tenth of the range
    or more, over the screen and over each quarter of it."""
    w, h = images[0].size
    boxes = [(0, 0, w, h)] + [(x, y, x + w // 2, y + h // 2) for y in (0, h // 2) for x in (0, w // 2)]
    window, n = 1000 // TICK_MS, len(images)
    grey = [image.convert('L') for image in images]
    most = 0
    for box in boxes:
        means = [ImageStat.Stat(g.crop(box)).mean[0] for g in grey]
        steps = [abs(means[i] - means[i - 1]) for i in range(n)]
        jumps = [i for i in range(n) if steps[i] >= 25.5]
        for i in jumps:
            count = sum(1 for j in jumps if (j - i) % n < window)
            if count > 6:
                raise SystemExit('%s: the GIF flashes more than 3 times a second at %.2f s (in %s)'
                                 % (watch.name, i * TICK_MS / 1000, box))
            most = max(most, count)
    return 'at most %d big changes of brightness in a second' % most


def check_holds(reel):
    """Every line held whole, once typed, long enough to read: a second at least."""
    for title, line, typed, cut in reel.holds:
        if (cut - typed) * TICK_MS < 1000:
            raise SystemExit('%s: %r held %d ms once typed' % (title, line, (cut - typed) * TICK_MS))


def contact_sheet(images, path, every=4, cols=8):
    """Every 4th tick at 1:1, labelled with its time."""
    w, h = images[0].size
    picks = list(range(0, len(images), every))
    cell_w, cell_h = w + 8, h + 20
    sheet = Image.new('RGB', (cols * cell_w + 8, -(-len(picks) // cols) * cell_h + 8), (32, 32, 32))
    draw = ImageDraw.Draw(sheet)
    for n, i in enumerate(picks):
        x, y = 8 + (n % cols) * cell_w, 8 + (n // cols) * cell_h
        sheet.paste(images[i], (x, y))
        draw.text((x, y + h + 4), '%.2f s' % (i * TICK_MS / 1000), fill=(200, 200, 200))
    sheet.save(path)


# ---------------------------------------------------------------------------------------
# The store screens: a headline over the watch's screen (Shapeshifter's store screens).
#
# Each is (file, headline, what, place, marks): `what` a scene shown whole under the headline,
# or 'card' (the UV slot's values); `place` 'top' (the screen from its top row down, its
# bottom under the frame) or 'bottom' (from its bottom row up, its top under the headline);
# `marks` 'alerts' locks the brackets on to the alerts in the Watch Status Bar.
SCREENS = {
    'default': (
        ('2-forecast', ('THE FORECAST', 'AT A GLANCE'), 'hero', 'bottom', None),
        ('3-alerts', ('ALERTS WHEN', 'IT MATTERS'), 'alerts-full', 'top', 'alerts'),
        ('4-radar', ('RAIN RADAR', '2 HOURS AHEAD'), 'view-radar', 'bottom', None),
        ('5-max', ('NOW, TODAY', 'AND TOMORROW'), 'card', None, None),
        ('6-layouts', ('YOUR LAYOUT,', 'YOUR WAY'), 'layout-weather', 'top', None),
    ),
    'aplite': (
        ('2-forecast', ('THE FORECAST', 'AT A GLANCE'), 'hero', 'bottom', None),
        ('3-lines', ('RAIN, WIND', 'OR UV'), 'layout-nocal', 'bottom', None),
        ('4-max', ('NOW, TODAY', 'AND TOMORROW'), 'card', None, None),
        ('5-calendar', ('THREE WEEKS', 'AT A GLANCE'), 'layout-full', 'top', None),
        ('6-uv', ('THE UV INDEX', 'HOUR BY HOUR'), 'aplite-uv', 'bottom', None),
    ),
}
# The UV slot's card: each value selection, the slot as the watch shows it then, and what it
# means. The same numbers as STORY's lines.
CARD_ROWS = (('NOW', 'max-now', 'UV now'), ('DAY MAX', 'max-day', 'max left today'),
             ('BOTH', 'max-both', 'now / max'), ('EVENING', 'max-tomorrow', '» tomorrow\'s max'))
CARD_NOTE = 'Wind, gusts and AQI too.'
# The headline: font, first line's top, second line's top, the rule's row.
HEADLINES = {200: ('GOTHIC_28_BOLD', 0, 24, 18), 144: ('GOTHIC_24_BOLD', -5, 13, 11)}
STORE_CORNER = {200: 12, 144: 9}   # px of a corner the store rounds off


def headline(canvas, fonts, watch, first, second):
    """Two lines: the first white with its ghosts (rain blue left, red right) on the rule, the
    second in coral. Returns the row under them."""
    name, top, second_top, rule = HEADLINES[watch.w]
    font = fonts[name]
    canvas.hline(0, watch.w - 1, rule, watch.ink(RULE))
    width = fit(font, first, watch.x1 - watch.x0, '%s headline' % watch.name)
    x = (watch.w - width) // 2
    canvas.fill(x - 6, rule, x + width + 5, rule, BLACK)
    ghosted(canvas, font, watch, x, top, ('', first))
    centred(canvas, font, (watch.x0, second_top, watch.x1 - watch.x0), second, watch.ink(CORAL),
            '%s headline' % watch.name)
    return second_top + font.ink_rows(second)[1] + 4


def check_corners(canvas, watch, what):
    """No word in the corners the store rounds off."""
    r = STORE_CORNER[watch.w]
    for x0, y0, x1, y1, text in canvas.inked:
        for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
            cx = r if x < r else watch.w - 1 - r if x > watch.w - 1 - r else x
            cy = r if y < r else watch.h - 1 - r if y > watch.h - 1 - r else y
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                raise SystemExit('%s %s: %r runs into a rounded corner' % (watch.name, what, text))


def uv_slot(screens, watch, scene):
    """The UV slot as a scene shows it: the right slot of the status bar under the clock's band."""
    shot = screens.shot(watch.name, scene)
    return right_slot(shot, ink_rows_from(shot, screens.band(watch.name, scene)[1]))


def uv_card(canvas, fonts, screens, watch, top):
    """The UV slot's values: a row each (its name, what it means under it, and the slot as the
    watch shows it then), under a header on Pebble Time 2, and a note."""
    crops = []
    for name, scene, means in CARD_ROWS:
        x0, y0, x1, y1 = uv_slot(screens, watch, scene)
        crops.append(screens.shot(watch.name, scene).crop((x0 - 1, y0 - 1, x1 + 2, y1 + 2)))
    y = top
    if watch.w > 144:
        y = header(canvas, fonts, watch, y, 'UV INDEX SLOT') + 2
    label, note = fonts[watch.option], fonts[watch.hint]
    pitch = label.height + note.height - (4 if watch.w > 144 else 3)
    for (name, scene, means), crop in zip(CARD_ROWS, crops):
        cx = watch.x1 - crop.width
        fit(label, name, cx - watch.x0 - 4, '%s card' % watch.name)
        fit(note, means, watch.x1 - watch.x0, '%s card' % watch.name)
        canvas.text(label, watch.x0, y, name, watch.ink(CORAL))
        canvas.text(note, watch.x0, y + label.height - 2, means, watch.ink(GREY))
        canvas.image.paste(crop, (cx, y + (pitch - crop.height) // 2))
        canvas.px = canvas.image.load()
        y += pitch
    for line in wrap(note, CARD_NOTE, watch.x1 - watch.x0):
        canvas.text(note, watch.x0, y, line, WHITE)
        y += note.height
    if y > watch.h - 2:
        raise SystemExit('%s: the UV card runs %d px past the screen' % (watch.name, y - watch.h + 2))


def store_screen(screens, fonts, watch, spec):
    """One store screen: the headline over a watch screen or the UV card."""
    name, (first, second), what, place, marks = spec
    canvas = Canvas(Image.new('RGB', (watch.w, watch.h), BLACK))
    top = HEADLINES[watch.w][2] + fonts[HEADLINES[watch.w][0]].height + 4
    if what == 'card':
        uv_card(canvas, fonts, screens, watch, top)
    else:
        shot = screens.shot(watch.name, what)
        if screens.scenes[what]['mode'] != 'full':
            raise SystemExit('%s: %s is a panel scene, its clock is blank' % (name, what))
        dy = top if place == 'top' else 0
        # From its bottom up, the screen starts at the first blank row under the headline, so
        # no element shows cut in half there.
        start = top if place == 'top' else next_blank(shot, top)
        visible = shot.crop((0, start - dy, watch.w, watch.h - dy))
        canvas.image.paste(visible, (0, start))
        canvas.px = canvas.image.load()
        if marks == 'alerts':
            y0, y1 = ink_rows_from(shot, 0)
            brackets(canvas, watch, (0, y0 + dy, watch.w - 1, y1 - 1 + dy))
    canvas.fill(0, 0, watch.w - 1, top - 1, BLACK)
    headline(canvas, fonts, watch, first, second)
    check_corners(canvas, watch, name)
    check_palette(canvas.image, '%s %s' % (watch.name, name), watch.colour)
    return name + '.png', canvas.image


# ---------------------------------------------------------------------------------------
# The run.

BUNDLE_TIME = (1980, 1, 1, 0, 0, 0)   # every zip entry's time: the same every build


def bundle(folder, path):
    """The whole set in one zip: its entries sorted, with fixed times, so two builds give the
    same bytes."""
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in sorted(os.walk(folder)):
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, folder)
                if rel.startswith('frames' + os.sep):
                    continue
                info = zipfile.ZipInfo(rel, BUNDLE_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                with open(full, 'rb') as f:
                    z.writestr(info, f.read())


def build_platform(screens, fonts, platform, out, sheets):
    """One watch's set: the showcase GIF and its five store screens."""
    watch = WATCHES[platform]
    folder = os.path.join(out, platform)
    os.makedirs(folder, exist_ok=True)
    seed = int(hashlib.sha256(platform.encode()).hexdigest()[:8], 16)
    reel = Showcase(watch, screens, fonts, seed).build()
    check_holds(reel)
    for f in reel.frames:
        check_palette(f['image'], '%s showcase' % platform, watch.colour)
    ticks = per_tick(reel.frames)
    flashes = check_flashes(ticks, watch)
    gif = os.path.join(folder, '1-showcase.gif')
    written = save_gif(reel.frames, gif)
    log(check_gif(gif, written, watch) + ', ' + flashes)
    contact_sheet(ticks, os.path.join(sheets, 'contact-sheet-%s.png' % platform))
    images = []
    for spec in SCREENS['aplite' if platform == 'aplite' else 'default']:
        name, image = store_screen(screens, fonts, watch, spec)
        image.save(os.path.join(folder, name), optimize=True)
        images.append(image)
    sheet = Image.new('RGB', (len(images) * (watch.w * 2 + 8) + 8, watch.h * 2 + 16), (32, 32, 32))
    for i, image in enumerate(images):
        sheet.paste(image.resize((watch.w * 2, watch.h * 2), Image.NEAREST), (8 + i * (watch.w * 2 + 8), 8))
    sheet.save(os.path.join(sheets, 'screens-%s.png' % platform))
    log('%s: %s' % (platform, ', '.join(spec[0] + '.png' for spec in SCREENS['aplite' if platform == 'aplite'
                                                                             else 'default'])))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('version', help='the screenshot folder, e.g. v2.3.0')
    parser.add_argument('--platforms', default=' '.join(PLATFORMS), help='which watches (default: all five)')
    parser.add_argument('--refresh', action='store_true', help='fetch the fonts again')
    args = parser.parse_args()
    fonts = system_fonts(args.refresh)
    screens = Screens(args.version, scene_manifest())
    out = os.path.join(ROOT, 'screenshot', args.version, 'store-art')
    os.makedirs(BUILD, exist_ok=True)
    for platform in args.platforms.split():
        if platform not in WATCHES:
            raise SystemExit('unknown platform %s' % platform)
        build_platform(screens, fonts, platform, out, BUILD)
    path = os.path.join(BUILD, 'warnweather-store-%s.zip' % args.version)
    bundle(out, path)
    log('wrote', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    sys.exit(main())
