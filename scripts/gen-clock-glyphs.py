#!/usr/bin/env python3
"""Generate the anti-aliased clock digit strips for the colour platforms.

The watch's system fonts (and the SDK's TTF font resources) are 1-bit, so the clock
digits on a colour screen have hard, stair-stepped edges. This script rasterises the
digits ONCE, here, with FreeType's anti-aliasing, and quantises each pixel's coverage
to the 2-bit alpha a GColor8 carries (0, 1/3, 2/3, opaque). The SDK packs each strip
as a 2-bit palette whose four entries are those four alpha levels; the watch recolours
the entries to the clock colour (keeping each one's alpha) and draws with GCompOpSet,
which blends every pixel at its alpha — so one strip serves every clock colour and
theme, and the blend against whatever sits underneath is the firmware's own
(src/c/layers/clock_glyphs.c).

Outputs, all committed (run by hand after changing a face or size, like the other
generators in scripts/):
  resources/img/clock-<face>~<platform>.png  one strip per face and colour platform:
      the glyphs '0'..'9' and ':' side by side, each cropped to its own ink columns,
      all sharing the digits' union ink rows. RGB is black everywhere (the watch
      replaces it); only alpha carries the glyph, in exactly four levels, so the SDK
      packs it as a 2-bit palette.
  src/c/layers/clock_glyphs_ink.h            each face's union ink height per platform —
      the strip's height, and the ink_h the layout's ClockInk table (clock_ink.c)
      seats the clock band with. Its own header so clock_ink.c takes the one number
      it needs without the glyph tables.
  src/c/layers/clock_glyphs_metrics.h        each glyph's strip column, width, left
      bearing and advance — the numbers clock_glyphs.c lays the string out with.

The faces are the repo's own TTFs, at the sizes the 1-bit clock already used, so the
digits keep their size and the layout's measured ink (clock_ink.h) still holds:
  roboto  Roboto-Bold.ttf        basalt 49 (the system ROBOTO_BOLD_SUBSET_49's size),
                                 emery 62 (the retired FONT_ROBOTO_BOLD_62 resource's)
  bitham  Montserrat-Medium.ttf  basalt 44 (Bitham 42's 31-row digit height; Bitham
                                 itself ships only inside the firmware, as a 1-bit
                                 font), emery 62 (the retired FONT_MONTSERRAT_MEDIUM_62's)

Requires freetype-py and Pillow:  pip install freetype-py pillow
Run:      python3 scripts/gen-clock-glyphs.py
Preview:  python3 scripts/gen-clock-glyphs.py --preview build/clock-glyphs-preview
          (renders sample times on dark and light backgrounds through a model of the
          firmware's 2-bit blend, 4x upscaled, for eyeballing — not committed)
"""
import argparse
import os
import sys

import freetype
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
GLYPHS = '0123456789:'

# (C name, file stem, TTF, {platform: pixel size}). The C name matches the TimeFont
# option each face renders (config.h); the stem names the resource file.
FACES = [
    ('ROBOTO', 'roboto', 'Roboto-Bold.ttf', {'basalt': 49, 'emery': 62}),
    ('BITHAM', 'bitham', 'Montserrat-Medium.ttf', {'basalt': 44, 'emery': 62}),
]
PLATFORMS = ['basalt', 'emery']
PLATFORM_MACRO = {'basalt': 'PBL_PLATFORM_BASALT', 'emery': 'PBL_PLATFORM_EMERY'}

# LIGHT hinting snaps only vertically, so the digits keep their designed widths and
# curves while the horizontal edges land on whole rows (crisp tops and baselines).
LOAD_FLAGS = freetype.FT_LOAD_RENDER | freetype.FT_LOAD_TARGET_LIGHT


def alpha_level(coverage):
    """Nearest of the four GColor8 alpha levels for an 8-bit coverage value."""
    return (coverage * 3 + 127) // 255


def render_face(ttf, size):
    """Rasterise GLYPHS; returns (glyphs, ink_top, ink_h) in baseline-relative rows.

    Each glyph: {'char', 'adv', 'lsb', 'rows': {y: [levels]}, 'w'} where y is the row
    relative to the baseline (negative = above) and the levels cover only the
    glyph's own ink columns, starting at lsb from the pen.
    """
    face = freetype.Face(ttf)
    face.set_pixel_sizes(0, size)
    glyphs = []
    top, bottom = None, None
    for ch in GLYPHS:
        face.load_char(ch, LOAD_FLAGS)
        g = face.glyph
        bm = g.bitmap
        levels = [[alpha_level(bm.buffer[y * bm.pitch + x]) for x in range(bm.width)]
                  for y in range(bm.rows)]
        cols = [x for x in range(bm.width) if any(row[x] for row in levels)]
        if not cols:
            sys.exit('glyph %r renders no ink at %dpx in %s' % (ch, size, ttf))
        c0, c1 = cols[0], cols[-1]
        rows = {}
        for y, row in enumerate(levels):
            if any(row[c0:c1 + 1]):
                rows[y - g.bitmap_top] = row[c0:c1 + 1]
        glyphs.append({'char': ch, 'adv': g.advance.x // 64, 'lsb': g.bitmap_left + c0,
                       'w': c1 - c0 + 1, 'rows': rows})
        if ch != ':':
            # The digits define the ink box; the colon sits inside it.
            top = min(rows) if top is None else min(top, min(rows))
            bottom = max(rows) if bottom is None else max(bottom, max(rows))
    for g in glyphs:
        if min(g['rows']) < top or max(g['rows']) > bottom:
            sys.exit('glyph %r inks outside the digits\' rows' % g['char'])
    return glyphs, top, bottom - top + 1


def build_strip(glyphs, ink_top, ink_h):
    """Lay the glyphs side by side; returns (RGBA image, strip x per glyph)."""
    xs, x = [], 0
    for g in glyphs:
        xs.append(x)
        x += g['w']
    img = Image.new('RGBA', (x, ink_h), (0, 0, 0, 0))
    px = img.load()
    for g, gx in zip(glyphs, xs):
        for y, row in g['rows'].items():
            for i, level in enumerate(row):
                if level:
                    px[gx + i, y - ink_top] = (0, 0, 0, level * 85)
    return img, xs


def c_table(name, glyphs, xs):
    lines = ['static const ClockGlyph CLOCK_GLYPHS_%s[CLOCK_GLYPH_COUNT] = {' % name]
    for g, x in zip(glyphs, xs):
        lines.append("    { %3d, %2d, %3d, %2d },  // '%s'" % (x, g['w'], g['lsb'], g['adv'], g['char']))
    lines.append('};')
    return lines


PLATFORM_ARMS_END = [
    '#else',
    '#error "No anti-aliased clock glyphs for this colour platform: add it to scripts/gen-clock-glyphs.py"',
    '#endif',
    '',
]


def platform_arms(emit):
    """The per-platform #if/#elif arms, each filled by emit(platform)."""
    out = []
    for i, platform in enumerate(PLATFORMS):
        out.append('%s defined(%s)' % ('#if' if i == 0 else '#elif', PLATFORM_MACRO[platform]))
        out.extend(emit(platform))
    return out + PLATFORM_ARMS_END


def write(path, lines):
    with open(path, 'w') as f:
        f.write('\n'.join(lines))
    return path


def write_ink_header(results):
    out = [
        '// GENERATED by scripts/gen-clock-glyphs.py — do not edit; re-run the script.',
        '//',
        "// Per colour platform, each anti-aliased face's union ink height: the rows its digits",
        "// occupy, which is also its strip's height. Read by clock_glyphs_metrics.h and by",
        "// clock_ink.c, whose ClockInk table seats the clock band with it.",
        '#pragma once',
        '',
    ]
    out.extend(platform_arms(lambda platform: [
        '#define CLOCK_GLYPHS_%s_INK_H %d  // %s px' % (name, results[(platform, name)]['ink_h'],
                                                      results[(platform, name)]['size'])
        for name, _stem, _ttf, _sizes in FACES]))
    return write(os.path.join(ROOT, 'src', 'c', 'layers', 'clock_glyphs_ink.h'), out)


def write_header(results):
    out = [
        '// GENERATED by scripts/gen-clock-glyphs.py — do not edit; re-run the script.',
        '//',
        "// Per colour platform and face: each glyph's column in its strip resource",
        '// (resources/img/clock-<face>~<platform>.png), its ink width, its left bearing (ink',
        '// start relative to the pen) and its advance, in pixels, for the glyphs \'0\'..\'9\' then',
        "// ':'. The strips' height is the face's ink height, in clock_glyphs_ink.h. Included by",
        '// src/c/layers/clock_glyphs.c only.',
        '#pragma once',
        '',
        '#include <pebble.h>',
        '#include "clock_glyphs_ink.h"',
        '',
        '#define CLOCK_GLYPH_COUNT %d' % len(GLYPHS),
        '',
        'typedef struct {',
        '    uint16_t x;    // first column in the strip',
        '    uint8_t  w;    // ink columns',
        '    int8_t   lsb;  // ink start, relative to the pen',
        '    uint8_t  adv;  // pen advance',
        '} ClockGlyph;',
        '',
    ]

    def tables(platform):
        lines = []
        for name, _stem, _ttf, _sizes in FACES:
            r = results[(platform, name)]
            lines.extend(c_table(name, r['glyphs'], r['xs']))
        return lines
    out.extend(platform_arms(tables))
    return write(os.path.join(ROOT, 'src', 'c', 'layers', 'clock_glyphs_metrics.h'), out)


def blend(src, dst, a):
    """The firmware's gcolor_blend on one 2-bit channel (a in 0..3), on 0..255 values."""
    s, d = src // 85, dst // 85
    return ((s * a + d * (3 - a)) // 3) * 85


def preview(results, outdir):
    os.makedirs(outdir, exist_ok=True)
    samples = ['12:34', '10:08', '9:41', '23:59']
    for (platform, name), r in sorted(results.items()):
        glyph_by_char = {g['char']: (g, x) for g, x in zip(r['glyphs'], r['xs'])}
        width = max(sum(glyph_by_char[c][0]['adv'] for c in s) for s in samples) + 8
        tile_h = r['ink_h'] + 8
        img = Image.new('RGB', (width * 2, tile_h * len(samples)))
        px = img.load()
        for col, (bg, fg) in enumerate([((0, 0, 0), (255, 255, 255)), ((255, 255, 255), (0, 0, 0))]):
            for row, text in enumerate(samples):
                x0, y0 = col * width, row * tile_h
                for y in range(tile_h):
                    for x in range(width):
                        px[x0 + x, y0 + y] = bg
                pen = x0 + 4
                for c in text:
                    g, _sx = glyph_by_char[c]
                    for gy, levels in g['rows'].items():
                        for i, level in enumerate(levels):
                            if level:
                                X, Y = pen + g['lsb'] + i, y0 + 4 + gy - r['ink_top']
                                d = px[X, Y]
                                px[X, Y] = tuple(blend(fg[k], d[k], level) for k in range(3))
                    pen += g['adv']
        img = img.resize((img.width * 4, img.height * 4), Image.NEAREST)
        img.save(os.path.join(outdir, 'clock-%s-%s.png' % (name.lower(), platform)))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--preview', metavar='DIR',
                        help='also write 4x previews of sample times to DIR')
    args = parser.parse_args()

    results = {}
    for name, stem, ttf_name, sizes in FACES:
        ttf = os.path.join(ROOT, 'resources', 'fonts', ttf_name)
        for platform in PLATFORMS:
            glyphs, ink_top, ink_h = render_face(ttf, sizes[platform])
            img, xs = build_strip(glyphs, ink_top, ink_h)
            path = os.path.join(ROOT, 'resources', 'img', 'clock-%s~%s.png' % (stem, platform))
            img.save(path, optimize=True)
            results[(platform, name)] = {'glyphs': glyphs, 'xs': xs, 'ink_top': ink_top,
                                         'ink_h': ink_h, 'size': sizes[platform]}
            adv = dict((g['char'], g['adv']) for g in glyphs)
            widest = max(sum(adv[c] for c in s) for s in ['00:00', '12:34', '20:08', '08:08'])
            print('%-6s %-6s %2dpx  ink_h %2d  strip %3dx%d  widest-ish time %d px'
                  % (platform, stem, sizes[platform], ink_h, img.width, img.height, widest))
    for path in (write_ink_header(results), write_header(results)):
        print('wrote', os.path.relpath(path, ROOT))
    if args.preview:
        preview(results, args.preview)
        print('previews in', args.preview)


if __name__ == '__main__':
    main()
