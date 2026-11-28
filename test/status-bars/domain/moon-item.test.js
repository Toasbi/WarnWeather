'use strict';
// src/pkjs/status-bars/domain/moon-item.js — the moon the On demand Moon phase item shows on a
// day: which days its Show names, Today + tomorrow's day before with the mark, the picture
// mirrored south of the equator, and the turn at local midnight. In Berlin's zone
// (test/helpers/in-zone.js), through November 2026: the new moon on the 9th, the full moon on
// the 24th (test/weather/domain/moon.test.js pins the days).
const test = require('node:test');
const assert = require('node:assert/strict');
const moonItem = require('../../../src/pkjs/status-bars/domain/moon-item.js');
const moon = require('../../../src/pkjs/weather/domain/moon.js');
const platformLib = require('../../../src/pkjs/config-ui/lib/platform.js');
const { inZone } = require('../../helpers/in-zone.js');

const ITEM = require.resolve('../../../src/pkjs/status-bars/domain/moon-item.js');
const PLATFORM = require.resolve('../../../src/pkjs/config-ui/lib/platform.js');
const env = (platform) => platformLib.computeEnv({ platform });
// The item on the Watch bar's right, as a tick there stores it.
const PLACED = { statusTopOnDemandRightItems: 'moon' };
const SYDNEY = { lat: -33.87, lon: 151.21 };
const BERLIN = { lat: 52.52, lon: 13.40 };

/**
 * The item's moon at noon on each of the given November days, in Berlin's zone.
 * @param {Object} settings The settings (merged over PLACED).
 * @param {number[]} days Days of November 2026.
 * @param {?{lat: number, lon: number}} [place] Where the sky is seen from (default Berlin).
 * @param {?string} [platform] The watch's platform (default basalt).
 * @returns {Array<{shown: ?Object, reads: number}>} Per day: the shown moon and how often the
 *   place was read for it.
 */
function shown(settings, days, place, platform) {
  return inZone('Europe/Berlin', { item: ITEM, platform: PLATFORM }, ({ item, platform }, input) => input.days.map((d) => {
    let reads = 0;
    const got = item.shownMoon(input.settings, platform.computeEnv({ platform: input.platform }), new Date(2026, 10, d, 12),
      () => { reads += 1; return input.place; });
    return { shown: got, reads: reads };
  }), { settings: Object.assign({}, PLACED, settings), days, place: place === undefined ? BERLIN : place,
    platform: platform || 'basalt' });
}
const moons = (rows) => rows.map((r) => r.shown);
const today = (picture) => ({ picture, mark: null });

test('placed nowhere, or on a watch without On demand, the item shows no moon and never turns', () => {
  const days = [8, 9, 23, 24];
  assert.deepEqual(moons(shown({ statusTopOnDemandRightItems: '', moonItemShow: 'always' }, days)),
    [null, null, null, null], 'on no bar (the defaults leave it off every bar)');
  assert.deepEqual(moons(shown({ moonItemShow: 'always' }, days, BERLIN, 'aplite')), [null, null, null, null],
    'aplite');
  const now = new Date(2026, 10, 24, 12);
  assert.equal(moonItem.turnAt({ moonItemShow: 'always' }, env('basalt'), now), null);
  assert.equal(moonItem.turnAt(Object.assign({ moonItemShow: 'always' }, PLACED), env('aplite'), now), null);
  assert.equal(moonItem.placed(PLACED, env('basalt')), true);
  assert.equal(moonItem.placed(PLACED, null), true, 'no env: a watch that draws On demand');
  assert.equal(moonItem.CODE, 'moon');
});

test('Show At full moon, the default: the full moon\'s day alone', () => {
  assert.deepEqual(moons(shown({}, [8, 9, 23, 24, 25])), [null, null, null, today(moon.FULL), null]);
});

test('Show At new moon, and At new and full moon: their days alone', () => {
  assert.deepEqual(moons(shown({ moonItemShow: 'new' }, [8, 9, 10, 24])), [null, today(moon.NEW), null, null]);
  assert.deepEqual(moons(shown({ moonItemShow: 'both' }, [8, 9, 10, 23, 24, 25])),
    [null, today(moon.NEW), null, null, today(moon.FULL), null]);
});

test('Today + tomorrow: the day before shows tomorrow\'s moon with the mark; today\'s moon wins', () => {
  assert.deepEqual(moons(shown({ moonItemDays: 'tomorrow' }, [22, 23, 24, 25])),
    [null, { picture: moon.FULL, mark: 'raquo' }, today(moon.FULL), null], 'At full moon, the default mark');
  assert.deepEqual(moons(shown({ moonItemShow: 'new', moonItemDays: 'tomorrow', moonItemNextDayMark: 'star' },
    [7, 8, 9, 23])), [null, { picture: moon.NEW, mark: 'star' }, today(moon.NEW), null],
  'At new moon: the full moon\'s eve shows nothing');
  assert.deepEqual(moons(shown({ moonItemShow: 'both', moonItemDays: 'tomorrow', moonItemNextDayMark: 'none' },
    [8, 23])), [{ picture: moon.NEW, mark: 'none' }, { picture: moon.FULL, mark: 'none' }],
  'At new and full moon, unmarked');
});

test('Always: tonight\'s moon every day; with Today + tomorrow the eve of a full or new moon shows that moon', () => {
  // November 2026 in Berlin: waning crescents to the 8th, the new moon on the 9th, waxing
  // crescents, the first quarter on the 17th, waxing gibbous moons, the full moon on the 24th.
  const days = [3, 8, 9, 12, 17, 20, 23, 24, 27];
  assert.deepEqual(moons(shown({ moonItemShow: 'always' }, days)), [7, 7, 0, 1, 2, 3, 3, 4, 5].map(today));
  assert.deepEqual(moons(shown({ moonItemShow: 'always', moonItemDays: 'tomorrow', moonItemNextDayMark: 'gt' }, days)),
    [today(7), { picture: moon.NEW, mark: 'gt' }, today(0), today(1), today(2), today(3),
      { picture: moon.FULL, mark: 'gt' }, today(4), today(5)],
    'the quarters\' eves keep tonight\'s moon: only a new or full moon is named');
});

test('south of the equator the waxing and waning halves swap; the place is read only for those', () => {
  const always = { moonItemShow: 'always' };
  const south = shown(always, [3, 9, 12, 17, 20, 24], SYDNEY);
  // Seen from the south, a waning crescent (7) looks like the north's waxing one (1), and so on;
  // the new and the full moon look the same everywhere, so their days read no place.
  assert.deepEqual(moons(south), [1, 0, 7, 6, 5, 4].map(today));
  assert.deepEqual(south.map((r) => r.reads), [1, 0, 1, 1, 1, 0]);
  // North, and with no place known yet (drawn as the north sees it).
  assert.deepEqual(moons(shown(always, [3, 12, 20])), [7, 1, 3].map(today));
  assert.deepEqual(moons(shown(always, [3, 12, 20], null)), [7, 1, 3].map(today));
  // Tomorrow's full moon reads no place either.
  assert.deepEqual(shown({ moonItemDays: 'tomorrow' }, [23], SYDNEY),
    [{ shown: { picture: moon.FULL, mark: 'raquo' }, reads: 0 }]);
  // A day the item shows nothing reads no place.
  assert.deepEqual(shown({}, [20], SYDNEY), [{ shown: null, reads: 0 }]);
});

test('turnAt: the next local midnight while the item sits on a bar', () => {
  const got = inZone('Europe/Berlin', { item: ITEM, platform: PLATFORM }, ({ item, platform }, settings) =>
    [new Date(2026, 10, 23, 12), new Date(2026, 10, 23, 23, 59), new Date(2026, 10, 24, 0, 0)].map((now) =>
      new Date(item.turnAt(settings, platform.computeEnv({ platform: 'basalt' }), now)).toString().slice(4, 24)),
  PLACED);
  assert.deepEqual(got, ['Nov 24 2026 00:00:00', 'Nov 24 2026 00:00:00', 'Nov 25 2026 00:00:00']);
});
