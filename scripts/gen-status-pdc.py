#!/usr/bin/env python3
"""Generate the status-slot PDC glyphs (outline family).

The route (distance) silhouette is hand-simplified from Tabler Icons
(https://tabler.io/icons), MIT License, Copyright (c) 2020-2024 Pawel Kuna, and
simplified for legibility at the 10-15 px render tiers; do not copy upstream
paths mechanically.

DEPRECATED: nothing is generated here anymore. The whole outline family —
temperature / UV / wind / gust / precip (umbrella) / pollen / distance / heart —
is converted from the outline (stroke) SVGs in docs/superpowers/svg/*.svg via
scripts/svg2pdc.py; the remaining health glyphs (sleep / steps) are committed
directly. They are all the same outline family; status_row_icons.c recolors every
command's stroke to theme_fg() and clears the fill regardless of origin. This file
is kept only for its encode/verify reference.

The glyphs here render as thin outlines: author strokes only (fill cleared) and
approximate curves as polygons.

Run by hand and commit the output: python3 scripts/gen-status-pdc.py
"""
import math
import os
import struct
import sys

VIEWBOX = 24
SUBPX = 8           # precise-path units per px
STROKE = 0xFF       # recolored to theme_fg() at runtime
STROKE_W = 2
FILL_CLEAR = 0x00


def circle(cx, cy, r, n=16):
    # n=16 keeps the polygon reading round at the 12-15 px render tiers (the
    # runtime scales points but not a native circle's radius, so we approximate).
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


# Nothing is generated here anymore. STATUS_DISTANCE was the last hold-out; it now
# comes from docs/superpowers/svg/distance.svg via scripts/svg2pdc.py, like the whole
# outline family (temperature/UV/wind/gust/precip/pollen/heart). Retiring the entry
# stops a stray `--force` run from clobbering the SVG-sourced glyph with the old
# chunky hand-authored one. The encode/circle helpers are kept for reference.
ICONS = {}


def verify(data, n_expected):
    assert data[:4] == b"PDCI"
    (size,) = struct.unpack_from("<I", data, 4)
    assert size == len(data) - 8
    (ncmds,) = struct.unpack_from("<H", data, 14)
    assert ncmds == n_expected


def main():
    # Nothing to generate: every glyph now comes from an SVG via scripts/svg2pdc.py
    # (see this module's docstring). Kept as a no-op so an old muscle-memory run is
    # harmless rather than clobbering the SVG-sourced assets.
    if not ICONS:
        print("gen-status-pdc: nothing to generate — glyphs come from "
              "docs/superpowers/svg/*.svg via scripts/svg2pdc.py.")
        return
    if "--force" not in sys.argv:
        print("gen-status-pdc: DISABLED. Re-run with --force to regenerate.")
        return
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
