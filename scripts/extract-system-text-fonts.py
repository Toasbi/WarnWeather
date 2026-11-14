#!/usr/bin/env python3
"""Extract the watch's Gothic text fonts from the Pebble SDK's emulator firmware.

The watch draws every line of text but the clock in Gothic: the status bars, the
calendar and the graphs' labels, at 14, 18 and 24 px, regular and bold (the
FONT_KEY_GOTHIC_* keys in src/c). Those fonts ship only inside the firmware, so this
script reads them out of the SDK's QEMU flash image (pebble_font_resource.py) and
writes every glyph of the six to scripts/text-fonts-system.json (committed). The
settings page draws its pictures of the watch's screens with them:
scripts/gen-watch-fonts-page.js turns the JSON into web fonts in
src/pkjs/page/layout/watch-fonts.generated.js.

The fonts are picked from basalt's flash, whose Gothic glyphs every watch shares (emery's
differ in a handful of accented capitals only). Each size has two full fonts in the pack,
the regular one inking less than the bold. As a check, each font's digits must seat as
src/c/layers/status_metrics.h models them: a cap of content_h/2 + 2 rows, standing on the
line box's bottom (the content height is the font's nominal size).

JSON: per font, its height (the nominal size, from the line's top to its baseline), the
codepoint it draws for a missing one (wildcard), and each glyph as [codepoint, width,
height, left, top (rows below the line's top), advance, bitmap] — the bitmap's rows one
after another, a bit per pixel, most significant bit first, in base64.

Run: python3 scripts/extract-system-text-fonts.py [--sdk DIR]
     (DIR: the SDK's sdk-core/pebble, default the installed current SDK)
Then: node scripts/gen-watch-fonts-page.js
"""
import argparse
import base64
import json
import os

from pebble_font_resource import DEFAULT_SDK, fonts_in, ink, load_flash, wildcard

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'scripts', 'text-fonts-system.json')
PLATFORM = 'basalt'
SIZES = (14, 18, 24)


def bitmap(rows, w, h):
    """A glyph's pixels, row after row, MSB first, as base64."""
    bits = [px for row in rows for px in row]
    out = bytearray((w * h + 7) // 8)
    for i, px in enumerate(bits):
        if px:
            out[i // 8] |= 0x80 >> (i % 8)
    return base64.b64encode(bytes(out)).decode('ascii')


def check(name, size, glyphs):
    """The digits seat as status_metrics.h models them, or the run stops."""
    digits = [glyphs[ord(c)] for c in '0123456789']
    top = min(g[3] for g in digits)
    bottom = max(g[3] + g[1] for g in digits)
    cap = size // 2 + 2
    if bottom != size or bottom - top != cap:
        raise SystemExit('extract-system-text-fonts: %s digits ink rows %d..%d, status_metrics.h says %d..%d'
                         % (name, top, bottom, size - cap, size))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--sdk', default=DEFAULT_SDK, help='the SDK\'s sdk-core/pebble directory')
    args = parser.parse_args()
    flash = load_flash(args.sdk, PLATFORM)
    fonts = fonts_in(flash)
    out = {'source': 'Pebble SDK emulator firmware system fonts (%s qemu_spi_flash.bin)' % PLATFORM, 'fonts': {}}
    for size in SIZES:
        full = [f for f in fonts if f[1] == size and ord('A') in f[3] and ord('0') in f[3]]
        if len(full) != 2:
            raise SystemExit('extract-system-text-fonts: Gothic %d: %d candidates' % (size, len(full)))
        full.sort(key=lambda f: sum(ink(g) for g in f[3].values()))
        for f, name in zip(full, ('GOTHIC_%d' % size, 'GOTHIC_%d_BOLD' % size)):
            at, max_h, _, glyphs = f
            check(name, size, glyphs)
            out['fonts'][name] = {
                'height': max_h,
                'wildcard': wildcard(flash, at),
                'glyphs': [[cp, g[0], g[1], g[2], g[3], g[4], bitmap(g[5], g[0], g[1])]
                           for cp, g in sorted(glyphs.items())],
            }
            print('%-15s %d glyphs, digits advance %d' % (name, len(glyphs), glyphs[ord('0')][4]))
    with open(OUT, 'w') as fh:
        fh.write('{\n "source": %s,\n "fonts": {\n' % json.dumps(out['source']))
        names = sorted(out['fonts'])
        for i, name in enumerate(names):
            font = out['fonts'][name]
            fh.write('  %s: {\n   "height": %d,\n   "wildcard": %d,\n   "glyphs": [\n' % (
                json.dumps(name), font['height'], font['wildcard']))
            fh.write(',\n'.join('    ' + json.dumps(g, separators=(',', ':')) for g in font['glyphs']))
            fh.write('\n   ]\n  }%s\n' % (',' if i < len(names) - 1 else ''))
        fh.write(' }\n}\n')
    print('wrote', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
