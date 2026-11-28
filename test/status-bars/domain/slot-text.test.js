'use strict';
// slot-text.js wireKind: the kind a slot's item packs as. The bake packs by it
// (status-lines.js packLine) and the settings page counts a slot's bytes by it, so the two
// agree on which items carry text. And momentText: a plugin's moment as a slot prints it, with
// dayText, the day of one on another day.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const slotText = require('../../../src/pkjs/status-bars/domain/slot-text.js');
const { inZone } = require('../../helpers/in-zone.js');

const K = catalog.KINDS;
const BASALT = { platform: 'basalt' };
const APLITE = { platform: 'aplite' };
/** The kind `code` packs as. */
const kindOf = (code, settings, env) => slotText.wireKind(code, catalog.byCode(code), settings, env);

test('most items pack as their catalog kind, whatever the settings', () => {
  ['temp', 'city', 'uv', 'steps', 'hr', 'sleep', 'date', 'phoneBattery', 'empty'].forEach((code) => {
    assert.equal(kindOf(code, { distanceUnits: 'imperial', batterySlotLook: 'text' }, BASALT),
      catalog.byCode(code).kind, code);
    assert.equal(kindOf(code, {}, APLITE), catalog.byCode(code).kind, code + ' on aplite');
  });
});

test('distance packs its unit: kilometres, or miles under imperial units', () => {
  assert.equal(kindOf('distance', {}, BASALT), K.LIVE_DISTANCE);
  assert.equal(kindOf('distance', { distanceUnits: 'metric' }, BASALT), K.LIVE_DISTANCE);
  assert.equal(kindOf('distance', { distanceUnits: 'imperial' }, BASALT), K.LIVE_DISTANCE_MI);
  assert.equal(kindOf('distance', null, BASALT), K.LIVE_DISTANCE);
});

test('the watch battery packs its Look: the drawn battery, or its charge as text (never on aplite)', () => {
  assert.equal(kindOf('battery', {}, BASALT), K.LIVE_BATTERY);
  assert.equal(kindOf('battery', { batterySlotLook: 'icon' }, BASALT), K.LIVE_BATTERY);
  assert.equal(kindOf('battery', { batterySlotLook: 'nope' }, BASALT), K.LIVE_BATTERY, 'an unknown look is the Icon look');
  // Text and Icon + text both print the charge: the text's kind (the icon id tells them apart,
  // status-lines.js iconFor).
  ['text', 'both'].forEach((look) => {
    assert.equal(kindOf('battery', { batterySlotLook: look }, BASALT), K.LIVE_BATTERY_PCT, look);
    assert.equal(kindOf('battery', { batterySlotLook: look }, APLITE), K.LIVE_BATTERY, look + ' on aplite');
    assert.equal(catalog.kindHasText(kindOf('battery', { batterySlotLook: look }, BASALT)), true,
      look + ': the text can carry the days left');
  });
  assert.equal(catalog.kindHasText(kindOf('battery', {}, BASALT)), false);
});

test('the watch battery\'s Look reads its three values, the Icon look for anything else and on aplite', () => {
  assert.equal(slotText.batteryLook({}, BASALT), 'icon');
  assert.equal(slotText.batteryLook(null, BASALT), 'icon');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'icon' }, BASALT), 'icon');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'text' }, BASALT), 'text');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'both' }, BASALT), 'both');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'Both' }, BASALT), 'icon', 'stored values, not labels');
  assert.equal(slotText.batteryLook({ batterySlotLook: 'both' }), 'both', 'an unknown watch is not aplite');
  ['icon', 'text', 'both'].forEach((look) => {
    assert.equal(slotText.batteryLook({ batterySlotLook: look }, APLITE), 'icon', look + ' on aplite');
  });
});

test('the calendar week is the watch\'s to draw, but for aplite, where the phone bakes it as text', () => {
  assert.equal(kindOf('week', {}, BASALT), K.LIVE_WEEK);
  assert.equal(kindOf('week', {}, undefined), K.LIVE_WEEK, 'an unknown watch draws it itself');
  assert.equal(kindOf('week', {}, APLITE), K.TEXT);
});

/** Noon on 23 Nov 2026 here: the instant the moments below are baked for. */
const BAKED = new Date(2026, 10, 23, 12, 0).getTime();
const H12 = { axisTimeFormat: '12h', timeShowAmPm: true };
const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();

test('a moment on the day the slot is baked for prints its clock time alone, from midnight to midnight', () => {
  assert.equal(slotText.momentText(at(23, 0, 0), BAKED, {}, 19), '0:00');
  assert.equal(slotText.momentText(at(23, 23, 10), BAKED, {}, 19), '23:10');
  assert.equal(slotText.momentText(at(23, 23, 10), BAKED, H12, 8), '11:10p');
  assert.equal(slotText.momentText(at(23, 23, 59), at(23, 0, 0), {}, 8), '23:59', 'baked at midnight');
});

test('a moment in the coming week prints its weekday before its clock time, six days on at most', () => {
  assert.equal(slotText.momentText(at(24, 23, 10), BAKED, {}, 19), 'Tue 23:10', 'tomorrow, in the middle');
  assert.equal(slotText.momentText(at(24, 23, 10), BAKED, H12, 19), 'Tue 11:10p');
  assert.equal(slotText.momentText(at(24, 0, 0), at(23, 23, 59), {}, 19), 'Tue 0:00', 'a minute later');
  assert.equal(slotText.momentText(at(28, 9, 15), BAKED, {}, catalog.CAPS.EDGE_TEXT_MAX), 'Sat 9:15', 'an edge: 8 in 8');
  [['Tue', 24], ['Wed', 25], ['Thu', 26], ['Fri', 27], ['Sat', 28], ['Sun', 29]].forEach(([day, d]) => {
    assert.equal(slotText.momentText(at(d, 9, 15), BAKED, {}, 19), day + ' 9:15', day);
  });
  assert.equal(slotText.momentText(at(30, 9, 15), BAKED, {}, 19), '9:15 30 Nov', 'a week on: Monday would be today');
});

test('a moment on another day prints its date after its clock time, a week on and before today', () => {
  assert.equal(slotText.momentText(at(30, 23, 10), BAKED, {}, 19), '23:10 30 Nov', 'the middle');
  assert.equal(slotText.momentText(at(30, 23, 10), BAKED, H12, 19), '11:10p 30 Nov');
  assert.equal(slotText.momentText(at(22, 9, 5), BAKED, {}, 19), '9:05 22 Nov', 'the day before: a weekday would be next week\'s');
  assert.equal(slotText.momentText(new Date(2025, 10, 23, 12, 0).getTime(), BAKED, {}, 19), '12:00 23 Nov',
    'the same date a year before');
  assert.equal(slotText.momentText(at(30, 23, 10), BAKED, {}, 12), '23:10 30 Nov', '12 bytes in 12');
});

test('a moment in the coming week shortens its weekday to two letters where three leave its time no room: an edge', () => {
  const EDGE = catalog.CAPS.EDGE_TEXT_MAX;
  // Tomorrow's high tide, baked the evening before.
  const EVENING = at(23, 20, 0);
  assert.equal(slotText.momentText(at(24, 3, 5), EVENING, {}, EDGE), 'Tue 3:05', 'three letters where they fit');
  assert.equal(slotText.momentText(at(24, 3, 5), EVENING, { timeLeadingZero: true }, EDGE), 'Tu 03:05');
  assert.equal(slotText.momentText(at(24, 14, 32), EVENING, {}, EDGE), 'Tu 14:32');
  assert.equal(slotText.momentText(at(24, 3, 5), EVENING, H12, EDGE), 'Tu 3:05a');
  assert.equal(slotText.momentText(at(24, 23, 10), BAKED, H12, EDGE), 'Tu11:10p', 'no room for the space');
  assert.equal(slotText.momentText(at(24, 9, 5), EVENING, Object.assign({ timeLeadingZero: true }, H12), EDGE),
    'Tu09:05a');
  assert.equal(slotText.momentText(at(24, 14, 32), EVENING, {}, catalog.CAPS.MID_TEXT_MAX), 'Tue 14:32', 'the middle');
  [['Wed', 25], ['Thu', 26], ['Fri', 27], ['Sat', 28], ['Sun', 29]].forEach(([day, d]) => {
    assert.equal(slotText.momentText(at(d, 14, 32), BAKED, {}, EDGE), day.slice(0, 2) + ' 14:32', day);
  });
  assert.equal(slotText.momentText(at(24, 14, 32), EVENING, {}, 6), 'Tue', 'no room for the time at all: the day alone');
});

test('a moment on another day prints its day alone where both do not fit: never a cut text', () => {
  assert.equal(slotText.momentText(at(30, 23, 10), BAKED, {}, 11), '30 Nov', '12 bytes in 11');
  assert.equal(slotText.momentText(at(30, 23, 10), BAKED, {}, catalog.CAPS.EDGE_TEXT_MAX), '30 Nov', 'an edge');
  assert.equal(slotText.momentText(new Date(2026, 11, 1, 1, 5).getTime(), BAKED, {}, catalog.CAPS.EDGE_TEXT_MAX),
    '1 Dec', 'the shortest of both is 10 bytes');
});

test('a day counts by the calendar across a clock change: a 47 hour gap is two days, a 145 hour gap six', () => {
  const got = inZone('Europe/Berlin', { slotText: require.resolve('../../../src/pkjs/status-bars/domain/slot-text.js') },
    ({ slotText: text }) => {
      const sat = new Date(2027, 2, 27, 12, 0).getTime();
      return { gap: new Date(2027, 2, 29).getTime() - new Date(2027, 2, 27).getTime(),
        mon: text.momentText(new Date(2027, 2, 29, 9, 0).getTime(), sat, {}, 19),
        fri: text.momentText(new Date(2027, 3, 2, 9, 0).getTime(), sat, {}, 19),
        weekOn: text.momentText(new Date(2027, 3, 3, 9, 0).getTime(), sat, {}, 19),
        back: text.dayText(2026, 9, 26, new Date(2026, 9, 24, 23, 30).getTime()),
        backLong: text.dayText(2026, 9, 30, new Date(2026, 9, 24, 12).getTime()) };
    });
  assert.equal(got.gap, 47 * 3600000, 'the clocks go forward on 28 Mar 2027');
  assert.equal(got.mon, 'Mon 9:00');
  assert.equal(got.fri, 'Fri 9:00', 'six days on');
  assert.equal(got.weekOn, '9:00 3 Apr', 'a week on');
  assert.equal(got.back, 'Mon', 'the clocks go back on 25 Oct 2026: 49 hours');
  assert.equal(got.backLong, 'Fri', 'six days on across it: 145 hours');
});

test('a day other than today: its weekday in the coming week, else its date', () => {
  assert.equal(slotText.dayText(2026, 10, 24, BAKED), 'Tue');
  assert.equal(slotText.dayText(2026, 10, 29, BAKED), 'Sun');
  assert.equal(slotText.dayText(2026, 10, 30, BAKED), '30 Nov');
  assert.equal(slotText.dayText(2026, 10, 22, BAKED), '22 Nov', 'yesterday');
  assert.equal(slotText.dayText(2027, 0, 1, new Date(2026, 11, 31, 22, 0).getTime()), 'Fri', 'into the new year');
});

test('a moment\'s date names its month in three letters, every month of the year', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  months.forEach((name, m) => assert.equal(slotText.momentText(new Date(2027, m, 5, 10, 0).getTime(), BAKED, {}, 8),
    '5 ' + name));
});

// The sun and moon slots worked out on the phone (sky-slots.js) print through these.
const SLOT_TEXT = require.resolve('../../../src/pkjs/status-bars/domain/slot-text.js');
const EDGE = catalog.CAPS.EDGE_TEXT_MAX;
const MID = catalog.CAPS.MID_TEXT_MAX;

test('Day length prints hours and minutes: 24h when the sun never sets, 0h when it never rises', () => {
  assert.deepEqual([698, 490, 485, 60, 1439, 1440, 0].map(slotText.dayLengthText),
    ['11h38', '8h10', '8h05', '1h00', '23h59', '24h', '0h']);
});

test('every moon phase has its name and a short form that fits an edge slot', () => {
  assert.deepEqual(slotText.MOON_NAMES.map((n) => n.short),
    ['New', 'Wax cres', '1st qtr', 'Wax gib', 'Full', 'Wan gib', 'Last qtr', 'Wan cres']);
  assert.deepEqual(slotText.MOON_NAMES.map((n) => n.full),
    ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous',
      'Last quarter', 'Waning crescent']);
  slotText.MOON_NAMES.forEach((n) => {
    assert.ok(Buffer.byteLength(n.short) <= EDGE, n.short);
    assert.ok(Buffer.byteLength(n.full) <= MID, n.full);
  });
});

test('the Moon phase prints the short name by default, and under Full the name where the slot holds it', () => {
  const NOW = Date.UTC(2026, 10, 28, 12);
  const moon = (phase) => ({ phase: phase, lit: 0.89, fullDay: new Date(2026, 11, 24) });
  assert.equal(slotText.moonText(moon(5), {}, EDGE, NOW), 'Wan gib');
  assert.equal(slotText.moonText(moon(5), {}, MID, NOW), 'Wan gib', 'Short in every slot');
  const full = { moonSlotName: 'full' };
  assert.equal(slotText.moonText(moon(5), full, MID, NOW), 'Waning gibbous');
  assert.equal(slotText.moonText(moon(5), full, EDGE, NOW), 'Wan gib', 'an edge has no room for it');
  assert.equal(slotText.moonText(moon(0), full, EDGE, NOW), 'New moon', 'a name that fits an edge');
  assert.equal(slotText.moonText(moon(4), full, EDGE, NOW), 'Full', 'Full moon is 9 bytes');
  assert.equal(slotText.moonText(moon(5), { moonSlotLook: 'text' }, EDGE, NOW), 'Wan gib');
  // The Icon look draws tonight's moon alone, whatever it is set to show.
  assert.equal(slotText.moonText(moon(5), { moonSlotLook: 'icon', moonSlotShows: 'lit' }, MID, NOW), '');
  // Anything unknown reads as the defaults.
  assert.equal(slotText.moonText(moon(5), { moonSlotLook: 'x', moonSlotShows: 'y', moonSlotName: 'z' }, MID, NOW),
    'Wan gib');
  assert.deepEqual([slotText.moonLook(null), slotText.moonShows(null), slotText.moonName(null)],
    ['both', 'phase', 'short']);
});

test('how much of the moon is lit prints as a share, with lit after it in the Text look', () => {
  const NOW = Date.UTC(2026, 10, 28, 12);
  const at = (lit) => ({ phase: 5, lit: lit, fullDay: new Date(2026, 11, 24) });
  const lit = { moonSlotShows: 'lit' };
  const litText = { moonSlotShows: 'lit', moonSlotLook: 'text' };
  assert.equal(slotText.moonText(at(0.89), lit, EDGE, NOW), '89%');
  assert.equal(slotText.moonText(at(0.886), lit, MID, NOW), '89%');
  assert.equal(slotText.moonText(at(0.89), litText, EDGE, NOW), '89% lit');
  assert.equal(slotText.moonText(at(1), litText, EDGE, NOW), '100% lit', 'eight bytes: still an edge\'s');
  assert.equal(slotText.moonText(at(0.004), lit, EDGE, NOW), '0%');
});

test('the next full moon prints its day: Today, a weekday in the coming week, else its date; Full where there is room', () => {
  const got = inZone('Europe/Berlin', { slotText: SLOT_TEXT }, ({ slotText }) => {
    const now = new Date(2026, 10, 28, 12).getTime();
    const texts = (day) => {
      const moon = { phase: 5, lit: 0.89, fullDay: day };
      return [
        slotText.moonText(moon, { moonSlotShows: 'full' }, 8, now),
        slotText.moonText(moon, { moonSlotShows: 'full' }, 19, now),
        slotText.moonText(moon, { moonSlotShows: 'full', moonSlotLook: 'text' }, 8, now)
      ];
    };
    return [texts(new Date(2026, 11, 24)), texts(new Date(2026, 11, 1)), texts(new Date(2026, 10, 28))];
  });
  assert.deepEqual(got, [
    // An edge beside the full moon's picture, the middle slot, an edge in the Text look.
    ['24 Dec', 'Full 24 Dec', '24 Dec'],
    ['Tue', 'Full Tue', 'Full Tue'],
    ['Today', 'Full today', 'Today']
  ]);
});

test('Dawn/dusk prints its clock time to the minute, with its day when it is a day or more ahead', () => {
  const got = inZone('Europe/Berlin', { slotText: SLOT_TEXT }, ({ slotText }) => {
    const now = new Date(2026, 10, 28, 12).getTime();
    const at = (d, h, m, s) => new Date(2026, 10, d, h, m, s);
    const h12 = { axisTimeFormat: '12h', timeShowAmPm: true };
    return [
      slotText.twilightText(at(28, 16, 40, 19), now, {}, 8),
      slotText.twilightText(at(29, 7, 12, 36), now, {}, 8),
      slotText.twilightText(at(28, 16, 40, 19), now, h12, 8),
      // 23 h 59 min ahead: still the clock alone, as the next one cannot be another.
      slotText.twilightText(at(29, 11, 59, 0), now, {}, 8),
      // A day ahead and more, as far north: its day too.
      slotText.twilightText(at(29, 12, 0, 0), now, {}, 19),
      slotText.twilightText(at(29, 18, 0, 0), now, {}, 8),
      slotText.twilightText(null, now, {}, 8)
    ];
  });
  assert.deepEqual(got, ['16:40', '7:13', '4:40p', '11:59', 'Sun 12:00', 'Su 18:00', '--']);
});
