#!/usr/bin/env python3
"""Generate the rain-intensity glyph PDC files (drizzle / rain / downpour).

Emits three Pebble Draw Command Image (PDCI) files of filled teardrops (Tabler
`droplets` style); drop count = intensity bucket. All three files share ONE drop
geometry unit (translated, never rescaled per variant) so the family reads as one
consistent glyph at 1/2/3 copies. Run by hand when the art changes and commit the
output — no deps.

    python3 scripts/gen-rain-pdc.py

Fill is authored white (0xFF) / stroke clear (0x00); top_status_layer.c recolors
the fill per radar tier and scales the glyph to the
strip slot at load time. Precise-path points are in 1/8-pixel units (viewbox 25 px
-> 0..200 units). Shape + arrangement were tuned against an offline PIL mock before
authoring.
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


# One drop unit, sized as in the three-drop composition (Tabler `droplets`);
# a lone drop gains whitespace but must NOT be materially larger.
DROP = teardrop(0, 0, 4.2, -6.5)  # local coords around (0,0); tune r/tip once


def translated(dx, dy):
    return [(x + dx, y + dy) for x, y in DROP]


ARRANGEMENTS = {
    # A single, normal-sized teardrop — nudged to visual center. Deliberately NOT
    # scaled up to fill the box: a lone drop that fills the viewbox reads as one
    # huge blob, not a raindrop; count (not size) encodes intensity.
    "RAIN_DRIZZLE.pdc": [translated(12.5, 14)],                      # centered
    "RAIN_RAIN.pdc": [translated(8, 14), translated(17, 14)],        # balanced
    "RAIN_DOWNPOUR.pdc": [translated(12.5, 9),                       # one above
                          translated(7, 17), translated(18, 17)],    # two below
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
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(blob)
        print("wrote %-20s %3d bytes  %d drop(s)" % (name, len(blob), len(drops)))


if __name__ == "__main__":
    main()
