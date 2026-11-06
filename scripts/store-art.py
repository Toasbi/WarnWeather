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

THE SHOWCASE (about 30 s on Pebble Time 2, less where a watch has fewer settings, looping): the
watchface as the watch draws it, then a tour of what it can do. In a tour scene the big clock
makes room for a card in the settings page's look (the setting's name, its segmented control
with the picked option in the page's coral, and what it does), while the rest of the screen is
the watch's own capture of that setting: graph lines, forecast length and the left axis
(Pebble Time 2 only), the weather alerts, the UV slot's Now / Day max / Both and tomorrow's max
(marked with a »), the calendar; then views and layouts whole, and the wordmark. Scenes
cross-fade; a changed option slides the control's selection while the screen around the card
fades to the new capture. A thin coral ring shows where to look.

THE STORE SCREENS: a two-line headline on the banner's charcoal over the watch's screen (the
forecast, the alerts, the health view, the UV slot's values, Weather only), each at the
platform's own screenshot size.

The look is the banner's (resources/banner-*.png: its charcoal, white and the "Warn" coral, in
Poppins) and the settings page's (src/pkjs/config-ui/lib/shell.html: its cards, segmented
controls and coral), anti-aliased and the same on every watch; the watch's own screens stay as
captured, black and white where the watch is. Every text is measured and the build fails on one
that doesn't fit; nothing flashes more than 3 times a second; every GIF frame decodes to the
frame it was written from. The same frames give the same bytes.

Needs Python 3 with Pillow, and Node for the scene list. The type is Poppins
(screenshot/fonts/, SIL Open Font License: screenshot/fonts/Poppins-OFL.txt).
"""
import argparse
import hashlib
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
LOOP_S = (14.0, 34.0)       # the showcase's length, s
GIF_BUDGET = 1 << 20        # bytes; the store took the old 41 s reel at 945 KB

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
# The banner (resources/banner-*.png): its charcoal, blue-grey at the top left and warmer to the
# bottom right, the "Warn" coral, and the grey of its line under the name.
CHARCOAL = (41, 45, 54)
CHARCOAL_WARM = (50, 34, 38)
WARN = (255, 90, 60)
SUBTITLE = (212, 218, 226)
# The settings page, dark (src/pkjs/config-ui/lib/shell.html): a card, a control's track, the
# accent (the picked option, a switch that is on), text and muted text.
CARD = (58, 59, 63)
TRACK = (70, 71, 76)
ACCENT = (250, 74, 53)
TEXT = (240, 242, 246)
MUTED = (182, 186, 194)
RULE = (66, 69, 77)         # a hairline between rows, on the charcoal

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


def ink(f, text='Hg'):
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
    doesn't fit one line breaks at its '\n' where it has one, else greedily, and two lines are
    broken where their longer one is shortest, so the second isn't a word left over."""
    words = text.split()
    if width(f, ' '.join(words)) > room and '\n' in text:
        lines = text.split('\n')
        for line in lines:
            fit(f, line, room, what)
        if len(lines) > most:
            raise SystemExit('%s: %r takes %d lines, it has %d' % (what, text, len(lines), most))
        return lines
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


def pick_copy(copy, fits):
    """The copy itself, or of (long, short) the first that `fits`; the short one's fit check
    reports a line that fits neither."""
    if isinstance(copy, str):
        return copy
    return copy[0] if fits(copy[0]) else copy[1]


def say(image, texts, f, x, baseline, text, colour):
    """One line of text, its origin at x on the baseline; kept in `texts` (its inked box and its
    words) for the checks."""
    d = ImageDraw.Draw(image)
    d.text((x, baseline), text, font=f, fill=colour, anchor='ls')
    texts.append((d.textbbox((x, baseline), text, font=f, anchor='ls'), text))


def say_centred(image, texts, f, cx, baseline, text, colour):
    """One line centred on x = cx."""
    say(image, texts, f, int(round(cx - width(f, text) / 2)), baseline, text, colour)


def round_rect(image, box, radius, colour, ring=None):
    """A box with round corners (x0, y0, x1, y1, its far edges at x1 and y1, fractions allowed),
    anti-aliased: filled, or, with `ring`, only that many px of it inside its edge."""
    x0, y0, x1, y1 = box
    left, top, right, bottom = int(x0), int(y0), -int(-x1), -int(-y1)
    w, h = right - left, bottom - top
    if w <= 0 or h <= 0:
        return
    mask = Image.new('L', (w * SS, h * SS), 0)
    d = ImageDraw.Draw(mask)

    def scaled(a, b, c, e):
        return ((a - left) * SS, (b - top) * SS, (c - left) * SS - 1, (e - top) * SS - 1)

    r = min(radius, (x1 - x0) / 2, (y1 - y0) / 2)
    d.rounded_rectangle(scaled(x0, y0, x1, y1), r * SS, fill=255)
    if ring:
        d.rounded_rectangle(scaled(x0 + ring, y0 + ring, x1 - ring, y1 - ring), max(0, r - ring) * SS, fill=0)
    image.paste(colour, (left, top, right, bottom), mask.resize((w, h), Image.BOX))


def mix(a, b, t):
    """Colour a, t of the way to colour b."""
    return tuple(int(round(p + (q - p) * t)) for p, q in zip(a, b))


def charcoal(w, h):
    """The banner's background at w x h: its charcoal, from blue-grey at the top left to warm at
    the bottom right, in 12 steps (a GIF frame keeps few colours)."""
    image = Image.new('RGB', (w, h))
    px = image.load()
    for y in range(h):
        for x in range(w):
            t = round(12 * (0.7 * x / (w - 1) + 0.3 * y / (h - 1))) / 12
            px[x, y] = mix(CHARCOAL, CHARCOAL_WARM, t)
    return image


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
# control's height and `pad` its selection's inset; `gap` the rows between a card's parts.
TYPE = {
    'big': dict(
        inset=3, margin=8, card_r=9, track=22, track_r=8, pad=2, pill_r=6, gap=5, ring=1.5,
        label=('medium', 12), option=('semibold', 12), hint=('regular', 12), caption=('medium', 15),
        title=('semibold', 18), line=('regular', 13), wordmark=('semibold', 24), slogan=('regular', 13),
        headline=('semibold', 19), head_pad=9, row_name=('semibold', 13), row_note=('regular', 12),
        note=('regular', 12), screen_r=10),
    'small': dict(
        inset=2, margin=6, card_r=7, track=17, track_r=6, pad=2, pill_r=5, gap=3, ring=1.5,
        label=('medium', 10), option=('semibold', 10), hint=('regular', 10), caption=('medium', 12),
        title=('semibold', 15), line=('regular', 11), wordmark=('semibold', 17), slogan=('regular', 10),
        headline=('semibold', 15), head_pad=6, row_name=('semibold', 11), row_note=('regular', 10),
        note=('regular', 10), screen_r=7),
}


class Watch:
    """A platform the set is made for: its screenshot size, colour or black and white, and the
    sizes its type and cards take (TYPE)."""

    def __init__(self, name, size, colour, kind):
        self.name, (self.w, self.h), self.colour = name, size, colour
        self.k = TYPE[kind]

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
            raise SystemExit('%s/%s: no clock band (the longest blank run is %d rows)' % (platform, scene,
                                                                                      best[1] - best[0]))
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


def focus_ring(image, watch, box):
    """A thin coral ring round a box (x0, y0, x1, y1, inclusive), 2 px out from it and kept on
    the screen: where to look."""
    k = watch.k
    x0, y0 = max(0, box[0] - 3), max(0, box[1] - 3)
    x1, y1 = min(watch.w, box[2] + 4), min(watch.h, box[3] + 4)
    round_rect(image, (x0, y0, x1, y1), 4, ACCENT, ring=k['ring'])


# ---------------------------------------------------------------------------------------
# The card: the settings page in the clock's band.

def card_box(watch, band):
    """The card's box in a band: the band less a row above and below, inset from the sides."""
    k = watch.k
    return k['inset'], band[0] + 1, watch.w - k['inset'], band[1] - 1


def content_span(watch):
    """Where a card's words and controls go across the screen: x0, x1 (exclusive)."""
    k = watch.k
    return k['inset'] + k['margin'], watch.w - k['inset'] - k['margin']


def option_spans(watch, options):
    """The segmented control's options across its track: each one's (x0, x1), floats. The options
    share the track in proportion to their words, as the page's buttons do."""
    k = watch.k
    f = watch.f('option')
    x0, x1 = content_span(watch)
    inner = x1 - x0 - 2 * k['pad']
    widths = [width(f, o) for o in options]
    extra = (inner - sum(widths)) / len(options)
    if extra < 8:
        raise SystemExit('%s: the options %s need %d px of %d' % (watch.name, options, sum(widths) + 8 * len(options),
                                                                  inner))
    spans, x = [], x0 + k['pad']
    for wd in widths:
        spans.append((x, x + wd + extra))
        x += wd + extra
    return spans


def caption_room(watch, band):
    """How many caption lines a step's card holds in a band: two where they fit, else one."""
    k = watch.k
    lab_t, lab_b = ink(watch.f('label'))
    f = watch.f('caption')
    t, b = ink(f)
    rows = band[1] - band[0] - 2 - 4
    return 2 if lab_b - lab_t + k['gap'] - t + (f.size + 3) + b <= rows else 1


def card_lines(watch, card):
    """A card's lines under its label, fitted: a setting's one hint line, a step's caption in as
    many lines as its band holds (two at most). Where a line is (long, short), the long one when
    it fits."""
    x0, x1 = content_span(watch)
    room = x1 - x0
    what = '%s %s card' % (watch.name, card['title'])
    fit(watch.f('label'), card['title'], room, what)
    if card['kind'] == 'setting':
        f = watch.f('hint')
        line = pick_copy(card['line'], lambda text: width(f, text) <= room)
        fit(f, line, room, what)
        return [line]
    f = watch.f('caption')
    most = caption_room(watch, card['band'])
    line = pick_copy(card['line'], lambda text: len(wrap(f, text, room, 9, what)) <= most)
    return wrap(f, line, room, most, what)


def card_layout(watch, card):
    """A card's rows by their ink, from its content's top: (height, label baseline, control top,
    first line's baseline, line pitch)."""
    k = watch.k
    lab_t, lab_b = ink(watch.f('label'))
    y = lab_b - lab_t + k['gap']
    control = None
    if card['kind'] == 'setting':
        control = y
        y += k['track'] + k['gap']
        f = watch.f('hint')
    else:
        f = watch.f('caption')
    t, b = ink(f)
    pitch = f.size + 3
    n = len(card_lines(watch, card))
    return y - t + (n - 1) * pitch + b, -lab_t, control, y - t, pitch


def draw_card(image, texts, watch, card, pill=None):
    """The card over the clock's band: the setting's (or the tour step's) name; for a setting its
    segmented control, the selection at `pill` (x0, x1; the picked option's span by default) and
    each option's words white as far as the selection covers them; then its line."""
    k = watch.k
    box = card_box(watch, card['band'])
    round_rect(image, box, k['card_r'], CARD)
    need, label_y, control_y, line_y, pitch = card_layout(watch, card)
    if need > box[3] - box[1] - 4:
        raise SystemExit('%s: the %s card needs %d rows, its band has %d' % (watch.name, card['title'], need,
                                                                              box[3] - box[1] - 4))
    top = box[1] + (box[3] - box[1] - need) // 2
    x0, x1 = content_span(watch)
    say(image, texts, watch.f('label'), x0, top + label_y, card['title'], MUTED)
    if card['kind'] == 'setting':
        f = watch.f('option')
        y = top + control_y
        round_rect(image, (x0, y, x1, y + k['track']), k['track_r'], TRACK)
        spans = option_spans(watch, card['options'])
        a, b = pill if pill is not None else spans[card['picked']]
        round_rect(image, (a, y + k['pad'], b, y + k['track'] - k['pad']), k['pill_r'], ACCENT)
        baseline = y + (k['track'] + cap(f) + 1) // 2
        for option, (sa, sb) in zip(card['options'], spans):
            wd = width(f, option)
            tx = int(round((sa + sb - wd) / 2))
            covered = max(0.0, min(b, tx + wd) - max(a, tx)) / wd
            say(image, texts, f, tx, baseline, option, mix(MUTED, WHITE, covered))
        f, colour = watch.f('hint'), SUBTITLE
    else:
        f, colour = watch.f('caption'), TEXT
    for i, line in enumerate(card_lines(watch, card)):
        say(image, texts, f, x0, top + line_y + i * pitch, line, colour)
    return box


# ---------------------------------------------------------------------------------------
# The storyboard. Each beat names its scenes (scripts/gen-store-art-fixtures.js); a beat or a
# step whose scene isn't captured on a watch is left out there (the manifest says where each
# is), so every watch shows only what it can do.
#
# ('open', scene)                     the watchface, whole
# ('steps', title, steps)             a caption per step: (scene, line, mark)
# ('setting', title, options, steps)  the options (None: the manifest's span labels), the picked
#                                     one per step: (scene, picked, line, mark)
# ('gallery', title, line, scenes)    a title card, then the screens whole
# ('end',)                            the wordmark and what it does
#
# A line is its words, or (long, short) where a 144 px watch needs the short one; a '\n' marks
# where a caption breaks when it takes two lines. `mark` puts
# the ring on 'top' (the Watch Status Bar), 'slot' (the UV slot: the status bar under the card,
# its right slot) or 'calendar' (between the Watch Status Bar and the card), or nowhere (None).
# The UV slot's lines name its numbers: the morning's UV 3 now and 8 at noon, the evening's 0
# and tomorrow's 7 (forecast-long.json's UV through gen-store-art-fixtures.js' windows).
STORY = (
    ('open', 'hero'),
    ('steps', 'Graph lines', (
        ('lines-rain', 'Rain chance and amount', None),
        ('lines-wind', 'Wind and gusts', None),
        ('lines-mix', 'Up to four lines at once', None))),
    ('setting', 'Forecast length', None, (
        ('span-12', 0, 'The next 12 hours', None),
        ('span-long', 2, 'Up to 66 hours ahead', None))),
    ('setting', 'Left axis values', ('On axis', 'On graph', 'Off'), (
        ('axis-axis', 0, 'High and low on the axis', None),
        ('axis-graph', 1, 'High and low on the graph', None),
        ('axis-off', 2, 'No axis, a wider graph', None))),
    ('steps', 'Weather alerts', (
        ('alerts-calm', ('Out of sight while all is calm', 'Hidden until needed'), None),
        ('alerts-on', ('Rain soon,\nhigh UV and gusts', 'Rain soon, UV, gusts'), 'top'),
        ('alerts-line', ('The UV line only from 5 up', 'UV line from 5 up'), None))),
    ('setting', 'UV index slot', ('Now', 'Day max', 'Both'), (
        ('max-now', 0, 'UV index now: 3', 'slot'),
        ('max-day', 1, ('Highest UV left today: 8', 'Max left today: 8'), 'slot'),
        ('max-both', 2, ('Now and today\'s max: 3/8', 'Now / today\'s max'), 'slot'),
        ('max-tomorrow', 2, ('Evening: » is tomorrow\'s max', '» is tomorrow\'s max'), 'slot'))),
    ('steps', 'Calendar', (
        ('calendar', ('Three weeks at a glance', 'Three weeks in view'), 'calendar'),)),
    ('gallery', 'Views and layouts', 'Health, Weather only and a light theme', (
        'view-health', 'layout-weather', 'layout-light')),
    ('gallery', 'Layouts', 'The calendar or a big graph', ('layout-full', 'layout-nocal')),
    ('end',),
)
WORDMARK = ('Warn', 'Weather')
SLOGAN = 'The forecast at a glance,\nalerts when it matters.'

FADE = 6                  # ticks a cross-fade takes (its last tick is the scene it fades to)
OPEN_TICKS = 40           # the watchface whole, before the tour (1.6 s)
STEP_TICKS = 29           # a tour step, held once faded in
SLOT_TICKS = 36           # the UV slot's steps, which carry the most to read
CARD_TICKS = 29
GALLERY_TICKS = 31
END_TICKS = 50


def ease(t):
    """A fade's progress at t (0 to 1): slow out, slow in."""
    return t * t * (3 - 2 * t)


class Reel:
    """The GIF's frames, each a whole number of 40 ms ticks, and the holds the checks look at."""

    def __init__(self, watch):
        self.watch, self.frames, self.holds = watch, [], []

    def add(self, image, ticks=1, fading=False):
        self.frames.append({'image': image, 'ms': TICK_MS * ticks, 'fading': fading})

    def last(self):
        return self.frames[-1]['image']

    def fade(self, target, ticks, what=None, between=None):
        """A cross-fade from the last frame to `target`, which then holds `ticks` (0: not added).
        `between(e)` gives the fade's frame at e (0 to 1) where one image to the next isn't
        enough (a sliding selection); `what` names the words the hold shows, for the checks."""
        a = self.last()
        for i in range(1, FADE):
            e = ease(i / FADE)
            self.add(between(e) if between else Image.blend(a, target, e), fading=True)
        if ticks:
            self.add(target, ticks)
            if what:
                self.holds.append((what, ticks * TICK_MS))


class Showcase:
    """One watch's showcase GIF, beat by beat."""

    def __init__(self, watch, screens):
        self.watch, self.screens = watch, screens
        self.reel = Reel(watch)

    def has(self, scene):
        return self.screens.has(self.watch.name, scene)

    def shot(self, scene):
        return self.screens.shot(self.watch.name, scene)

    def compose(self, scene, card, ring=(), pill=None):
        """A scene's capture with the card over its clock's band and the ring on."""
        image = self.shot(scene).copy()
        texts = []
        x0, y0, x1, y1 = draw_card(image, texts, self.watch, card, pill)
        for box in ring:
            focus_ring(image, self.watch, box)
        for (tx0, ty0, tx1, ty1), text in texts:
            if not (x0 <= tx0 and tx1 <= x1 and y0 <= ty0 and ty1 <= y1):
                raise SystemExit('%s: %r runs out of its card' % (self.watch.name, text))
        return image

    def band(self, scenes):
        """The rows the card takes through a beat: the band every step's capture leaves."""
        bands = [self.screens.band(self.watch.name, s) for s in scenes]
        return max(b[0] for b in bands), min(b[1] for b in bands)

    def marks(self, kind, scene, band):
        """Where a step's ring goes (see STORY): 'top', the Watch Status Bar (the first inked rows);
        'slot', the right slot of the status bar under the card; 'calendar', all that is between
        the Watch Status Bar and the card."""
        shot = self.shot(scene)
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
        """A tour beat: its first step faded in, then each next one: for a setting the selection
        slides to the picked option while the screen around the card and the line fade to the
        step's own; for a step the card's caption and the screen fade."""
        steps = [s for s in steps if self.has(s[0])]
        if not steps or kind == 'setting' and len(steps) < 2:
            return
        scenes = [s[0] for s in steps]
        band = self.band(scenes)
        if options is None:
            options = self.screens.scenes[scenes[0]]['spanLabels']
        spans = option_spans(self.watch, options) if kind == 'setting' else None
        before = None
        for scene, *rest in steps:
            picked = rest[0] if kind == 'setting' else None
            line, mark = rest[-2], rest[-1]
            card = {'kind': kind, 'title': title, 'band': band, 'options': options, 'picked': picked,
                    'line': line}
            ring = self.marks(mark, scene, band) if mark else ()
            target = self.compose(scene, card, ring)
            hold = SLOT_TICKS if mark == 'slot' else STEP_TICKS
            what = '%s: %s' % (title, card_lines(self.watch, card)[0])
            if before and kind == 'setting':
                was_scene, was_card, was_ring = before
                (a0, a1), (b0, b1) = spans[was_card['picked']], spans[picked]

                def between(e, was_scene=was_scene, was_card=was_card, was_ring=was_ring, a0=a0, a1=a1, b0=b0,
                            b1=b1, scene=scene, card=card, ring=ring):
                    pill = (a0 + (b0 - a0) * e, a1 + (b1 - a1) * e)
                    return Image.blend(self.compose(was_scene, was_card, was_ring, pill),
                                       self.compose(scene, card, ring, pill), e)

                self.reel.fade(target, hold, what, between)
            else:
                self.reel.fade(target, hold, what)
            before = (scene, card, ring)

    def title_card(self, title, line):
        """A gallery's title card: the title and its line, centred on the banner's charcoal."""
        w = self.watch
        image = charcoal(w.w, w.h)
        texts = []
        room = w.w - 2 * (w.k['inset'] + w.k['margin'])
        tf, lf = w.f('title'), w.f('line')
        titles = wrap(tf, title, room, 2, '%s title' % w.name)
        lines = wrap(lf, line, room, 3, '%s title card' % w.name)
        t_pitch, l_pitch = tf.size + 4, lf.size + 5
        t_top, _ = ink(tf)
        _, l_bottom = ink(lf)
        height = -t_top + (len(titles) - 1) * t_pitch + w.k['gap'] * 2 + lf.size + (len(lines) - 1) * l_pitch + \
            l_bottom
        y = (w.h - height) // 2 - t_top
        for text in titles:
            say_centred(image, texts, tf, w.w / 2, y, text, TEXT)
            y += t_pitch
        y += w.k['gap'] * 2 + lf.size - t_pitch + 4
        for text in lines:
            say_centred(image, texts, lf, w.w / 2, y, text, SUBTITLE)
            y += l_pitch
        self.inside(texts, 'title card')
        return image

    def inside(self, texts, what):
        """Every text on the screen, clear of its edges by the card's margin."""
        m = self.watch.k['margin']
        for (x0, y0, x1, y1), text in texts:
            if x0 < m or y0 < m or x1 > self.watch.w - m or y1 > self.watch.h - m:
                raise SystemExit('%s %s: %r runs off the screen' % (self.watch.name, what, text))

    def gallery(self, title, line, scenes):
        """A title card, then each screen whole."""
        scenes = [s for s in scenes if self.has(s)]
        if not scenes:
            return
        self.reel.fade(self.title_card(title, line), CARD_TICKS, '%s: %s' % (title, line))
        for scene in scenes:
            self.reel.fade(self.shot(scene), GALLERY_TICKS)

    def end_card(self):
        """The wordmark as the banner has it (Warn in coral, Weather in white) and what
        WarnWeather does under it, on the banner's charcoal."""
        w = self.watch
        image = charcoal(w.w, w.h)
        texts = []
        mark, sf = w.f('wordmark'), w.f('slogan')
        room = w.w - 2 * (w.k['inset'] + w.k['margin'])
        lines = wrap(sf, SLOGAN, room, 3, '%s slogan' % w.name)
        name = ''.join(WORDMARK)
        fit(mark, name, room, '%s wordmark' % w.name)
        m_top, _ = ink(mark, name)
        pitch = sf.size + 5
        height = -m_top + w.k['gap'] * 3 + sf.size + (len(lines) - 1) * pitch
        y = (w.h - height) // 2 - m_top
        x = int(round((w.w - width(mark, name)) / 2))
        say(image, texts, mark, x, y, WORDMARK[0], WARN)
        say(image, texts, mark, x + width(mark, WORDMARK[0]), y, WORDMARK[1], WHITE)
        y += w.k['gap'] * 3 + sf.size
        for text in lines:
            say_centred(image, texts, sf, w.w / 2, y, text, SUBTITLE)
            y += pitch
        self.inside(texts, 'end card')
        return image

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
                self.reel.fade(self.end_card(), END_TICKS, 'end: ' + SLOGAN.replace('\n', ' '))
        # Back into the watchface the loop opens on: the fade's frames, then the first frame.
        self.reel.fade(self.shot(STORY[0][1]), 0)
        return self.reel


# ---------------------------------------------------------------------------------------
# The GIF: a table of the colours most frames use, and a frame's own table where it needs other
# colours (a cross-fade's blends); each frame after the first only the box that changed, with
# what didn't change inside it transparent where that is smaller. Codes as narrow as the table
# allows.

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


FADE_COLOURS = 128          # a fade's frame, on screen for 40 ms, in at most this many colours


def limit_colours(frames):
    """A fade's frames cut to FADE_COLOURS colours and any other over 255 to 255, by median cut,
    without dither: what is written is what is checked. A fade's blends are most of the GIF's
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
    """The frames, identical ones merged and a fade's frames cut to 255 colours, as a looping GIF.
    Returns the frames as written."""
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
    """Every line held whole, once faded in, long enough to read: a second at least."""
    for what, ms in reel.holds:
        if ms < 1000:
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
# The store screens: a headline on the banner's charcoal over the watch's screen.
#
# Each is (file, headline, what, place, mark): `what` a scene shown whole under the headline,
# or 'card' (the UV slot's values); `place` 'top' (the screen from its top row down, its
# bottom cut) or 'bottom' (from its bottom row up, its top under the headline); `mark` 'alerts'
# puts the ring on the alerts in the Watch Status Bar. The headline's first line is white, its
# second in the banner's coral; a headline can differ per watch ({platform: headline, None: the
# others'}): only Pebble Time 2's health view shows a heart rate.
SCREENS = {
    'default': (
        ('2-forecast', ('The forecast', 'at a glance'), 'hero', 'bottom', None),
        ('3-alerts', ('Alerts when', 'it matters'), 'alerts-full', 'top', 'alerts'),
        ('4-health', {'emery': ('Steps, sleep', 'and heart rate'), None: ('Steps and sleep', 'on your wrist')},
         'view-health', 'bottom', None),
        ('5-max', ('Now, today', 'and tomorrow'), 'card', None, None),
        ('6-layouts', ('Your layout,', 'your way'), 'layout-weather', 'top', None),
    ),
    'aplite': (
        ('2-forecast', ('The forecast', 'at a glance'), 'hero', 'bottom', None),
        ('3-lines', ('Rain, wind', 'or UV'), 'layout-nocal', 'bottom', None),
        ('4-max', ('Now, today', 'and tomorrow'), 'card', None, None),
        ('5-calendar', ('Three weeks', 'at a glance'), 'layout-full', 'top', None),
        ('6-uv', ('The UV index', 'hour by hour'), 'aplite-uv', 'bottom', None),
    ),
}
# The UV slot's card: each value selection, the slot as the watch shows it then, and what it
# means (or (long, short), as STORY's lines). The same numbers as STORY's lines.
CARD_ROWS = (('Now', 'max-now', 'UV now'), ('Day max', 'max-day', 'Max left today'),
             ('Both', 'max-both', 'Now / max'), ('Evening', 'max-tomorrow', ('» tomorrow\'s max', '» tomorrow')))
CARD_NOTE = 'Wind, gusts and AQI too.'
STORE_CORNER = {200: 12, 144: 9}   # px of a corner the store rounds off


def headline(image, texts, watch, first, second):
    """The headline's two lines, centred: the first white, the second in coral. Returns the row
    under it, where the screen starts."""
    k = watch.k
    f = watch.f('headline')
    room = watch.w - 2 * k['margin']
    for line in (first, second):
        fit(f, line, room, '%s headline' % watch.name)
    _, bottom = ink(f)
    baseline = k['head_pad'] + cap(f)
    pitch = f.size + 4
    say_centred(image, texts, f, watch.w / 2, baseline, first, TEXT)
    say_centred(image, texts, f, watch.w / 2, baseline + pitch, second, WARN)
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
    """The UV slot as a scene shows it: the right slot of the status bar under the clock's band."""
    shot = screens.shot(watch.name, scene)
    return right_slot(shot, ink_rows_from(shot, screens.band(watch.name, scene)[1]))


def uv_card(image, texts, screens, watch, top):
    """The UV slot's values, a row each: its name, what it means under it, and the slot as the
    watch shows it then, in a black screen of its own; a note under them."""
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
        room = sx - left - 6
        means = pick_copy(means, lambda text: width(mf, text) <= room)
        fit(nf, name, room, '%s card' % watch.name)
        fit(mf, means, room, '%s card' % watch.name)
        base = y + (pitch - text_h) // 2 - n_top
        say(image, texts, nf, left, base, name, TEXT)
        say(image, texts, mf, left, base + mf.size + 2, means, MUTED)
        if i:
            ImageDraw.Draw(image).line((left, y, right - 1, y), fill=RULE)
    say(image, texts, notef, left, note_top + cap(notef), CARD_NOTE, MUTED)
    fit(notef, CARD_NOTE, right - left, '%s card' % watch.name)


def store_screen(screens, watch, spec):
    """One store screen: the headline over a watch screen (its top corners rounded, as the
    settings page's preview has them) or the UV card."""
    name, words, what, place, mark = spec
    first, second = words.get(watch.name, words[None]) if isinstance(words, dict) else words
    image = charcoal(watch.w, watch.h)
    texts = []
    top = headline(image, texts, watch, first, second)
    if what == 'card':
        uv_card(image, texts, screens, watch, top)
    else:
        shot = screens.shot(watch.name, what)
        if screens.scenes[what]['mode'] != 'full':
            raise SystemExit('%s: %s is a panel scene, its clock is blank' % (name, what))
        dy = top if place == 'top' else 0
        screen = Image.new('RGB', (watch.w, watch.h), BLACK)
        # From its bottom up, the screen starts at the first blank row under the headline, so
        # no element shows cut in half there.
        start = top if place == 'top' else next_blank(shot, top)
        screen.paste(shot.crop((0, start - dy, watch.w, watch.h - dy)), (0, start))
        if mark == 'alerts':
            y0, y1 = ink_rows_from(shot, 0)
            focus_ring(screen, watch, (0, y0 + dy, watch.w - 1, y1 - 1 + dy))
        shape = Image.new('L', (watch.w * SS, (watch.h - top + watch.k['screen_r']) * SS), 0)
        ImageDraw.Draw(shape).rounded_rectangle((0, 0, watch.w * SS - 1, shape.height - 1),
                                                watch.k['screen_r'] * SS, fill=255)
        shape = shape.resize((watch.w, watch.h - top + watch.k['screen_r']), Image.BOX)
        mask = Image.new('L', (watch.w, watch.h), 0)
        mask.paste(shape, (0, top))
        image.paste(screen, (0, 0), mask)
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


def build_platform(screens, platform, out, sheets):
    """One watch's set: the showcase GIF and its five store screens."""
    watch = WATCHES[platform]
    folder = os.path.join(out, platform)
    os.makedirs(folder, exist_ok=True)
    reel = Showcase(watch, screens).build()
    check_holds(reel)
    ticks = per_tick(reel.frames)
    flashes = check_flashes(ticks, watch)
    gif = os.path.join(folder, '1-showcase.gif')
    written = save_gif(reel.frames, gif)
    log(check_gif(gif, written, watch) + ', ' + flashes)
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
    args = parser.parse_args()
    screens = Screens(args.version, scene_manifest())
    out = os.path.join(ROOT, 'screenshot', args.version, 'store-art')
    os.makedirs(BUILD, exist_ok=True)
    for platform in args.platforms.split():
        if platform not in WATCHES:
            raise SystemExit('unknown platform %s' % platform)
        build_platform(screens, platform, out, BUILD)
    path = os.path.join(BUILD, 'warnweather-store-%s.zip' % args.version)
    bundle(out, path)
    log('wrote', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    sys.exit(main())
