"""The status icons and the sizes the watch draws each at, as the icon creator (WarnWeatherTools)
and the import of its exports read them (README.md in this folder). Plain Python, no dependencies.

    python3 scripts/pixel-icons/watch_icons.py manifest   the icons and their sizes as JSON, for
                                                          the icon creator
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PIXELS_JSON = os.path.join(ROOT, 'resources', 'pixel-icons.json')

# ---- The bars each watch draws icons in ---------------------------------------------------
# (label, the icon's target height, top bar?, the bar's text font). status_row.c
# icon_target_h(): 6/9 of the font's content height in a bar, 5/9 in the top bar.
PLATFORMS = [
    ('basalt', 'Pebble Time, Pebble 2', [
        ('bars with 14 px text', 9, False, 'GOTHIC_14'),
        ('top bar', 10, True, 'GOTHIC_18'),
        ('bars with 18 px text', 12, False, 'GOTHIC_18'),
    ]),
    ('emery', 'Pebble Time 2', [
        ('bars with 18 px text', 12, False, 'GOTHIC_18'),
        ('top bar', 13, True, 'GOTHIC_24'),
        ('bars with 24 px text', 16, False, 'GOTHIC_24'),
    ]),
]
# Where a bar's text font puts the centre of its capitals, from the text frame's top: the line an
# icon is seated on (status_row.c cap_cy).
FONT_CAP_CY = {'GOTHIC_14': 9, 'GOTHIC_18': 12, 'GOTHIC_24': 17}
FONT_HEIGHT = {'GOTHIC_14': 14, 'GOTHIC_18': 18, 'GOTHIC_24': 24}
# The gap between an icon's ink and its text (STATUS_ROW_ICON_TEXT_GAP - 1, as the colour watches
# count a glyph one column narrower than its ink).
ICON_TEXT_GAP = 2

# ---- The icons ------------------------------------------------------------------------------
# The catalogue both this file and gen_watch_icons.js read (icons.json): per icon its key, name and
# group, its scale percent (status_row_icons.c icon_scale_pct()), its weights on the 144 px
# watches and the Pebble Time 2 (status_icon_weight.h), its sample text, a note, and the watch
# icon ids its drawings serve.
ICONS_JSON = os.path.join(HERE, 'icons.json')
ICONS = json.load(open(ICONS_JSON, encoding='utf-8'))['icons']
KEYS = [i['key'] for i in ICONS]
# Pebble Classic/Steel draw these from bit masks in status_row_aplite.c (bit x = column x).
APLITE = ['TEMP', 'WIND', 'GUST', 'UV', 'AQI', 'POLLEN', 'COUNTDOWN']
# A mask's most rows and columns: a taller one is cut at the top of the 14 px text's band
# (status_row_aplite.c status_mask_draw), and a row is a uint16_t, bit x for column x.
APLITE_ROWS = 13
APLITE_WIDTH = 16
# The Pebble Classic/Steel bars: (label, text font), as status_row_aplite.c row_font picks them.
APLITE_BARS = [('bars with 14 px text', 'GOTHIC_14'), ('top bar', 'GOTHIC_18'), ('bars with 18 px text', 'GOTHIC_18')]


def icon(key):
    for i in ICONS:
        if i['key'] == key:
            return i
    raise KeyError(key)


# ---- The watch's sizing rules ---------------------------------------------------------------
def phone_icon_h(key, h, top, plat):
    """status_row_icons.c phone_icon_h(): the phone pair's height in whole pixels."""
    if plat == 'emery':
        if h >= 16:
            h -= 2
        elif not top and h <= 12 and key == 'PHONE_BATTERY':
            h -= 2
    if h & 1:
        h -= 1
    return max(9, h)


def load_for(key, pct, target, top, plat):
    """The icon's height in a bar, as status_row_icons_load() works it out."""
    h = max(1, target * pct // 100)
    if key == 'TEMP' and h < 10 and not top:
        return 9
    if key in ('PHONE_BATTERY', 'PHONE_BATTERY_CHG'):
        h = phone_icon_h(key, h, top, plat)
    return h


def painted_rows(h):
    """The rows a glyph scaled to h paints (ADR-0002 §3: always odd)."""
    return h + 1 if h % 2 == 0 else h + 2


def svg_h(key, rows):
    """The height the old scaling takes an SVG to for a size (`rows` painted rows): the first bar's
    that draws the icon that tall, else rows - 1 (any height paints painted_rows of it, whatever
    the glyph). The icon creator scales a source to it."""
    for u in uses(key):
        if painted_rows(u['h']) == rows:
            return u['h']
    return rows - 1


def uses(key):
    """Every bar the icon is drawn in: [{plat, where, font, h, weight}]."""
    it = icon(key)
    out = []
    for plat, pname, bars in PLATFORMS:
        wb, we = it['weights']
        for label, target, top, font in bars:
            h = load_for(key, it['pct'], target, top, plat)
            out.append({'plat': plat, 'where': pname + ': ' + label, 'font': font, 'h': h,
                        'weight': wb if plat == 'basalt' else we})
            if key == 'WIND':       # the Windy weather condition: 100 %, centred
                out.append({'plat': plat, 'where': pname + ': ' + label + ' (Windy weather)', 'font': font,
                            'h': target, 'weight': 50})
    return out


# ---- The manifest ---------------------------------------------------------------------------
def aplite_size(key):
    """An icon's Pebble Classic and Steel bit mask as a size of its own for the icon creator: key
    'A', at most APLITE_ROWS tall and APLITE_WIDTH wide, drawn in black and white pixel for pixel,
    seated in the Classic bars as status_mask_draw seats a mask ('seat': 'mask')."""
    return {'key': 'A', 'name': 'Pebble Classic and Steel', 'rows': APLITE_ROWS, 'maxWidth': APLITE_WIDTH,
            'scaleHeight': svg_h(key, APLITE_ROWS),
            'uses': [{'where': 'Pebble Classic, Steel: ' + label, 'platform': 'aplite', 'font': font, 'weight': 50,
                      'seat': 'mask'} for label, font in APLITE_BARS]}


def manifest():
    """The icons, the sizes the watch draws each at and where, for the icon creator: each size's
    painted rows, the height the old scaling takes a source to for it (svg_h), and every bar that
    draws it, with the bar's text font and the icon's seating weight (status_icon_weight.h). An
    icon the Pebble Classic and Steel draw from a bit mask has that as a size of its own, 'A'
    (aplite_size)."""
    icons = []
    for it in ICONS:
        sizes = {}
        for u in uses(it['key']):
            rows = painted_rows(u['h'])
            s = sizes.setdefault(rows, {'rows': rows, 'scaleHeight': svg_h(it['key'], rows), 'uses': []})
            s['uses'].append({'where': u['where'], 'platform': u['plat'], 'font': u['font'], 'weight': u['weight']})
        listed = [sizes[r] for r in sorted(sizes)]
        if it['key'] in APLITE:
            listed.append(aplite_size(it['key']))
        icons.append({'id': it['key'], 'name': it['name'], 'group': it['group'], 'sample': it['sample'],
                      'note': it['note'], 'sizes': listed})
    fonts = {f: {'height': FONT_HEIGHT[f], 'capCentre': FONT_CAP_CY[f]} for f in FONT_CAP_CY}
    return {'app': 'WarnWeather', 'iconTextGap': ICON_TEXT_GAP, 'fonts': fonts, 'icons': icons}


if __name__ == '__main__':
    import sys
    if sys.argv[1:] != ['manifest']:
        sys.exit('usage: watch_icons.py manifest')
    json.dump(manifest(), sys.stdout, indent=1)
    sys.stdout.write('\n')
