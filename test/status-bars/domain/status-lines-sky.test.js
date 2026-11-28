'use strict';
// The sun and moon slots worked out on the phone in a bake (sky-slots.js): Dawn/dusk, Day length
// and Moon phase, phone-baked text with the icon of the sky they show, the place read once and
// only for a bar that shows one; the On demand Moon phase item's moon in the levels word
// (moon-item.js); and skyTurnAt, the next instant one of them changes, at which
// status-rebake.js bakes again between fetches. In Berlin's zone (test/helpers/in-zone.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const statusLines = require('../../../src/pkjs/status-bars/domain/status-lines.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const { inZone } = require('../../helpers/in-zone.js');
const { moonOf } = require('../../helpers/weather-levels.js');
const { NOTHING_PLACED, placedOnly } = require('../../helpers/on-demand.js');

const LINES = require.resolve('../../../src/pkjs/status-bars/domain/status-lines.js');
const BYTES = require.resolve('../../helpers/status-line-bytes.js');
const I = catalog.ICONS;
const TEXT = catalog.KINDS.TEXT;
const BERLIN = { lat: 52.52, lon: 13.40 };
// The Watch bar, which every bake sends.
const WATCH_BAR = { statusTopLeft: 'twilight', statusTopMid: 'moon', statusTopRight: 'dayLength' };

/**
 * Bake in Berlin's zone at a local time and read the Watch bar back.
 * @param {Object} settings The settings.
 * @param {string} platform The watch's platform.
 * @param {?{lat: number, lon: number}} place The sky's place.
 * @param {number} [hour] The local hour of 28 Nov 2026 the bake runs at (default noon).
 * @returns {{slots: Array<Object>, reads: number, turn: ?string, moon: ?number}} The Watch bar's
 *   slots, how often the place was read, the sky's next turn as a local time, and the levels
 *   word's moon bits (moonOf; null without the word).
 */
function bakeInBerlin(settings, platform, place, hour) {
  const got = inZone('Europe/Berlin', { lines: LINES, bytes: BYTES }, ({ lines, bytes }, { settings, platform, place, hour }) => {
    let reads = 0;
    const facts = { sky: { position: () => { reads += 1; return place; } } };
    const now = new Date(2026, 10, 28, hour, 0);
    const payload = { CITY: 'Berlin' };
    lines.buildStatusLines(payload, settings, { platform: platform }, now, facts);
    const baked = reads;
    const turn = lines.skyTurnAt(settings, { platform: platform }, now, facts);
    const levels = payload.STATUS_LEVELS_UINT8;
    return { slots: bytes.decodeLine(payload.STATUS_LINE_3_UINT8), reads: baked,
      turn: turn === null ? null : new Date(turn).toTimeString().slice(0, 8),
      levels: levels ? Array.from(levels) : null };
  }, { settings, platform, place, hour: hour === undefined ? 12 : hour });
  return { slots: got.slots, reads: got.reads, turn: got.turn, moon: got.levels ? moonOf(got.levels) : null };
}

test('a bar bakes Dawn/dusk, the Moon phase and Day length from the clock and the place', () => {
  const got = bakeInBerlin(WATCH_BAR, 'basalt', BERLIN);
  assert.deepEqual(got.slots, [
    { kind: TEXT, icon: I.DUSK, text: '16:40' },
    { kind: TEXT, icon: I.MOON_WAN_GIB, text: 'Wan gib' },
    { kind: TEXT, icon: I.DAY_LENGTH, text: '8h10' }
  ]);
  assert.equal(got.reads, 1, 'the place is read once for the bake');
  assert.equal(got.turn, '16:40:19', 'the dusk turns them first');
});

test('the slots\' settings reach the bake: the moon\'s Look and Shows', () => {
  const got = bakeInBerlin(Object.assign({}, WATCH_BAR, { moonSlotLook: 'text', moonSlotShows: 'full' }),
    'basalt', BERLIN);
  assert.deepEqual(got.slots[1], { kind: TEXT, icon: I.MOON_TEXT, text: 'Full 24 Dec' });
});

test('with no place yet the moon still shows; Dawn/dusk and Day length wait with --', () => {
  const got = bakeInBerlin(WATCH_BAR, 'emery', null);
  assert.deepEqual(got.slots.map((s) => [s.icon, s.text]),
    [[I.DUSK, '--'], [I.MOON_WAN_GIB, 'Wan gib'], [I.DAY_LENGTH, '--']]);
  assert.equal(got.turn, '00:00:00', 'the moon turns at midnight');
});

test('a bake with no sun and moon slot reads no place and has no sky turn', () => {
  const got = bakeInBerlin({ statusTopLeft: 'temp', statusTopMid: 'city', statusTopRight: 'sun' }, 'basalt', BERLIN);
  assert.equal(got.reads, 0);
  assert.equal(got.turn, null);
  // Nor one where the slots sit on a bar no screen shows: no line is sent for it.
  const unseen = bakeInBerlin({ statusBar4Left: 'moon', statusBar4Mid: 'twilight' }, 'emery', BERLIN);
  assert.equal(unseen.reads, 0);
  assert.equal(unseen.turn, null);
});

test('aplite has none of the three: its slots bake empty and nothing turns', () => {
  const got = bakeInBerlin(WATCH_BAR, 'aplite', BERLIN);
  assert.deepEqual(got.slots.map((s) => s.kind), [catalog.KINDS.EMPTY, catalog.KINDS.EMPTY, catalog.KINDS.EMPTY]);
  assert.equal(got.reads, 0);
  assert.equal(got.turn, null);
});

test('skyTurnAt without settings, or without the sky\'s facts, still answers', () => {
  const now = new Date(Date.UTC(2026, 10, 28, 12));
  assert.equal(statusLines.skyTurnAt(null, { platform: 'basalt' }, now, null), null);
  // No facts: no place, so only the moon turns, at the phone's midnight.
  const turn = statusLines.skyTurnAt(WATCH_BAR, { platform: 'basalt' }, now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  assert.equal(turn, midnight);
});

// --- the On demand Moon phase item: its moon in the levels word ---------------------------
// 28 Nov 2026, noon in Berlin: a waning gibbous moon (phase 5), the full moon four days gone.
const ITEM_ALWAYS = placedOnly('moon', { moonItemShow: 'always' });
const PLAIN_BAR = { statusTopLeft: 'temp', statusTopMid: 'city', statusTopRight: 'sun' };

test('the On demand Moon phase rides the levels word, the place read once with the slots', () => {
  const got = bakeInBerlin(Object.assign({}, WATCH_BAR, ITEM_ALWAYS), 'basalt', BERLIN);
  assert.equal(got.moon, 1 + 5, 'today\'s waning gibbous, unmarked');
  assert.equal(got.reads, 1, 'one read for the slots and the item');
  assert.equal(got.turn, '16:40:19', 'the dusk still turns first');
});

test('the item alone reads the place for its picture and turns at midnight', () => {
  const north = bakeInBerlin(Object.assign({}, PLAIN_BAR, ITEM_ALWAYS), 'basalt', BERLIN);
  assert.deepEqual([north.moon, north.reads, north.turn], [1 + 5, 1, '00:00:00']);
  // Seen from the south the waning gibbous looks like the north's waxing one (3).
  const south = bakeInBerlin(Object.assign({}, PLAIN_BAR, ITEM_ALWAYS), 'basalt', { lat: -33.87, lon: 151.21 });
  assert.equal(south.moon, 1 + 3);
  // At full moon, the default, today shows nothing and reads no place; the item still turns at
  // midnight, when the day may bring one.
  const full = bakeInBerlin(Object.assign({}, PLAIN_BAR, placedOnly('moon')), 'emery', BERLIN);
  assert.deepEqual([full.moon, full.reads, full.turn], [0, 0, '00:00:00']);
});

test('after dusk the item\'s midnight comes before the next dawn', () => {
  const dawnOnly = { statusTopLeft: 'twilight', statusTopMid: 'city', statusTopRight: 'temp' };
  assert.equal(bakeInBerlin(dawnOnly, 'basalt', BERLIN, 20).turn, '07:12:36', 'the slot alone: the dawn');
  assert.equal(bakeInBerlin(Object.assign({}, dawnOnly, ITEM_ALWAYS), 'basalt', BERLIN, 20).turn, '00:00:00');
});

test('placed on no bar the item adds no bits and no turn; aplite has no levels word at all', () => {
  const none = bakeInBerlin(Object.assign({}, PLAIN_BAR, NOTHING_PLACED, { moonItemShow: 'always' }), 'basalt', BERLIN);
  assert.deepEqual([none.moon, none.reads, none.turn], [0, 0, null]);
  const aplite = bakeInBerlin(Object.assign({}, PLAIN_BAR, ITEM_ALWAYS), 'aplite', BERLIN);
  assert.deepEqual([aplite.moon, aplite.reads, aplite.turn], [null, 0, null]);
});
