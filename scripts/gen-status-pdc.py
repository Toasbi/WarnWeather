#!/usr/bin/env python3
"""Generate the status-slot PDC glyphs (outline family).

Geometry is hand-simplified from Tabler Icons (https://tabler.io/icons),
MIT License, Copyright (c) 2020-2024 Pawel Kuna - simplified for legibility
at the 10-15 px render tiers; do not copy upstream paths mechanically.
Run by hand and commit the output: python3 scripts/gen-status-pdc.py
"""
import math
import os
import struct

VIEWBOX = 24
SUBPX = 8           # precise-path units per px
STROKE = 0xFF       # recolored to theme_fg() at runtime
STROKE_W = 2
FILL_CLEAR = 0x00


def circle(cx, cy, r, n=10):
    return [(cx + r * math.cos(2 * math.pi * i / n),
             cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def encode_command(points, path_open):
    header = struct.pack("<BBBBBHH", 3, 0, STROKE, STROKE_W, FILL_CLEAR,
                         1 if path_open else 0, len(points))
    body = b"".join(struct.pack("<hh", int(round(x * SUBPX)), int(round(y * SUBPX)))
                    for x, y in points)
    return header + body


def encode_pdc(commands):
    body = struct.pack("<BBhhH", 1, 0, VIEWBOX, VIEWBOX, len(commands))
    for points, path_open in commands:
        body += encode_command(points, path_open)
    return b"PDCI" + struct.pack("<I", len(body)) + body


# Each icon: list of (points, path_open). Grid is 24x24, stroke 2.
ICONS = {
    # Tabler `temperature`: stem + bulb.
    "STATUS_TEMP": [
        ([(10, 14), (10, 5), (11, 4), (13, 4), (14, 5), (14, 14)], True),
        (circle(12, 17, 4), False),
    ],
    # Custom UV monogram: a U and a V.
    "STATUS_UV": [
        ([(4, 6), (4, 14), (5.5, 16), (8, 16), (9.5, 14), (9.5, 6)], True),
        ([(13.5, 6), (16.5, 16), (19.5, 6)], True),
    ],
    # Tabler `wind`: three streamlines, top two with curled ends.
    "STATUS_WIND": [
        ([(3, 8), (15, 8), (17, 7), (17, 5), (15, 4)], True),
        ([(3, 12), (19, 12), (21, 11), (21, 9), (19, 8)], True),
        ([(3, 16), (13, 16), (15, 17), (15, 19), (13, 20)], True),
    ],
    # Tabler `windsock`: pole + cone + one divider.
    "STATUS_GUST": [
        ([(5, 3), (5, 21)], True),
        ([(5, 5), (19, 7.5), (19, 10.5), (5, 13)], False),
        ([(11, 6), (11, 12)], True),
    ],
    # Tabler `umbrella`: dome + handle.
    "STATUS_PRECIP": [
        ([(3, 12), (4, 9), (7, 6), (12, 4.5), (17, 6), (20, 9), (21, 12)], True),
        ([(3, 12), (21, 12)], True),
        ([(12, 12), (12, 18), (13, 19.5), (15, 19.5), (16, 18)], True),
    ],
    # Tabler `route`: start dot, S-path, end dot.
    "STATUS_DISTANCE": [
        (circle(5, 19, 2.5, 8), False),
        ([(7.5, 19), (14, 19), (17, 16), (17, 9), (14, 6), (9.5, 6)], True),
        (circle(19, 5, 2.5, 8), False),
    ],
}


def verify(data, n_expected):
    assert data[:4] == b"PDCI"
    (size,) = struct.unpack_from("<I", data, 4)
    assert size == len(data) - 8
    (ncmds,) = struct.unpack_from("<H", data, 14)
    assert ncmds == n_expected


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "resources", "data")
    for name, commands in ICONS.items():
        data = encode_pdc(commands)
        verify(data, len(commands))
        path = os.path.join(out_dir, name + ".pdc")
        with open(path, "wb") as f:
            f.write(data)
        print("wrote %s (%d bytes, %d commands)" % (path, len(data), len(commands)))


if __name__ == "__main__":
    main()
