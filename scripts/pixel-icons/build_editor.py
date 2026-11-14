#!/usr/bin/env python3
"""Build the pixel icon editor: one HTML page (README.md in this folder).

    python3 scripts/pixel-icons/build_editor.py [out.html]     (default build/pixel-icons/editor.html)

For every status icon it lists the sizes the watch draws it at (watch_icons.py) and, for each
size, the pixels to start from:
  saved   the drawing in resources/pixel-icons.json, when there is one;
  now     today's icon, drawn the way the watch draws it with antialiasing off;
  lucide, tabler   the weather icons from Lucide (ISC) and Tabler (MIT), traced onto the grid
          (a pixel is on when its centre lies within half a pixel of the library's line), with
          the library's outline kept as a guide.
Pebble Classic/Steel's bit masks come along as a size of their own.

Needs node (the watch fonts), npm (the two icon libraries, fetched once into build/) and
svg.path (pip install svg.path, as ../svg2pdc.py does).
"""
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import watch_icons as W  # noqa: E402

ROOT = W.ROOT
LIBRARIES = W.LIBRARIES
ensure_library = W.ensure_library

_spec = importlib.util.spec_from_file_location('svg2pdc', os.path.join(ROOT, 'scripts', 'svg2pdc.py'))
svg2pdc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(svg2pdc)


def element_d(elem):
    """One SVG element as path data, or None."""
    t = elem.tag.split('}')[-1]
    a = elem.attrib
    if a.get('stroke') == 'none':
        return None
    f = lambda k: float(a.get(k, 0))  # noqa: E731
    if t == 'path':
        return a.get('d')
    if t == 'circle':
        cx, cy, r = f('cx'), f('cy'), f('r')
        return 'M%g %gA%g %g 0 1 0 %g %gA%g %g 0 1 0 %g %g' % (cx - r, cy, r, r, cx + r, cy, r, r, cx - r, cy)
    if t == 'line':
        return 'M%g %gL%g %g' % (f('x1'), f('y1'), f('x2'), f('y2'))
    if t in ('polyline', 'polygon'):
        nums = [float(v) for v in re.split(r'[\s,]+', a.get('points', '').strip()) if v]
        pts = list(zip(nums[0::2], nums[1::2]))
        return 'M' + 'L'.join('%g %g' % p for p in pts) + ('Z' if t == 'polygon' else '')
    if t == 'rect':
        x, y, w, h = f('x'), f('y'), f('width'), f('height')
        return 'M%g %gh%gv%gh%gZ' % (x, y, w, h, -w)
    return None


def library_paths(spec, lib):
    """(flattened paths, outline path data) for a library icon name or a list of path data."""
    if isinstance(spec, list):
        ds = spec
    else:
        tree = ET.parse(os.path.join(ensure_library(lib), LIBRARIES[lib][2], spec + '.svg'))
        ds = [d for d in (element_d(e) for e in tree.iter()) if d]
    old = svg2pdc.CURVE_SPACING
    svg2pdc.CURVE_SPACING = 0.2          # trace the curves finely
    paths = []
    for d in ds:
        for pts, is_open in svg2pdc.flatten_path(d):
            paths.append((pts if len(pts) >= 2 else pts * 2, not is_open))
    svg2pdc.CURVE_SPACING = old
    return paths, ds


def near_line(paths):
    """Every pixel whose centre lies within half a pixel of a path (pixel i spans i..i+1); a
    tiny fixed nudge settles a line running exactly between two rows onto one of them."""
    segs = []
    for pts, closed in paths:
        seq = list(pts) + ([pts[0]] if closed else [])
        segs += list(zip(seq, seq[1:]))
    xs = [p[0] for a, b in segs for p in (a, b)]
    ys = [p[1] for a, b in segs for p in (a, b)]
    px = set()
    for gy in range(int(math.floor(min(ys))) - 1, int(math.ceil(max(ys))) + 1):
        for gx in range(int(math.floor(min(xs))) - 1, int(math.ceil(max(xs))) + 1):
            cx, cy = gx + 0.5 + 0.013, gy + 0.5 + 0.007
            best = 9.0
            for (x0, y0), (x1, y1) in segs:
                dx, dy = x1 - x0, y1 - y0
                L = dx * dx + dy * dy
                t = 0.0 if L == 0 else max(0.0, min(1.0, ((cx - x0) * dx + (cy - y0) * dy) / L))
                ex, ey = x0 + t * dx - cx, y0 + t * dy - cy
                best = min(best, ex * ex + ey * ey)
            if best <= 0.25:
                px.add((gx, gy))
    return px


def library_size(paths, rows, cols):
    """A library icon traced at `rows` on a `cols`-wide grid, and its guide map: a source point
    (x, y) lands at grid cell (x * m[0] + m[1], y * m[0] + m[2])."""
    _, k, (cx, cy, px0, py0) = W.icon_load(paths, rows - 1)
    mapped = [([((x - cx) * k + px0 + 0.5, (y - cy) * k + py0 + 0.5) for x, y in pts], c) for pts, c in paths]
    px = near_line(mapped)
    xs = [x for x, _ in px]
    ys = [y for _, y in px]
    w, h = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
    ox = (cols - w) // 2 - min(xs)
    oy = (rows - h) // 2 - min(ys)
    lines = W.to_lines(px, rows, cols)
    return lines, [round(k, 5), round(px0 + ox + 0.5 - cx * k, 4), round(py0 + oy + 0.5 - cy * k, 4)]


def watch_fonts():
    js = ("const F = require(process.argv[1]); const out = {};"
          "const rules = F.css.split('@font-face').filter(Boolean).map(r => '@font-face' + r);"
          "for (const k of ['GOTHIC_14', 'GOTHIC_18', 'GOTHIC_24']) { const f = F.fonts[k];"
          "out[k] = { family: f.family, height: f.height,"
          "css: rules.filter(r => r.includes('font-family:' + f.family + ';')).join('') }; }"
          "process.stdout.write(JSON.stringify(out));")
    path = os.path.join(ROOT, 'src', 'pkjs', 'page', 'layout', 'watch-fonts.generated.js')
    return json.loads(subprocess.check_output(['node', '-e', js, path]))


def saved_pixels():
    if not os.path.exists(W.PIXELS_JSON):
        return {}
    return json.load(open(W.PIXELS_JSON)).get('icons', {})


def editor_data():
    saved = saved_pixels()
    masks = W.aplite_masks()
    icons = []
    for row in W.ICONS:
        it = W.icon(row[0])
        key = it['key']
        sizes = {}
        for u in W.uses(key):
            px = W.today(u['res'], u['h'])
            rows = max(y for _, y in px) - min(y for _, y in px) + 1
            s = sizes.setdefault(rows, {'rows': rows, 'uses': [], 'now': px})
            s['uses'].append({'where': u['where'], 'font': u['font'], 'weight': u['weight'], 'plat': u['plat']})
        out_sizes = []
        for rows in sorted(sizes):
            s = sizes[rows]
            w = max(x for x, _ in s['now']) - min(x for x, _ in s['now']) + 1
            cols = max(rows + 8, w + 4)
            out_sizes.append({'id': str(rows), 'rows': rows, 'cols': cols, 'uses': s['uses'],
                              'sources': {'now': W.to_lines(s['now'], rows, cols)}})
        sources, guides = ['now'], {}
        for lib in ('lucide', 'tabler'):
            spec = it[lib]
            if not spec:
                continue
            paths, ds = library_paths(spec, lib)
            for z in out_sizes:
                z['sources'][lib], m = library_size(paths, z['rows'], z['cols'])
                z.setdefault('guides', {})[lib] = m
            guides[lib] = ds
            sources.append(lib)
        if key in W.APLITE:
            out_sizes.append({'id': 'A', 'rows': len(masks[key]), 'cols': 16, 'aplite': True,
                              'uses': [{'where': 'Pebble Classic, Steel', 'font': f, 'plat': 'aplite'}
                                       for f in ('GOTHIC_14', 'GOTHIC_18')],
                              'sources': {'now': masks[key]}})
        mine = saved.get(key, {})
        for z in out_sizes:
            entry = mine.get('sizes', {}).get(z['id'])
            if entry and len(entry['pixels']) == z['rows']:
                z['sources']['saved'] = entry['pixels']
                z['start'] = 'saved'
                z['savedSource'] = entry.get('source', '')
        start = 'lucide' if 'lucide' in sources else 'now'
        icons.append({'key': key, 'name': it['name'], 'group': it['group'], 'sample': it['sample'],
                      'note': it['note'], 'sources': sources, 'start': start, 'guides': guides,
                      'done': bool(mine.get('done')), 'sizes': out_sizes})
    return {'icons': icons}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'build', 'pixel-icons', 'editor.html')
    data = 'window.ICON_DATA = ' + json.dumps(editor_data(), separators=(',', ':')) + ';\n'
    data += 'window.WATCH_FONTS = ' + json.dumps(watch_fonts(), separators=(',', ':')) + ';\n'
    assert '</script' not in data
    page = open(os.path.join(HERE, 'editor.html')).read().replace('/*ICON_DATA*/', data)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w') as f:
        f.write(page)
    print('wrote %s (%d KB)' % (os.path.relpath(out, ROOT), len(page) // 1024))


if __name__ == '__main__':
    main()
