#!/usr/bin/env python3
"""Generate the anti-aliased clock digit strips for the colour platforms.

The watch's system fonts (and the SDK's TTF font resources) are 1-bit, so the clock
digits on a colour screen have hard, stair-stepped edges. This script rasterises the
digits ONCE, here, grid-fitted (see fit_glyph) and with FreeType's anti-aliasing, and
quantises each pixel's coverage to the 2-bit alpha a GColor8 carries (0, 1/3, 2/3,
opaque). The SDK packs each strip as a 2-bit palette whose four entries are those four
alpha levels; the watch recolours
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

# Grid fitting. LIGHT hinting snapped only vertically, so every vertical stem kept fractional left
# and right edges: a grey rail down each side. Instead, FreeType's auto-hinter fits the outline for
# a 1-bit target (TARGET_MONO), which snaps BOTH axes -- straight stems and bars land on whole
# pixels -- and the fitted outline is then rasterised in 8-bit grey, so curves and diagonals keep
# their anti-aliasing. The auto-hinter rounds each stroke's width to the NEAREST pixel, though (a
# bar's height even rounds down below .75), which thins a stroke whose fraction is small: Bitham's
# 4.36 px stem draws 4 px at 44 px. fit_glyph() undoes that stroke by stroke on the fitted outline:
# a thinned stroke gets its design width back exactly -- the edge the hinter placed nearer the
# design stays on the grid and the other moves out by the lost fraction (one grey column or row
# where LIGHT drew two). A stroke counts as thinned when the hinter took SLIVER or more off its
# design width; less is under the 2-bit alpha's half step, which the strip could not show anyway.
# Round strokes across the vertical -- a bowl's top and bottom, the round top of a '0' -- are
# rounded the same way and restored the same way. Round ones across the horizontal -- a bowl's
# left and right sides -- are not fitted at all: every point where the outline turns back in x
# that is on no straight edge keeps its design x, so a bowl's sides shade their own edges the way
# the curve above and below them does. Snapping them only moved them: at Emery's 62 px the
# hinter set the right side of Roboto's '6' down from 24.67..33.39 to 24..33 -- the whole stroke
# 0.4-0.7 px into the counter, which then read as a narrow slot beside a fat wall. A straight edge
# no stroke claims (a bar's end, a terminal's cut) is snapped to the nearest pixel -- inward when
# it is the glyph's own top or bottom, so no flat edge fills a row the other digits reach only with
# overshoot -- and each glyph is placed by its ink centroid, so the gaps between digits stay the
# design's to within half a pixel.
HINT_FLAGS = freetype.FT_LOAD_TARGET_MONO | freetype.FT_LOAD_FORCE_AUTOHINT | freetype.FT_LOAD_NO_BITMAP
DESIGN_FLAGS = freetype.FT_LOAD_NO_HINTING | freetype.FT_LOAD_NO_BITMAP
SLIVER = 10     # 26.6 units, ~1/6 px
MERGE = 16      # same-side straight runs within 1/4 px are one edge (as the auto-hinter merges them)
MIN_RUN = 64    # a straight run shorter than 1 px is not an edge
ASPECT = 2      # a stem is at most ASPECT times wider than its straight runs are long (a bar's two
                # ends face each other across solid ink too, but they are not a stem)


def contours(ends):
    start = 0
    for end in ends:
        yield list(range(start, end + 1))
        start = end + 1


def straight_edges(P, tags, ends):
    """The outline's straight axis-parallel edges, in 26.6 units, pen-relative, y up.

    A run is a chain of points between on-curve ends that keeps one coordinate (k = 0: x, a
    vertical run; k = 1: y). Same-side runs within MERGE are merged into one edge: {'k', 'side',
    'pos' (length-weighted), 'runs': [(lo, hi, pos)], 'idx'} (and 'last', the merge's working
    position). side +1: ink at the larger coordinate --
    TrueType contours keep the ink on their right, so an upward run is a left edge of ink and a
    leftward run a bottom edge.
    """
    runs = []
    for idx in contours(ends):
        n = len(idx)
        for k in (0, 1):
            same = [P[idx[j]][k] == P[idx[(j + 1) % n]][k] for j in range(n)]
            if all(same):
                continue
            j, run = (same.index(False) + 1) % n, []
            for _ in range(n + 1):
                if same[j]:
                    run = run or [j]
                    run.append((j + 1) % n)
                elif run:
                    pts = [idx[t] for t in run]
                    while pts and not tags[pts[0]] & 1:
                        pts.pop(0)
                    while pts and not tags[pts[-1]] & 1:
                        pts.pop()
                    if len(pts) >= 2:
                        a, b = P[pts[0]], P[pts[-1]]
                        length = b[1 - k] - a[1 - k]
                        run_key = (k, tuple(pts))
                        if abs(length) >= MIN_RUN and run_key not in [r[0] for r in runs]:
                            side = (1 if length > 0 else -1) * (1 if k == 0 else -1)
                            runs.append((run_key, k, side, a[k], min(a[1 - k], b[1 - k]),
                                         max(a[1 - k], b[1 - k]), pts))
                    run = []
                j = (j + 1) % n
    edges = []
    for _key, k, side, pos, lo, hi, pts in sorted(runs, key=lambda r: (1 - r[1], r[2], r[3])):
        e = edges[-1] if edges else None
        if e and e['k'] == k and e['side'] == side and pos - e['last'] <= MERGE:
            e['runs'].append((lo, hi, pos))
        else:
            e = {'k': k, 'side': side, 'runs': [(lo, hi, pos)], 'idx': []}
            edges.append(e)
        e['last'] = pos
        e['idx'] += pts
    for e in edges:
        total = sum(hi - lo for lo, hi, _pos in e['runs'])
        e['pos'] = sum(pos * (hi - lo) for lo, hi, pos in e['runs']) / float(total)
        e['idx'] = sorted(set(e['idx']))
    return edges


def polygons(P, tags, ends):
    """The outline as closed polygons (each conic cut into 8 chords), for inside tests."""
    polys = []
    for idx in contours(ends):
        pts = []
        for j, i in enumerate(idx):
            a, b = P[i], P[idx[(j + 1) % len(idx)]]
            pts.append((a[0], a[1], tags[i] & 1))
            if not tags[i] & 1 and not tags[idx[(j + 1) % len(idx)]] & 1:
                pts.append(((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, 1))
        while not pts[0][2]:
            pts.append(pts.pop(0))
        poly, j, n = [], 0, len(pts)
        while j < n:
            a, b = pts[j], pts[(j + 1) % n]
            if b[2]:
                poly.append((a[0], a[1]))
                j += 1
            else:
                c = pts[(j + 2) % n]
                for t in range(8):
                    u = t / 8.0
                    poly.append(((1 - u) ** 2 * a[0] + 2 * (1 - u) * u * b[0] + u * u * c[0],
                                 (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * b[1] + u * u * c[1]))
                j += 2
        polys.append(poly)
    return polys


def inside(polys, x, y):
    winding = 0
    for poly in polys:
        for i in range(len(poly)):
            (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
            if (y0 <= y) != (y1 <= y) and x0 + (y - y0) * (x1 - x0) / (y1 - y0) > x:
                winding += 1 if y1 > y0 else -1
    return winding != 0


def overlap_span(a, b):
    """The longest stretch along which two edges face each other: (lo, hi) or None."""
    best = None
    for alo, ahi, _ in a['runs']:
        for blo, bhi, _ in b['runs']:
            lo, hi = max(alo, blo), min(ahi, bhi)
            if hi > lo and (best is None or hi - lo > best[1] - best[0]):
                best = (lo, hi)
    return best


def straight_strokes(edges, polys):
    """Stems (k = 0) and bars (k = 1): mutually nearest facing edges with solid ink between them."""
    strokes = []
    for k in (0, 1):
        los = [e for e in edges if e['k'] == k and e['side'] > 0]
        his = [e for e in edges if e['k'] == k and e['side'] < 0]
        for a in los:
            facing = [b for b in his if b['pos'] > a['pos'] and overlap_span(a, b)]
            b = min(facing, key=lambda b: b['pos']) if facing else None
            if b is None or max((e for e in los if e['pos'] < b['pos'] and overlap_span(e, b)),
                                key=lambda e: e['pos']) is not a:
                continue
            w = b['pos'] - a['pos']
            lo, hi = overlap_span(a, b)
            mid = (lo + hi) / 2.0
            solid = all(inside(polys, *((a['pos'] + w * t, mid) if k == 0 else (mid, a['pos'] + w * t)))
                        for t in (0.1, 0.3, 0.5, 0.7, 0.9))
            if solid and w <= ASPECT * (hi - lo):
                strokes.append((k, a, b))
    return strokes


def extremes(P, tags, ends, k):
    """Points where the contour turns back along axis k: on-curve points, and the two level
    control points either side of an implied one (TrueType's way of drawing a round extreme
    without an on-curve point of its own -- the inside of Roboto's upper '8' bowl)."""
    out = set()
    for idx in contours(ends):
        n = len(idx)
        for j, i in enumerate(idx):
            c = P[i][k]
            level = any(not tags[idx[(j + s) % n]] & 1 and P[idx[(j + s) % n]][k] == c for s in (-1, 1))
            if tags[i] & 1 or level:
                prev = next((P[idx[(j - s) % n]][k] for s in range(1, n) if P[idx[(j - s) % n]][k] != c), c)
                nxt = next((P[idx[(j + s) % n]][k] for s in range(1, n) if P[idx[(j + s) % n]][k] != c), c)
                if (prev - c) * (nxt - c) > 0:
                    out.add(i)
    return out


def adjacent(i, j, ends):
    """True when points i and j are neighbours on one contour."""
    for idx in contours(ends):
        if i in idx and j in idx:
            return (idx.index(i) - idx.index(j)) % len(idx) in (1, len(idx) - 1)
    return False


def round_edges(P, tags, ends, polys, edges):
    """The round extremes that are no straight edge's end, as one-point edges shaped like
    straight_edges' ({'k', 'side', 'pos', 'at', 'idx'}; 'at' is the other coordinate). Two
    neighbouring points level at the extreme (a short flat, or an implied on-curve point's two
    controls) are one edge, at their midpoint."""
    out = []
    for k in (0, 1):
        straight = set(i for e in edges if e['k'] == k for i in e['idx'])
        groups = []
        for i in sorted(extremes(P, tags, ends, k) - straight):
            g = next((g for g in groups if P[g[0]][k] == P[i][k] and any(adjacent(i, t, ends) for t in g)),
                     None)
            if g:
                g.append(i)
            else:
                groups.append([i])
        for g in groups:
            c, at = P[g[0]][k], sum(P[i][1 - k] for i in g) / float(len(g))
            ink = [inside(polys, *((c + d, at) if k == 0 else (at, c + d))) for d in (-4, 4)]
            if ink[0] != ink[1]:
                out.append({'k': k, 'side': 1 if ink[1] else -1, 'pos': c, 'at': at, 'idx': g})
    return out


def round_strokes(rounds, polys):
    """Round stems and bars: a round extreme and the nearest one facing it across solid ink --
    a bowl's outer and inner sides, where the auto-hinter rounds the width as it does a straight
    stroke's."""
    def solid(a, b):
        k = a['k']
        pts = [(a['pos'] + (b['pos'] - a['pos']) * t, a['at'] + (b['at'] - a['at']) * t)
               for t in (0.1, 0.3, 0.5, 0.7, 0.9)]
        return all(inside(polys, *(p if k == 0 else (p[1], p[0]))) for p in pts)

    def facing(a, b):
        # across the stroke, not along it: the two extremes sit within the stroke's width of
        # each other on the other axis
        return b['pos'] > a['pos'] and abs(b['at'] - a['at']) <= b['pos'] - a['pos'] and solid(a, b)

    strokes = []
    for k in (0, 1):
        los = [e for e in rounds if e['k'] == k and e['side'] > 0]
        his = [e for e in rounds if e['k'] == k and e['side'] < 0]
        for a in los:
            near = [b for b in his if facing(a, b)]
            b = min(near, key=lambda b: b['pos']) if near else None
            if b is None or max((e for e in los if facing(e, b)), key=lambda e: e['pos']) is not a:
                continue
            strokes.append((k, a, b))
    return strokes


def ink_centre(P, tags, ends):
    """The x of the outline's ink centroid, in 26.6 units: area-weighted over its polygons, where
    a counter's opposite winding subtracts."""
    area = cx = 0.0
    for poly in polygons(P, tags, ends):
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            c = x0 * y1 - x1 * y0
            area += c
            cx += (x0 + x1) * c
    return cx / (3.0 * area)


def restored_widths(U, H, strokes):
    """{id(edge): 26.6 move} that gives each thinned stroke back its design width."""
    ymin, ymax = min(p[1] for p in U), max(p[1] for p in U)
    moves = {}
    for k, a, b in strokes:
        ha, hb = set(H[i][k] for i in a['idx']), set(H[i][k] for i in b['idx'])
        if len(ha) != 1 or len(hb) != 1:
            continue    # the hinter split the edge; leave it as fitted
        ha, hb = ha.pop(), hb.pop()
        design, fitted = b['pos'] - a['pos'], hb - ha
        centre = (a['pos'] + b['pos']) / 2.0
        # a bar's edge on the glyph's top or bottom keeps its row: the ink height must not change
        fix_a = k == 1 and abs(a['pos'] - ymin) <= MERGE
        fix_b = k == 1 and abs(b['pos'] - ymax) <= MERGE
        da = db = 0
        if design - fitted >= SLIVER and not (fix_a and fix_b):
            # keep on the grid the edge whose design-width partner lands the stroke's centre
            # nearest the design's; a bar's top or bottom row (fix_a/fix_b) is never the one moved
            keep_a = [] if fix_b else [(abs(ha + design / 2.0 - centre), 0, 'a')]
            keep_b = [] if fix_a else [(abs(hb - design / 2.0 - centre), 1, 'b')]
            if min(keep_a + keep_b)[2] == 'a':
                db = int(round(ha + design)) - hb
            else:
                da = int(round(hb - design)) - ha
        if da:
            moves[id(a)] = da
        if db:
            moves[id(b)] = db
    return moves


def interpolate(P, ends, k, delta):
    """Move every point by its delta along axis k: points without one interpolate between their
    contour's nearest moved-or-anchored neighbours (TrueType's IUP), else follow the nearer one."""
    d = [0.0] * len(P)
    for idx in contours(ends):
        t = [i for i in idx if i in delta]
        for i in t:
            d[i] = delta[i]
        if len(t) == 1:
            for i in idx:
                d[i] = delta[t[0]]
        if len(t) < 2:
            continue
        pos = {i: j for j, i in enumerate(idx)}
        for m in range(len(t)):
            t1, t2 = t[m], t[(m + 1) % len(t)]
            j = (pos[t1] + 1) % len(idx)
            while idx[j] != t2:
                i = idx[j]
                o1, o2, d1, d2 = P[t1][k], P[t2][k], d[t1], d[t2]
                if o1 > o2:
                    o1, o2, d1, d2 = o2, o1, d2, d1
                x = P[i][k]
                d[i] = d1 if x <= o1 else d2 if x >= o2 else d1 + (x - o1) * (d2 - d1) / float(o2 - o1)
                j = (j + 1) % len(idx)
    return d


def fit_glyph(face, ch):
    """Load ch grid-fitted with its thinned strokes restored into face.glyph, rendered in 8-bit
    grey. Returns the advance: the unhinted one rounded, as LIGHT gave it (the hinter's own may
    differ by a pixel; the glyph goes back to the design's pen position instead)."""
    face.load_char(ch, DESIGN_FLAGS)
    o = face.glyph.outline
    U, tags, ends = [list(p) for p in o.points], list(o.tags), list(o.contours)
    adv = (face.glyph.advance.x + 32) // 64
    face.load_char(ch, HINT_FLAGS)
    points = face.glyph.outline._FT_Outline.points
    H = [[points[i].x, points[i].y] for i in range(len(U))]
    # The hinter shifts the outline by whole pixels to fit its own advance; undo the shift that
    # puts the glyph's ink centroid nearest the design's, so the gaps between digits keep the
    # design's (ties: nearest outline).
    c0, c1 = ink_centre(U, tags, ends), ink_centre(H, tags, ends)
    shift = min((abs(c1 + 64 * s - c0), sum(abs(h[0] + 64 * s - u[0]) for u, h in zip(U, H)), s)
                for s in (-1, 0, 1))[2]
    H = [[x + 64 * shift, y] for x, y in H]
    edges = straight_edges(U, tags, ends)
    polys = polygons(U, tags, ends)
    rounds = round_edges(U, tags, ends, polys, edges)
    strokes = straight_strokes(edges, polys) + round_strokes(rounds, polys)
    moves = restored_widths(U, H, strokes)
    # A straight edge no stroke claims -- a bar's end, a terminal's cut -- is a weak edge to the
    # hinter, left wherever its neighbours put it, often between pixels: snap it to the nearest
    # pixel so it draws crisp. A horizontal one that is the glyph's own top or bottom snaps
    # inward instead: rounding it out would fill a solid row that the other digits reach only
    # with a round's faint overshoot (Emery Roboto's '6' terminal stood a pixel above every
    # other digit in a B&W theme).
    paired = set(id(e) for _k, a, b in strokes for e in (a, b))
    ylo, yhi = min(p[1] for p in H), max(p[1] for p in H)
    for e in edges:
        at = set(H[i][e['k']] for i in e['idx'])
        if id(e) not in paired and len(at) == 1:
            h = at.pop()
            top, bottom = e['k'] == 1 and h >= yhi, e['k'] == 1 and h <= ylo
            snapped = h // 64 * 64 if top else -(-h // 64) * 64 if bottom else (h + 32) // 64 * 64
            moves[id(e)] = snapped - h
    straight_x = set(i for e in edges if e['k'] == 0 for i in e['idx'])
    for k in (0, 1):
        # every straight edge, round extreme and corner moves by its stroke's correction (most by
        # none): they anchor the interpolation of the points between them
        delta = dict((i, 0) for i in extremes(U, tags, ends, k))
        for e in edges + rounds:
            if e['k'] == k:
                for i in e['idx']:
                    delta[i] = moves.get(id(e), 0)
        if k == 0:
            # ...except that in x only the straight edges (stems, bar ends) stay fitted: every
            # other turn -- a bowl's side, a curve's or a diagonal's end -- goes back to its design x
            for i in delta:
                if i not in straight_x:
                    delta[i] = U[i][0] - H[i][0]
        d = interpolate(H, ends, k, delta)
        for i in range(len(H)):
            if k == 0:
                points[i].x = H[i][0] + int(round(d[i]))
            else:
                points[i].y = H[i][1] + int(round(d[i]))
    face.glyph.render(freetype.FT_RENDER_MODE_NORMAL)
    return adv


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
        adv = fit_glyph(face, ch)
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
        glyphs.append({'char': ch, 'adv': adv, 'lsb': g.bitmap_left + c0,
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
