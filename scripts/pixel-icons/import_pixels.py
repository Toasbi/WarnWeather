#!/usr/bin/env python3
"""Bring edits from the pixel icon editor into resources/pixel-icons.json (README.md here).

    python3 scripts/pixel-icons/import_pixels.py --export editor-export.json
    python3 scripts/pixel-icons/import_pixels.py --db <dir>

--export reads the editor's "Copy all as JSON" (every size of every icon). --db reads a dump
of the published editor's database (one JSON file per document under <dir>/glyphs and
<dir>/icons): edited sizes and done marks only; an icon marked done gets its unedited sizes
from the editor's own starting pixels (build_editor.py), so a done icon always has every size.

The file keeps every edited size, done or not, so the editor can be rebuilt where you left off;
only done icons go to the watch (gen_watch_icons.js).
"""
import argparse
import glob
import json
import os
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


def put(doc, key, size_id, pixels, source):
    if key not in W.KEYS or not pixels:
        return False
    entry = doc['icons'].setdefault(key, {'done': False, 'sizes': {}})
    entry['sizes'][size_id] = {'source': source or '', 'pixels': list(pixels)}
    return True


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
    a = ap.parse_args()
    if not a.export and not a.db:
        ap.error('give --export or --db')
    doc = load()
    n = from_export(doc, a.export) if a.export else from_db(doc, a.db)
    fill_done(doc)
    save(doc)
    done = sorted(k for k, e in doc['icons'].items() if e.get('done'))
    print('imported %d sizes; done: %s' % (n, ', '.join(done) or 'none'))


if __name__ == '__main__':
    main()
