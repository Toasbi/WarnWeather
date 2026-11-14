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
--picks reads a dump of the published picker's database (<dir>/picks), --picks-export its
"Copy picks as JSON": each size's version and Redraw mark (build_picker.py). An old version
keeps its lines in the file (watch_icons.py old_version), since the old icon is no drawing.

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


# What a size keeps from the picker when its pixels are edited again.
PICKED = ('version', 'redraw', 'old')


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
    if s is None or size_id == 'A' or version not in ('pixel', 'half', 'slant', 'old'):
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
    if redraw:
        s['redraw'] = True
    return True


def from_picks(doc, picks):
    """[{icon, size, version, redraw}] into the file."""
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
            picks = []
            for f in sorted(glob.glob(os.path.join(a.picks, 'picks', '*.json'))):
                g = json.load(open(f))
                picks.append(g.get('data', g))
        else:
            picks = list(json.load(open(a.picks_export)).get('picks', {}).values())
        n = from_picks(doc, picks)
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
