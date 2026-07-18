#!/usr/bin/env python3
"""Convert an outline SVG icon into a Pebble PDC (precise-path) glyph.

This is the pipeline for the status/health outline family in resources/data/
(STATUS_TEMP/UV/WIND/GUST/PRECIP/POLLEN/DISTANCE, HEALTH_HEART). Sources live in
docs/superpowers/svg/*.svg (Tabler outline icons). It replaces the old
gen-status-pdc.py, which is now a no-op.

Why a custom tool (vs pebble-examples' svg2pdc.py):
 - flattens Bezier/arc segments into many sub-points (the official tool keeps only
   each segment's start point, turning curves into chords → "wonky");
 - emits precise paths (type 3, 1/8-px units) always;
 - turns <circle>/<ellipse> into high-facet polygons so they read round when small;
 - skips non-drawn paths (Tabler ships a transparent stroke="none" 24x24 bounding
   rect; stroking it would draw a box border around the glyph);
 - forces stroke-only line-art (stroke 0xFF, clear fill) to match the runtime
   recolor in status_row_icons.c (theme_fg() stroke, GColorClear fill).

Sizing note — the runtime scaler in status_row_icons.c normalizes each glyph's INK
bounding box to the tier's target height (content_h * ICON_RATIO), so the authored
pixel size does NOT affect the rendered size: only the glyph's ASPECT RATIO and its
curve/circle fidelity carry through. VIEWBOX/MARGIN therefore just keep the master
sane and give the polygonizer enough resolution; STROKE_W matters because a 1px
stroke is the one width Pebble antialiases (keep it 1).

Conventions (override via env for one-offs):
 - VIEWBOX 24 (test/status-pdc.test.js asserts 24 for this family)
 - SVG2PDC_MARGIN 2   -> ~20px content
 - SVG2PDC_STROKE 1   -> thin, antialiased

Deps: pip install svg.path
Usage: python3 scripts/svg2pdc.py in.svg NAME [out_dir]   # writes out_dir/NAME.pdc

Regenerate the whole family (from repo root):
    for pair in \\
      temperature:STATUS_TEMP uv:STATUS_UV wind:STATUS_WIND gusts:STATUS_GUST \\
      umbrella:STATUS_PRECIP pollen:STATUS_POLLEN distance:STATUS_DISTANCE \\
      heart-pulse:HEALTH_HEART; do
      svg=${pair%%:*}; name=${pair##*:}
      python3 scripts/svg2pdc.py "docs/superpowers/svg/$svg.svg" "$name" resources/data
    done
(HEALTH_STEPS / HEALTH_SLEEP are hand-authored PDCs, not produced here.)
"""
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET

import svg.path

VIEWBOX = 24
SUBPX = 8
MARGIN = float(os.environ.get("SVG2PDC_MARGIN", "2.0"))  # padding -> content ~20px
STROKE = 0xFF
STROKE_W = int(os.environ.get("SVG2PDC_STROKE", "1"))    # 1px = AA'd on Pebble
FILL_CLEAR = 0x00
# Curves are flattened by arc LENGTH (roughly one point every CURVE_SPACING viewbox px)
# and are NOT run through RDP afterwards. RDP is a greedy, start-point-dependent
# simplifier: on a symmetric arc it keeps an asymmetric subset of vertices, which is what
# made circles/arcs (e.g. the thermometer bulb) lopsided. Uniform arc-length sampling is
# inherently symmetric about the arc's axis, so dropping RDP fixes the asymmetry; the
# extra vertices cost a few PDC bytes (negligible). Assumes 24-viewBox source SVGs
# (Tabler/Lucide), so segment length is measured in ~viewbox units.
CURVE_SPACING = 1.2   # viewbox px between flattened curve points
CURVE_MIN_STEPS = 3   # never fewer than this many chords per curved segment
CIRCLE_SPACING = 1.2  # viewbox px between polygon vertices for <circle>/<ellipse>
CIRCLE_MIN = 12
CIRCLE_MAX = 64


def _f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _curve_steps(seg):
    """Chord count for a curved segment: ~one per CURVE_SPACING of arc length,
    so long/tight arcs get more vertices and short ones fewer — evenly spaced."""
    try:
        length = seg.length(error=1e-3)
    except Exception:
        length = 0.0
    steps = int(round(length / CURVE_SPACING))
    return steps if steps > CURVE_MIN_STEPS else CURVE_MIN_STEPS


def flatten_path(d):
    """Return list of (points, is_open) subpaths from a path 'd' string."""
    path = svg.path.parse_path(d)
    subs = []
    cur = None
    for seg in path:
        name = type(seg).__name__
        if name == "Move":
            if cur:
                subs.append(cur)
            cur = {"pts": [(seg.end.real, seg.end.imag)], "closed": False}
        elif name == "Close":
            if cur:
                cur["closed"] = True
                subs.append(cur)
                cur = None
        else:
            if cur is None:
                cur = {"pts": [(seg.start.real, seg.start.imag)], "closed": False}
            if name == "Line":
                cur["pts"].append((seg.end.real, seg.end.imag))
            else:
                steps = _curve_steps(seg)
                for i in range(1, steps + 1):
                    p = seg.point(i / float(steps))
                    cur["pts"].append((p.real, p.imag))
    if cur:
        subs.append(cur)
    return [(s["pts"], not s["closed"]) for s in subs]


def circle_pts(cx, cy, rx, ry, n=None):
    import math
    if n is None:
        r = max(abs(rx), abs(ry))
        n = int(round(2 * math.pi * r / CIRCLE_SPACING))
        n = max(CIRCLE_MIN, min(CIRCLE_MAX, n))
    return [(cx + rx * math.cos(2 * math.pi * i / n),
             cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]


def local(tag):
    return tag.split("}")[-1]


def extract(elem):
    """Yield (points, is_open) for one supported SVG element."""
    t = local(elem.tag)
    a = elem.attrib
    # Skip non-drawn paths (Tabler's transparent 24x24 bounding rect carries
    # stroke="none"); we force a stroke on everything else, so leaving it in
    # renders a box border around the glyph.
    if a.get("stroke") == "none":
        return
    if t == "path" and a.get("d"):
        for sub in flatten_path(a["d"]):
            yield sub
    elif t in ("circle",):
        yield (circle_pts(_f(a.get("cx")), _f(a.get("cy")),
                          _f(a.get("r")), _f(a.get("r"))), False)
    elif t == "ellipse":
        yield (circle_pts(_f(a.get("cx")), _f(a.get("cy")),
                          _f(a.get("rx")), _f(a.get("ry"))), False)
    elif t == "rect":
        x, y = _f(a.get("x")), _f(a.get("y"))
        w, h = _f(a.get("width")), _f(a.get("height"))
        yield ([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], False)
    elif t == "line":
        yield ([(_f(a.get("x1")), _f(a.get("y1"))),
                (_f(a.get("x2")), _f(a.get("y2")))], True)
    elif t in ("polyline", "polygon"):
        nums = [float(v) for v in re.split(r"[\s,]+", a.get("points", "").strip()) if v]
        pts = list(zip(nums[0::2], nums[1::2]))
        yield (pts, t == "polyline")


def parse_svg(svg_path):
    tree = ET.parse(svg_path)
    cmds = []
    for elem in tree.iter():
        for pts, is_open in extract(elem):
            if len(pts) >= 2:
                cmds.append((pts, is_open))
    return cmds


def fit_to_viewbox(cmds):
    xs = [p[0] for pts, _ in cmds for p in pts]
    ys = [p[1] for pts, _ in cmds for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    w, h = maxx - minx, maxy - miny
    avail = VIEWBOX - 2 * MARGIN
    scale = avail / max(w, h)
    ox = MARGIN + (avail - w * scale) / 2.0
    oy = MARGIN + (avail - h * scale) / 2.0
    out = []
    for pts, is_open in cmds:
        out.append(([(ox + (x - minx) * scale, oy + (y - miny) * scale)
                     for x, y in pts], is_open))
    return out


def encode(cmds):
    body = struct.pack("<BBhhH", 1, 0, VIEWBOX, VIEWBOX, len(cmds))
    for pts, is_open in cmds:
        body += struct.pack("<BBBBBHH", 3, 0, STROKE, STROKE_W, FILL_CLEAR,
                            1 if is_open else 0, len(pts))
        for x, y in pts:
            body += struct.pack("<hh", int(round(x * SUBPX)), int(round(y * SUBPX)))
    return b"PDCI" + struct.pack("<I", len(body)) + body


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: svg2pdc.py in.svg NAME [out_dir]")
    svg_path, name = sys.argv[1], sys.argv[2]
    out_dir = sys.argv[3] if len(sys.argv) > 3 else "."
    cmds = parse_svg(svg_path)
    cmds = fit_to_viewbox(cmds)
    data = encode(cmds)
    out = os.path.join(out_dir, name + ".pdc")
    with open(out, "wb") as f:
        f.write(data)
    print("wrote %s (%d bytes, %d commands)" % (out, len(data), len(cmds)))


if __name__ == "__main__":
    main()
