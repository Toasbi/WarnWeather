"""Pebble system fonts inside the SDK's emulator firmware: finding and reading them.

The watch's system fonts ship only inside its firmware, where they sit in the system
resource pack. The SDK's QEMU flash image (sdk-core/pebble/<platform>/qemu/
qemu_spi_flash.bin.bz2) holds that pack, so a font can be read straight out of it.

Each font is a Pebble font resource (v3: the SDK's tools/font/fontgen.py writes it):
FontInfo, a 255-entry hash table, offset tables of (codepoint, offset), then each
glyph as a 5-byte header (width, height, left, top, advance) and its bitmap, one bit
per pixel, rows unaligned, LSB first in 32-bit little-endian words. `top` counts rows
below the line's top; the baseline sits `max_height` rows below it.

Shared by extract-system-clock-glyphs.py (the clock's 1-bit digits) and
extract-system-text-fonts.py (the Gothic text fonts). Standard library only.
"""
import bz2
import os
import re
import struct

DEFAULT_SDK = os.path.expanduser('~/.local/share/pebble-sdk/SDKs/current/sdk-core/pebble')


def load_flash(sdk, platform):
    """A platform's emulator flash image, decompressed."""
    path = os.path.join(sdk, platform, 'qemu', 'qemu_spi_flash.bin.bz2')
    return bz2.decompress(open(path, 'rb').read())


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


def wildcard(flash, at):
    """The codepoint the font at `at` draws for one it has no glyph for."""
    return struct.unpack_from('<H', flash, at + 4)[0]


def parse_font(flash, at):
    """The glyphs of the font resource at `at`: {codepoint: (w, h, left, top, adv, rows)}."""
    version, max_h, count, wild, table_size, cp_bytes, size, features = \
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
