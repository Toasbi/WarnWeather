#!/usr/bin/env python3
"""WarnWeather's appstore set, per platform: the showcase GIF and five store screens.

    python3 -I scripts/store-art.py <version> [--platforms "emery basalt"]

Reads the watch screens scripts/capture-store-art.sh captured from the scenes of
scripts/gen-store-art-fixtures.js (screenshot/<version>/store-art/frames/<platform>/<scene>.png)
and writes each platform's set in the order it is uploaded:

    screenshot/<version>/store-art/<platform>/1-showcase.gif
    screenshot/<version>/store-art/<platform>/2-forecast.png .. 6-layouts.png

and, to judge them, build/store-art/contact-sheet-<platform>.png (the GIF every 8th tick) and
build/store-art/screens-<platform>.png (the five screens at 2x), and the whole set in one file
to hand over, build/store-art/warnweather-store-<version>.zip. The store's time-lapse GIFs (a
real day of weather, frame by frame) stay on the listing as they are; this set replaces the old
reel and the single screenshots.

THE SHOWCASE: a time-lapse of a day and a half on the watch (Saturday's calm, the evening and the
night, Sunday's thunderstorm), which stops now and then to show what the watchface can do and
goes on. At a stop a card takes the big clock's place and explains what the screen shows: a
setting (its segmented control, the picked option in the watch's red, what it does), changed
in place while the rest of the screen redraws with it, or what the moment brings (the UV slot's
tomorrow mark at night, the calendar at midnight, the alerts before the storm), a thin ring
round where to look. It opens on the calm morning and brings in the alerts with the storm;
then the layouts, and the wordmark. Cards unfold from the clock's middle and fold back into
it, the selection slides, words move up out of view and the next ones up into it, and a
setting's screen redraws from left to right.

THE STORE SCREENS: a two-line headline over the watch's screen (the forecast, the alerts, the
health view, the UV slot's values, Weather only), each at the platform's own screenshot size.

Everything drawn is in the watch screen's own colours (black, white, its two greys and its
red; black and white on a black and white watch), anti-aliased, in Poppins (the banner's
type); only the wordmark keeps the banner's coral. Every text is measured and the build fails
on one that doesn't fit; nothing flashes more than 3 times a second; every GIF frame decodes
to the frame it was written from. The same frames give the same bytes.

Needs Python 3 with Pillow, and Node for the scene list. The type is Poppins
(screenshot/fonts/, SIL Open Font License: screenshot/fonts/Poppins-OFL.txt).
"""
import argparse
import json
import os
import struct
import subprocess
import sys
import zipfile
from collections import Counter

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build', 'store-art')
FONTS = os.path.join(ROOT, 'screenshot', 'fonts')

TICK_MS = 40                # 25 frames a second
PLATFORMS = ('emery', 'basalt', 'diorite', 'flint', 'aplite')
LOOP_S = (14.0, 62.0)       # the showcase's length, s
GIF_BUDGET = 1536 * 1024    # bytes (the store took the old 41 s reel at 945 KB; it states no limit)

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
# The watch's own colours as its screenshots show them (CORRECT below): its light grey (the
# axis' values), its dark grey (the night hatch, the axis), its red (the temperature line).
GREY = (171, 171, 171)
DARK_GREY = (84, 84, 84)
RED = (227, 84, 98)
WARN = (255, 90, 60)        # the banner's "Warn", the wordmark's alone
SS = 4                      # shapes are drawn 4x and scaled down: their anti-aliasing


def log(*parts):
    """One line of progress."""
    print('store-art:', *parts, flush=True)


# ---------------------------------------------------------------------------------------
# Type and shapes.

POPPINS = {'regular': 'Poppins-Regular.ttf', 'medium': 'Poppins-Medium.ttf', 'semibold': 'Poppins-SemiBold.ttf'}
_FONTS = {}


def font(spec):
    """Poppins at a weight and a pixel size, spec (weight, size). Laid out by FreeType alone: its
    whole-pixel advances keep a word space open at these sizes, where the shaped layout's
    fractional ones close it up."""
    if spec not in _FONTS:
        weight, size = spec
        _FONTS[spec] = ImageFont.truetype(os.path.join(FONTS, POPPINS[weight]), size,
                                          layout_engine=ImageFont.Layout.BASIC)
    return _FONTS[spec]


TALL = 'Hbdfhiklt\'gjpqy'   # a line's tallest and lowest letters: where any line's ink can reach


def ink(f, text=TALL):
    """The rows a text inks around its baseline: (top, bottom), top negative."""
    _, top, _, bottom = f.getbbox(text, anchor='ls')
    return top, bottom


def cap(f):
    """A font's cap height."""
    return -ink(f, 'H')[0]


def width(f, text):
    """A line's advance, in whole pixels."""
    return int(round(f.getlength(text)))


def fit(f, text, room, what):
    """The line's width, failing when it is over `room`."""
    px = width(f, text)
    if px > room:
        raise SystemExit('%s: %r is %d px, over its %d px' % (what, text, px, room))
    return px


def wrap(f, text, room, most, what):
    """Words broken into lines that each fit `room` px, at most `most` of them. A text that
    doesn't fit one line breaks at its '\\n' where it has one, else greedily, and two lines are
    broken where their longer one is shortest, so the second isn't a word left over."""
    words = text.split()
    if width(f, ' '.join(words)) > room and '\n' in text:
        lines = text.split('\n')
    else:
        lines, line = [], ''
        for word in words:
            trial = (line + ' ' + word).strip()
            if width(f, trial) <= room or not line:
                line = trial
            else:
                lines.append(line)
                line = word
        lines.append(line)
        if len(lines) == 2:
            splits = [(' '.join(words[:i]), ' '.join(words[i:])) for i in range(1, len(words))]
            lines = list(min(splits, key=lambda ab: (max(width(f, ab[0]), width(f, ab[1])), -width(f, ab[0]))))
    for line in lines:
        fit(f, line, room, what)
    if len(lines) > most:
        raise SystemExit('%s: %r takes %d lines, it has %d' % (what, text, len(lines), most))
    return lines


def wraps(f, text, room, most):
    """Whether a text wraps into at most `most` lines that each fit `room` px."""
    try:
        wrap(f, text, room, most, '')
    except SystemExit:
        return False
    return True


def pick_copy(copy, fits):
    """The copy itself, or of (long, short) the first that `fits`; the short one's fit check
    reports a line that fits neither."""
    if isinstance(copy, str):
        return copy
    return copy[0] if fits(copy[0]) else copy[1]


def clip_box(image, clip):
    """A clip box (x0, y0, x1, y1, fractions allowed) as whole pixels inside the image, or None
    when it is empty."""
    if clip is None:
        return 0, 0, image.width, image.height
    x0, y0 = max(0, int(clip[0])), max(0, int(clip[1]))
    x1, y1 = min(image.width, -int(-clip[2])), min(image.height, -int(-clip[3]))
    return (x0, y0, x1, y1) if x1 > x0 and y1 > y0 else None


def say(image, f, x, baseline, text, colour, alpha=1.0, clip=None, texts=None):
    """One line of text, its origin at x on the baseline, `alpha` of the way over what is there
    and only inside `clip`; kept in `texts` (its inked box and its words) for the checks."""
    box = clip_box(image, clip)
    if alpha <= 0 or box is None or not text:
        return
    x0, y0, x1, y1 = box
    mask = Image.new('L', (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(mask).text((x - x0, baseline - y0), text, font=f, fill=255, anchor='ls')
    if alpha < 1:
        mask = mask.point(lambda v: int(v * alpha + 0.5))
    image.paste(colour, box, mask)
    if texts is not None:
        l, t, r, b = f.getbbox(text, anchor='ls')
        texts.append(((x + l, baseline + t, x + r, baseline + b), text))


def round_rect(image, box, radius, colour, ring=None, alpha=1.0, clip=None):
    """A box with round corners (x0, y0, x1, y1, its far edges at x1 and y1, fractions allowed),
    anti-aliased: filled, or, with `ring`, only that many px of it inside its edge; `alpha` of the
    way over what is there, and only inside `clip`."""
    x0, y0, x1, y1 = box
    left, top, right, bottom = int(x0), int(y0), -int(-x1), -int(-y1)
    w, h = right - left, bottom - top
    if w <= 0 or h <= 0 or alpha <= 0:
        return
    mask = Image.new('L', (w * SS, h * SS), 0)
    d = ImageDraw.Draw(mask)

    def scaled(a, b, c, e):
        return ((a - left) * SS, (b - top) * SS, max((a - left) * SS, (c - left) * SS - 1),
                max((b - top) * SS, (e - top) * SS - 1))

    r = max(0, min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
    d.rounded_rectangle(scaled(x0, y0, x1, y1), r * SS, fill=255)
    if ring and x1 - x0 > 2 * ring and y1 - y0 > 2 * ring:
        d.rounded_rectangle(scaled(x0 + ring, y0 + ring, x1 - ring, y1 - ring), max(0, r - ring) * SS, fill=0)
    mask = mask.resize((w, h), Image.BOX)
    if alpha < 1:
        mask = mask.point(lambda v: int(v * alpha + 0.5))
    cb = clip_box(image, clip)
    if cb is None:
        return
    ix0, iy0 = max(left, cb[0]), max(top, cb[1])
    ix1, iy1 = min(right, cb[2]), min(bottom, cb[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return
    image.paste(colour, (ix0, iy0, ix1, iy1), mask.crop((ix0 - left, iy0 - top, ix1 - left, iy1 - top)))


def mix(a, b, t):
    """Colour a, t of the way to colour b."""
    return tuple(int(round(p + (q - p) * t)) for p, q in zip(a, b))


def lerp(a, b, t):
    """a, t of the way to b (numbers, or tuples of them)."""
    if isinstance(a, tuple):
        return tuple(p + (q - p) * t for p, q in zip(a, b))
    return a + (b - a) * t


def ease(t):
    """In and out: slow, fast, slow."""
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t):
    """Out: fast, then settling."""
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


def part(t, a, b):
    """How far t is through the part of a transition from a to b (0 before it, 1 after)."""
    return min(1.0, max(0.0, (t - a) / (b - a)))


# What `pebble screenshot` shows of each of Pebble's 64 colours (pebble-tool's
# commands/screenshot.py, _correct_colours: the display's own colours, applied unless
# --no-correction). The captures are checked against it: a capture in other colours was taken
# some other way.
LEVELS = (0, 85, 170, 255)
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

# Two sets of sizes: Pebble Time 2's 200 px and the 144 px of the others. `inset` is the card's
# gap to the screen's side, `margin` its words' gap to the card's side; `track` is a segmented
# control's height and `pad` its selection's inset; `gap` the rows between a card's parts; `rise`
# how far words travel as they come and go.
TYPE = {
    'big': dict(
        inset=3, margin=8, card_r=8, track=22, track_r=7, pad=2, pill_r=5, gap=4, ring=1.5, rise=6,
        label=('medium', 12), option=('semibold', 12), hint=('regular', 13), caption=('medium', 15),
        chip=('medium', 13), wordmark=('semibold', 24), slogan=('regular', 13), headline=('semibold', 19),
        head_pad=9, row_name=('semibold', 13), row_note=('regular', 12), note=('regular', 12), screen_r=10),
    'small': dict(
        inset=2, margin=6, card_r=6, track=16, track_r=5, pad=2, pill_r=4, gap=3, ring=1.5, rise=4,
        label=('medium', 10), option=('semibold', 10), hint=('regular', 10), caption=('medium', 12),
        chip=('medium', 11), wordmark=('semibold', 17), slogan=('regular', 10), headline=('semibold', 15),
        head_pad=6, row_name=('semibold', 11), row_note=('regular', 10), note=('regular', 10), screen_r=7),
}


class Watch:
    """A platform the set is made for: its screenshot size, colour or black and white, the sizes
    its type and cards take (TYPE), and its colours: on a colour watch its own greys and red, on
    a black and white one white."""

    def __init__(self, name, size, colour, kind):
        self.name, (self.w, self.h), self.colour = name, size, colour
        self.k = TYPE[kind]
        self.accent = RED if colour else WHITE          # the picked option, the ring
        self.on_accent = WHITE if colour else BLACK      # words on the accent
        self.line = DARK_GREY if colour else WHITE       # a card's edge, a control's track
        self.muted = GREY if colour else WHITE           # a card's name, an option not picked
        self.second = RED if colour else GREY            # a headline's second line

    def f(self, role):
        """The font a role takes on this watch."""
        return font(self.k[role])


WATCHES = {
    'emery': Watch('emery', (200, 228), True, 'big'),
    'basalt': Watch('basalt', (144, 168), True, 'small'),
    'diorite': Watch('diorite', (144, 168), False, 'small'),
    'flint': Watch('flint', (144, 168), False, 'small'),
    'aplite': Watch('aplite', (144, 168), False, 'small'),
}
# Where a black and white watch takes a band from: its layout is basalt's (the same 144 x 168
# geometry), and only a colour watch draws its clock in black.
BAND_FROM = {'emery': 'emery', 'basalt': 'basalt', 'diorite': 'basalt', 'flint': 'basalt', 'aplite': 'basalt'}
# The band scene of a scene's layout: the three-week calendar's own, else the compact calendar's
# (every day frame's, and every setting's).
BAND_OF = {'cal-full': 'band-full'}


def scene_manifest():
    """The scenes (scripts/gen-store-art-fixtures.js --manifest): id, mode, moment, platforms."""
    out = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'gen-store-art-fixtures.js'), '--manifest'],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


class Screens:
    """The captured watch screens of one version, per platform and scene, and the day's frames
    in order."""

    def __init__(self, version, manifest):
        self.dir = os.path.join(ROOT, 'screenshot', version, 'store-art', 'frames')
        self.scenes = {s['id']: s for s in manifest}
        self.day = [s['id'] for s in manifest if s['mode'] == 'day']
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
        """The clock's band of a scene's layout (y0, y1; y1 exclusive): the longest run of blank
        rows between the screen's top and bottom rows in its band scene, whose clock is drawn in
        black (a colour watch's own; a black and white one takes basalt's, its layout's)."""
        image = self.shot(BAND_FROM[platform], BAND_OF.get(scene, 'band-compact'))
        w, h = image.size
        rows = image.tobytes()
        blank = [rows[y * w * 3:(y + 1) * w * 3] == bytes(3 * w) for y in range(h)]
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
            raise SystemExit('%s/%s: no clock band (the longest blank run is %d rows)'
                             % (platform, scene, best[1] - best[0]))
        return best


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


def next_blank(image, y):
    """The first all-black row at or below row y."""
    while y < image.height and image.crop((0, y, image.width, y + 1)).getbbox() is not None:
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


def ring_box(watch, box):
    """The ring round a box (x0, y0, x1, y1, inclusive): 3 px out from it, kept on the screen."""
    return (max(0, box[0] - 3), max(0, box[1] - 3), min(watch.w, box[2] + 4), min(watch.h, box[3] + 4))


def draw_ring(image, watch, box, alpha=1.0):
    """The thin ring in the accent that shows where to look."""
    round_rect(image, box, 4, watch.accent, ring=watch.k['ring'], alpha=alpha)


# ---------------------------------------------------------------------------------------
# The card: what a stop explains, over the clock's band.

class Card:
    """A stop's card in a band: a setting (its name, its options with the picked one, what it
    does) or a moment (its name, a caption of up to two lines). Its words are fitted on creation:
    a line is its words or (long, short), the long one where it fits."""

    def __init__(self, watch, kind, title, options, picked, line, band):
        self.watch, self.kind, self.title, self.options, self.picked, self.band = (
            watch, kind, title, options, picked, band)
        k = watch.k
        self.box = (k['inset'], band[0], watch.w - k['inset'], band[1])
        x0, x1 = self.span()
        room = x1 - x0
        what = '%s %s card' % (watch.name, title)
        fit(watch.f('label'), title, room, what)
        if kind == 'setting':
            f = watch.f('hint')
            text = pick_copy(line, lambda t: width(f, t) <= room)
            fit(f, text, room, what)
            self.lines = [text]
        else:
            f = watch.f('caption')
            most = self.caption_room()
            text = pick_copy(line, lambda t: wraps(f, t, room, most))
            self.lines = wrap(f, text, room, most, what)
        self.need = self.layout()[0]
        if self.need > band[1] - band[0] - 2:
            raise SystemExit('%s: the %s card needs %d rows, its band has %d' % (watch.name, title, self.need,
                                                                                band[1] - band[0] - 2))

    def span(self):
        """Where its words and control go across the screen: x0, x1 (exclusive)."""
        k = self.watch.k
        return k['inset'] + k['margin'], self.watch.w - k['inset'] - k['margin']

    def caption_room(self):
        """How many caption lines the band holds: two where they fit, else one."""
        k, f = self.watch.k, self.watch.f('caption')
        lab_t, lab_b = ink(self.watch.f('label'), self.title)
        t, b = ink(f)
        rows = self.band[1] - self.band[0] - 2
        return 2 if lab_b - lab_t + k['gap'] - t + (f.size + 3) + b <= rows else 1

    def layout(self):
        """Its rows by their ink, from its content's top: (height, label baseline, control top,
        first line's baseline, line pitch). The name by its own letters (it stays while the
        card's lines change), the lines by the tallest and lowest any line can have, so they
        keep their row from step to step."""
        k = self.watch.k
        lab_t, lab_b = ink(self.watch.f('label'), self.title)
        y = lab_b - lab_t + k['gap']
        control = None
        if self.kind == 'setting':
            control = y
            y += k['track'] + k['gap']
            f = self.watch.f('hint')
        else:
            f = self.watch.f('caption')
        t, b = ink(f)
        pitch = f.size + 3
        return y - t + (len(self.lines) - 1) * pitch + b, -lab_t, control, y - t, pitch

    def top(self, box):
        """Its content's top row in a box (the card's, as it moves)."""
        return box[1] + (box[3] - box[1] - self.need) / 2

    def spans(self):
        """The options across the control's track: each one's (x0, x1), floats, sharing the
        track in proportion to their words, as the settings page's buttons do."""
        k = self.watch.k
        f = self.watch.f('option')
        x0, x1 = self.span()
        inner = x1 - x0 - 2 * k['pad']
        widths = [width(f, o) for o in self.options]
        extra = (inner - sum(widths)) / len(self.options)
        if extra < 8:
            raise SystemExit('%s: the options %s need %d px of %d' % (self.watch.name, self.options,
                                                                      sum(widths) + 8 * len(self.options), inner))
        out, x = [], x0 + k['pad']
        for wd in widths:
            out.append((x, x + wd + extra))
            x += wd + extra
        return out

    def same_control(self, other):
        """Whether another card has the same control (the selection can slide between them)."""
        return other is not None and self.kind == other.kind == 'setting' and self.options == other.options


def draw_card_box(image, watch, box, alpha=1.0):
    """The card itself: black over the clock, a hairline edge in the watch's dark grey."""
    k = watch.k
    round_rect(image, box, k['card_r'], BLACK, alpha=alpha)
    round_rect(image, box, k['card_r'], watch.line, ring=1, alpha=alpha)


def draw_title(image, card, box, alpha=1.0, dy=0.0, texts=None, clip=None):
    """The card's name, muted, laid out in `box` and shown inside `clip` (the box's inside)."""
    x0, _ = card.span()
    say(image, card.watch.f('label'), x0, round(card.top(box) + card.layout()[1] + dy), card.title,
        card.watch.muted, alpha, clip or inner(card, box), texts)


def draw_control(image, card, box, pill, alpha=1.0, texts=None, clip=None):
    """The card's segmented control: its track, the selection at `pill` (x0, x1), each option's
    words in the accent's ink as far as the selection covers them."""
    watch, k = card.watch, card.watch.k
    x0, x1 = card.span()
    y = card.top(box) + card.layout()[2]
    clip = clip or inner(card, box)
    round_rect(image, (x0, y, x1, y + k['track']), k['track_r'], watch.line, ring=1, alpha=alpha, clip=clip)
    a, b = pill
    round_rect(image, (a, y + k['pad'], b, y + k['track'] - k['pad']), k['pill_r'], watch.accent, alpha=alpha,
               clip=clip)
    f = watch.f('option')
    baseline = round(y + (k['track'] + cap(f) + 1) / 2)
    for option, (sa, sb) in zip(card.options, card.spans()):
        wd = width(f, option)
        tx = int(round((sa + sb - wd) / 2))
        covered = max(0.0, min(b, tx + wd) - max(a, tx)) / wd
        say(image, f, tx, baseline, option, mix(watch.muted, watch.on_accent, covered), alpha, clip, texts)


def draw_lines(image, card, box, alpha=1.0, dy=0.0, texts=None, clip=None):
    """The card's line (a setting's, in white) or caption (a moment's, in white, a little bigger)."""
    x0, _ = card.span()
    _, _, _, line_y, pitch = card.layout()
    f = card.watch.f('hint' if card.kind == 'setting' else 'caption')
    top = card.top(box)
    for i, line in enumerate(card.lines):
        say(image, f, x0, round(top + line_y + i * pitch + dy), line, WHITE, alpha, clip or inner(card, box),
            texts)


def inner(card, box):
    """Where a card's words may show in its box: inside its edge."""
    return box[0] + 1, box[1] + 1, box[2] - 1, box[3] - 1


def draw_card(image, card, box, texts=None):
    """A card at rest: its box, name, control and line."""
    draw_card_box(image, card.watch, box)
    draw_title(image, card, box, texts=texts)
    if card.kind == 'setting':
        draw_control(image, card, box, card.spans()[card.picked], texts=texts)
    draw_lines(image, card, box, texts=texts)


# ---------------------------------------------------------------------------------------
# A layout's label: a small chip at the bottom of the screen.

def chip_box(watch, text):
    """A chip's box for its text, centred at the screen's bottom."""
    f = watch.f('chip')
    w = width(f, text) + 2 * watch.k['margin']
    h = cap(f) + 2 * watch.k['margin'] - 2
    x0 = (watch.w - w) / 2
    return x0, watch.h - h - 4, x0 + w, watch.h - 4


def draw_chip(image, watch, text, box, alpha=1.0, text_alpha=None, dy=0.0, texts=None):
    """A chip: black, the watch's dark grey edge, its words in white."""
    fit(watch.f('chip'), text, watch.w - 4 * watch.k['margin'], '%s chip' % watch.name)
    round_rect(image, box, (box[3] - box[1]) / 2, BLACK, alpha=alpha)
    round_rect(image, box, (box[3] - box[1]) / 2, watch.line, ring=1, alpha=alpha)
    f = watch.f('chip')
    x = int(round((box[0] + box[2] - width(f, text)) / 2))
    baseline = round((box[1] + box[3] + cap(f)) / 2 + dy)
    say(image, f, x, baseline, text, WHITE, alpha if text_alpha is None else text_alpha,
        (box[0] + 1, box[1] + 1, box[2] - 1, box[3] - 1), texts)


# ---------------------------------------------------------------------------------------
# The storyboard. The day runs frame by frame ('run' to a frame) and stops ('stop': cards,
# each a setting or a moment with its steps). A step or a card whose scene isn't captured on a
# watch is left out there, a setting card needs two steps, and a card can name its watches, so
# every watch shows only what it can do.
#
# ('open', scene, ticks)                 the first frame, held
# ('run', scene)                         on through the day's frames to this one
# ('stop', card, ...)                    a stop at the frame the run reached; each card:
#     ('setting', title, options, steps[, platforms])   options None: the scene's span labels;
#                                                        a step (scene, picked, line, mark)
#     ('moment', title, steps[, platforms])              a step (scene, line, mark)
# ('layouts', (scene, label), ...)       the layouts whole, each with its label
# ('end',)                               the wordmark and what it does, then back to the start
#
# A line is its words, or (long, short) where a 144 px watch needs the short one; a '\n' marks
# where a caption breaks when it takes two lines. `mark` puts the ring on 'top' (the Watch
# Status Bar), 'slot' (the UV slot: the forecast row's right slot under the card) or
# 'calendar' (between the Watch Status Bar and the card), or nowhere (None). The numbers are
# the day's (gen-store-art-fixtures.js): UV 5 at 10:00 with 8 to come, 3 the next day; the rain
# 15 minutes away at 08:45 on Sunday, the gusts up to 59 km/h at noon.
NOT_APLITE = ('emery', 'basalt', 'diorite', 'flint')
STORY = (
    ('open', 'day-0-0800', 30),
    ('run', 'day-0-1000'),
    ('stop', ('setting', 'UV index slot', ('Now', 'Day max', 'Both'), (
        ('day-0-1000', 2, ('Now and today\'s max: 5/8', 'Now / today\'s max'), 'slot'),
        ('uv-now', 0, ('The UV index now: 5', 'UV index now: 5'), 'slot'),
        ('uv-max', 1, ('Highest UV left today: 8', 'Max left today: 8'), 'slot')))),
    ('run', 'day-0-1200'),
    ('stop', ('moment', 'Graph lines', (
        ('day-0-1200', 'Rain chance and amount', None),
        ('lines-wind', 'Wind and gusts', None),
        ('lines-mix', 'Up to four lines at once', None)))),
    ('run', 'day-0-1400'),
    ('stop', ('setting', 'Forecast length', None, (
        ('day-0-1400', 1, 'The next 24 hours', None),
        ('span-long', 2, 'Up to 60 hours ahead', None))),
     ('setting', 'Left axis values', ('On axis', 'On graph', 'Off'), (
         ('day-0-1400', 0, 'High and low on the axis', None),
         ('axis-off', 2, 'No axis, a wider graph', None)))),
    ('run', 'day-0-2200'),
    ('stop', ('moment', 'UV index slot', (
        ('day-0-2200', ('After sunset: » marks\ntomorrow\'s max', '» is tomorrow\'s max'), 'slot'),))),
    ('run', 'day-1-0000'),
    ('stop', ('moment', 'Calendar', (
        ('day-1-0000', ('Midnight: on to Sunday', 'On to Sunday'), 'calendar'),
        ('cal-full', ('Or three weeks at a glance', 'Or three weeks'), 'calendar')))),
    ('run', 'day-1-0845'),
    ('stop', ('moment', 'Weather alerts', (
        ('day-1-0845', ('Rain in 15 minutes,\ngusts up to 59 today', 'Rain soon, gusts 59'), 'top'),),
        NOT_APLITE)),
    ('run', 'day-1-1400'),
    ('layouts', ('layout-weather', 'Weather only'), ('layout-light', 'Light theme'), ('view-health', 'Health view'),
     ('layout-nocal', 'No calendar')),
    ('end',),
)
WORDMARK = ('Warn', 'Weather')
SLOGAN = 'The forecast at a glance,\nalerts when it matters.'

RUN_TICKS = 3             # a day frame, as the day runs (its first tick half the last frame)
OPEN = 9                  # a card unfolding
STEP = 12                 # a step to the next: the selection slides, the screen redraws
CLOSE = 10                # a card folding back into the clock
CHIP = 5                  # a layout coming in, its label after it
END_TICKS = 62            # the wordmark, held
FIRST_EXTRA = 5           # a card's first step: its name is read with it
SETTLE = 6                # the day stopped at a frame, before the card unfolds
LOOP = 9                  # into the wordmark, and from it into the first frame


def hold_ticks(text):
    """How long a step holds once it is in: 0.9 s and 45 ms a character, between 1.8 and 2.8 s."""
    return int(round(min(2.8, max(1.8, 0.9 + 0.045 * len(text))) * 1000 / TICK_MS))


class Reel:
    """The GIF's frames, each a whole number of 40 ms ticks, and the holds the checks look at."""

    def __init__(self, watch):
        self.watch, self.frames, self.holds = watch, [], []

    def add(self, image, ticks=1, fading=False):
        self.frames.append({'image': image, 'ms': TICK_MS * ticks, 'fading': fading})

    def last(self):
        return self.frames[-1]['image']


def wipe(a, b, t, feather=18):
    """Screen a redrawn as b from left to right, t of the way, through a soft edge."""
    w, h = a.size
    front = t * (w + feather)
    row = Image.new('L', (w, 1))
    row.putdata([int(255 * min(1.0, max(0.0, (front - x) / feather))) for x in range(w)])
    return Image.composite(b, a, row.resize((w, h), Image.NEAREST))


class Moment:
    """What the screen shows at a tick: a scene, maybe a card over its band and a ring, maybe a
    layout's label."""

    def __init__(self, scene, card=None, ring=None, chip=None):
        self.scene, self.card, self.ring, self.chip = scene, card, ring, chip


class Showcase:
    """One watch's showcase GIF, from the storyboard."""

    def __init__(self, watch, screens):
        self.watch, self.screens = watch, screens
        self.reel = Reel(watch)
        self.at = None      # the day frame the run has reached

    def has(self, scene):
        return self.screens.has(self.watch.name, scene)

    def shot(self, scene):
        return self.screens.shot(self.watch.name, scene)

    def mark(self, kind, scene, band):
        """Where a step's ring goes (see STORY): 'top', the Watch Status Bar (the first inked rows);
        'slot', the right slot of the forecast row under the card; 'calendar', all that is
        between the Watch Status Bar and the card."""
        if not kind:
            return None
        shot = self.shot(scene)
        if kind == 'top':
            y0, y1 = ink_rows_from(shot, 0)
            return ring_box(self.watch, (0, y0, self.watch.w - 1, y1 - 1))
        if kind == 'slot':
            return ring_box(self.watch, right_slot(shot, ink_rows_from(shot, band[1])))
        if kind == 'calendar':
            strip_end = ink_rows_from(shot, 0)[1]
            x0, y0, x1, y1 = shot.crop((0, strip_end, self.watch.w, band[0])).getbbox()
            return ring_box(self.watch, (x0, y0 + strip_end, x1 - 1, y1 - 1 + strip_end))
        raise SystemExit('unknown mark %r' % kind)

    # -- drawing a tick ------------------------------------------------------------------

    def render(self, a, b, t, texts=None):
        """The tick t of the way from moment a to moment b: the screen redrawn from a's scene to
        b's, the card unfolding, folding or stepping on, the ring and the label coming and going."""
        if a.scene == b.scene or t >= 1:
            image = self.shot(b.scene if t >= 1 else a.scene).copy()
        elif t <= 0:
            image = self.shot(a.scene).copy()
        else:
            image = wipe(self.shot(a.scene), self.shot(b.scene), ease(t))
        self.render_card(image, a.card, b.card, t, texts)
        self.render_ring(image, a.ring, b.ring, t)
        self.render_chip(image, a.chip, b.chip, t, texts)
        return image

    def render_card(self, image, a, b, t, texts):
        """A card at rest, unfolding (a None), folding (b None) or stepping from a to b."""
        rise = self.watch.k['rise']
        if a is None and b is None:
            return
        if a is None or b is None:
            card = b if a is None else a
            # Unfolding: the box opens from its middle (the first 60 %), the words rise in after it.
            # Folding: the words sink out first, then the box closes back into its middle.
            if a is None:
                grow, words = ease_out(part(t, 0, 0.6)), ease_out(part(t, 0.35, 1))
            else:
                grow, words = 1 - ease(part(t, 0.3, 1)), 1 - ease(part(t, 0, 0.5))
            x0, y0, x1, y1 = card.box
            cy, half = (y0 + y1) / 2, (y1 - y0) / 2 * grow
            if half < 1:
                return
            box = (x0, cy - half, x1, cy + half)
            draw_card_box(image, self.watch, box)
            clip = inner(card, box)
            dy = rise * (1 - words)
            draw_title(image, card, card.box, words, dy, clip=clip)
            if card.kind == 'setting':
                draw_control(image, card, card.box, card.spans()[card.picked], words, clip=clip)
            draw_lines(image, card, card.box, words, dy, clip=clip)
            return
        if a is b or t >= 1:
            draw_card(image, b, b.box, texts)
            return
        e = ease(t)
        box = lerp(a.box, b.box, e)
        draw_card_box(image, self.watch, box)
        out_t, in_t = ease(part(t, 0, 0.55)), ease(part(t, 0.45, 1))
        if a.title == b.title:
            draw_title(image, b, box)
        else:
            draw_title(image, a, box, 1 - out_t, -rise * out_t)
            draw_title(image, b, box, in_t, rise * (1 - in_t))
        if b.same_control(a):
            sa, sb = a.spans()[a.picked], b.spans()[b.picked]
            draw_control(image, b, box, lerp(sa, sb, e))
        else:
            if a.kind == 'setting':
                draw_control(image, a, box, a.spans()[a.picked], 1 - out_t)
            if b.kind == 'setting':
                draw_control(image, b, box, b.spans()[b.picked], in_t)
        if a.lines == b.lines and a.kind == b.kind:
            draw_lines(image, b, box)
        else:
            draw_lines(image, a, box, 1 - out_t, -rise * out_t)
            draw_lines(image, b, box, in_t, rise * (1 - in_t))

    def render_ring(self, image, a, b, t):
        """The ring at rest, coming in (a None), going (b None) or moving from a to b."""
        if a is None and b is None:
            return
        if a is not None and b is not None:
            draw_ring(image, self.watch, lerp(a, b, ease(t)) if t < 1 else b)
        elif a is None:
            draw_ring(image, self.watch, b, ease(part(t, 0.5, 1)))
        else:
            draw_ring(image, self.watch, a, 1 - ease(part(t, 0, 0.4)))

    def render_chip(self, image, a, b, t, texts):
        """A layout's label at rest, rising in after its layout (a None), fading (b None) or
        changing its words."""
        rise = self.watch.k['rise']
        if a is None and b is None:
            return
        if t >= 1 or a == b:
            if b is not None:
                draw_chip(image, self.watch, b, chip_box(self.watch, b), texts=texts)
            return
        if a is None:
            e = ease_out(part(t, 0.55, 1))
            x0, y0, x1, y1 = chip_box(self.watch, b)
            draw_chip(image, self.watch, b, (x0, y0 + rise * 2 * (1 - e), x1, y1 + rise * 2 * (1 - e)), e)
        elif b is None:
            draw_chip(image, self.watch, a, chip_box(self.watch, a), 1 - ease(part(t, 0, 0.35)))
        else:
            out_t, in_t = ease(part(t, 0, 0.45)), ease(part(t, 0.55, 1))
            box = lerp(chip_box(self.watch, a), chip_box(self.watch, b), ease(t))
            draw_chip(image, self.watch, a if t < 0.5 else b, box, 1.0, 0.0)
            draw_chip(image, self.watch, a, box, 0.0, 1 - out_t, -rise * out_t)
            draw_chip(image, self.watch, b, box, 0.0, in_t, rise * (1 - in_t))

    # -- the reel ------------------------------------------------------------------------

    def go(self, a, b, ticks, hold, what=None):
        """From moment a to moment b in `ticks` ticks, then b held for `hold` (0: not added); the
        words b shows are checked once at rest."""
        for i in range(1, ticks):
            self.reel.add(self.render(a, b, i / ticks), fading=True)
        if hold:
            texts = []
            image = self.render(b, b, 1, texts)
            self.check_words(texts, b)
            self.reel.add(image, hold)
            if what:
                self.reel.holds.append((what, hold * TICK_MS))

    def check_words(self, texts, moment):
        """Every word at rest inside its card or its label."""
        if moment.card is not None:
            box = inner(moment.card, moment.card.box)
        elif moment.chip is not None:
            box = chip_box(self.watch, moment.chip)
        else:
            box = (0, 0, self.watch.w, self.watch.h)
        for (x0, y0, x1, y1), text in texts:
            if x0 < box[0] or y0 < box[1] or x1 > box[2] or y1 > box[3]:
                raise SystemExit('%s: %r runs out of its card or label' % (self.watch.name, text))

    def run(self, to):
        """On through the day's frames from the one reached to `to`, a soft cut a frame."""
        day = self.screens.day
        i, j = day.index(self.at), day.index(to)
        for scene in day[i + 1:j + 1]:
            if not self.has(scene):
                continue
            last = self.shot(self.at)
            self.reel.add(Image.blend(last, self.shot(scene), 0.5), fading=True)
            self.reel.add(self.shot(scene), RUN_TICKS - 1)
            self.at = scene

    def cards(self, specs):
        """A stop's cards on this watch: each card's steps that are captured here, as moments
        (a setting with fewer than two left out), in order."""
        out = []
        for spec in specs:
            kind, title = spec[0], spec[1]
            if kind == 'setting':
                options, steps, platforms = spec[2], spec[3], spec[4] if len(spec) > 4 else PLATFORMS
            else:
                options, steps, platforms = None, spec[2], spec[3] if len(spec) > 3 else PLATFORMS
            if self.watch.name not in platforms:
                continue
            steps = [s for s in steps if self.has(s[0])]
            if not steps or kind == 'setting' and len(steps) < 2:
                continue
            if kind == 'setting' and options is None:
                options = next(self.screens.scenes[s[0]]['spanLabels'] for s in steps
                               if self.screens.scenes[s[0]]['spanLabels'])
            moments = []
            for step in steps:
                scene = step[0]
                band = self.screens.band(self.watch.name, scene)
                picked = step[1] if kind == 'setting' else None
                line, mark = step[-2], step[-1]
                card = Card(self.watch, kind, title, options, picked, line, band)
                moments.append(Moment(scene, card, self.mark(mark, scene, band)))
            out.append(moments)
        return out

    def stop(self, specs):
        """A stop at the frame the run reached: the first card unfolds over it, each step goes on
        to the next (and card to card), and the last folds back into the clock while the screen
        redraws as the frame again."""
        cards = self.cards(specs)
        if not cards:
            return
        here = Moment(self.at)
        self.reel.add(self.shot(self.at), SETTLE)
        if cards[0][0].scene != self.at:
            raise SystemExit('%s: a stop starts at %s, the run is at %s' % (self.watch.name, cards[0][0].scene,
                                                                            self.at))
        last = here
        for moments in cards:
            for n, m in enumerate(moments):
                words = m.card.title + ': ' + ' '.join(m.card.lines)
                # A card's first step holds a little longer: its name is read with it.
                hold = hold_ticks(' '.join(m.card.lines)) + (FIRST_EXTRA if n == 0 else 0)
                self.go(last, m, OPEN if last.card is None else STEP, hold, words)
                last = m
        self.go(last, here, CLOSE, 0)
        self.reel.add(self.shot(self.at), 2)

    def layouts(self, items):
        """The layouts whole, each redrawn in from the last, its label rising in after it."""
        items = [(scene, label) for scene, label in items if self.has(scene)]
        last = Moment(self.at)
        for scene, label in items:
            m = Moment(scene, chip=label)
            self.go(last, m, STEP + CHIP, hold_ticks(label + ' layout'), label)
            last = m

    def end_card(self):
        """The wordmark (the banner's coral Warn, Weather in white) and what it does, on black."""
        w = self.watch
        image = Image.new('RGB', (w.w, w.h), BLACK)
        texts = []
        room = w.w - 2 * (w.k['inset'] + w.k['margin'])
        mark, sf = w.f('wordmark'), w.f('slogan')
        lines = wrap(sf, SLOGAN, room, 3, '%s slogan' % w.name)
        name = ''.join(WORDMARK)
        fit(mark, name, room, '%s wordmark' % w.name)
        m_top, _ = ink(mark, name)
        pitch = sf.size + 5
        height = -m_top + w.k['gap'] * 3 + sf.size + (len(lines) - 1) * pitch
        return image, texts, lines, mark, sf, name, (w.h - height) // 2 - m_top, pitch

    def draw_end(self, t):
        """The wordmark rising in, then its line."""
        w = self.watch
        image, texts, lines, mark, sf, name, y, pitch = self.end_card()
        a, b = ease_out(part(t, 0, 0.6)), ease_out(part(t, 0.4, 1))
        rise = w.k['rise'] * 2
        x = int(round((w.w - width(mark, name)) / 2))
        say(image, mark, x, round(y + rise * (1 - a)), WORDMARK[0], WARN if w.colour else WHITE, a, texts=texts)
        say(image, mark, x + width(mark, WORDMARK[0]), round(y + rise * (1 - a)), WORDMARK[1],
            WHITE if w.colour else GREY, a, texts=texts)
        y += w.k['gap'] * 3 + sf.size
        for text in lines:
            say(image, sf, int(round((w.w - width(sf, text)) / 2)), round(y + rise * (1 - b)), text,
                w.muted if w.colour else WHITE, b, texts=texts)
            y += pitch
        return image, texts

    def end(self):
        """The layouts' last screen into the wordmark, held, then into the first frame."""
        last = self.reel.last()
        rest, texts = self.draw_end(1)
        for (x0, y0, x1, y1), text in texts:
            m = self.watch.k['margin']
            if x0 < m or y0 < m or x1 > self.watch.w - m or y1 > self.watch.h - m:
                raise SystemExit('%s end card: %r runs off the screen' % (self.watch.name, text))
        black = Image.new('RGB', last.size, BLACK)
        for i in range(1, LOOP):
            self.reel.add(Image.blend(last, black, ease(i / LOOP)), fading=True)
        for i in range(0, 16):
            self.reel.add(self.draw_end(i / 16)[0], fading=True)
        self.reel.add(rest, END_TICKS)
        self.reel.holds.append(('end: ' + SLOGAN.replace('\n', ' '), END_TICKS * TICK_MS))
        first = self.shot(STORY[0][1])
        for i in range(1, LOOP):
            self.reel.add(Image.blend(rest, first, ease(i / LOOP)), fading=True)

    def build(self):
        """The whole loop: the day with its stops, the layouts, the wordmark, and back."""
        for beat in STORY:
            if beat[0] == 'open':
                self.at = beat[1]
                self.reel.add(self.shot(beat[1]), beat[2])
            elif beat[0] == 'run':
                self.run(beat[1])
            elif beat[0] == 'stop':
                self.stop(beat[1:])
            elif beat[0] == 'layouts':
                self.layouts(beat[1:])
            elif beat[0] == 'end':
                self.end()
        return self.reel


# ---------------------------------------------------------------------------------------
# The GIF: a table of the colours most frames use, and a frame's own table where it needs other
# colours (a fade's blends); each frame after the first only the box that changed, with what
# didn't change inside it transparent where that is smaller. Codes as narrow as the table allows.

def merge(frames):
    """Consecutive identical frames as one, their delays added (a fade's only while all of it
    is)."""
    out = []
    for f in frames:
        if out and out[-1]['image'].tobytes() == f['image'].tobytes():
            out[-1] = dict(out[-1], ms=out[-1]['ms'] + f['ms'], fading=out[-1]['fading'] and f['fading'])
        else:
            out.append(dict(f))
    return out


def colours_of(image):
    """The colours an image uses, sorted."""
    return sorted(c for _, c in image.getcolors(1 << 16))


FADE_COLOURS = 128          # a frame in motion, on screen for 40 ms, in at most this many colours


def limit_colours(frames):
    """A frame in motion cut to FADE_COLOURS colours and any other over 255 to 255, by median cut,
    without dither: what is written is what is checked. Motion's blends are most of the GIF's
    bytes, and fewer colours make them smaller."""
    for f in frames:
        most = FADE_COLOURS if f['fading'] else 255
        if len(f['image'].getcolors(1 << 16)) > most:
            f['image'] = f['image'].quantize(most, method=Image.Quantize.MEDIANCUT,
                                             dither=Image.Dither.NONE).convert('RGB')


def gif_lzw(data, m):
    """GIF's LZW of a frame's colour indices (bytes) with minimum code size m, as its data
    sub-blocks: a clear code, the codes (m + 1 bits wide and wider as the table grows, to 12;
    a full table starts again after a clear code), the end code."""
    clear, end = 1 << m, (1 << m) + 1
    out = bytearray()
    acc, nbits = clear, m + 1
    width_, nxt, table = m + 1, end + 1, {}
    prefix = data[0]
    for c in data[1:]:
        key = prefix << 8 | c
        code = table.get(key)
        if code is not None:
            prefix = code
            continue
        acc |= prefix << nbits
        nbits += width_
        if nxt < 4096:
            table[key] = nxt
            nxt += 1
            if nxt > 1 << width_ and width_ < 12:
                width_ += 1
        else:
            acc |= clear << nbits
            nbits += width_
            width_, nxt, table = m + 1, end + 1, {}
        while nbits >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            nbits -= 8
        prefix = c
    acc |= prefix << nbits
    nbits += width_
    if nxt < 4096 and nxt >= 1 << width_ and width_ < 12:
        width_ += 1
    acc |= end << nbits
    nbits += width_
    out += acc.to_bytes((nbits + 7) // 8, 'little')
    return b''.join(bytes([len(out[i:i + 255])]) + out[i:i + 255] for i in range(0, len(out), 255)) + b'\0'


def table_bits(n):
    """The bits a colour table of n colours and a transparent entry takes (2 at least)."""
    return max(2, n.bit_length())


def indexed(image, table):
    """An image as indices into a colour table holding all its colours (an 'L' image). Mapped
    colour by colour: Pillow's own conversion to a palette looks colours up 6 bits a channel, and
    a fade's neighbouring shades would share an entry."""
    lut = {bytes(c): i for i, c in enumerate(table)}
    data = image.tobytes()
    return Image.frombytes('L', image.size, bytes(lut[data[i:i + 3]] for i in range(0, len(data), 3)))


def changed_mask(cur, prev):
    """255 where two RGB images differ, 0 where they don't."""
    r, g, b = ImageChops.difference(cur, prev).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v else 0)


def save_gif(frames, path):
    """The frames, identical ones merged and those in motion cut to fewer colours, as a looping
    GIF. Returns the frames as written."""
    frames = merge(frames)
    limit_colours(frames)
    w, h = frames[0]['image'].size
    count = Counter()
    for f in frames:
        count.update(colours_of(f['image']))
    shared = sorted(c for c, _ in sorted(count.items(), key=lambda kv: (-kv[1], kv[0]))[:255])
    shared_set = set(shared)
    mg = table_bits(len(shared))
    out = bytearray(struct.pack('<6sHHBBB', b'GIF89a', w, h, 0xF0 | (mg - 1), 0, 0))
    out += bytes([v for c in shared for v in c] + [0] * (3 * ((1 << mg) - len(shared))))
    out += b'\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00'
    prev = None
    for f in frames:
        cur = f['image']
        if prev is None:
            box, mask = (0, 0, w, h), Image.new('L', (w, h), 255)
        else:
            mask = changed_mask(cur, prev)
            box = mask.getbbox() or (0, 0, 1, 1)
        crop, keep = cur.crop(box), mask.crop(box)
        colours = colours_of(crop)
        local = not set(colours) <= shared_set
        table = colours if local else shared
        m = table_bits(len(table)) if local else mg
        transparent = len(table)
        idx = indexed(crop, table)
        data = gif_lzw(idx.tobytes(), m)
        if prev is not None:
            clear = Image.composite(idx, Image.new('L', idx.size, transparent), keep)
            data = min(data, gif_lzw(clear.tobytes(), m), key=len)
        x0, y0, x1, y1 = box
        out += struct.pack('<BBBBHBB', 0x21, 0xF9, 4, 1 << 2 | 1, f['ms'] // 10, transparent, 0)
        out += struct.pack('<BHHHHB', 0x2C, x0, y0, x1 - x0, y1 - y0, (0x80 | (m - 1)) if local else 0)
        if local:
            out += bytes([v for c in table for v in c] + [0] * (3 * ((1 << m) - len(table))))
        out += bytes([m]) + data
        prev = cur
    with open(path, 'wb') as fp:
        fp.write(out + b';')
    return frames


def check_gif(path, frames, watch):
    """Size, length and frames of a written GIF, as a line; fails on a wrong one and on a frame
    that doesn't decode to the frame it was written from."""
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
    long_enough = LOOP_S[0] * 1000 <= total <= LOOP_S[1] * 1000
    if gif.size != (watch.w, watch.h) or length >= GIF_BUDGET or not long_enough:
        raise SystemExit('%s: %s, %d bytes, %d ms' % (path, gif.size, length, total))
    return '%s: %dx%d, %d frames, %.2f s, %d KB, %d colours' % (
        watch.name, gif.size[0], gif.size[1], gif.n_frames, total / 1000, length // 1024, len(colours))


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
    """Every step held, once in, long enough to read: 1.8 s at least."""
    for what, ms in reel.holds:
        if ms < 1800:
            raise SystemExit('%s: %r held %d ms' % (reel.watch.name, what, ms))


def contact_sheet(images, path, every=8, cols=8):
    """Every 8th tick at 1:1, labelled with its time."""
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
# The store screens: a headline over the watch's screen, on black.
#
# Each is (file, headline, what, place, mark): `what` a scene shown whole under the headline,
# or 'card' (the UV slot's values); `place` 'top' (the screen from its top row down, its
# bottom cut) or 'bottom' (from its bottom row up, its top under the headline); `mark` 'alerts'
# puts the ring on the alerts in the Watch Status Bar. The headline's first line is white, its
# second in the watch's red (grey on a black and white watch); a headline can differ per watch
# ({platform: headline, None: the others'}): only Pebble Time 2's health view shows a heart rate.
SCREENS = {
    'default': (
        ('2-forecast', ('The forecast', 'at a glance'), 'day-0-1400', 'bottom', None),
        ('3-alerts', ('Alerts when', 'it matters'), 'day-1-0845', 'top', 'alerts'),
        ('4-health', {'emery': ('Steps, sleep', 'and heart rate'), None: ('Steps and sleep', 'on your wrist')},
         'view-health', 'bottom', None),
        ('5-max', ('Now, today', 'and tomorrow'), 'card', None, None),
        ('6-layouts', ('Your layout,', 'your way'), 'layout-weather', 'top', None),
    ),
    'aplite': (
        ('2-forecast', ('The forecast', 'at a glance'), 'day-0-1400', 'bottom', None),
        ('3-lines', ('Rain, wind', 'or UV'), 'lines-wind', 'bottom', None),
        ('4-max', ('Now, today', 'and tomorrow'), 'card', None, None),
        ('5-calendar', ('Three weeks', 'at a glance'), 'cal-full', 'top', None),
        ('6-uv', ('The UV index', 'hour by hour'), 'uv-line', 'bottom', None),
    ),
}
# The UV slot's card: each value selection, the slot as the watch shows it then, and what it
# means (or (long, short), as STORY's lines). The same numbers as STORY's.
CARD_ROWS = (('Now', 'uv-now', 'UV now'), ('Day max', 'uv-max', 'Max left today'),
             ('Both', 'day-0-1000', 'Now / max'), ('Evening', 'day-0-2200', ('» tomorrow\'s max', '» tomorrow')))
CARD_NOTE = 'Wind, gusts and AQI too.'
STORE_CORNER = {200: 12, 144: 9}   # px of a corner the store rounds off


def headline(image, texts, watch, first, second):
    """The headline's two lines, centred: the first white, the second in the watch's red. Returns
    the row under it, where the screen starts."""
    k = watch.k
    f = watch.f('headline')
    room = watch.w - 2 * k['margin']
    for line in (first, second):
        fit(f, line, room, '%s headline' % watch.name)
    _, bottom = ink(f)
    baseline = k['head_pad'] + cap(f)
    pitch = f.size + 4
    for text, y, colour in ((first, baseline, WHITE), (second, baseline + pitch, watch.second)):
        say(image, f, int(round((watch.w - width(f, text)) / 2)), y, text, colour, texts=texts)
    return baseline + pitch + bottom + k['head_pad']


def check_corners(texts, watch, what):
    """No word in the corners the store rounds off."""
    r = STORE_CORNER[watch.w]
    for (x0, y0, x1, y1), text in texts:
        for x, y in ((x0, y0), (x1 - 1, y0), (x0, y1 - 1), (x1 - 1, y1 - 1)):
            cx = r if x < r else watch.w - 1 - r if x > watch.w - 1 - r else x
            cy = r if y < r else watch.h - 1 - r if y > watch.h - 1 - r else y
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                raise SystemExit('%s %s: %r runs into a rounded corner' % (watch.name, what, text))


def uv_slot(screens, watch, scene):
    """The UV slot as a scene shows it: the right slot of the forecast row under the clock's band."""
    shot = screens.shot(watch.name, scene)
    return right_slot(shot, ink_rows_from(shot, screens.band(watch.name, scene)[1]))


def uv_card(image, texts, screens, watch, top):
    """The UV slot's values, a row each: its name, what it means under it, and the slot as the
    watch shows it then, in a black screen of its own edged in the watch's dark grey; a note."""
    k = watch.k
    crops = []
    for name, scene, means in CARD_ROWS:
        x0, y0, x1, y1 = uv_slot(screens, watch, scene)
        crops.append(screens.shot(watch.name, scene).crop((x0 - 2, y0 - 2, x1 + 3, y1 + 3)))
    nf, mf, notef = watch.f('row_name'), watch.f('row_note'), watch.f('note')
    left, right = k['margin'] + 2, watch.w - k['margin'] - 2
    note_top = watch.h - k['margin'] - notef.size - 2
    pitch = (note_top - top) // len(CARD_ROWS)
    n_top, _ = ink(nf)
    _, m_bottom = ink(mf)
    text_h = -n_top + 2 + mf.size + m_bottom - 2
    for i, ((name, scene, means), crop) in enumerate(zip(CARD_ROWS, crops)):
        y = top + i * pitch
        sw, sh = crop.width + 6, crop.height + 4
        sx, sy = right - sw, y + (pitch - sh) // 2
        round_rect(image, (sx, sy, sx + sw, sy + sh), 4, BLACK)
        image.paste(crop, (sx + 3, sy + 2))
        round_rect(image, (sx, sy, sx + sw, sy + sh), 4, watch.line, ring=1)
        room = sx - left - 6
        means = pick_copy(means, lambda text: width(mf, text) <= room)
        fit(nf, name, room, '%s card' % watch.name)
        fit(mf, means, room, '%s card' % watch.name)
        base = y + (pitch - text_h) // 2 - n_top
        say(image, nf, left, base, name, WHITE, texts=texts)
        say(image, mf, left, base + mf.size + 2, means, watch.muted, texts=texts)
        if i:
            ImageDraw.Draw(image).line((left, y, right - 1, y), fill=DARK_GREY)
    fit(notef, CARD_NOTE, right - left, '%s card' % watch.name)
    say(image, notef, left, note_top + cap(notef), CARD_NOTE, watch.muted, texts=texts)


def store_screen(screens, watch, spec):
    """One store screen: the headline over a watch screen (edged in the watch's dark grey, its top
    corners rounded, as the settings page's preview has them) or the UV card, on black."""
    name, words, what, place, mark = spec
    first, second = words.get(watch.name, words[None]) if isinstance(words, dict) else words
    image = Image.new('RGB', (watch.w, watch.h), BLACK)
    texts = []
    top = headline(image, texts, watch, first, second)
    if what == 'card':
        uv_card(image, texts, screens, watch, top)
    else:
        shot = screens.shot(watch.name, what)
        dy = top if place == 'top' else 0
        screen = Image.new('RGB', (watch.w, watch.h), BLACK)
        # From its bottom up, the screen starts at the first blank row under the headline, so
        # no element shows cut in half there.
        start = top + 2 if place == 'top' else next_blank(shot, top + 2)
        screen.paste(shot.crop((0, start - dy, watch.w, watch.h - dy)), (0, start))
        if mark == 'alerts':
            y0, y1 = ink_rows_from(shot, 0)
            draw_ring(screen, watch, ring_box(watch, (0, y0 + dy, watch.w - 1, y1 - 1 + dy)))
        r = watch.k['screen_r']
        mask = Image.new('L', (watch.w * SS, (watch.h - top + r) * SS), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, watch.w * SS - 1, mask.height - 1), r * SS, fill=255)
        mask = mask.resize((watch.w, watch.h - top + r), Image.BOX)
        full = Image.new('L', (watch.w, watch.h), 0)
        full.paste(mask, (0, top))
        image.paste(screen, (0, 0), full)
        round_rect(image, (0, top, watch.w, watch.h + r), r, watch.line if watch.colour else DARK_GREY, ring=1)
    check_corners(texts, watch, name)
    return name + '.png', image


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


def build_platform(screens, platform, out, sheets, gif=True):
    """One watch's set: the showcase GIF and its five store screens."""
    watch = WATCHES[platform]
    folder = os.path.join(out, platform)
    os.makedirs(folder, exist_ok=True)
    if gif:
        reel = Showcase(watch, screens).build()
        check_holds(reel)
        ticks = per_tick(reel.frames)
        flashes = check_flashes(ticks, watch)
        path = os.path.join(folder, '1-showcase.gif')
        written = save_gif(reel.frames, path)
        log(check_gif(path, written, watch) + ', ' + flashes)
        contact_sheet(per_tick(written), os.path.join(sheets, 'contact-sheet-%s.png' % platform))
    images = []
    specs = SCREENS['aplite' if platform == 'aplite' else 'default']
    for spec in specs:
        name, image = store_screen(screens, watch, spec)
        image.save(os.path.join(folder, name), optimize=True)
        images.append(image)
    sheet = Image.new('RGB', (len(images) * (watch.w * 2 + 8) + 8, watch.h * 2 + 16), (32, 32, 32))
    for i, image in enumerate(images):
        sheet.paste(image.resize((watch.w * 2, watch.h * 2), Image.NEAREST), (8 + i * (watch.w * 2 + 8), 8))
    sheet.save(os.path.join(sheets, 'screens-%s.png' % platform))
    log('%s: %s' % (platform, ', '.join(spec[0] + '.png' for spec in specs)))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('version', help='the screenshot folder, e.g. v2.3.0')
    parser.add_argument('--platforms', default=' '.join(PLATFORMS), help='which watches (default: all five)')
    parser.add_argument('--screens-only', action='store_true', help='only the store screens, no GIF')
    args = parser.parse_args()
    screens = Screens(args.version, scene_manifest())
    out = os.path.join(ROOT, 'screenshot', args.version, 'store-art')
    os.makedirs(BUILD, exist_ok=True)
    for platform in args.platforms.split():
        if platform not in WATCHES:
            raise SystemExit('unknown platform %s' % platform)
        build_platform(screens, platform, out, BUILD, gif=not args.screens_only)
    path = os.path.join(BUILD, 'warnweather-store-%s.zip' % args.version)
    bundle(out, path)
    log('wrote', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    sys.exit(main())
