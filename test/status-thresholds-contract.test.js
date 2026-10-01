'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const th = require('../src/pkjs/status-thresholds.js');
const wire = require('../src/pkjs/status-wire.js');

const header = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_threshold.h'), 'utf8');

function cDefine(name) {
  const m = header.match(new RegExp('#define\\s+' + name + '\\s+(\\d+)'));
  assert.ok(m, name + ' missing from status_threshold.h');
  return Number(m[1]);
}

// ThreshRainDisplay sits in on_demand.h, which status_threshold.h includes: the On
// demand lane rule there reads it.
const onDemandHeader = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'c', 'appendix', 'on_demand.h'), 'utf8');

function cEnum(name, text = header, file = 'status_threshold.h') {
  const m = text.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' missing from ' + file);
  return Number(m[1]);
}

// The 48-B blob of 1.24.0: the watch reads the Battery item byte and the ten On demand
// cells from it.
test('kind count and blob layout are in lockstep with status_threshold.h', () => {
  assert.equal(th.KINDS.length, cDefine('THRESH_KIND_COUNT'));
  assert.equal(wire.SETTINGS_BYTES, cDefine('THRESH_SETTINGS_BYTES'), 'the phone sends the full 48-B shape');
  assert.equal(wire.COLORS_OFFSET, cDefine('THRESH_COLORS_OFFSET'));
  assert.equal(wire.HEALTH_OFFSET, cDefine('THRESH_HEALTH_OFFSET'));
  assert.equal(wire.BOLD_OFFSET, cDefine('THRESH_BOLD_OFFSET'));
  assert.equal(wire.ALERTS_OFFSET, cDefine('THRESH_ALERTS_OFFSET'));
  assert.equal(wire.BATTERY_OFFSET, cDefine('THRESH_BATTERY_OFFSET'));
  assert.match(header, new RegExp('#define THRESH_BATTERY_VALUE_BIT 0x' + wire.BATTERY_VALUE_BIT.toString(16) + '\\b'),
    'the Look bit');
  assert.equal(wire.WARN_LOOK_OFFSET, cDefine('THRESH_WARN_LOOK_OFFSET'));
  assert.equal(wire.ON_DEMAND_OFFSET, cDefine('THRESH_ON_DEMAND_OFFSET'));
  // The paired kinds — the ones owning an enable bit, a color pair, and (for
  // the health trio) a u16 pair — are exactly the non-boldOnly ones, and they
  // must ALL precede the bold-only tail: byte 0 has 8 enable bits, no more.
  const paired = th.KINDS.filter(k => !k.boldOnly).length;
  assert.equal(paired, cDefine('THRESH_PAIRED_KIND_COUNT'));
  th.KINDS.forEach((k, i) => {
    assert.equal(Boolean(k.boldOnly), i >= paired, k.code + ' paired/bold-only split');
  });
  // Battery % (kind 16) opened byte 33 — the widening that took the blob 33 -> 34.
  assert.equal(wire.BOLD_OFFSET + (cEnum('THRESH_BATTERY_PCT') >> 2), 33,
    'the battery-% bold cell lives in byte 33');
});

// Byte 33 is a whole byte holding four 2-bit cells (kinds 16..19), and battery %
// only claimed the first. Every kind appended into the remaining three was free:
// the blob's width is paid for on the Clay message (7 B tuple header +
// SETTINGS_BYTES, recorded in test/inbox-size.test.js). The only widening since is
// 1.24.0's 34 -> 48: the rain-look byte and the Battery item byte, appended right
// AFTER the bold area — so the bold area now ends where they begin — the two warn-look
// bytes and the ten On demand cells.
test('the bold-only kinds sharing byte 33 never widen the blob', () => {
  assert.equal(cEnum('THRESH_DEW'), 17, 'dew is the second cell of byte 33');
  assert.equal(wire.BOLD_OFFSET + (cEnum('THRESH_DEW') >> 2), 33,
    'the dew bold cell shares byte 33 with battery %');
  assert.equal(wire.SETTINGS_BYTES, 48, 'the alert, Battery, warn-look and On demand bytes are the widening past 34');
  assert.equal(cDefine('THRESH_SETTINGS_BYTES'), 48);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_ALERTS'), 34);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_KIND16'), 33);
  // Capacity, stated once: the bold area runs to the end of byte 33, and kinds
  // 18/19 (the phone battery) took the last two cells; kind 20 would need a
  // sixth bold byte AND relocate both alert bytes behind it.
  assert.ok(th.KINDS.length <= 20,
    'kind 20 would need a sixth bold byte — that is a layout change, not an append');
  assert.equal(wire.BOLD_OFFSET + ((th.KINDS.length - 1) >> 2), wire.ALERTS_OFFSET - 1,
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
  const boldBytes = wire.ALERTS_OFFSET - wire.BOLD_OFFSET;
  assert.equal(boldBytes, Math.ceil((th.KINDS.length * 2) / 8));
  // The C side refuses to compile a kind whose bold cell would alias it.
  assert.match(header,
    /_Static_assert\(THRESH_BOLD_OFFSET \+ \(\(THRESH_KIND_COUNT \+ 3\) \/ 4\) <= THRESH_ALERTS_OFFSET/);
});

// Byte 34: bits 0-1 the rain alert's look, bits 2-7 reserved. 'text' is 0 so
// a pre-alerts blob (no byte 34) and an unset setting both read today's look.
test('the rain look wire values are in lockstep with ThreshRainDisplay', () => {
  assert.equal(wire.ALERTS_OFFSET, 34);
  const rainEnum = name => cEnum(name, onDemandHeader, 'on_demand.h');
  assert.equal(th.RAIN_DISPLAY.text, rainEnum('THRESH_RAIN_DISPLAY_TEXT'));
  assert.equal(th.RAIN_DISPLAY.icon, rainEnum('THRESH_RAIN_DISPLAY_ICON'));
  assert.equal(th.RAIN_DISPLAY.minutes, rainEnum('THRESH_RAIN_DISPLAY_MINUTES'));
  assert.equal(th.RAIN_DISPLAY.text, 0);
  assert.equal(wire.BATTERY_OFFSET, wire.ALERTS_OFFSET + 1, 'the Battery byte follows it');
});

// The status bars: the phone's On demand bars (on-demand.js BARS) and the watch's
// ThreshBar share one order, which is the order of the 2-bit cells in every On demand
// cell byte.
test('the bars are in lockstep with ThreshBar', () => {
  const OD = require('../src/pkjs/on-demand.js');
  assert.equal(wire.BATTERY_OFFSET, 35);
  assert.equal(wire.WARN_LOOK_OFFSET, wire.BATTERY_OFFSET + 1, 'the warn-look bytes follow it');
  assert.deepEqual(OD.BARS.map(b => b.bar), ['top', 'forecast', 'radar', 'health']);
  assert.equal(cEnum('THRESH_BAR_TOP'), 0);
  assert.equal(cEnum('THRESH_BAR_FORECAST'), 1);
  assert.equal(cEnum('THRESH_BAR_RADAR'), 2);
  assert.equal(cEnum('THRESH_BAR_HEALTH'), 3);
  assert.equal(OD.BARS.length, cDefine('THRESH_BAR_COUNT'));
  // The C side refuses to compile a layout where the bytes drift apart.
  assert.match(header, /_Static_assert\(THRESH_BATTERY_OFFSET == THRESH_ALERTS_OFFSET \+ 1/);
});

// The 48-B blob's tail: the Battery item byte at 35 and one cell byte per On demand
// item from 38, in the item order on_demand.h pins (the priority order).
test('the Battery byte and the On demand cells close the 48-B blob', () => {
  assert.equal(cDefine('THRESH_BATTERY_OFFSET'), 35);
  assert.equal(cDefine('THRESH_ON_DEMAND_OFFSET'), 38);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES'), 48);
  assert.equal(cDefine('THRESH_BATTERY_LEVEL_DEFAULT'), 10);
  const onDemand = onDemandHeader;
  const items = ['OD_BATTERY', 'OD_BLUETOOTH', 'OD_QUIET_TIME', 'OD_SLEEP', 'OD_RAIN',
    'OD_GUST', 'OD_UV', 'OD_AQI', 'OD_POLLEN', 'OD_WIND'];
  items.forEach((name, i) => {
    assert.match(onDemand, new RegExp(name + '\\s*=\\s*' + i + ','), name + ' is item ' + i);
  });
  assert.match(onDemand, /OD_ITEM_COUNT = 10/);
  assert.match(header, /_Static_assert\(THRESH_SETTINGS_BYTES == THRESH_ON_DEMAND_OFFSET \+ OD_ITEM_COUNT/);
  assert.match(header, /_Static_assert\(THRESH_SETTINGS_BYTES <= STATUS_LINE_MAX_BYTES/);
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
  assert.deepEqual(th.ALERT_KINDS.map(a => a.code), ['gust', 'uv', 'aqi', 'pollen', 'wind'],
    'the On demand priority order, which is also the bake\'s (the cap drops wind first)');
  const OD = require('../src/pkjs/on-demand.js');
  assert.deepEqual(th.ALERT_KINDS.map(a => a.code),
    OD.ITEMS.map(i => i.code).filter(c => th.ALERT_KINDS.some(a => a.code === c)),
    'the same order as the On demand items');
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
// the only widening since is 1.24.0's 34 -> 48 (the two alert bytes, the two
// warn-look bytes and the On demand cells), which added exactly one accepted
// length: 34, pre-alerts, for upgrading watches. Its interim 35-, 36- and 38-byte
// steps never shipped.
test('kinds 18/19 fill byte 33; 1.24.0 adds exactly one accepted length', () => {
  assert.equal(cDefine('THRESH_SETTINGS_BYTES'), 48);
  assert.equal(wire.SETTINGS_BYTES, 48);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_ALERTS'), 34);
  assert.equal(cDefine('THRESH_SETTINGS_BYTES_PRE_KIND16'), 33);
  assert.equal(cDefine('THRESH_BOLD_OFFSET'), 29);
  // Both new kinds land in a byte the blob already pays for, at the two cells
  // battery % and dew left free. Derived from the enum, not restated.
  const iconedKind = cEnum('THRESH_PHONE_BATTERY');
  const plainKind = cEnum('THRESH_PHONE_BATTERY_PLAIN');
  [iconedKind, plainKind].forEach((kind) => {
    assert.equal(wire.BOLD_OFFSET + (kind >> 2), 33, 'kind ' + kind + ' lives in byte 33');
  });
  assert.equal(2 * (iconedKind & 3), 4, 'phoneBattery is byte 33 bits 4-5');
  assert.equal(2 * (plainKind & 3), 6, 'phoneBatteryPlain is byte 33 bits 6-7');
  // The watch accepts exactly FOUR blob lengths — 48, 34 (pre-alerts), 33
  // (pre-kind-16), 29 (pre-bold). A fifth entry in status_threshold.c's validator
  // would mean another widening.
  const validator = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'c', 'appendix', 'status_threshold.c'), 'utf8')
    .split('bool status_threshold_settings_validate')[1].split('}')[0];
  const lengths = [...validator.matchAll(/len\s*==\s*(THRESH_SETTINGS_BYTES[A-Z0-9_]*)/g)]
    .map(m => m[1]);
  assert.deepEqual(lengths,
    ['THRESH_SETTINGS_BYTES', 'THRESH_SETTINGS_BYTES_PRE_ALERTS',
      'THRESH_SETTINGS_BYTES_PRE_KIND16', 'THRESH_SETTINGS_BYTES_PRE_BOLD'],
    'exactly the four known lengths');
  // Byte 33 is FULL, and the alert bytes sit right behind it: kind 20 needs a
  // sixth bold byte AND both alert bytes relocated — a layout change. Stated as an
  // equality so the next append trips this test.
  assert.equal(th.KINDS.length, 20, 'byte 33 holds exactly four cells (kinds 16..19)');
  assert.equal(wire.ALERTS_OFFSET - wire.BOLD_OFFSET, 5, 'five bold bytes, 20 cells');
});

// Bytes 36..37: the warn look per PAIRED kind, 2 bits each in ThreshKind order,
// ThreshWarnLook values. They cover the 8 paired kinds exactly; the On demand cells
// follow them.
test('the warn-look bytes are in lockstep with ThreshWarnLook', () => {
  assert.equal(wire.WARN_LOOK_OFFSET, 36);
  assert.equal(th.WARN_LOOKS.none, cEnum('THRESH_WARN_LOOK_NONE'));
  assert.equal(th.WARN_LOOKS.outline, cEnum('THRESH_WARN_LOOK_OUTLINE'));
  assert.equal(th.WARN_LOOKS.fill, cEnum('THRESH_WARN_LOOK_FILL'));
  assert.deepEqual(Object.keys(th.WARN_LOOKS), ['none', 'outline', 'fill']);
  const paired = th.KINDS.filter(k => !k.boldOnly).length;
  assert.equal(wire.ON_DEMAND_OFFSET, wire.WARN_LOOK_OFFSET + Math.ceil(paired * 2 / 8),
    'the look bytes cover the paired kinds, the cells follow');
  // The C side refuses to compile a ninth paired kind without a third look byte.
  assert.match(header, /_Static_assert\(THRESH_ON_DEMAND_OFFSET\s*== THRESH_WARN_LOOK_OFFSET \+ \(THRESH_PAIRED_KIND_COUNT \+ 3\) \/ 4/);
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

test('DEFAULT_GOAL_HEX is the stored-shape twin of the packed goal green', () => {
  // Every settings-page site that seeds/resets the goal green reads this export;
  // the derivation pins it to the colour an unset goal kind packs, forever.
  assert.equal(th.DEFAULT_GOAL_HEX, '#55FF00');
  assert.equal(parseInt(th.DEFAULT_GOAL_HEX.slice(1), 16), th.thresholdColor({}, 'Steps', 'Warn'));
});
