#!/usr/bin/env python3
"""Bring edits from the pixel icon editor, and picks from the icon picker, into
resources/pixel-icons.json (README.md here).

    python3 scripts/pixel-icons/import_pixels.py --export editor-export.json
    python3 scripts/pixel-icons/import_pixels.py --db <dir>
    python3 scripts/pixel-icons/import_pixels.py --picks <dir>
    python3 scripts/pixel-icons/import_pixels.py --picks-export picks.json

--export reads the editor's "Copy all as JSON" (every size of every icon). --db reads a dump
of the published editor's database (one JSON file per document under <dir>/glyphs and
<dir>/icons): edited sizes and done marks only; an icon marked done gets its unedited sizes
from the editor's own starting pixels (build_editor.py), so a done icon always has every size.
--picks reads a dump of the published picker's database (<dir>/picks and <dir>/svgs),
--picks-export its "Copy picks as JSON": each size's version and Redraw mark, and the SVGs added
there (build_picker.py). An SVG is kept as resources/icon-svg/<KEY>.svg. An old or svg version
keeps its lines in the file (watch_icons.py old_version, svg-icon.js atSize), since neither is
a drawing.

The file keeps every edited size, done or not, so the editor can be rebuilt where you left off;
only done icons go to the watch (gen_watch_icons.js).
"""
import argparse
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import watch_icons as W  # noqa: E402

ABOUT = ("The status icons' pixel drawings, per size (scripts/pixel-icons/README.md). Edit them in the "
         "pixel icon editor, not by hand; only icons marked done are built into the watch.")


def load():
    if os.path.exists(W.PIXELS_JSON):
        return json.load(open(W.PIXELS_JSON))
    return {'format': 1, 'about': ABOUT, 'icons': {}}


def platforms(key, size_id):
    """The platforms (watch_icons.PLATFORMS, or aplite) that draw this size of the icon."""
    if size_id == 'A':
        return ['aplite']
    rows = int(size_id)
    return sorted({u['plat'] for u in W.uses(key) if W.painted_rows(u['h']) == rows})


def save(doc):
    doc['about'] = ABOUT
    doc['icons'] = {k: doc['icons'][k] for k in W.KEYS if k in doc['icons']}
    for key, entry in doc['icons'].items():
        for size_id, s in entry['sizes'].items():
            s['platforms'] = platforms(key, size_id)
    with open(W.PIXELS_JSON, 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')


# What a size keeps from the picker when its pixels are edited again.
PICKED = ('version', 'redraw', 'old', 'svg')
VERSIONS = ('pixel', 'half', 'slant', 'old', 'svg')
SVG_DIR = os.path.join(W.ROOT, 'resources', 'icon-svg')
SVG_MAX = 256 * 1024


def svg_path(key):
    return os.path.join(SVG_DIR, key + '.svg')


def keep_svgs(svgs):
    """The picker's SVGs ({KEY: text}) as resources/icon-svg/<KEY>.svg; the keys written."""
    out = []
    for key, text in sorted((svgs or {}).items()):
        if key not in W.KEYS or not isinstance(text, str) or not text.strip():
            print('skipped the SVG for %s: no such icon, or empty' % key)
            continue
        if len(text.encode('utf-8')) > SVG_MAX:
            raise SystemExit('%s: the SVG is larger than %d KB' % (key, SVG_MAX // 1024))
        os.makedirs(SVG_DIR, exist_ok=True)
        with open(svg_path(key), 'w') as f:
            f.write(text if text.endswith('\n') else text + '\n')
        out.append(key)
    return out


def svg_version(key, rows):
    """The icon's SVG at a size, scaled the old way (svg-icon.js atSize): {'lines', 'w', 'h',
    'at'}, `at` the height it was scaled to (watch_icons.svg_h)."""
    src = svg_path(key)
    if not os.path.exists(src):
        raise SystemExit('%s %s: picked svg, but there is no %s' % (key, rows, os.path.relpath(src, W.ROOT)))
    at = W.svg_h(key, rows)
    out = json.loads(subprocess.check_output(['node', os.path.join(HERE, 'svg-icon.js'), 'bake', src, str(at)]))
    out['at'] = at
    return out


def put(doc, key, size_id, pixels, source):
    if key not in W.KEYS or not pixels:
        return False
    entry = doc['icons'].setdefault(key, {'done': False, 'sizes': {}})
    was = entry['sizes'].get(size_id, {})
    entry['sizes'][size_id] = dict({'source': source or '', 'pixels': list(pixels)},
                                   **{k: was[k] for k in PICKED if k in was})
    return True


def pick(doc, key, size_id, version, redraw):
    """One size's pick: its version (pixel by default) and its Redraw mark."""
    s = doc['icons'].get(key, {}).get('sizes', {}).get(size_id)
    if s is None or size_id == 'A' or version not in VERSIONS:
        print('skipped the pick for %s %s (%s): no such drawing' % (key, size_id, version))
        return False
    for k in PICKED:
        s.pop(k, None)
    if version != 'pixel':
        s['version'] = version
    if version == 'old':
        old = W.old_version(key, int(size_id))
        if not old:
            raise SystemExit('%s %s: no bar drew the old icon that tall' % (key, size_id))
        s['old'] = old
    if version == 'svg':
        s['svg'] = svg_version(key, int(size_id))
    if redraw:
        s['redraw'] = True
    return True


def from_picks(doc, picks, svgs=None):
    """The picker's SVGs ({KEY: text}) into resources/icon-svg/, then its picks
    ([{icon, size, version, redraw}]) into the file."""
    keep_svgs(svgs)
    return sum(pick(doc, p.get('icon'), str(p.get('size')), p.get('version') or 'pixel', bool(p.get('redraw')))
               for p in picks)


def fill_done(doc):
    """Every size of every done icon, the editor's starting pixels where it was not edited."""
    missing = [k for k, e in doc['icons'].items() if e.get('done')]
    if not missing:
        return
    import build_editor  # svg.path, npm and node, only when a done icon lacks a size
    data = {i['key']: i for i in build_editor.editor_data()['icons']}
    for key in missing:
        entry = doc['icons'][key]
        for z in data[key]['sizes']:
            if z['id'] in entry['sizes']:
                continue
            src = z.get('start') or (data[key]['start'] if data[key]['start'] in z['sources'] else 'now')
            entry['sizes'][z['id']] = {'source': src, 'pixels': z['sources'][src]}


def from_export(doc, path):
    ex = json.load(open(path))
    n = 0
    for key, icon in ex.get('icons', {}).items():
        if key not in W.KEYS:
            continue
        for size_id, s in icon.get('sizes', {}).items():
            if s.get('edited') or icon.get('done'):
                n += put(doc, key, size_id, s.get('pixels'), s.get('source'))
        if key in doc['icons'] or icon.get('done'):
            doc['icons'].setdefault(key, {'done': False, 'sizes': {}})['done'] = bool(icon.get('done'))
    return n


def from_db(doc, d):
    n = 0
    for f in sorted(glob.glob(os.path.join(d, 'glyphs', '*.json'))):
        g = json.load(open(f))
        g = g.get('data', g)
        size_id = g.get('size') or str(g.get('rows'))
        n += put(doc, g.get('icon'), size_id, g.get('pixels'), g.get('source'))
    for f in sorted(glob.glob(os.path.join(d, 'icons', '*.json'))):
        g = json.load(open(f))
        g = g.get('data', g)
        key = os.path.splitext(os.path.basename(f))[0]
        if key in W.KEYS:
            doc['icons'].setdefault(key, {'done': False, 'sizes': {}})['done'] = bool(g.get('done'))
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--export')
    ap.add_argument('--db')
    ap.add_argument('--picks')
    ap.add_argument('--picks-export')
    a = ap.parse_args()
    if not (a.export or a.db or a.picks or a.picks_export):
        ap.error('give --export, --db, --picks or --picks-export')
    doc = load()
    if a.picks or a.picks_export:
        if a.picks:
            picks, svgs = [], {}
            for f in sorted(glob.glob(os.path.join(a.picks, 'picks', '*.json'))):
                g = json.load(open(f))
                picks.append(g.get('data', g))
            for f in sorted(glob.glob(os.path.join(a.picks, 'svgs', '*.json'))):
                g = json.load(open(f))
                g = g.get('data', g)
                svgs[g.get('icon') or os.path.splitext(os.path.basename(f))[0]] = g.get('svg')
        else:
            ex = json.load(open(a.picks_export))
            picks, svgs = list(ex.get('picks', {}).values()), ex.get('svgs', {})
        n = from_picks(doc, picks, svgs)
        save(doc)
        kinds = {}
        for e in doc['icons'].values():
            for s in e['sizes'].values():
                kinds[s.get('version', 'pixel')] = kinds.get(s.get('version', 'pixel'), 0) + 1
        redraw = sum(1 for e in doc['icons'].values() for s in e['sizes'].values() if s.get('redraw'))
        print('imported %d picks; %s; %d to redraw' % (
            n, ', '.join('%d %s' % (kinds[k], k) for k in sorted(kinds)), redraw))
        return
    n = from_export(doc, a.export) if a.export else from_db(doc, a.db)
    fill_done(doc)
    save(doc)
    done = sorted(k for k, e in doc['icons'].items() if e.get('done'))
    print('imported %d sizes; done: %s' % (n, ', '.join(done) or 'none'))


if __name__ == '__main__':
    main()
