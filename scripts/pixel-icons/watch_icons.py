"""What the pixel icon tools share: the status icons, the sizes the watch draws each at, and
the watch's own way of scaling and drawing a glyph (README.md in this folder).

Plain Python, no dependencies; build_editor.py adds svg.path (through ../svg2pdc.py) for the
icon libraries.
"""
import os
import re
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PIXELS_JSON = os.path.join(ROOT, 'resources', 'pixel-icons.json')

PU = 8   # precise units per pixel (status_row_icons.c PRECISE_UNITS_PER_PX)

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
# The watches each platform's resources go to (package.template.json targetPlatforms).
PLATFORM_TARGETS = {'basalt': ['basalt', 'diorite', 'flint'], 'emery': ['emery']}

# ---- The icons ------------------------------------------------------------------------------
WEATHER = 'Weather'
VALUES = 'Weather values'
HEALTH = 'Phone and health'
SYSTEM = 'Bluetooth and quiet time'

# key: (name, group, today's resource, scale percent, weight (basalt, emery), sample text,
#       Lucide icon or parts, Tabler icon, note)
# Scale percents: status_row_icons.c icon_scale_pct(). Weights: status_icon_weight.h.
LUCIDE_CLOUD = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242'
RAIN_ALERT = 'Also the rain alert’s icon.'
ICONS = [
    ('SUN', 'Sun', WEATHER, 'STATUS_COND_SUN', 100, (50, 50), 'SUN', 'sun', 'sun', ''),
    ('MOON', 'Clear night', WEATHER, 'STATUS_COND_MOON', 100, (50, 50), 'CLR', 'moon', 'moon', ''),
    ('SUN_CLOUD', 'Partly cloudy', WEATHER, 'STATUS_COND_SUN_CLOUD', 100, (50, 50), 'PCLD', 'cloud-sun', None, ''),
    ('MOON_CLOUD', 'Partly cloudy, night', WEATHER, 'STATUS_COND_MOON_CLOUD', 100, (50, 50), 'PCLD',
     'cloud-moon', None, ''),
    ('CLOUD', 'Cloudy', WEATHER, 'STATUS_COND_CLOUD', 100, (50, 50), 'CLDY', 'cloud', 'cloud', ''),
    ('FOG', 'Fog', WEATHER, 'STATUS_COND_FOG', 100, (50, 50), 'FOG', 'cloud-fog', 'cloud-fog', ''),
    ('HAZE', 'Haze', WEATHER, 'STATUS_COND_HAZE', 100, (50, 50), 'HAZE', 'haze', 'haze', ''),
    ('DRIZZLE', 'Drizzle', WEATHER, 'STATUS_COND_DRIZZLE', 100, (50, 50), 'DRZL', 'cloud-drizzle', None,
     RAIN_ALERT + ' Light rain.'),
    ('RAIN', 'Rain', WEATHER, 'STATUS_COND_RAIN', 100, (50, 50), 'RAIN', 'cloud-rain', 'cloud-rain',
     RAIN_ALERT + ' Rain.'),
    ('HEAVY_RAIN', 'Heavy rain', WEATHER, 'RAIN_DOWNPOUR', 100, (50, 50), 'RAIN', 'cloud-rain-wind', None,
     RAIN_ALERT + ' Heavy rain (Pebble Time 2).'),
    # Lucide has no sleet: its rain cloud with two rain lines and a column of snow dots.
    ('SLEET', 'Sleet', WEATHER, 'STATUS_COND_SLEET', 100, (50, 50), 'SLT',
     [LUCIDE_CLOUD, 'M8 14v6', 'M16 14v6', 'M12 16h.01', 'M12 20h.01'], None, ''),
    ('SNOW', 'Snow', WEATHER, 'STATUS_COND_SNOW', 100, (50, 50), 'SNOW', 'cloud-snow', 'cloud-snow', ''),
    ('HAIL', 'Hail', WEATHER, 'STATUS_COND_HAIL', 100, (50, 50), 'HAIL', 'cloud-hail', None, ''),
    ('THUNDER', 'Thunderstorm', WEATHER, 'STATUS_COND_THUNDER', 100, (50, 50), 'TSTM', 'cloud-lightning',
     'cloud-storm', ''),
    ('TEMP', 'Temperature', VALUES, 'STATUS_TEMP', 93, (50, 50), '18°', None, None, ''),
    ('DEW', 'Dew point', VALUES, 'STATUS_DEW', 88, (50, 56), '9°', None, None, ''),
    ('UV', 'UV index', VALUES, 'STATUS_UV', 95, (50, 53), '3', None, None, ''),
    ('WIND', 'Wind and Windy', VALUES, 'STATUS_WIND', 95, (54, 60), '12', None, None,
     'Wind speed and the Windy weather icon share this drawing.'),
    ('GUST', 'Wind gusts', VALUES, 'STATUS_GUST', 95, (54, 53), '30', None, None, ''),
    ('AQI', 'Air quality', VALUES, 'STATUS_AQI', 85, (50, 50), '38', None, None, ''),
    ('POLLEN', 'Pollen', VALUES, 'STATUS_POLLEN', 100, (54, 56), '2', None, None, ''),
    ('COUNTDOWN', 'Countdown', VALUES, 'STATUS_COUNTDOWN', 100, (58, 59), '3d', None, None, ''),
    ('PHONE_BATTERY', 'Phone battery', HEALTH, 'STATUS_PHONE_BATTERY', 100, (50, 54), '80%', None, None, ''),
    ('PHONE_BATTERY_CHG', 'Phone charging', HEALTH, 'STATUS_PHONE_BATTERY_CHG', 100, (50, 54), '80%', None,
     None, ''),
    ('STEPS', 'Steps', HEALTH, 'HEALTH_STEPS', 80, (50, 54), '8.2k', None, None, ''),
    ('DISTANCE', 'Distance', HEALTH, 'STATUS_DISTANCE', 95, (50, 53), '5.1', None, None, ''),
    ('SLEEP', 'Sleep', HEALTH, 'HEALTH_SLEEP', 100, (50, 50), '7h', None, None, ''),
    ('HEART', 'Heart rate', HEALTH, 'HEALTH_HEART', 100, (50, 56), '62', None, None, ''),
    ('QUIET', 'Quiet time', SYSTEM, 'STATUS_QUIET', 100, (50, 50), '', None, None, ''),
    ('BT', 'Bluetooth', SYSTEM, 'STATUS_BT', 100, (50, 50), '', None, None, ''),
    ('BT_OFF', 'Bluetooth off', SYSTEM, 'STATUS_BT_OFF', 100, (50, 50), '', None, None, ''),
]
KEYS = [i[0] for i in ICONS]
# Pebble Classic/Steel draw these from bit masks in status_row_aplite.c (bit x = column x).
APLITE = ['TEMP', 'WIND', 'GUST', 'UV', 'AQI', 'POLLEN', 'COUNTDOWN']


def icon(key):
    for i in ICONS:
        if i[0] == key:
            return dict(zip(('key', 'name', 'group', 'res', 'pct', 'weights', 'sample', 'lucide', 'tabler',
                             'note'), i))
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


def load_for(key, res, pct, target, top, plat):
    """(resource, h) as status_row_icons_load() picks them for a bar."""
    h = max(1, target * pct // 100)
    if key == 'TEMP' and h < 10 and not top:
        return 'STATUS_TEMP_SMALL', 9
    if key in ('PHONE_BATTERY', 'PHONE_BATTERY_CHG'):
        h = phone_icon_h(key, h, top, plat)
    return res, h


def painted_rows(h):
    """The rows a glyph scaled to h paints (ADR-0002 §3: always odd)."""
    return h + 1 if h % 2 == 0 else h + 2


def uses(key):
    """Every bar the icon is drawn in: [{plat, where, font, res, h, weight}]."""
    it = icon(key)
    out = []
    for plat, pname, bars in PLATFORMS:
        wb, we = it['weights']
        for label, target, top, font in bars:
            r, h = load_for(key, it['res'], it['pct'], target, top, plat)
            out.append({'plat': plat, 'where': pname + ': ' + label, 'font': font, 'res': r, 'h': h,
                        'weight': wb if plat == 'basalt' else we})
            if key == 'WIND':       # the Windy weather condition: 100 %, centred
                out.append({'plat': plat, 'where': pname + ': ' + label + ' (Windy weather)', 'font': font,
                            'res': 'STATUS_WIND', 'h': target, 'weight': 50})
    return out


# ---- PDC files ------------------------------------------------------------------------------
def read_pdc(path):
    """A PDC image's paths as (points in PDC pixels, closed)."""
    b = open(path, 'rb').read()
    n = struct.unpack_from('<H', b, 14)[0]
    off, out = 16, []
    for _ in range(n):
        t, _hidden, _sc, _sw, _fc, opn, npts = struct.unpack_from('<BBBBBHH', b, off)
        off += 9
        pts = []
        for _ in range(npts):
            x, y = struct.unpack_from('<hh', b, off)
            off += 4
            pts.append((x / float(PU), y / float(PU)) if t == 3 else (float(x), float(y)))
        out.append((pts, not opn))
    return out


def resource_pdc(name):
    return read_pdc(os.path.join(ROOT, 'resources', 'data', name + '.pdc'))


# ---- The watch's scaling and drawing --------------------------------------------------------
def div_round(a, b):
    return (a + b // 2) // b if a >= 0 else -(((-a) + b // 2) // b)


def snap_off(d, num, den):
    return div_round(d * num, 2 * PU * den) * PU


def icon_load(paths, h):
    """status_row_icons.c icon_load() on float PDC-pixel points: every vertex's pixel, and
    the map it used: (scale, source centre x, y, pixel of the centre x, y)."""
    pre = [([(int(round(x * PU)), int(round(y * PU))) for x, y in pts], c) for pts, c in paths]
    xs = [x for pts, _ in pre for x, _ in pts]
    ys = [y for pts, _ in pre for _, y in pts]
    glyph_h, glyph_w = max(ys) - min(ys), max(xs) - min(xs)
    num, den = h * PU, glyph_h
    sum_x, sum_y = min(xs) + max(xs), min(ys) + max(ys)
    base_x = PU // 2 + snap_off(glyph_w, num, den)
    base_y = PU // 2 + snap_off(glyph_h, num, den)
    out = []
    for pts, c in pre:
        q = [((base_x + snap_off(2 * x - sum_x, num, den) - PU // 2) // PU,
              (base_y + snap_off(2 * y - sum_y, num, den) - PU // 2) // PU) for x, y in pts]
        out.append((q, c))
    centre = (sum_x / 2.0 / PU, sum_y / 2.0 / PU, (base_x - PU // 2) // PU, (base_y - PU // 2) // PU)
    return out, num / float(den), centre


def line(a, b):
    """Bresenham pixels from a to b, both ends included (Pebble's 1 px line, no antialiasing)."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    px = []
    while True:
        px.append((x0, y0))
        if (x0, y0) == (x1, y1):
            return px
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def raster(paths):
    """The pixels of integer-point paths drawn with 1 px lines."""
    px = set()
    for pts, closed in paths:
        n = len(pts)
        for i in range(n - 1 + (1 if closed and n > 2 else 0)):
            px.update(line(pts[i], pts[(i + 1) % n]))
        if n == 1:
            px.add(pts[0])
    return px


def today(res, h):
    """Today's icon at request h as the watch draws it with antialiasing off."""
    return raster(icon_load(resource_pdc(res), h)[0])


def old_version(key, rows):
    """The old version of a size (variants.js): the icon the watch drew before the pixel
    drawings, scaled to `rows` painted rows the way the watch scaled it (icon_load), from the
    first bar that drew it that tall, as the editor's Today starts. Its lines run through pixel
    centres, the ink at (0, 0), a closed path ending where it began, so the watch draws them
    1:1, smoothed, as it drew the old icon. {'lines': [[[x, y], ...], ...], 'w', 'h'}, or None
    when no bar drew the old icon that tall."""
    for u in uses(key):
        paths = icon_load(resource_pdc(u['res']), u['h'])[0]
        px = raster(paths)
        if max(y for _, y in px) - min(y for _, y in px) + 1 != rows:
            continue
        x0 = min(x for x, _ in px)
        y0 = min(y for _, y in px)
        lines = []
        for pts, closed in paths:
            q = [[x - x0, y - y0] for x, y in pts]
            if closed and len(q) > 2:
                q.append(q[0])
            lines.append(q)
        return {'lines': lines, 'w': max(x for x, _ in px) - x0 + 1, 'h': rows}
    return None


# ---- Grids ----------------------------------------------------------------------------------
def to_lines(pixels, rows, cols):
    """'#'/'.' rows, the ink centred across `cols` and down `rows`."""
    grid = [['.'] * cols for _ in range(rows)]
    if pixels:
        xs = [x for x, _ in pixels]
        ys = [y for _, y in pixels]
        w, hh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        ox = (cols - w) // 2 - min(xs)
        oy = (rows - hh) // 2 - min(ys)
        for x, y in pixels:
            if 0 <= x + ox < cols and 0 <= y + oy < rows:
                grid[y + oy][x + ox] = '#'
    return [''.join(r) for r in grid]


def from_lines(lines):
    """The set pixels of '#'/'.' rows, moved so the ink starts at (0, 0)."""
    px = {(x, y) for y, s in enumerate(lines) for x, ch in enumerate(s) if ch == '#'}
    if not px:
        return px
    x0 = min(x for x, _ in px)
    y0 = min(y for _, y in px)
    return {(x - x0, y - y0) for x, y in px}


# ---- Pebble Classic/Steel bit masks ---------------------------------------------------------
APLITE_C = os.path.join(ROOT, 'src', 'c', 'layers', 'status_row_aplite.c')
APLITE_H = os.path.join(ROOT, 'src', 'c', 'layers', 'status_masks_aplite.h')


def aplite_masks():
    """{KEY: rows of '#'/'.' (16 wide)} as status_row_aplite.c (or its masks header) has them."""
    src = open(APLITE_H if os.path.exists(APLITE_H) else APLITE_C).read()
    out = {}
    for name in APLITE:
        body = re.search(r'MASK_%s\[\]\s*=\s*\{([^}]*)\}' % name, src).group(1)
        vals = [int(v, 16) for v in re.findall(r'0x[0-9a-fA-F]+', body)]
        out[name] = [''.join('#' if (v >> x) & 1 else '.' for x in range(16)) for v in vals]
    return out
