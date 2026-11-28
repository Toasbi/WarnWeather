'use strict';
// sky-slots.js: the sun and moon slots worked out on the phone, Dawn/dusk, Day length and Moon
// phase. Their times follow the phone's zone, so the cases run in a child process started in the
// zone (test/helpers/in-zone.js), at the places sun-events.test.js pins.
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const skySlots = require('../../../src/pkjs/status-bars/domain/sky-slots.js');
const { inZone } = require('../../helpers/in-zone.js');

const SKY = require.resolve('../../../src/pkjs/status-bars/domain/sky-slots.js');
const I = catalog.ICONS;
const BERLIN = { lat: 52.52, lon: 13.40 };
const SYDNEY = { lat: -33.87, lon: 151.21 };
const LONGYEARBYEN = { lat: 78.22, lon: 15.65 };
const ALL = ['twilight', 'dayLength', 'moon'];

/**
 * Each slot's text and icon at some local times in a zone.
 * @param {string} zone An IANA zone.
 * @param {?{lat: number, lon: number}} place Where the sky is seen from.
 * @param {string[]} times Local times, 'YYYY-MM-DDTHH:MM'.
 * @param {Object} [settings] The slots' settings.
 * @param {string[]} [codes] The slots shown.
 * @returns {Array<Object<string, string>>} Per time, per code: 'text icon'.
 */
function slotsAt(zone, place, times, settings, codes) {
  return inZone(zone, { sky: SKY }, ({ sky }, { place, times, settings, codes }) => times.map((iso) => {
    const now = new Date(iso);
    const readings = sky.readingsAt(codes, now, place);
    const out = {};
    codes.forEach((code) => {
      out[code] = sky.textOf(code, readings, settings, code === 'moon' ? 19 : 8, now) + ' '
        + sky.iconOf(code, readings, settings);
    });
    return out;
  }), { place, times, settings: settings || {}, codes: codes || ALL });
}

/**
 * The next turn of the given slots at some local times in a zone, as a local time.
 * @param {string} zone An IANA zone.
 * @param {?{lat: number, lon: number}} place Where the sky is seen from.
 * @param {string[]} times Local times.
 * @param {string[]} codes The slots shown.
 * @returns {Array<?string>} 'D HH:MM:SS' local, or null.
 */
function turnsAt(zone, place, times, codes) {
  return inZone(zone, { sky: SKY }, ({ sky }, { place, times, codes }) => times.map((iso) => {
    const now = new Date(iso);
    const turn = sky.turnAt(sky.readingsAt(codes, now, place), now);
    const pad = (n) => (n < 10 ? '0' : '') + n;
    if (turn === null) { return null; }
    const d = new Date(turn);
    return d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }), { place, times, codes });
}

test('Berlin on 28 Nov 2026: the dusk through the day, the dawn through the night, the day\'s length, a waning gibbous', () => {
  assert.deepEqual(slotsAt('Europe/Berlin', BERLIN, ['2026-11-28T12:00', '2026-11-28T20:00']), [
    { twilight: '16:40 ' + I.DUSK, dayLength: '8h10 ' + I.DAY_LENGTH, moon: 'Wan gib ' + I.MOON_WAN_GIB },
    { twilight: '7:13 ' + I.DAWN, dayLength: '8h10 ' + I.DAY_LENGTH, moon: 'Wan gib ' + I.MOON_WAN_GIB }
  ]);
});

test('south of the equator the moon\'s picture is the other way round, and its name the same', () => {
  // 28 Nov 2026 in Sydney: the same waning gibbous, lit on the side the north sees waxing.
  const [got] = slotsAt('Australia/Sydney', SYDNEY, ['2026-11-28T22:00'], {}, ['moon']);
  assert.equal(got.moon, 'Wan gib ' + I.MOON_WAX_GIB);
  // Every phase swaps waxing for waning; new and full moon stay.
  const swapped = inZone('Australia/Sydney', { sky: SKY }, ({ sky }) => {
    const out = [];
    for (let d = 1; d <= 30; d += 1) {
      const now = new Date(2026, 10, d, 22);
      const north = sky.iconOf('moon', sky.readingsAt(['moon'], now, { lat: 1, lon: 151 }), {});
      const south = sky.iconOf('moon', sky.readingsAt(['moon'], now, { lat: -1, lon: 151 }), {});
      out.push([north, south]);
    }
    return out;
  });
  const SWAP = { [I.MOON_NEW]: I.MOON_NEW, [I.MOON_FULL]: I.MOON_FULL, [I.MOON_WAX_CRES]: I.MOON_WAN_CRES,
    [I.MOON_FIRST_QTR]: I.MOON_LAST_QTR, [I.MOON_WAX_GIB]: I.MOON_WAN_GIB, [I.MOON_WAN_GIB]: I.MOON_WAX_GIB,
    [I.MOON_LAST_QTR]: I.MOON_FIRST_QTR, [I.MOON_WAN_CRES]: I.MOON_WAX_CRES };
  swapped.forEach(([north, south]) => assert.equal(south, SWAP[north], north + ' south'));
  assert.equal(new Set(swapped.map(([north]) => north)).size, 8, 'a month shows all eight');
});

test('before a place is known, Dawn/dusk and Day length show -- and the moon shows, drawn as the north sees it', () => {
  assert.deepEqual(slotsAt('Europe/Berlin', null, ['2026-11-28T20:00']), [
    { twilight: '-- ' + I.DUSK, dayLength: '-- ' + I.DAY_LENGTH, moon: 'Wan gib ' + I.MOON_WAN_GIB }
  ]);
});

test('the Moon phase draws by its Look: the full moon beside the full moon\'s day, none in the Text look', () => {
  const at = (settings) => slotsAt('Europe/Berlin', BERLIN, ['2026-11-28T12:00'], settings, ['moon'])[0].moon;
  assert.equal(at({ moonSlotShows: 'full' }), 'Full 24 Dec ' + I.MOON_FULL);
  assert.equal(at({ moonSlotLook: 'text' }), 'Wan gib ' + I.MOON_TEXT);
  assert.equal(at({ moonSlotLook: 'text', moonSlotShows: 'full' }), 'Full 24 Dec ' + I.MOON_TEXT);
  // The Icon look shows tonight's moon alone: Shows does not apply.
  assert.equal(at({ moonSlotLook: 'icon', moonSlotShows: 'full' }), ' ' + I.MOON_WAN_GIB);
  assert.match(at({ moonSlotShows: 'lit' }), new RegExp('^\\d+% ' + I.MOON_WAN_GIB + '$'));
});

test('only the slots shown are worked out', () => {
  const now = new Date(Date.UTC(2026, 10, 28, 12));
  const moonOnly = skySlots.readingsAt(['moon'], now, BERLIN);
  assert.equal(moonOnly.twilight, null);
  assert.equal(moonOnly.dayLength, null);
  assert.equal(moonOnly.moon.phase, 5);
  const sunOnly = skySlots.readingsAt(['twilight', 'dayLength'], now, BERLIN);
  assert.equal(sunOnly.moon, null);
  assert.equal(sunOnly.dayLength, 490);
  assert.equal(sunOnly.twilight.type, 'dusk');
  assert.deepEqual(skySlots.CODES, ALL);
  assert.ok(ALL.every(skySlots.isSky));
  assert.ok(!['sun', 'condition', 'city'].some(skySlots.isSky), 'Sunrise/sunset prints the forecast\'s sun events');
});

test('the next turn: the dawn or dusk shown, midnight for the day length and the moon', () => {
  assert.deepEqual(turnsAt('Europe/Berlin', BERLIN, ['2026-11-28T12:00', '2026-11-28T16:40', '2026-11-28T20:00'],
    ['twilight']), ['28 16:40:19', '28 16:40:19', '29 07:12:36']);
  assert.deepEqual(turnsAt('Europe/Berlin', BERLIN, ['2026-11-28T12:00', '2026-11-28T23:59'], ['moon']),
    ['29 00:00:00', '29 00:00:00']);
  assert.deepEqual(turnsAt('Europe/Berlin', BERLIN, ['2026-11-28T12:00'], ['dayLength']), ['29 00:00:00']);
  // Whichever comes first.
  assert.deepEqual(turnsAt('Europe/Berlin', BERLIN, ['2026-11-28T12:00', '2026-11-28T20:00'], ALL),
    ['28 16:40:19', '29 00:00:00']);
});

test('without a place nothing but the moon turns; with no dawn or dusk in reach Dawn/dusk does not', () => {
  assert.deepEqual(turnsAt('Europe/Berlin', null, ['2026-11-28T12:00'], ['twilight', 'dayLength']), [null]);
  assert.deepEqual(turnsAt('Europe/Berlin', null, ['2026-11-28T12:00'], ALL), ['29 00:00:00']);
  // Longyearbyen in the polar night: no dawn within two days. A fetch's bake finds the first.
  assert.deepEqual(turnsAt('Arctic/Longyearbyen', LONGYEARBYEN, ['2026-12-21T12:00'], ['twilight']), [null]);
});

test('a dawn more than a day ahead turns once it is a day ahead, as its day leaves the text', () => {
  // The polar night's first dawn in Longyearbyen, 31 Jan 2027 at 11:21:13.
  assert.deepEqual(slotsAt('Arctic/Longyearbyen', LONGYEARBYEN, ['2027-01-30T00:00', '2027-01-30T11:22'],
    {}, ['twilight']).map((s) => s.twilight), ['Su 11:21 ' + I.DAWN, '11:21 ' + I.DAWN]);
  assert.deepEqual(turnsAt('Arctic/Longyearbyen', LONGYEARBYEN, ['2027-01-30T00:00', '2027-01-30T11:22'],
    ['twilight']), ['30 11:21:13', '31 11:21:13']);
});
