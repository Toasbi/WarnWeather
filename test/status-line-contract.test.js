const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/pkjs/status-line-catalog.js');

const header = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_line.h'), 'utf8');

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
  // The PHONE's battery. One catalog item, TWO glyph ids: the phone substitutes
  // _CHG for _PHONE_BATTERY at bake time, so "charging" rides the icon byte the
  // slot already pays for instead of a new wire field.
  assert.equal(catalog.ICONS.PHONE_BATTERY, cEnum('STATUS_ICON_PHONE_BATTERY'));
  assert.equal(catalog.ICONS.PHONE_BATTERY_CHG, cEnum('STATUS_ICON_PHONE_BATTERY_CHG'));
  // PLAIN is text-only exactly like PRESSURE — no glyph is ever loaded. Its id
  // exists solely so the no-icon variant does not arrive as TEXT + ICON_NONE and
  // silently drive City's bold mode (the bug that shipped once on pressure).
  assert.equal(catalog.ICONS.PHONE_BATTERY_PLAIN, cEnum('STATUS_ICON_PHONE_BATTERY_PLAIN'));
});

// Icon ids are append-only wire values: a slot blob persisted on flash outlives
// the upgrade that renumbers them, so pin the literals as well as the lockstep.
test('the phone-battery icon ids are 16/17/18 on both sides of the wire', () => {
  assert.equal(cEnum('STATUS_ICON_PHONE_BATTERY'), 16);
  assert.equal(cEnum('STATUS_ICON_PHONE_BATTERY_CHG'), 17);
  assert.equal(cEnum('STATUS_ICON_PHONE_BATTERY_PLAIN'), 18);
  assert.equal(catalog.ICONS.PHONE_BATTERY, 16);
  assert.equal(catalog.ICONS.PHONE_BATTERY_CHG, 17);
  assert.equal(catalog.ICONS.PHONE_BATTERY_PLAIN, 18);
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
  // Both phone-battery items ride SLOT_TEXT; only the icon id tells them apart.
  ['phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
    const item = catalog.byCode(code);
    assert.ok(item, code + ' missing from catalog');
    assert.equal(item.kind, catalog.KINDS.TEXT, code + ' must be SLOT_TEXT');
  });
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
    batteryPct: [catalog.KINDS.LIVE_BATTERY_PCT, catalog.ICONS.NONE],
    // Two items, three icon ids: the CHG id has no catalog entry of its own —
    // the baker swaps it in for 'phoneBattery' while the phone is charging.
    phoneBattery: [catalog.KINDS.TEXT, catalog.ICONS.PHONE_BATTERY],
    phoneBatteryPlain: [catalog.KINDS.TEXT, catalog.ICONS.PHONE_BATTERY_PLAIN]
  };
  Object.keys(expected).forEach(code => {
    const item = catalog.byCode(code);
    assert.ok(item, code + ' missing from catalog');
    assert.equal(item.kind, expected[code][0], code + ' kind');
    assert.equal(item.icon, expected[code][1], code + ' icon');
  });
});
