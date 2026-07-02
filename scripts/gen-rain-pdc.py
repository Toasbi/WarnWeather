#!/usr/bin/env python3
"""Generate the rain-intensity glyph PDC files (drizzle / rain / downpour).

Emits three Pebble Draw Command Image (PDCI) files of filled teardrops; drop
count = intensity bucket, arranged on a diagonal (falling-rain) inside a 25x25
viewbox. Run by hand when the art changes and commit the output — no deps.

    python3 scripts/gen-rain-pdc.py

Fill is authored white (0xFF) / stroke clear (0x00); top_status_layer.c recolors
the fill per radar tier and scales the glyph to the strip slot at load time.
Precise-path points are in 1/8-pixel units (viewbox 25 px -> 0..200 units).
Shape + arrangement validated in scratchpad/mock_drops.py.
"""
import math
import os
import struct

VIEWBOX = 25          # px
SUBPX = 8             # precise-path units per px
FILL_WHITE = 0xFF     # GColorWhite (recolored per tier at runtime)
STROKE_CLEAR = 0x00   # GColorClear (drops are pure fills, no outline)


def teardrop(cx, cy, r, tip_y, n_arc=14):
    """Closed teardrop polygon: tip at (cx, tip_y) above a body circle
    (center (cx, cy), radius r). Returns [(x, y), ...] in px."""
    d = abs(cy - tip_y)
    if d <= r:
        d = r * 1.001
    half = math.acos(r / d)          # tangent-cone half-angle at the circle center
    phi = -math.pi / 2               # center -> tip points straight up
    t1, t2 = phi + half, phi - half
    pts = [(cx, tip_y), (cx + r * math.cos(t1), cy + r * math.sin(t1))]
    end = t2 + 2 * math.pi           # major arc: around the bottom to the far tangent
    for i in range(1, n_arc + 1):
        a = t1 + (end - t1) * i / n_arc
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def drop_in_box(x0, y0, size, scale=1.0):
    """A teardrop sized to a sub-box (matches scratchpad/mock_drops.py)."""
    return teardrop(cx=x0 + 0.5 * size,
                    cy=y0 + 0.60 * size,
                    r=0.30 * size * scale,
                    tip_y=y0 + 0.06 * size)


S = VIEWBOX
ARRANGEMENTS = {
    "RAIN_DRIZZLE":  [drop_in_box(0, 0, S, scale=1.05)],
    "RAIN_RAIN":     [drop_in_box(0.02 * S, 0.00 * S, 0.62 * S),
                      drop_in_box(0.38 * S, 0.34 * S, 0.62 * S)],
    "RAIN_DOWNPOUR": [drop_in_box(0.00 * S, 0.00 * S, 0.50 * S),
                      drop_in_box(0.27 * S, 0.24 * S, 0.50 * S),
                      drop_in_box(0.52 * S, 0.48 * S, 0.50 * S)],
}


def encode_command(points):
    header = struct.pack("<BBBBBHH", 3, 0, STROKE_CLEAR, 0, FILL_WHITE, 0, len(points))
    body = b"".join(struct.pack("<hh", int(round(x * SUBPX)), int(round(y * SUBPX)))
                    for x, y in points)
    return header + body


def encode_pdc(drops):
    body = struct.pack("<BBhhH", 1, 0, VIEWBOX, VIEWBOX, len(drops))  # ver, rsvd, w, h, ncmds
    for pts in drops:
        body += encode_command(pts)
    return b"PDCI" + struct.pack("<I", len(body)) + body


def verify(blob, expected_cmds):
    assert blob[:4] == b"PDCI", "bad magic"
    assert struct.unpack_from("<I", blob, 4)[0] == len(blob) - 8, "size mismatch"
    assert struct.unpack_from("<H", blob, 14)[0] == expected_cmds, "command count"


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "resources", "data")
    for name, drops in ARRANGEMENTS.items():
        blob = encode_pdc(drops)
        verify(blob, len(drops))
        with open(os.path.join(out_dir, name + ".pdc"), "wb") as f:
            f.write(blob)
        print("wrote %-20s %3d bytes  %d drop(s)" % (name + ".pdc", len(blob), len(drops)))


if __name__ == "__main__":
    main()
