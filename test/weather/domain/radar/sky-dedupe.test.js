// test/weather/domain/radar/sky-dedupe.test.js
//
// The outbox's comparator for the radar's sky rows (sky-dedupe.js, the 'sky' category of
// wire/domain/weather-categories.js). A sky starts on the quarter hour holding the radar's
// slot 0, so a new one is built every quarter hour whatever the weather does; the one the
// watch holds still draws the window (the blob's start is absolute) as long as it reaches
// far enough. These pin when a candidate may stay on the phone.
const test = require('node:test');
const assert = require('node:assert/strict');

const radarSky = require('../../../../src/pkjs/weather/domain/radar/radar-sky.js');
const skyDedupe = require('../../../../src/pkjs/weather/domain/radar/sky-dedupe.js');
const WEATHER_CATEGORIES = require('../../../../src/pkjs/wire/domain/weather-categories.js');

const Q = radarSky.SLOT_SECONDS;
const N = radarSky.NUM_SLOTS;
// A half-hour refresh boundary (radar-sky.js REFRESH_SECONDS: the sky is asked once per
// UTC half hour).
const HALF = Math.floor(1790200800 / radarSky.REFRESH_SECONDS) * radarSky.REFRESH_SECONDS;

/**
 * Weather that holds still: each absolute quarter hour has its own cloud, sun and bolt,
 * whichever sky it is read into.
 * @param {number} t A quarter hour's start, epoch seconds.
 * @returns {{cloud: number, sun: number, bolt: boolean}} That quarter hour's sky.
 */
function steadyAt(t) {
  const i = (t - HALF) / Q;
  return { cloud: [0, 62, 125, 187, 250][(i % 5 + 5) % 5], sun: [250, 187][(i % 2 + 2) % 2], bolt: i === 4 };
}

/**
 * A packed sky of `n` slots from `start`, each slot from `at` (steadyAt by default).
 * @param {number} start First slot's start.
 * @param {Object} [opts] {n, at}.
 * @returns {{RADAR_SKY_UINT8: number[]}} The category subset.
 */
function sky(start, opts) {
  opts = opts || {};
  const n = opts.n || N;
  const at = opts.at || steadyAt;
  const slots = [];
  for (let k = 0; k < n; k += 1) { slots.push(at(start + k * Q)); }
  return { RADAR_SKY_UINT8: radarSky.packSky({ start: start,
    clouds: slots.map((s) => s.cloud), suns: slots.map((s) => s.sun), bolts: slots.map((s) => s.bolt) }) };
}

const changed = skyDedupe.skyComparator;

test('the sky category is compared by skyComparator, not byte for byte', () => {
  const category = WEATHER_CATEGORIES.filter((c) => c.name === 'sky')[0];
  assert.equal(category.comparator, skyDedupe.skyComparator);
});

test('nothing sent yet: the sky goes out', () => {
  assert.equal(changed(sky(HALF), null), true);
});

test('the same sky again (a re-served half hour) stays on the phone', () => {
  assert.equal(changed(sky(HALF), sky(HALF)), false);
  assert.equal(changed(sky(HALF + Q), sky(HALF + Q)), false);
});

test('a slot that changed inside the window goes out', () => {
  const wetter = (t) => (t === HALF + 3 * Q ? { cloud: 250, sun: 0, bolt: false } : steadyAt(t));
  assert.equal(changed(sky(HALF, { at: wetter }), sky(HALF)), true);
});

test('a bolt that moved goes out', () => {
  const bolt = (t) => Object.assign({}, steadyAt(t), { bolt: t === HALF + 5 * Q });
  assert.equal(changed(sky(HALF, { at: bolt }), sky(HALF)), true);
});

test('a quarter hour on, inside the same half hour, the sky the watch holds still covers it: no send', () => {
  // Built at :15 the candidate starts a slot later; the one sent at :00 holds every quarter
  // hour the window reaches before the :30 refresh (its last radar slot then starts at :25).
  assert.equal(changed(sky(HALF + Q), sky(HALF)), false);
});

test('...unless a slot it still has to show changed since', () => {
  const later = (t) => (t === HALF + 9 * Q ? { cloud: 0, sun: 0, bolt: true } : steadyAt(t));
  assert.equal(changed(sky(HALF + Q, { at: later }), sky(HALF)), true);
});

test('on the half hour the sky the watch holds would run out before the next refresh: it goes out', () => {
  // The :30 candidate must last until :60, which needs one slot more than the :00 sky has
  // past :30 (and the :15 one ends a slot short of that too).
  assert.equal(changed(sky(HALF + 2 * Q), sky(HALF)), true);
  assert.equal(changed(sky(HALF + 2 * Q), sky(HALF + Q)), true);
});

test('a candidate on the half hour must match the last-sent one in every slot, the slack one too', () => {
  const slack = (t) => (t === HALF + (N - 1) * Q ? { cloud: 250, sun: 0, bolt: false } : steadyAt(t));
  assert.equal(changed(sky(HALF, { at: slack }), sky(HALF)), true);
});

test('the clear: a repeat stays, a sky after it and a clear after a sky go out', () => {
  const clear = radarSky.clearSkyTuple();
  assert.equal(changed(clear, clear), false);
  assert.equal(changed(sky(HALF), clear), true);
  assert.equal(changed(clear, sky(HALF)), true);
});

test('a sky that went back in time, or off the quarter-hour grid, goes out', () => {
  assert.equal(changed(sky(HALF), sky(HALF + Q)), true, 'the clock went back');
  assert.equal(changed(sky(HALF + Q), sky(HALF + 60)), true, 'not a whole number of slots');
});

test('a sky an older build sent with one slot less is used while it reaches far enough', () => {
  const nine = sky(HALF + Q, { n: N - 1 });
  assert.equal(changed(sky(HALF + Q), nine), false, 'a :15 window needs nine slots');
  assert.equal(changed(sky(HALF), sky(HALF, { n: N - 1 })), true, 'a :00 one needs ten');
});

test('a blob that does not unpack is compared byte for byte', () => {
  assert.equal(changed({ RADAR_SKY_UINT8: [1, 2, 3] }, { RADAR_SKY_UINT8: [1, 2, 3] }), false);
  assert.equal(changed(sky(HALF), { RADAR_SKY_UINT8: [1, 2, 3] }), true);
});
