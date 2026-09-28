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
  assert.equal(th.ALERTS_OFFSET, cDefine('THRESH_ALERTS_OFFSET'));
  assert.equal(th.BAR_ALERTS_OFFSET, cDefine('THRESH_BAR_ALERTS_OFFSET'));
  assert.equal(th.WARN_LOOK_OFFSET, cDefine('THRESH_WARN_LOOK_OFFSET'));
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
// only claimed the first. Every kind appended into the remaining three was free:
// the blob's width is paid for on the Clay message (7 B tuple header +
// SETTINGS_BYTES, recorded in test/inbox-size.test.js). The widenings since are the
// two alert bytes (34 -> 36), appended right AFTER the bold area — so the bold area
// now ends where the alert bytes begin — and the two warn-look bytes (36 -> 38).
test('the bold-only kinds sharing byte 33 never widen the blob', () => {
  assert.equal(cEnum('THRESH_DEW'), 17, 'dew is the second cell of byte 33');
  assert.equal(th.BOLD_OFFSET + (cEnum('THRESH_DEW') >> 2), 33,
    'the dew bold cell shares byte 33 with battery %');
  assert.equal(th.SETTINGS_BYTES, 38, 'the alert and warn-look bytes are the widenings past 34');
  assert.equal(cDefine('THRESH_SETTINGS_BYTES'), 38);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_WARN_LOOK'), 36);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_BAR_ALERTS'), 35);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_ALERTS'), 34);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_KIND16'), 33);
  // Capacity, stated once: the bold area runs to the end of byte 33, and kinds
  // 18/19 (the phone battery) took the last two cells; kind 20 would need a
  // sixth bold byte AND relocate both alert bytes behind it.
  assert.ok(th.KINDS.length <= 20,
    'kind 20 would need a sixth bold byte — that is a layout change, not an append');
  assert.equal(th.BOLD_OFFSET + ((th.KINDS.length - 1) >> 2), th.ALERTS_OFFSET - 1,
    'the last bold byte sits right before the alert bytes');
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
  // The alert bytes follow the bold area, so the bold area is BOLD..ALERTS.
  const boldBytes = th.ALERTS_OFFSET - th.BOLD_OFFSET;
  assert.equal(boldBytes, Math.ceil((th.KINDS.length * 2) / 8));
  // The C side refuses to compile a kind whose bold cell would alias it.
  assert.match(header,
    /_Static_assert\(THRESH_BOLD_OFFSET \+ \(\(THRESH_KIND_COUNT \+ 3\) \/ 4\) <= THRESH_ALERTS_OFFSET/);
});

// Byte 34: bits 0-1 the Alerts row's rain look, bits 2-7 reserved. 'text' is 0 so
// a pre-alerts blob (no byte 34) and an unset setting both read today's look.
test('the rain look wire values are in lockstep with ThreshRainDisplay', () => {
  assert.equal(th.ALERTS_OFFSET, 34);
  assert.equal(th.RAIN_DISPLAY.text, cEnum('THRESH_RAIN_DISPLAY_TEXT'));
  assert.equal(th.RAIN_DISPLAY.icon, cEnum('THRESH_RAIN_DISPLAY_ICON'));
  assert.equal(th.RAIN_DISPLAY.minutes, cEnum('THRESH_RAIN_DISPLAY_MINUTES'));
  assert.equal(th.RAIN_DISPLAY.text, 0);
  assert.equal(th.BAR_ALERTS_OFFSET, th.ALERTS_OFFSET + 1, 'the placement byte follows it');
});

// Byte 35: the Alerts row's placement per status bar, 2 bits per bar in ThreshBar
// order, ThreshAlertsPlace values. The warn-look bytes follow it.
test('the per-bar placement byte is in lockstep with ThreshBar / ThreshAlertsPlace', () => {
  assert.equal(th.BAR_ALERTS_OFFSET, 35);
  assert.equal(th.WARN_LOOK_OFFSET, th.BAR_ALERTS_OFFSET + 1, 'the warn-look bytes follow it');
  assert.deepEqual(th.BAR_ALERT_KEYS.map(b => b.bar), ['top', 'forecast', 'radar', 'health']);
  assert.equal(cEnum('THRESH_BAR_TOP'), 0);
  assert.equal(cEnum('THRESH_BAR_FORECAST'), 1);
  assert.equal(cEnum('THRESH_BAR_RADAR'), 2);
  assert.equal(cEnum('THRESH_BAR_HEALTH'), 3);
  assert.equal(th.BAR_ALERT_KEYS.length, cDefine('THRESH_BAR_COUNT'));
  assert.equal(th.BAR_ALERT_PLACES.off, cEnum('THRESH_ALERTS_OFF'));
  assert.equal(th.BAR_ALERT_PLACES.left, cEnum('THRESH_ALERTS_LEFT'));
  assert.equal(th.BAR_ALERT_PLACES.middle, cEnum('THRESH_ALERTS_MIDDLE'));
  assert.equal(th.BAR_ALERT_PLACES.right, cEnum('THRESH_ALERTS_RIGHT'));
  // The C side refuses to compile a layout where the two bytes drift apart.
  assert.match(header, /_Static_assert\(THRESH_BAR_ALERTS_OFFSET == THRESH_ALERTS_OFFSET \+ 1/);
});

// The alert entries name their kind by ThreshKind in 3 bits (alert_set.h,
// ALERT_ENTRIES_UINT8): every alert kind's wire id must fit.
test('every alert kind is a weather kind whose wire id fits the entry header', () => {
  th.ALERT_KINDS.forEach((a) => {
    const i = th.KINDS.findIndex(k => k.code === a.code);
    assert.ok(i >= 0, a.code + ' is a KINDS code');
    assert.equal(th.KINDS[i].key, a.key, a.code + ' key stem');
    assert.ok(!th.KINDS[i].goal && !th.KINDS[i].boldOnly, a.code + ' is a weather kind');
    assert.ok(i <= 7, a.code + ' fits bits 0-2');
  });
  assert.deepEqual(th.ALERT_KINDS.map(a => a.code), ['uv', 'wind', 'gust', 'aqi', 'pollen'],
    'the row\'s fixed order');
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

// Kinds 18 and 19 took byte 33's LAST two 2-bit cells without widening the blob;
// the widenings since are the two alert bytes (34 -> 36), which added exactly two
// accepted lengths (34 pre-alerts, 35 pre-placement) for upgrading watches, and the
// two warn-look bytes (36 -> 38), which added one more (36 pre-warn-look).
test('kinds 18/19 fill byte 33; the alert and warn-look bytes add exactly three accepted lengths', () => {
  assert.equal(cDefine('THRESH_SETTINGS_BYTES'), 38);
  assert.equal(th.SETTINGS_BYTES, 38);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_WARN_LOOK'), 36);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_BAR_ALERTS'), 35);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_ALERTS'), 34);
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
  // The watch accepts exactly SIX blob lengths — 38, 36 (pre-warn-look), 35
  // (pre-placement), 34 (pre-alerts), 33 (pre-kind-16), 29 (pre-bold). A seventh
  // entry in status_threshold.c's validator would mean another widening.
  const validator = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_threshold.c'), 'utf8')
    .split('bool status_threshold_settings_validate')[1].split('}')[0];
  const lengths = [...validator.matchAll(/len\s*==\s*(THRESH_SETTINGS_BYTES[A-Z0-9_]*)/g)]
    .map(m => m[1]);
  assert.deepEqual(lengths,
    ['THRESH_SETTINGS_BYTES', 'THRESH_SETTINGS_BYTES_PRE_WARN_LOOK',
      'THRESH_SETTINGS_BYTES_PRE_BAR_ALERTS',
      'THRESH_SETTINGS_BYTES_PRE_ALERTS', 'THRESH_SETTINGS_BYTES_PRE_KIND16',
      'THRESH_SETTINGS_BYTES_PRE_BOLD'],
    'exactly the six known lengths');
  // Byte 33 is FULL, and the alert bytes sit right behind it: kind 20 needs a
  // sixth bold byte AND both alert bytes relocated — a layout change. Stated as an
  // equality so the next append trips this test.
  assert.equal(th.KINDS.length, 20, 'byte 33 holds exactly four cells (kinds 16..19)');
  assert.equal(th.ALERTS_OFFSET - th.BOLD_OFFSET, 5, 'five bold bytes, 20 cells');
});

// Bytes 36..37: the warn look per PAIRED kind, 2 bits each in ThreshKind order,
// ThreshWarnLook values. They end the blob, and cover the 8 paired kinds exactly.
test('the warn-look bytes are in lockstep with ThreshWarnLook', () => {
  assert.equal(th.WARN_LOOK_OFFSET, 36);
  assert.equal(th.WARN_LOOKS.none, cEnum('THRESH_WARN_LOOK_NONE'));
  assert.equal(th.WARN_LOOKS.outline, cEnum('THRESH_WARN_LOOK_OUTLINE'));
  assert.equal(th.WARN_LOOKS.fill, cEnum('THRESH_WARN_LOOK_FILL'));
  assert.deepEqual(Object.keys(th.WARN_LOOKS), ['none', 'outline', 'fill']);
  const paired = th.KINDS.filter(k => !k.boldOnly).length;
  assert.equal(th.SETTINGS_BYTES, th.WARN_LOOK_OFFSET + Math.ceil(paired * 2 / 8),
    'the look bytes cover the paired kinds and end the blob');
  // The C side refuses to compile a ninth paired kind without a third look byte.
  assert.match(header, /_Static_assert\(THRESH_SETTINGS_BYTES\s*== THRESH_WARN_LOOK_OFFSET \+ \(THRESH_PAIRED_KIND_COUNT \+ 3\) \/ 4/);
});

// The default look: goal kinds outline; weather kinds fill on a colour watch and
// outline on a B&W one (a B&W warn fill would be the danger fill). An unknown
// platform counts as colour, like every other capability.
test('warnLookDefault / warnLookFor resolve the per-platform default', () => {
  th.KINDS.filter(k => !k.boldOnly).forEach((k) => {
    const want = k.goal ? 'outline' : 'fill';
    assert.equal(th.warnLookDefault(k.key, true), want, k.key + ' colour');
    assert.equal(th.warnLookDefault(k.key), want, k.key + ' unknown platform');
    assert.equal(th.warnLookDefault(k.key, false), 'outline', k.key + ' B&W');
    assert.equal(th.warnLookFor({}, k.key, true), want);
    assert.equal(th.warnLookFor(null, k.key, false), 'outline');
    ['none', 'outline', 'fill'].forEach((look) => {
      const s = {};
      s['thresh' + k.key + 'WarnLook'] = look;
      assert.equal(th.warnLookFor(s, k.key, true), look, k.key + ' stored ' + look);
      assert.equal(th.warnLookFor(s, k.key, false), look, k.key + ' stored ' + look + ' on B&W');
    });
    const junk = {};
    junk['thresh' + k.key + 'WarnLook'] = 'bogus';
    assert.equal(th.warnLookFor(junk, k.key, true), want, k.key + ' unknown value = default');
  });
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

test('directions match the C module: the JS axis is retired, the C stub is false', () => {
  // The goal flag covers exactly the health trio (the C module returns false for
  // every kind — see status_threshold_below_is_worse; the JS contract retired
  // its side of the axis entirely); UV (appended after them) is a plain weather
  // kind.
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
