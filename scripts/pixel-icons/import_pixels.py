#!/usr/bin/env python3
"""Bring an export of the icon creator (WarnWeatherTools) into resources/pixel-icons.json
(README.md here):

    python3 scripts/pixel-icons/import_pixels.py --creator creator-export.json

Per icon and size, a pixel drawing, or a drawing as its lines (version drawing, kept in the file)
with its pixels as the black and white watches draw it; an icon's Pebble Classic and Steel mask
(size A) as pixels alone. Every size is checked before any changes; the sizes the export leaves
out stay as they are. gen_watch_icons.js then builds the file into the watch.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import watch_icons as W  # noqa: E402

ABOUT = ("The status icons' drawings, per size (scripts/pixel-icons/README.md). Change them in the "
         "icon creator (WarnWeatherTools) and import its export, not by hand.")
CREATOR_FORMAT = 1


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
    doc['icons'] = {k: {'sizes': doc['icons'][k]['sizes']} for k in W.KEYS if k in doc['icons']}
    for key, entry in doc['icons'].items():
        for size_id, s in entry['sizes'].items():
            s['platforms'] = platforms(key, size_id)
    with open(W.PIXELS_JSON, 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')


def creator_size(key, size_id, s):
    """One size of an icon creator export, checked: (rows, pixels, drawing or None). Exits with
    the reason on anything the watch could not draw or the file does not have."""
    where = '%s %s' % (key, size_id)
    if key not in W.KEYS:
        raise SystemExit('%s: no such icon' % where)
    mask = str(size_id) == 'A'
    if mask and key not in W.APLITE:
        raise SystemExit('%s: the Pebble Classic and Steel draw no mask of this icon' % where)
    if not mask and (not str(size_id).isdigit() or not platforms(key, str(size_id))):
        raise SystemExit('%s: the icon has no size of %s rows' % (where, size_id))
    rows = W.APLITE_ROWS if mask else int(size_id)
    px = s.get('pixels') if isinstance(s, dict) else None
    if (not isinstance(px, list) or not px or len(px) > rows
            or any(not isinstance(r, str) or len(r) != len(px[0]) or set(r) - set('#.') for r in px)
            or not any('#' in r for r in px)):
        raise SystemExit('%s: pixels must be up to %d rows of # and . of one width, with ink' % (where, rows))
    d = s.get('drawing')
    if mask:
        # A bit mask is its pixels: the size's 3.1.1 mask stays behind, the build makes the new one.
        if d is not None:
            raise SystemExit('%s: the Pebble Classic and Steel mask is pixels alone, no drawing' % where)
        ink = [i for r in px for i, ch in enumerate(r) if ch == '#']
        if max(ink) - min(ink) + 1 > W.APLITE_WIDTH:
            raise SystemExit('%s: the Pebble Classic and Steel mask is %d pixels wide at most' % (where, W.APLITE_WIDTH))
        return rows, px, None
    if d is None:
        return rows, px, None
    ok = (isinstance(d, dict) and isinstance(d.get('w'), int) and isinstance(d.get('h'), int)
          and 1 <= d['w'] <= 64 and 1 <= d['h'] <= rows and isinstance(d.get('lines'), list) and d['lines'])
    if ok:
        for line in d['lines']:
            if not isinstance(line, list) or not line:
                ok = False
                break
            for p in line:
                if (not isinstance(p, list) or len(p) != 2 or not all(isinstance(v, int) for v in p)
                        or not (0 <= p[0] < d['w'] and 0 <= p[1] < d['h'])):
                    ok = False
                    break
    if not ok:
        raise SystemExit('%s: the drawing must be lines of whole pixels inside its box, at most %d rows' % (where, rows))
    return rows, px, {'lines': d['lines'], 'w': d['w'], 'h': d['h']}


def centred(px, rows, width):
    """The pixels in a grid `rows` high and `width` wide (or theirs, if wider), the ink centred,
    so a size keeps its grid's width."""
    h, w = len(px), len(px[0])
    width = max(width, w)
    ox, oy = (width - w) // 2, (rows - h) // 2
    out = ['.' * width] * rows
    for y, r in enumerate(px):
        out[oy + y] = '.' * ox + r + '.' * (width - w - ox)
    return out


def from_creator(doc, path):
    """An icon creator export into the file: each size's pixels, centred in its grid, and its
    drawing as version drawing when it has one; what the size kept before (a picked version, a
    3.1.1 mask) stays behind. Every size is checked first; nothing changes when one is wrong."""
    ex = json.load(open(path))
    if not isinstance(ex, dict) or ex.get('format') != CREATOR_FORMAT:
        raise SystemExit('%s: not an icon creator export of format %d' % (path, CREATOR_FORMAT))
    checked = []
    for key, icon in sorted((ex.get('icons') or {}).items()):
        for size_id, s in sorted((icon.get('sizes') or {}).items()):
            checked.append((key, str(size_id)) + creator_size(key, size_id, s))
    for key, size_id, rows, px, drawing in checked:
        entry = doc['icons'].setdefault(key, {'sizes': {}})
        was = entry['sizes'].get(size_id, {}).get('pixels') or []
        size = {'source': 'creator', 'pixels': centred(px, rows, len(was[0]) if was else 0)}
        if drawing:
            size['version'] = 'drawing'
            size['drawing'] = drawing
        entry['sizes'][size_id] = size
    return len(checked)


def main():
    ap = argparse.ArgumentParser(description='Bring an icon creator export into resources/pixel-icons.json.')
    ap.add_argument('--creator', required=True, help='the export file')
    a = ap.parse_args()
    doc = load()
    n = from_creator(doc, a.creator)
    save(doc)
    print('imported %d sizes from the icon creator' % n)


if __name__ == '__main__':
    main()
