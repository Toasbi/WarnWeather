'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const th = require('../src/pkjs/status-thresholds.js');

const header = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_threshold.h'), 'utf8');

function cDefine(name) {
  const m = header.match(new RegExp('#define\\s+' + name + '\\s+(\\d+)'));
  assert.ok(m, name + ' missing from status_threshold.h');
  return Number(m[1]);
}

function cEnum(name) {
  const m = header.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' missing from status_threshold.h');
  return Number(m[1]);
}

test('kind count and blob layout are in lockstep with status_threshold.h', () => {
  assert.equal(th.KINDS.length, cDefine('THRESH_KIND_COUNT'));
  assert.equal(th.SETTINGS_BYTES, cDefine('THRESH_SETTINGS_BYTES'));
  assert.equal(th.COLORS_OFFSET, cDefine('THRESH_COLORS_OFFSET'));
  assert.equal(th.HEALTH_OFFSET, cDefine('THRESH_HEALTH_OFFSET'));
  assert.equal(th.BOLD_OFFSET, cDefine('THRESH_BOLD_OFFSET'));
  // The paired kinds — the ones owning an enable bit, a color pair, and (for
  // the health trio) a u16 pair — are exactly the non-boldOnly ones, and they
  // must ALL precede the bold-only tail: byte 0 has 8 enable bits, no more.
  const paired = th.KINDS.filter(k => !k.boldOnly).length;
  assert.equal(paired, cDefine('THRESH_PAIRED_KIND_COUNT'));
  th.KINDS.forEach((k, i) => {
    assert.equal(Boolean(k.boldOnly), i >= paired, k.code + ' paired/bold-only split');
  });
  // Battery % (kind 16) opened byte 33 — the widening that took the blob 33 -> 34.
  assert.equal(th.BOLD_OFFSET + (cEnum('THRESH_BATTERY_PCT') >> 2), 33,
    'the battery-% bold cell lives in byte 33');
});

// Byte 33 is a whole byte holding four 2-bit cells (kinds 16..19), and battery %
// only claimed the first. Every kind appended into the remaining three is free:
// it must not move THRESH_SETTINGS_BYTES, because the blob's width is paid for on
// the Clay message (7 B tuple header + SETTINGS_BYTES, recorded in
// test/inbox-size.test.js) and widening it would also add a fourth accepted
// length for upgrading watches to read.
test('the bold-only kinds sharing byte 33 never widen the blob', () => {
  assert.equal(cEnum('THRESH_DEW'), 17, 'dew is the second cell of byte 33');
  assert.equal(th.BOLD_OFFSET + (cEnum('THRESH_DEW') >> 2), 33,
    'the dew bold cell shares byte 33 with battery %');
  assert.equal(th.SETTINGS_BYTES, 34, 'appending kinds 17..19 must not widen the blob');
  assert.equal(cDefine('THRESH_SETTINGS_BYTES'), 34);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_KIND16'), 33);
  // Capacity, stated once: the bold area runs to the end of byte 33, and kinds
  // 18/19 (the phone battery) took the last two cells; kind 20 is the first that
  // would cost a byte.
  assert.ok(th.KINDS.length <= 20,
    'kind 20 would need a sixth bold byte — that is a wire widening, not an append');
  assert.equal(cEnum('THRESH_PHONE_BATTERY_PLAIN'), 19,
    'the last cell of byte 33 is the highest kind the blob can hold for free');
});

test('bold modes are in lockstep with the ThreshBold enum', () => {
  assert.equal(th.BOLD_MODES.warn, cEnum('THRESH_BOLD_WARN'));
  assert.equal(th.BOLD_MODES.off, cEnum('THRESH_BOLD_OFF'));
  assert.equal(th.BOLD_MODES.always, cEnum('THRESH_BOLD_ALWAYS'));
  // 'warn' must stay the zero value: an all-zero (or never-configured) blob has
  // to reproduce the shipped bold-from-warn behaviour, watch and phone alike.
  assert.equal(th.BOLD_MODES[th.DEFAULT_BOLD_MODE], 0);
});

test('the bold bytes cover every kind at 2 bits each', () => {
  const boldBytes = th.SETTINGS_BYTES - th.BOLD_OFFSET;
  assert.equal(boldBytes, Math.ceil((th.KINDS.length * 2) / 8));
});

test('kind indices are in lockstep with the ThreshKind enum', () => {
  const names = { aqi: 'THRESH_AQI', pollen: 'THRESH_POLLEN', wind: 'THRESH_WIND',
    gust: 'THRESH_GUST', steps: 'THRESH_STEPS', sleep: 'THRESH_SLEEP',
    distance: 'THRESH_DISTANCE', uv: 'THRESH_UV',
    temp: 'THRESH_TEMP', pressure: 'THRESH_PRESSURE', sun: 'THRESH_SUN',
    date: 'THRESH_DATE', week: 'THRESH_WEEK', city: 'THRESH_CITY',
    countdown: 'THRESH_COUNTDOWN', hr: 'THRESH_HR', batteryPct: 'THRESH_BATTERY_PCT',
    dew: 'THRESH_DEW', phoneBattery: 'THRESH_PHONE_BATTERY',
    phoneBatteryPlain: 'THRESH_PHONE_BATTERY_PLAIN' };
  th.KINDS.forEach((k, i) => {
    assert.ok(names[k.code], k.code + ' has no ThreshKind enumerator in the map');
    assert.equal(i, cEnum(names[k.code]), k.code + ' wire index');
  });
  // Every enumerator is claimed: a C-side append with no JS twin would otherwise
  // sit unnoticed until a bold mode silently packed into the wrong cell.
  assert.equal(Object.keys(names).length, cDefine('THRESH_KIND_COUNT'));
});

// The phone battery is TWO kinds sharing ONE settings key: the iconed variant
// (icons 16/17 — the phone swaps in _CHG while charging) and the no-icon variant
// (icon 18). Kind 19 exists for exactly the reason kind 14 (pressure) had to be
// retrofitted: without it the no-icon slot arrives as SLOT_TEXT + ICON_NONE and
// falls through to THRESH_CITY, so its Bold row would drive City's.
test('the phone-battery kinds are 18/19 and share one settings key', () => {
  assert.equal(cEnum('THRESH_PHONE_BATTERY'), 18);
  assert.equal(cEnum('THRESH_PHONE_BATTERY_PLAIN'), 19);
  assert.equal(cDefine('THRESH_KIND_COUNT'), 20);
  assert.equal(th.KINDS.length, 20);
  const iconed = th.KINDS[18];
  const plain = th.KINDS[19];
  assert.equal(iconed.code, 'phoneBattery');
  assert.equal(plain.code, 'phoneBatteryPlain');
  assert.equal(iconed.key, 'PhoneBattery');
  assert.equal(plain.key, 'PhoneBattery', 'both resolve to the ONE Bold sheet');
  assert.equal(Boolean(iconed.boldOnly), true);
  assert.equal(Boolean(plain.boldOnly), true);
  // 'PhoneBattery' is the only key the table repeats, and it repeats exactly
  // twice — one boldSection('Phone battery', 'PhoneBattery') covers both.
  const counts = {};
  th.KINDS.forEach((k) => { counts[k.key] = (counts[k.key] || 0) + 1; });
  const repeated = Object.keys(counts).filter(key => counts[key] > 1);
  assert.deepEqual(repeated, ['PhoneBattery']);
  assert.equal(counts.PhoneBattery, 2);
});

// The feature's stated non-goal: "no THRESH_SETTINGS_BYTES change". Kinds 18 and
// 19 take byte 33's LAST two 2-bit cells, so the blob width, the Clay bundle and
// the accepted-length set all stay exactly as they were.
test('appending kinds 18/19 leaves the blob 34 B and the accepted lengths unchanged', () => {
  assert.equal(cDefine('THRESH_SETTINGS_BYTES'), 34);
  assert.equal(th.SETTINGS_BYTES, 34);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_KIND16'), 33);
  assert.equal(cDefine('THRESH_BOLD_OFFSET'), 29);
  // Both new kinds land in a byte the blob already pays for, at the two cells
  // battery % and dew left free. Derived from the enum, not restated.
  const iconedKind = cEnum('THRESH_PHONE_BATTERY');
  const plainKind = cEnum('THRESH_PHONE_BATTERY_PLAIN');
  [iconedKind, plainKind].forEach((kind) => {
    assert.equal(th.BOLD_OFFSET + (kind >> 2), 33, 'kind ' + kind + ' lives in byte 33');
  });
  assert.equal(2 * (iconedKind & 3), 4, 'phoneBattery is byte 33 bits 4-5');
  assert.equal(2 * (plainKind & 3), 6, 'phoneBatteryPlain is byte 33 bits 6-7');
  // The watch still accepts exactly THREE blob lengths — 34, 33 (pre-kind-16),
  // 29 (pre-bold). A fourth entry in status_threshold.c's validator would mean
  // the append widened the blob after all.
  const validator = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_threshold.c'), 'utf8')
    .split('bool status_threshold_settings_validate')[1].split('}')[0];
  const lengths = [...validator.matchAll(/len\s*==\s*(THRESH_SETTINGS_BYTES[A-Z0-9_]*)/g)]
    .map(m => m[1]);
  assert.deepEqual(lengths,
    ['THRESH_SETTINGS_BYTES', 'THRESH_SETTINGS_BYTES_PRE_KIND16', 'THRESH_SETTINGS_BYTES_PRE_BOLD'],
    'kinds 18/19 must not add a fourth accepted blob length');
  // Byte 33 is now FULL. Kind 20 is the first that widens the blob 34 -> 35 and
  // adds a fourth accepted length for upgrading watches — see the design's
  // "Open risks". Stated as an equality so the next append trips this test.
  assert.equal(th.KINDS.length, 20, 'byte 33 holds exactly four cells (kinds 16..19)');
  assert.equal(th.SETTINGS_BYTES - th.BOLD_OFFSET, 5, 'five bold bytes, 20 cells');
});

test('persist boundary carries the full levels word (UV rides bits 8-9)', () => {
  // STATUS_LEVELS_UINT8 widened to 2 wire bytes when UV became kind 7. The
  // persist accessors sit between app_message (writer) and status_row (reader);
  // a uint8_t parameter there silently truncates the high byte and kills UV
  // highlighting while the low-byte kinds keep working (2026-08-15 bug).
  const persistHeader = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'c', 'appendix', 'persist.h'), 'utf8');
  assert.match(persistHeader, /int\s+persist_get_status_levels\s*\(/,
    'persist_get_status_levels must return int');
  assert.match(persistHeader, /persist_set_status_levels\s*\(\s*int\s+/,
    'persist_set_status_levels must take int — uint8_t truncates the UV bits');
});

test('directions match the C module: no kind is below-is-worse since the goal rework', () => {
  th.KINDS.forEach((k) => {
    assert.equal(k.belowIsWorse, false, k.code);
  });
  // The goal flag covers exactly the health trio (the C module returns false for
  // every kind — see status_threshold_below_is_worse); UV (appended after them)
  // is a plain weather kind.
  th.KINDS.forEach((k, i) => {
    assert.equal(Boolean(k.goal),
      i >= cEnum('THRESH_STEPS') && i <= cEnum('THRESH_DISTANCE'),
      k.code + ' goal flag');
  });
});

test('DEFAULT_GOAL_HEX is the stored-shape twin of DEFAULT_GOAL_COLOR', () => {
  // Every settings-page site that seeds/resets the goal green reads this export;
  // the derivation pins the two representations to one value forever.
  assert.equal(th.DEFAULT_GOAL_HEX, '#55FF00');
  assert.equal(parseInt(th.DEFAULT_GOAL_HEX.slice(1), 16), th.DEFAULT_GOAL_COLOR);
});
