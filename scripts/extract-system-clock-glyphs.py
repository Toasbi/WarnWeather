#!/usr/bin/env python3
"""Extract the watch's 1-bit clock digits from the Pebble SDK's emulator firmware.

The clock draws from system fonts wherever it has no anti-aliased glyph images
(scripts/gen-clock-glyphs.py): LECO everywhere, and all three faces on the 144 px
black-and-white watches (src/c/layers/clock_ink.h has the table). Those fonts ship
only inside the firmware, so this script reads them out of the SDK's QEMU flash
image, where the firmware keeps them in its system resource pack, and writes their
digits and colon to scripts/clock-glyphs-system.json (committed). The settings
page's watch preview draws its clock with them (scripts/gen-clock-glyphs-page.js
bakes the JSON into src/pkjs/settings/clock-glyphs.generated.js).

Each font is a Pebble font resource (v3: the SDK's tools/font/fontgen.py writes it):
FontInfo, a 255-entry hash table, offset tables of (codepoint, offset), then each
glyph as a 5-byte header (width, height, left, top, advance) and its bitmap, one
bit per pixel, rows unaligned, LSB first in 32-bit little-endian words.

Fonts are found by their headers, and named by what they hold (see FONTS); as a
check, each face's digits must ink the rows clock_ink.c measured on the watch.

Run: python3 scripts/extract-system-clock-glyphs.py [--sdk DIR]
     (DIR: the SDK's sdk-core/pebble, default the installed current SDK)
Then: node scripts/gen-clock-glyphs-page.js
"""
import argparse
import base64
import bz2
import json
import os
import re
import struct
import zlib

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'scripts', 'clock-glyphs-system.json')
DEFAULT_SDK = os.path.expanduser('~/.local/share/pebble-sdk/SDKs/current/sdk-core/pebble')
GLYPHS = '0123456789:'

# The fonts the clock uses (clock_ink.h), how to tell each from its neighbours in the
# pack, and the digit ink height clock_ink.c measured on the watch (the check).
FONTS = {
    'LECO_42_NUMBERS': {'platform': 'basalt', 'height': 42, 'ink_h': 29},
    'LECO_60_NUMBERS_AM_PM': {'platform': 'emery', 'height': 60, 'ink_h': 42},
    'ROBOTO_BOLD_SUBSET_49': {'platform': 'basalt', 'height': 49, 'ink_h': 35},
    'BITHAM_42_MEDIUM_NUMBERS': {'platform': 'basalt', 'height': 42, 'ink_h': 31},
}


def fonts_in(flash):
    """Every v3 font resource in a flash image, in flash order.

    Returns [(offset, max_height, glyph count, {codepoint: glyph})].
    """
    out = []
    for m in re.finditer(rb'\x03(.)(..)(..)\xff([\x02\x04])\x0a(.)', flash, re.S):
        max_h = m.group(1)[0]
        count = struct.unpack('<H', m.group(2))[0]
        features = m.group(5)[0]
        if not (6 < max_h < 120 and 1 <= count < 2000 and features < 4):
            continue
        out.append((m.start(), max_h, count, parse_font(flash, m.start())))
    return out


def parse_font(flash, at):
    """The glyphs of the font resource at `at`: {codepoint: (w, h, left, top, adv, rows)}."""
    version, max_h, count, wildcard, table_size, cp_bytes, size, features = \
        struct.unpack_from('<BBHHBBBB', flash, at)
    if features & 0x02:
        raise ValueError('RLE4 glyphs are not handled')
    off_bytes = 2 if features & 0x01 else 4
    entry = cp_bytes + off_bytes
    tables = at + size + table_size * 4
    offsets = {}
    for b in range(table_size):
        _, n, off = struct.unpack_from('<BBH', flash, at + size + b * 4)
        for k in range(n):
            p = tables + off + k * entry
            cp = struct.unpack_from('<H' if cp_bytes == 2 else '<I', flash, p)[0]
            offsets[cp] = struct.unpack_from('<H' if off_bytes == 2 else '<I', flash, p + cp_bytes)[0]
    glyph_table = tables + count * entry
    glyphs = {}
    for cp, off in offsets.items():
        g = glyph_table + off
        w, h, left, top, adv = struct.unpack_from('<BBbbb', flash, g)
        words = (w * h + 31) // 32
        bits = []
        for i in range(words):
            word = struct.unpack_from('<I', flash, g + 5 + i * 4)[0]
            bits.extend((word >> j) & 1 for j in range(32))
        rows = [bits[r * w:(r + 1) * w] for r in range(h)]
        glyphs[cp] = (w, h, left, top, adv, rows)
    return glyphs


def ink(glyph):
    """Pixels a glyph inks."""
    return sum(sum(r) for r in glyph[5])


def pick(fonts, name):
    """The font named `name` among a flash's fonts (see FONTS)."""
    spec = FONTS[name]
    digits = [ord(c) for c in GLYPHS]
    have = [f for f in fonts if f[1] == spec['height'] and all(d in f[3] for d in digits)]
    roboto = [i for i, f in enumerate(fonts) if f[1] == 49 and len(f[3]) <= 16]
    if name == 'ROBOTO_BOLD_SUBSET_49':
        found = [f for f in have if len(f[3]) <= 16]
    elif name == 'BITHAM_42_MEDIUM_NUMBERS':
        # The numbers-only 42 before Roboto 49 (Bitham's fonts lead the pack's clock faces).
        found = [f for f in have if len(f[3]) <= 16 and fonts.index(f) < roboto[0]]
    elif name == 'LECO_42_NUMBERS':
        found = [f for f in have if fonts.index(f) > roboto[0] and ord('A') not in f[3]]
    else:
        # The two LECO 60 AM/PM fonts: the regular one inks less than the bold.
        found = sorted([f for f in have if ord('A') in f[3]], key=lambda f: ink(f[3][ord('8')]))[:1]
    if len(found) != 1:
        raise SystemExit('extract-system-clock-glyphs: %s: %d candidates' % (name, len(found)))
    return found[0]


def png(rows, w, h):
    """A black glyph on transparent as a PNG (8-bit RGBA, alpha 0 or 255)."""
    raw = b''.join(b'\x00' + b''.join(b'\x00\x00\x00' + (b'\xff' if px else b'\x00') for px in row)
                   for row in rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--sdk', default=DEFAULT_SDK, help='the SDK\'s sdk-core/pebble directory')
    args = parser.parse_args()
    flashes = {}
    out = {'source': 'Pebble SDK emulator firmware system fonts (qemu_spi_flash.bin)', 'fonts': {}}
    for name, spec in FONTS.items():
        plat = spec['platform']
        if plat not in flashes:
            path = os.path.join(args.sdk, plat, 'qemu', 'qemu_spi_flash.bin.bz2')
            flashes[plat] = fonts_in(bz2.decompress(open(path, 'rb').read()))
        _, max_h, _, glyphs = pick(flashes[plat], name)
        digits = [glyphs[ord(c)] for c in GLYPHS]
        top = min(g[3] for g in digits[:10])
        bottom = max(g[3] + g[1] for g in digits[:10])
        if bottom - top != spec['ink_h']:
            raise SystemExit('extract-system-clock-glyphs: %s inks %d rows, clock_ink.c says %d'
                             % (name, bottom - top, spec['ink_h']))
        out['fonts'][name] = {
            'maxHeight': max_h, 'inkTop': top, 'inkH': bottom - top,
            # [width, height, left, top (rows below the line top), advance, PNG base64]
            'glyphs': [[g[0], g[1], g[2], g[3], g[4], base64.b64encode(png(g[5], g[0], g[1])).decode('ascii')]
                       for g in digits]
        }
        print('%-26s %s  max %d  digits ink %d rows from %d  advances %s'
              % (name, plat, max_h, bottom - top, top, [g[4] for g in digits]))
    with open(OUT, 'w') as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write('\n')
    print('wrote', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
