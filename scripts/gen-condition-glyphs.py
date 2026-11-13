#!/usr/bin/env python3
"""Generate the weather condition slot's glyphs (src/pkjs/weather/condition.js).

Each glyph is composed from Tabler Icons outline shapes (https://tabler.io/icons, MIT License,
Copyright (c) 2020-2024 Pawel Kuna), the family every other status glyph comes from, plus the
few arcs and marks Tabler has no icon for (a sun or moon behind a cloud, drizzle, sleet, hail).
The parts are flattened and fitted exactly as scripts/svg2pdc.py does (its own functions), and
written twice from the one set of points:

  resources/data/STATUS_COND_<NAME>.pdc        the watch glyphs (status_row_icons.c)
  src/pkjs/settings/condition-glyphs.generated.js   the settings page's copy (status-slot-icons.js)

so the page draws the very outline the watch does. The page draws only the slot's own picture
(PAGE_GLYPHS), so only that one ships in it. The wind condition reuses STATUS_WIND.pdc.

Run by hand from the repo root after changing a glyph, and commit both outputs:
    python3 scripts/gen-condition-glyphs.py
Deps: pip install svg.path (svg2pdc.py's).
"""

import importlib.util
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("svg2pdc", os.path.join(HERE, "svg2pdc.py"))
svg2pdc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(svg2pdc)

# --- Tabler parts (24-unit grid) ---------------------------------------------------------

# tabler cloud: the closed cloud.
CLOUD = ("M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482"
         "c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 "
         "3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487"
         "h-11.878")
# tabler cloud-storm's bolt, moved under the raised cloud below.
BOLT = "M13 14.5l-2.5 4h3.5l-2 4"
# tabler cloud-fog: its cloud, closed a little higher, and the bank of fog under it.
FOG = ["M7 16a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-12", "M5 20l14 0"]
# tabler moon.
MOON = "M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"
# tabler haze's half sun, its rays lengthened to the UV glyph's two units so they survive the
# smallest bars, over its two banks of haze.
HAZE = ["M2 12h2", "M12 2v2", "M20 12h2", "M4.9 4.9l1.4 1.4", "M19.1 4.9l-1.4 1.4",
        "M8 12a4 4 0 1 1 8 0", "M3 16h18", "M3 20h18"]


def path(d, s=1.0, dx=0.0, dy=0.0):
    """A path's flattened subpaths, scaled by s and moved by (dx, dy)."""
    return [([(x * s + dx, y * s + dy) for x, y in pts], is_open)
            for pts, is_open in svg2pdc.flatten_path(d)]


def arc(cx, cy, r, a0, a1, step=30):
    """An open arc from angle a0 to a1 (degrees, y down: 0 right, 90 down), clockwise."""
    n = max(2, int(math.ceil(abs(a1 - a0) / float(step))))
    return [([(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / float(n))),
               cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / float(n))))
              for i in range(n + 1)], True)]


def rays(cx, cy, r0, r1, angles):
    """Open strokes from radius r0 to r1 at each angle (degrees, y down)."""
    out = []
    for a in angles:
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        out.append(([(cx + r0 * c, cy + r0 * s), (cx + r1 * c, cy + r1 * s)], True))
    return out


def ring(cx, cy, r):
    """A closed octagon, svg2pdc's <circle> (flat top, crisp at the small tiers)."""
    return [(svg2pdc.circle_pts(cx, cy, r, r), False)]


def plus(cx, cy, h=1.2):
    """A snowflake, small: a plus of arms h."""
    return [([(cx - h, cy), (cx + h, cy)], True), ([(cx, cy - h), (cx, cy + h)], True)]


# The sun the UV glyph draws (a ring of r 4 and eight rays two units long).
SUN = ring(12, 12, 4) + rays(12, 12, 6, 8, range(0, 360, 45))
# A sun and a moon peeking from behind a cloud: the cloud shrunk to the lower right, the body
# at the upper left with only its part outside the cloud drawn.
SMALL_CLOUD = path(CLOUD, 0.72, 7.6, 6.9)
SUN_CLOUD = (arc(8.5, 8.5, 3.2, 95, 355) + rays(8.5, 8.5, 4.6, 6.3, [135, 180, 225, 270, 315])
             + SMALL_CLOUD)
MOON_CLOUD = path(MOON, 0.55, 1.2, 1.4) + SMALL_CLOUD

# What falls, under the cloud rather than in it (tabler draws its drops inside an open
# cloud, which merges into one blob at the 10-15 px the bars draw): the closed cloud raised and
# shrunk to the top, its bottom at y 14.5, and the marks below it.
TOP_CLOUD = path(CLOUD, 0.82, 2.16, -0.26)
DROPS = path("M8.5 17l-1 3m5 -3l-1 3m5 -3l-1 3")
DOTS = path("M8.5 17.5l-.5 1.5m4.5 -1.5l-.5 1.5m4.5 -1.5l-.5 1.5")

GLYPHS = [
    ("SUN", SUN),
    ("MOON", path(MOON)),
    ("SUN_CLOUD", SUN_CLOUD),
    ("MOON_CLOUD", MOON_CLOUD),
    ("CLOUD", path(CLOUD)),
    ("FOG", sum((path(d) for d in FOG), [])),
    ("HAZE", sum((path(d) for d in HAZE), [])),
    # Drizzle three short drops, rain three long ones (showers too).
    ("DRIZZLE", TOP_CLOUD + DOTS),
    ("RAIN", TOP_CLOUD + DROPS),
    # Sleet: a drop beside a snowflake.
    ("SLEET", TOP_CLOUD + path("M9 17l-1 3") + plus(15, 18.5, 1.5)),
    ("SNOW", TOP_CLOUD + plus(9, 18.5, 1.5) + plus(15, 18.5, 1.5)),
    ("HAIL", TOP_CLOUD + ring(9, 18.8, 1.4) + ring(15, 18.8, 1.4)),
    ("THUNDER", TOP_CLOUD + path(BOLT)),
]


# The glyphs the settings page draws: the condition slot's picture (status-slot-icons.js).
PAGE_GLYPHS = ["SUN_CLOUD"]


def page_path(cmds):
    """The fitted subpaths as one SVG path string, a tenth of a unit apart."""
    parts = []
    for pts, is_open in cmds:
        d = "M" + " L".join("%s %s" % (_n(x), _n(y)) for x, y in pts)
        parts.append(d + ("" if is_open else "Z"))
    return "".join(parts)


def _n(v):
    s = ("%.1f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def main():
    out_dir = os.path.join(ROOT, "resources", "data")
    page = {}
    for name, cmds in GLYPHS:
        fitted = svg2pdc.fit_to_viewbox(cmds)
        data = svg2pdc.encode(fitted)
        dest = os.path.join(out_dir, "STATUS_COND_%s.pdc" % name)
        with open(dest, "wb") as f:
            f.write(data)
        page[name] = page_path(fitted)
        print("wrote %s (%d bytes, %d commands)" % (os.path.relpath(dest, ROOT), len(data), len(fitted)))
    js = os.path.join(ROOT, "src", "pkjs", "settings", "condition-glyphs.generated.js")
    lines = [
        "// GENERATED by scripts/gen-condition-glyphs.py from the glyphs it writes to",
        "// resources/data/STATUS_COND_*.pdc: do not edit. The weather condition glyphs the settings",
        "// page draws (PAGE_GLYPHS), one SVG path each (24-unit grid, outline), for its pictures of",
        "// the slot (status-slot-icons.js). Tabler Icons shapes, MIT License, Copyright (c) 2020-2024",
        "// Pawel Kuna.",
        "(function () {",
        "    var GLYPHS = {",
    ]
    names = PAGE_GLYPHS
    for i, n in enumerate(names):
        lines.append("        %s: '%s'%s" % (n, page[n], "," if i < len(names) - 1 else ""))
    lines += [
        "    };",
        "    if (typeof module !== 'undefined' && module.exports) { module.exports = GLYPHS; }",
        "    if (typeof window !== 'undefined') { window.ConditionGlyphs = GLYPHS; }",
        "})();",
        "",
    ]
    with open(js, "w") as f:
        f.write("\n".join(lines))
    print("wrote %s" % os.path.relpath(js, ROOT))


if __name__ == "__main__":
    main()
