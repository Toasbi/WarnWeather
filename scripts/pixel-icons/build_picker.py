#!/usr/bin/env python3
"""Build the icon picker: every size of every status icon in each version the watch can draw
it in (variants.js: pixel, half, slant, old), drawn by the watch's own renderer in the
emulator, on one HTML page where you pick a version for each size and mark the sizes you want
to draw again (README.md in this folder, "Versions"). On the page, Add SVG gives an icon one
more version, svg: an SVG made into a PDC and scaled to each size the old way (svg-icon.js),
drawn there as the watch draws it (pebble-draw.js). The SVG is a file, pasted code, or a Lucide or
Tabler icon picked on the page (icon-search.js), from the icons-lucide.js and icons-tabler.js this
script writes beside the page, which the page loads when its chooser first opens: publish them
with it.

    python3 scripts/pixel-icons/build_picker.py [--skip-render] [out.html]
        (default build/pixel-icons/picker.html)

The drawings are rendered on the Pebble Time 2's emulator (emery): the colour watches share
one renderer, and the black and white ones always draw the pixel version. --skip-render reuses
the last render (build/pixel-icons/gallery/).

Needs node, the Pebble SDK with its emulator (`pebble`), Pillow (pip install pillow) and npm (the
two icon libraries, fetched once into build/, as build_editor.py does).
"""
import base64
import html
import io
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import watch_icons as W  # noqa: E402

ROOT = W.ROOT
OUT_DIR = os.path.join(ROOT, 'build', 'pixel-icons')
GALLERY_DIR = os.path.join(OUT_DIR, 'gallery')
PLATFORM = 'emery'
SCREEN = (200, 228)
VERSIONS = ['pixel', 'half', 'slant', 'old']   # baked here; svg is made on the page
LIBS = ['pebble-draw.js', 'svg-icon.js', 'icon-search.js']   # inlined into the page
BATCH = 240            # drawings per gallery app (a Pebble app holds at most 256 resources)
UUID = '5b0c8a3e-7d1f-4c55-9a62-2f4b8e0d9c17'


def sizes_to_pick():
    """Every drawn size: [{key, id, rows, pixels, plats, uses, version, redraw, old}]."""
    saved = json.load(open(W.PIXELS_JSON))['icons']
    out = []
    for key in W.KEYS:
        mine = saved.get(key, {}).get('sizes', {})
        where = {}
        for u in W.uses(key):
            px = W.today(u['res'], u['h'])
            where.setdefault(max(y for _, y in px) - min(y for _, y in px) + 1, []).append(u['where'])
        for sid in sorted((s for s in mine if s != 'A'), key=int):
            s = mine[sid]
            if '#' not in ''.join(s['pixels']) or not s.get('platforms', ['basalt', 'emery']):
                continue
            rows = int(sid)
            out.append({'key': key, 'id': sid, 'rows': rows, 'pixels': s['pixels'],
                        'plats': s.get('platforms', ['basalt', 'emery']), 'uses': where.get(rows, []),
                        'version': s.get('version', 'pixel'), 'redraw': bool(s.get('redraw')),
                        'importedAt': s.get('importedAt'),
                        'old': W.old_version(key, rows), 'h': W.svg_h(key, rows)})
    return out


def pdc_size(path):
    """A PDC image's view box (w, h)."""
    b = open(path, 'rb').read()
    return struct.unpack_from('<hh', b, 10)


def write_drawings(sizes, pdc_dir):
    """Every size's versions as PDC files (variants.js); [(name, size index, version, w, h)]."""
    todo, cands = [], []
    for i, z in enumerate(sizes):
        for v in VERSIONS:
            if v == 'old' and not z['old']:
                continue
            name = 'D%03d_%s' % (i, v)
            todo.append({'name': name, 'version': v, 'pixels': z['pixels'], 'old': z['old']})
            cands.append([name, i, v])
    if os.path.isdir(pdc_dir):
        shutil.rmtree(pdc_dir)
    listing = os.path.join(OUT_DIR, 'versions.json')
    json.dump(todo, open(listing, 'w'))
    subprocess.check_call(['node', os.path.join(HERE, 'variants.js'), listing, pdc_dir])
    return [c + list(pdc_size(os.path.join(pdc_dir, c[0] + '.pdc'))) for c in cands]


def layout(cands):
    """Batches of drawings, each laid out on pages, every drawing on a dark page and on a
    light one: [{'cells': [(name, page, x, y, w, h, light)], 'pages': n}]."""
    cw = max(c[3] for c in cands) + 4
    ch = max(c[4] for c in cands) + 4
    cols, rows = (SCREEN[0] - 2) // cw, (SCREEN[1] - 2) // ch
    per = cols * rows
    out = []
    size = int(math.ceil(len(cands) / math.ceil(len(cands) / float(BATCH))))   # even batches
    for b in range(0, len(cands), size):
        batch = cands[b:b + size]
        pages = int(math.ceil(len(batch) / float(per)))
        cells = []
        for light in (0, 1):
            for k, c in enumerate(batch):
                page = light * pages + k // per
                x = 2 + (k % per) % cols * cw
                y = 2 + (k % per) // cols * ch
                cells.append((c[0], page, x, y, c[3], c[4], light))
        out.append({'cells': cells, 'pages': 2 * pages})
    return out


def write_project(n, batch, pdc_dir):
    """Batch n's gallery app (gallery/ with its drawings, a cells table and a manifest)."""
    proj = os.path.join(GALLERY_DIR, 'batch%d' % n)
    if os.path.isdir(proj):
        shutil.rmtree(proj)
    os.makedirs(os.path.join(proj, 'src', 'c'))
    os.makedirs(os.path.join(proj, 'resources', 'data'))
    shutil.copy(os.path.join(HERE, 'gallery', 'wscript'), proj)
    shutil.copy(os.path.join(HERE, 'gallery', 'src', 'c', 'gallery.c'), os.path.join(proj, 'src', 'c'))
    names = sorted({c[0] for c in batch['cells']})
    media = []
    for name in names:
        shutil.copy(os.path.join(pdc_dir, name + '.pdc'), os.path.join(proj, 'resources', 'data'))
        media.append({'type': 'raw', 'name': name, 'file': 'data/%s.pdc' % name, 'targetPlatforms': [PLATFORM]})
    pages = batch['pages']
    lights = [1 if any(c[1] == p and c[6] for c in batch['cells']) else 0 for p in range(pages)]
    cells = ',\n'.join('    { RESOURCE_ID_%s, %d, %d, %d }' % (c[0], c[1], c[2], c[3]) for c in batch['cells'])
    open(os.path.join(proj, 'src', 'c', 'cells.h'), 'w').write(
        '// GENERATED by build_picker.py: the drawings on each page of the gallery.\n#pragma once\n'
        '#include <pebble.h>\n'
        'typedef struct { uint32_t res; uint8_t page; uint8_t x; uint8_t y; } Cell;\n'
        '#define PAGE_COUNT %d\nstatic const bool s_page_light[PAGE_COUNT] = { %s };\n'
        '#define CELL_COUNT %d\nstatic const Cell s_cells[CELL_COUNT] = {\n%s\n};\n'
        % (pages, ', '.join(str(v) for v in lights), len(batch['cells']), cells))
    json.dump({'name': 'icon-gallery', 'author': 'WarnWeather', 'version': '1.0.0', 'private': True,
               'dependencies': {}, 'keywords': ['pebble-app'],
               'pebble': {'displayName': 'Icon gallery', 'uuid': UUID, 'sdkVersion': '3',
                          'enableMultiJS': False, 'targetPlatforms': [PLATFORM],
                          'watchapp': {'watchface': False}, 'messageKeys': [],
                          'resources': {'media': media}}},
              open(os.path.join(proj, 'package.json'), 'w'), indent=1)
    return proj


def pebble(*args, **kw):
    """`pebble` on the emulator; True when it succeeded."""
    cmd = ['pebble'] + list(args) + ['--emulator', PLATFORM, '--vnc']
    return subprocess.call(cmd, stdout=kw.get('out', subprocess.DEVNULL), stderr=subprocess.STDOUT,
                           timeout=kw.get('timeout', 120)) == 0


def kill_emulator():
    subprocess.call(['pebble', 'kill'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.call(['pkill', '-f', 'qemu-pebble'])
    subprocess.call(['pkill', '-f', 'pypkjs'])
    time.sleep(2)


def render(proj, pages):
    """Build and run one gallery app; a screenshot of every page: [path]."""
    subprocess.check_call(['pebble', 'build'], cwd=proj, stdout=subprocess.DEVNULL)
    pbw = os.path.join(proj, 'build', os.path.basename(proj) + '.pbw')
    kill_emulator()
    for attempt in range(3):
        with open(os.path.join(proj, 'install.log'), 'w') as log:
            if pebble('install', pbw, out=log, timeout=240):
                break
        kill_emulator()
    else:
        raise SystemExit('build_picker: the gallery did not install (%s/install.log)' % proj)
    logs_path = os.path.join(proj, 'logs.txt')
    logs = subprocess.Popen(['pebble', 'logs', '--emulator', PLATFORM, '--vnc'], stdout=open(logs_path, 'w'),
                            stderr=subprocess.STDOUT)
    shots = []
    try:
        for p in range(pages):
            if p:
                pebble('emu-button', 'click', 'select')
            for _ in range(80):
                time.sleep(0.25)
                if re.search(r'drawn %d\b' % p, open(logs_path).read()):
                    break
            else:
                if p:   # page 0 may have drawn before the log connected
                    raise SystemExit('build_picker: page %d never drew (%s)' % (p, logs_path))
            time.sleep(0.6)
            shot = os.path.join(proj, 'page%02d.png' % p)
            if not pebble('screenshot', shot, '--no-open', timeout=60):
                raise SystemExit('build_picker: no screenshot of page %d' % p)
            shots.append(shot)
    finally:
        logs.terminate()
        kill_emulator()
    return shots


def crops(batches):
    """Every drawing's picture, dark and light: {name: {'d': png, 'l': png}} (PNG bytes), each
    the drawing's box plus a pixel all round (smoothing can grey a pixel past its box)."""
    from PIL import Image
    out = {}
    for n, batch in enumerate(batches):
        proj = os.path.join(GALLERY_DIR, 'batch%d' % n)
        shots = {}
        for name, page, x, y, w, h, light in batch['cells']:
            if page not in shots:
                shots[page] = Image.open(os.path.join(proj, 'page%02d.png' % page)).convert('RGB')
            buf = io.BytesIO()
            shots[page].crop((x - 1, y - 1, x + w + 1, y + h + 1)).save(buf, 'PNG', optimize=True)
            out.setdefault(name, {})['l' if light else 'd'] = buf.getvalue()
    return out


def page_data(sizes, cands, pics):
    """The picker's data: icons in the editor's order, each size with its versions' pictures."""
    by_size = {}
    for name, i, v, w, h in cands:
        p = pics[name]
        by_size.setdefault(i, {})[v] = {'d': 'data:image/png;base64,' + base64.b64encode(p['d']).decode(),
                                        'l': 'data:image/png;base64,' + base64.b64encode(p['l']).decode(),
                                        'w': w + 2, 'h': h + 2}
    icons = []
    for i, z in enumerate(sizes):
        it = W.icon(z['key'])
        if not icons or icons[-1]['key'] != z['key']:
            # The SVG the icon was given in the picker, as imported (import_pixels.py).
            src = os.path.join(ROOT, 'resources', 'icon-svg', z['key'] + '.svg')
            icons.append({'key': z['key'], 'name': it['name'], 'group': it['group'], 'sizes': [],
                          'svg': open(src).read() if os.path.exists(src) else None})
        icons[-1]['sizes'].append({'id': z['id'], 'rows': z['rows'], 'plats': z['plats'], 'uses': z['uses'],
                                   'version': z['version'], 'redraw': z['redraw'], 'h': z['h'],
                                   'importedAt': z['importedAt'], 'versions': by_size[i]})
    return {'versions': VERSIONS, 'icons': icons}


# ---- The chooser's icon sets --------------------------------------------------------------
ICON_SETS = {'lucide': ('Lucide', 'https://lucide.dev'), 'tabler': ('Tabler Icons', 'https://tabler.io/icons')}
# The shapes an outline icon is drawn with and the geometry each keeps; svg-icon.js reads them all.
SHAPES = {'path': ('d',), 'circle': ('cx', 'cy', 'r'), 'ellipse': ('cx', 'cy', 'rx', 'ry'),
          'line': ('x1', 'y1', 'x2', 'y2'), 'polyline': ('points',), 'polygon': ('points',),
          'rect': ('x', 'y', 'width', 'height', 'rx', 'ry')}


def icon_body(path):
    """A library icon's shapes alone, each with its geometry and nothing else (no fill, class or
    script can come along), the invisible 24 x 24 box Tabler draws first (stroke="none") left out;
    None for an icon with another element, which the page could not draw as the watch would."""
    root = ET.parse(path).getroot()
    out = []
    for e in root.iter():
        if e is root:
            continue
        tag = e.tag.split('}')[-1]
        if tag not in SHAPES:
            return None
        if e.get('stroke') == 'none':
            continue
        out.append('<%s%s/>' % (tag, ''.join(' %s="%s"' % (k, html.escape(e.get(k), quote=True))
                                             for k in SHAPES[tag] if e.get(k) is not None)))
    return ''.join(out) or None


def icon_tags(lib, pkg):
    """The library's search words for each icon: Lucide's tags.json, Tabler's tags and category."""
    if lib == 'lucide':
        return json.load(open(os.path.join(pkg, 'tags.json')))
    return {k: (v.get('tags') or []) + ([v['category']] if v.get('category') else [])
            for k, v in json.load(open(os.path.join(pkg, 'icons.json'))).items()}


def write_icon_sets(out_dir):
    """Each library's outline icons as icons-<set>.js in out_dir, a script that adds the set to
    window.PICKER_ICON_SETS (icon-search.js has its shape), with the library's licence in it;
    [(path, icons, bytes)]."""
    written = []
    for lib in sorted(ICON_SETS):
        pkg = W.ensure_library(lib)
        _, version, sub = W.LIBRARIES[lib]
        tags, folder, icons = icon_tags(lib, pkg), os.path.join(pkg, sub), []
        for f in sorted(os.listdir(folder)):
            body = icon_body(os.path.join(folder, f)) if f.endswith('.svg') else None
            if body is None:
                continue
            name = f[:-4]
            words, extra = set(name.split('-')), []
            for t in tags.get(name, []):
                t = str(t).lower().strip()
                if t and t not in words and t not in extra:
                    extra.append(t)
            icons.append([name, body, ' '.join(extra)])
        title, home = ICON_SETS[lib]
        data = {'id': lib, 'name': title, 'version': version, 'home': home,
                'licence': open(os.path.join(pkg, 'LICENSE')).read(), 'icons': icons}
        text = ('/* %s %s (%s): its outline icons for the icon picker\'s chooser, under the licence in\n'
                '   "licence" below. Written by scripts/pixel-icons/build_picker.py. */\n'
                'window.PICKER_ICON_SETS = window.PICKER_ICON_SETS || {};\n'
                'window.PICKER_ICON_SETS[%s] = %s;\n') % (
            title, version, home, json.dumps(lib), json.dumps(data, separators=(',', ':')).replace('</', '<\\/'))
        path = os.path.join(out_dir, 'icons-%s.js' % lib)
        with open(path, 'w') as fh:
            fh.write(text)
        written.append((path, len(icons), len(text)))
    return written


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = args[0] if args else os.path.join(OUT_DIR, 'picker.html')
    os.makedirs(GALLERY_DIR, exist_ok=True)
    sizes = sizes_to_pick()
    pdc_dir = os.path.join(GALLERY_DIR, 'drawings')
    cands = write_drawings(sizes, pdc_dir)
    batches = layout(cands)
    if '--skip-render' not in sys.argv:
        for n, batch in enumerate(batches):
            proj = write_project(n, batch, pdc_dir)
            render(proj, batch['pages'])
            print('build_picker: rendered batch %d (%d pages)' % (n, batch['pages']))
    data = 'window.PICKER_DATA = ' + json.dumps(page_data(sizes, cands, crops(batches)), separators=(',', ':')) + ';'
    data = data.replace('</', '<\\/')   # an SVG's text can't end the script early
    libs = '\n'.join(open(os.path.join(HERE, name)).read() for name in LIBS)
    assert '</script' not in data and '</script' not in libs
    page = open(os.path.join(HERE, 'picker.html')).read()
    page = page.replace('/*PICKER_LIBS*/', libs).replace('/*PICKER_DATA*/', data)
    with open(out, 'w') as f:
        f.write(page)
    print('wrote %s (%d KB, %d sizes, %d drawings)' % (os.path.relpath(out, ROOT), len(page) // 1024,
                                                       len(sizes), len(cands)))
    for path, n, size in write_icon_sets(os.path.dirname(os.path.abspath(out))):
        print('wrote %s (%d KB, %d icons)' % (os.path.relpath(path, ROOT), size // 1024, n))


if __name__ == '__main__':
    main()
