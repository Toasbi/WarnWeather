const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');

const header = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'c', 'appendix', 'status_line.h'), 'utf8');

function cDefine(name) {
  const m = header.match(new RegExp('#define\\s+' + name + '\\s+(\\d+)'));
  assert.ok(m, name + ' missing from status_line.h');
  return Number(m[1]);
}

function cEnum(name) {
  const m = header.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' missing from status_line.h');
  return Number(m[1]);
}

test('caps are in lockstep with status_line.h', () => {
  assert.equal(catalog.CAPS.LINE_MAX, cDefine('STATUS_LINE_MAX_BYTES'));
  assert.equal(catalog.CAPS.EDGE_TEXT_MAX, cDefine('STATUS_TEXT_EDGE_MAX'));
  assert.equal(catalog.CAPS.MID_TEXT_MAX, cDefine('STATUS_TEXT_MID_MAX'));
  assert.equal(catalog.CAPS.EDGE_COND_TEXT_MAX, cDefine('STATUS_TEXT_EDGE_COND_MAX'));
});

test('slot kinds are in lockstep with status_line.h', () => {
  assert.equal(catalog.KINDS.EMPTY, cEnum('SLOT_EMPTY'));
  assert.equal(catalog.KINDS.TEXT, cEnum('SLOT_TEXT'));
  assert.equal(catalog.KINDS.LIVE_DATE, cEnum('SLOT_LIVE_DATE'));
  assert.equal(catalog.KINDS.LIVE_STEPS, cEnum('SLOT_LIVE_STEPS'));
  assert.equal(catalog.KINDS.LIVE_HR, cEnum('SLOT_LIVE_HR'));
  assert.equal(catalog.KINDS.LIVE_SLEEP, cEnum('SLOT_LIVE_SLEEP'));
  assert.equal(catalog.KINDS.LIVE_DISTANCE, cEnum('SLOT_LIVE_DISTANCE'));
  assert.equal(catalog.KINDS.LIVE_WEEK, cEnum('SLOT_LIVE_WEEK'));
  assert.equal(catalog.KINDS.LIVE_DISTANCE_MI, cEnum('SLOT_LIVE_DISTANCE_MI'));
  assert.equal(catalog.KINDS.LIVE_BATTERY, cEnum('SLOT_LIVE_BATTERY'));
  assert.equal(catalog.KINDS.LIVE_BATTERY_PCT, cEnum('SLOT_LIVE_BATTERY_PCT'));
});

test('the kinds whose slot carries text are in lockstep with status_slot_kind_has_text', () => {
  // The watch refuses a line that gives bytes to any other kind, so the two must agree.
  const m = header.match(/static inline bool status_slot_kind_has_text\(uint8_t kind\) \{\s*return ([^;]+);/);
  assert.ok(m, 'status_slot_kind_has_text missing from status_line.h');
  const named = m[1].split('||').map((term) => {
    const t = /^\s*kind == (SLOT_[A-Z_]+)\s*$/.exec(term);
    assert.ok(t, 'a term of another shape: ' + term);
    return cEnum(t[1]);
  });
  Object.keys(catalog.KINDS).forEach((name) => {
    const kind = catalog.KINDS[name];
    assert.equal(catalog.kindHasText(kind), named.indexOf(kind) !== -1, name);
  });
  assert.deepEqual(named.slice().sort((a, b) => a - b), [catalog.KINDS.TEXT, catalog.KINDS.LIVE_BATTERY_PCT]);
});

test('icon ids are in lockstep with status_line.h', () => {
  assert.equal(catalog.ICONS.NONE, cEnum('STATUS_ICON_NONE'));
  assert.equal(catalog.ICONS.DRAWN_SUN, cEnum('STATUS_ICON_DRAWN_SUN'));
  assert.equal(catalog.ICONS.TEMP, cEnum('STATUS_ICON_TEMP'));
  assert.equal(catalog.ICONS.UV, cEnum('STATUS_ICON_UV'));
  assert.equal(catalog.ICONS.WIND, cEnum('STATUS_ICON_WIND'));
  assert.equal(catalog.ICONS.GUST, cEnum('STATUS_ICON_GUST'));
  assert.equal(catalog.ICONS.STEPS, cEnum('STATUS_ICON_STEPS'));
  assert.equal(catalog.ICONS.SLEEP, cEnum('STATUS_ICON_SLEEP'));
  assert.equal(catalog.ICONS.HR, cEnum('STATUS_ICON_HR'));
  assert.equal(catalog.ICONS.DISTANCE, cEnum('STATUS_ICON_DISTANCE'));
  assert.equal(catalog.ICONS.AQI, cEnum('STATUS_ICON_AQI'));
  assert.equal(catalog.ICONS.POLLEN, cEnum('STATUS_ICON_POLLEN'));
  assert.equal(catalog.ICONS.COUNTDOWN, cEnum('STATUS_ICON_COUNTDOWN'));
  // PRESSURE is a text-only id (no glyph is ever loaded): it exists to
  // discriminate pressure from city (both TEXT) on the wire, so each can carry
  // its own per-kind bold mode.
  assert.equal(catalog.ICONS.PRESSURE, cEnum('STATUS_ICON_PRESSURE'));
  // DEWPOINT needs an id of its own even though its glyph is optional: a TEXT
  // slot with ICON_NONE inherits THRESH_CITY's bold mode.
  assert.equal(catalog.ICONS.DEWPOINT, cEnum('STATUS_ICON_DEWPOINT'));
  // The PHONE's battery: one glyph id (16). Id 17, the charging glyph the phone once
  // packed in its place, is a retired hole on both sides (see the next test).
  assert.equal(catalog.ICONS.PHONE_BATTERY, cEnum('STATUS_ICON_PHONE_BATTERY'));
  // PLAIN is text-only exactly like PRESSURE — no glyph is ever loaded. Its id
  // exists solely so the no-icon variant does not arrive as TEXT + ICON_NONE and
  // silently drive City's bold mode (the bug that shipped once on pressure).
  assert.equal(catalog.ICONS.PHONE_BATTERY_PLAIN, cEnum('STATUS_ICON_PHONE_BATTERY_PLAIN'));
  // The watch battery's Icon + text look: the glyph the watch draws in code before its text,
  // a sentinel like DRAWN_SUN.
  assert.equal(catalog.ICONS.DRAWN_BATTERY, cEnum('STATUS_ICON_DRAWN_BATTERY'));
  // The Plugin value slot: text-only like PRESSURE.
  assert.equal(catalog.ICONS.PLUGIN_TEXT, cEnum('STATUS_ICON_PLUGIN_TEXT'));
  // Every id the phone names, the C enum names: the watch drops a line with an id past its
  // STATUS_ICON_MAX, so an id added on one side only would blank the whole bar.
  const cIds = [];
  header.replace(/STATUS_ICON_[A-Z_]+\s*=\s*(\d+)/g, (m, id) => { cIds.push(Number(id)); return m; });
  Object.keys(catalog.ICONS).forEach((name) => {
    assert.ok(cIds.indexOf(catalog.ICONS[name]) !== -1, name + ' has a C enumerator');
  });
  assert.equal(Math.max.apply(null, Object.keys(catalog.ICONS).map((k) => catalog.ICONS[k])),
    cEnum('STATUS_ICON_PV_CALENDAR'), 'the highest id is the last appended');
  assert.match(header, /#define\s+STATUS_ICON_MAX\s+STATUS_ICON_PV_CALENDAR\b/, 'STATUS_ICON_MAX is the last id');
});

// Appended after the Plugin value's text-only id: the icons its dialog offers, each the same
// number on both sides, each loading a drawing (Bluetooth, Phone and Calendar the watch's own).
test('the Plugin value icons are ids 36 to 44 on both sides of the wire, each with a drawing', () => {
  const gen = require('../../../scripts/pixel-icons/gen_watch_icons.js');
  const names = ['SWITCH', 'SWITCH_OFF', 'WIFI', 'WIFI_OFF', 'BT', 'BT_OFF', 'PLUG', 'PHONE', 'CALENDAR'];
  const drawn = { BT: 'BT', BT_OFF: 'BT_OFF', PHONE: 'PHONE_BATTERY', CALENDAR: 'COUNTDOWN' };
  names.forEach((name, i) => {
    assert.equal(cEnum('STATUS_ICON_PV_' + name), 36 + i, name + ' in the C enum');
    assert.equal(catalog.ICONS['PV_' + name], 36 + i, name + ' on the phone');
    const key = drawn[name] || name;
    assert.ok((gen.ICON_IDS[key] || []).indexOf('STATUS_ICON_PV_' + name) !== -1, name + ' draws ' + key);
  });
});

// Appended after the drawn battery: a text-only id, so no drawing exists for it.
test('the plugin value is icon id 35 on both sides of the wire, and no drawing loads for it', () => {
  assert.equal(cEnum('STATUS_ICON_PLUGIN_TEXT'), 35);
  assert.equal(catalog.ICONS.PLUGIN_TEXT, 35);
  const gen = require('../../../scripts/pixel-icons/gen_watch_icons.js');
  assert.equal(Object.keys(gen.ICON_IDS).filter((d) => gen.ICON_IDS[d].indexOf('STATUS_ICON_PLUGIN_TEXT') !== -1)
    .length, 0, 'text-only, like the pressure');
});

// Appended after the weather condition's ids: a line stored with it before an upgrade
// keeps meaning the same glyph.
test('the drawn battery is icon id 34 on both sides of the wire, and no drawing loads for it', () => {
  assert.equal(cEnum('STATUS_ICON_DRAWN_BATTERY'), 34);
  assert.equal(catalog.ICONS.DRAWN_BATTERY, 34);
  const gen = require('../../../scripts/pixel-icons/gen_watch_icons.js');
  assert.equal(Object.keys(gen.ICON_IDS).filter((d) => gen.ICON_IDS[d].indexOf('STATUS_ICON_DRAWN_BATTERY') !== -1)
    .length, 0, 'drawn in code (battery_draw.c), like the sun arrow');
});

// Icon ids are append-only wire values: a slot blob persisted on flash outlives
// the upgrade that renumbers them, so pin the literals as well as the lockstep.
test('the phone-battery icon ids are 16 and 18 on both sides of the wire, 17 a retired hole', () => {
  assert.equal(cEnum('STATUS_ICON_PHONE_BATTERY'), 16);
  assert.equal(cEnum('STATUS_ICON_PHONE_BATTERY_PLAIN'), 18);
  assert.equal(catalog.ICONS.PHONE_BATTERY, 16);
  assert.equal(catalog.ICONS.PHONE_BATTERY_PLAIN, 18);
  // 17 (the charging glyph) is retired like 6 (precip): never reused, since a line
  // stored by an older install can still name it. Neither side has a name for it.
  assert.equal(Object.keys(catalog.ICONS).filter((k) => catalog.ICONS[k] === 17).length, 0,
    'no JS icon has id 17');
  assert.equal(Object.keys(catalog.ICONS).filter((k) => catalog.ICONS[k] === 6).length, 0,
    'no JS icon has id 6');
  assert.equal(header.search(/STATUS_ICON_\w+\s*=\s*17\b/), -1, 'no C enumerator has id 17');
  assert.equal(header.search(/STATUS_ICON_\w+\s*=\s*6\b/), -1, 'no C enumerator has id 6');
  assert.match(header, /retired hole[\s\S]*id 17[\s\S]*STATUS_ICON_PHONE_BATTERY_CHG/, 'the hole is documented next to id 6');
});

test('the weather condition icon ids are 19..33 on both sides of the wire', () => {
  const names = ['TEXT', 'SUN', 'MOON', 'SUN_CLOUD', 'MOON_CLOUD', 'CLOUD', 'FOG', 'HAZE', 'DRIZZLE', 'RAIN',
    'SLEET', 'SNOW', 'HAIL', 'THUNDER', 'WIND'];
  names.forEach((n, i) => {
    assert.equal(catalog.ICONS['COND_' + n], 19 + i, 'COND_' + n);
    assert.equal(cEnum('STATUS_ICON_COND_' + n), 19 + i, 'STATUS_ICON_COND_' + n);
  });
  assert.equal(catalog.ALT_SEP.charCodeAt(0), Number(header.match(/#define\s+STATUS_TEXT_ALT_SEP\s+(0x[0-9A-Fa-f]+)/)[1]));
  // Every glyph condition.js names is a catalog icon.
  const C = require('../../../src/pkjs/weather/domain/condition.js');
  Object.keys(C.CONDITIONS).forEach((id) => [false, true].forEach((night) => {
    assert.ok(Object.prototype.hasOwnProperty.call(catalog.ICONS, C.glyph(id, night)), id + ' ' + night);
  }));
});

// Each condition glyph is a pixel drawing the watch draws (scripts/pixel-icons: an icon in
// resources/pixel-icons.json, mapped to its id in gen_watch_icons.js and built into the watch's
// tables), and an outline the settings page draws (page/weather/condition-icons.js). A glyph
// missing its drawing draws as nothing, without an error (test/c/status_icon_drawings_test.c
// checks every height).
test('every condition glyph has its drawing and its watch mapping, and the page an icon for it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..', '..', '..');
  const gen = require('../../../scripts/pixel-icons/gen_watch_icons.js');
  const drawings = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'pixel-icons.json'), 'utf8')).icons;
  const table = fs.readFileSync(path.join(ROOT, 'src/c/layers/status_pixel_icons.generated.h'), 'utf8');
  const page = require('../../../src/pkjs/page/weather/condition-icons.js');
  const drawn = Object.keys(catalog.ICONS).filter((k) => /^COND_/.test(k) && k !== 'COND_TEXT');
  assert.ok(drawn.indexOf('COND_SUN_CLOUD') !== -1, 'a glyph the watch draws too');
  drawn.forEach((k) => {
    const id = 'STATUS_ICON_' + k;
    const key = Object.keys(gen.ICON_IDS).find((d) => gen.ICON_IDS[d].indexOf(id) !== -1);
    assert.ok(key, id + ': a drawing maps to it (gen_watch_icons.js ICON_IDS)');
    assert.ok(drawings[key] && Object.keys(drawings[key].sizes).length, id + ': ' + key + ' has drawings');
    assert.ok(table.indexOf('{ ' + id + ', ') !== -1, id + ': built into the watch\'s table');
    assert.ok(page.svg(k.replace(/^COND_/, '')), id + ': the page has its icon (condition-icons.js)');
  });
  assert.deepEqual(gen.ICON_IDS.WINDY, ['STATUS_ICON_COND_WIND'], 'Windy weather: drawings of its own, sized and seated apart from the wind speed\'s');
  assert.equal(table.indexOf('STATUS_ICON_COND_TEXT'), -1, 'the Text look maps to no glyph');
});

test('the city glyph bit is in lockstep with STATUS_ICON_CITY_GLYPH', () => {
  const m = header.match(/#define\s+STATUS_ICON_CITY_GLYPH\s+0x([0-9A-Fa-f]+)u?/);
  assert.ok(m, 'STATUS_ICON_CITY_GLYPH missing from status_line.h');
  assert.equal(catalog.CITY_GLYPH, parseInt(m[1], 16));
});

test('STATUS_ICON_MAX names the highest icon id in the enum', () => {
  const ids = [...header.matchAll(/(STATUS_ICON_[A-Z_]+)\s*=\s*(\d+)/g)]
    .map(m => ({ name: m[1], value: Number(m[2]) }));
  assert.ok(ids.length, 'no STATUS_ICON_* enumerators found');
  const highest = ids.reduce((a, b) => (b.value > a.value ? b : a));
  const m = header.match(/#define\s+STATUS_ICON_MAX\s+(STATUS_ICON_[A-Z_]+)/);
  assert.ok(m, 'STATUS_ICON_MAX missing from status_line.h');
  assert.equal(m[1], highest.name, 'STATUS_ICON_MAX was not bumped with the new id');
});

// The phone battery is phone-baked TEXT (kind 1), NOT a new SLOT_LIVE_* kind —
// that is the whole reason it costs zero watch-side plumbing and zero aplite
// bytes. A new kind would need a walk_slot arm, a persist path and a lean-twin
// port; pin that the ceiling did not move.
test('STATUS_SLOT_KIND_MAX is unchanged — the phone battery adds no slot kind', () => {
  const m = header.match(/#define\s+STATUS_SLOT_KIND_MAX\s+(SLOT_[A-Z_]+)/);
  assert.ok(m, 'STATUS_SLOT_KIND_MAX missing from status_line.h');
  assert.equal(m[1], 'SLOT_LIVE_BATTERY_PCT', 'the phone battery must not add a slot kind');
  assert.equal(cEnum('SLOT_LIVE_BATTERY_PCT'), 10);
  // The JS mirror agrees: no catalog kind exceeds the C ceiling.
  const kinds = Object.keys(catalog.KINDS).map(k => catalog.KINDS[k]);
  assert.equal(Math.max.apply(null, kinds), cEnum(m[1]),
    'the highest catalog kind must be STATUS_SLOT_KIND_MAX');
  // The phone battery rides SLOT_TEXT in both looks; only the icon id (16 or 18,
  // by its Look) tells them apart. 'phoneBatteryPlain' is no catalog item.
  const item = catalog.byCode('phoneBattery');
  assert.ok(item, 'phoneBattery missing from catalog');
  assert.equal(item.kind, catalog.KINDS.TEXT, 'phoneBattery must be SLOT_TEXT');
  assert.equal(catalog.byCode('phoneBatteryPlain'), undefined, 'the Text look is no item');
});

test('every dropdown item maps kind+icon consistently', () => {
  const expected = {
    empty: [catalog.KINDS.EMPTY, catalog.ICONS.NONE],
    temp: [catalog.KINDS.TEXT, catalog.ICONS.TEMP],
    pressure: [catalog.KINDS.TEXT, catalog.ICONS.PRESSURE],
    dew: [catalog.KINDS.TEXT, catalog.ICONS.DEWPOINT],
    city: [catalog.KINDS.TEXT, catalog.ICONS.NONE],
    countdown: [catalog.KINDS.TEXT, catalog.ICONS.COUNTDOWN],
    sun: [catalog.KINDS.TEXT, catalog.ICONS.DRAWN_SUN],
    uv: [catalog.KINDS.TEXT, catalog.ICONS.UV],
    wind: [catalog.KINDS.TEXT, catalog.ICONS.WIND],
    gust: [catalog.KINDS.TEXT, catalog.ICONS.GUST],
    aqi: [catalog.KINDS.TEXT, catalog.ICONS.AQI],
    pollen: [catalog.KINDS.TEXT, catalog.ICONS.POLLEN],
    steps: [catalog.KINDS.LIVE_STEPS, catalog.ICONS.STEPS],
    distance: [catalog.KINDS.LIVE_DISTANCE, catalog.ICONS.DISTANCE],
    hr: [catalog.KINDS.LIVE_HR, catalog.ICONS.HR],
    sleep: [catalog.KINDS.LIVE_SLEEP, catalog.ICONS.SLEEP],
    date: [catalog.KINDS.LIVE_DATE, catalog.ICONS.NONE],
    week: [catalog.KINDS.LIVE_WEEK, catalog.ICONS.NONE],
    battery: [catalog.KINDS.LIVE_BATTERY, catalog.ICONS.NONE],
    // The item's own kind and icon (its Icon look); the Text look re-packs them
    // in the bake (kind 10 / icon 18), which status-lines.test.js checks.
    // Icon 17 (the retired charging glyph) is a hole.
    phoneBattery: [catalog.KINDS.TEXT, catalog.ICONS.PHONE_BATTERY]
  };
  Object.keys(expected).forEach(code => {
    const item = catalog.byCode(code);
    assert.ok(item, code + ' missing from catalog');
    assert.equal(item.kind, expected[code][0], code + ' kind');
    assert.equal(item.icon, expected[code][1], code + ' icon');
  });
});
