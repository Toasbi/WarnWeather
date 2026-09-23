// test/sun-events.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickNext24hSunEvents } = require('../src/pkjs/weather/sun-events');

test('keeps only future events and caps at two', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  const events = [
    { type: 'sunrise', date: new Date('2026-06-19T05:00:00Z') }, // past
    { type: 'sunset',  date: new Date('2026-06-19T21:00:00Z') }, // future
    { type: 'sunrise', date: new Date('2026-06-20T05:00:00Z') }, // future
    { type: 'sunset',  date: new Date('2026-06-20T21:00:00Z') }  // future (dropped, >2)
  ];
  const out = pickNext24hSunEvents(events, now);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'sunset');
  assert.equal(out[1].type, 'sunrise');
});

test('returns fewer than two when only one is future', () => {
  const now = new Date('2026-06-19T22:00:00Z');
  const events = [
    { type: 'sunset', date: new Date('2026-06-19T21:00:00Z') },
    { type: 'sunrise', date: new Date('2026-06-20T05:00:00Z') }
  ];
  assert.deepEqual(pickNext24hSunEvents(events, now).map(function(e){return e.type;}), ['sunrise']);
});

// ---------------------------------------------------------------------------
// nextSunEvents: always a pair the watch can use, including at polar latitudes.
// ---------------------------------------------------------------------------
const SunCalc = require('suncalc');
const sunEvents = require('../src/pkjs/weather/sun-events');

const DAY_S = 86400;
const SUNRISE_ALT = -0.833 * Math.PI / 180;
const TROMSO = [69.65, 18.96];
const BERLIN = [52.52, 13.40];

/**
 * JS twin of forecast_layer.c: get_valid_sun_events + compute_night_segments.
 * The watch repeats the pair a day either side, sorts the six events and
 * shades every sunset -> sunrise span (at most three).
 * @param {{type: string, date: Date}[]} pair The two SUN_EVENTS events.
 * @returns {number[][]} Night spans [start, end] in epoch seconds.
 */
function watchNightSegments(pair) {
  const st = pair[0].type === 'sunrise' ? 0 : 1;
  const t0 = Math.trunc(pair[0].date.getTime() / 1000);
  const t1 = Math.trunc(pair[1].date.getTime() / 1000);
  if (t0 <= 0 || t1 <= 0 || t1 <= t0) { return []; }
  const events = [];
  for (let k = -1; k <= 1; k += 1) {
    events.push({ ts: t0 + k * DAY_S, type: st }, { ts: t1 + k * DAY_S, type: 1 - st });
  }
  events.sort((a, b) => a.ts - b.ts);
  const segments = [];
  for (let i = 0; i < events.length - 1 && segments.length < 3; i += 1) {
    if (events[i].type === 1 && events[i + 1].type === 0 && events[i + 1].ts > events[i].ts) {
      segments.push([events[i].ts, events[i + 1].ts]);
    }
  }
  return segments;
}

/**
 * Minutes of the 23 h chart starting at the fetch's hour where the watch's
 * shading disagrees with the sun (below -0.833 deg = night).
 * @param {Date} now Fetch time.
 * @param {number[]} coords [lat, lon].
 * @param {number} [stepMin] Sampling step in minutes.
 * @returns {{wrong: number, shaded: number}} Disagreeing / shaded minutes.
 */
function chartShading(now, coords, stepMin) {
  const step = (stepMin || 5) * 60;
  const nowS = Math.floor(now.getTime() / 1000);
  const start = nowS - (nowS % 3600);
  const segments = watchNightSegments(sunEvents.nextSunEvents(now, coords[0], coords[1]));
  let wrong = 0;
  let shaded = 0;
  for (let t = start; t < start + 23 * 3600; t += step) {
    const isShaded = segments.some((s) => t >= s[0] && t < s[1]);
    const isNight = SunCalc.getPosition(new Date(t * 1000), coords[0], coords[1]).altitude < SUNRISE_ALT;
    if (isShaded) { shaded += step / 60; }
    if (isShaded !== isNight) { wrong += step / 60; }
  }
  return { wrong: wrong, shaded: shaded };
}

function types(pair) { return pair.map((e) => e.type); }

test('midnight sun: a sunrise-then-sunset pair that shades none of the chart', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const pair = sunEvents.nextSunEvents(now, TROMSO[0], TROMSO[1]);
  assert.deepEqual(types(pair), ['sunrise', 'sunset']);
  assert.equal(pair[0].date.toISOString(), '2026-06-19T00:00:00.000Z', 'two days before today (UTC)');
  assert.equal(pair[1].date.toISOString(), '2026-06-24T00:00:00.000Z', 'three days after');
  assert.deepEqual(chartShading(now, TROMSO), { wrong: 0, shaded: 0 });
});

test('polar night: a sunset-then-sunrise pair that shades the whole chart', () => {
  const now = new Date('2026-12-15T12:00:00Z');
  const pair = sunEvents.nextSunEvents(now, TROMSO[0], TROMSO[1]);
  assert.deepEqual(types(pair), ['sunset', 'sunrise']);
  assert.deepEqual(chartShading(now, TROMSO), { wrong: 0, shaded: 23 * 60 });
});

test('the polar pair changes once a UTC day, not every fetch', () => {
  const key = (iso) => sunEvents.nextSunEvents(new Date(iso), TROMSO[0], TROMSO[1])
    .map((e) => e.date.getTime()).join();
  assert.equal(key('2026-06-21T00:10:00Z'), key('2026-06-21T23:50:00Z'));
  assert.notEqual(key('2026-06-21T23:50:00Z'), key('2026-06-22T00:10:00Z'));
});

test('the last short night before polar day: classified by the coming noon, not the sun now', () => {
  // 69.5N: no sunrise or sunset today or tomorrow, and the sun sits just below
  // the horizon at the fetch. Judging by `now` would shade the whole chart.
  const now = new Date('2026-05-18T22:30:00Z');
  const coords = [69.5, 18.96];
  assert.ok(SunCalc.getPosition(now, coords[0], coords[1]).altitude < SUNRISE_ALT);
  const pair = sunEvents.nextSunEvents(now, coords[0], coords[1]);
  assert.deepEqual(types(pair), ['sunrise', 'sunset'], 'polar day');
  assert.equal(chartShading(now, coords).shaded, 0);
});

test('the last day before polar night: the lone sunset gets a mirrored sunrise under a day later', () => {
  const now = new Date('2026-11-27T10:17:00Z');
  const pair = sunEvents.nextSunEvents(now, TROMSO[0], TROMSO[1]);
  assert.deepEqual(types(pair), ['sunset', 'sunrise']);
  const lone = pickNext24hSunEvents(sunEvents.sunCalcSunEvents(now, TROMSO[0], TROMSO[1]), now);
  assert.equal(lone.length, 1, 'tomorrow has no sunrise or sunset');
  assert.equal(pair[0].date.getTime(), lone[0].date.getTime(), 'the real sunset stays first (the sun slot shows it)');
  const gap = pair[1].date - pair[0].date;
  assert.ok(gap > 0 && gap < DAY_S * 1000, 'ordered and under a day apart, like any real pair');
  assert.ok(chartShading(now, TROMSO).wrong <= 15, 'day until the sunset, night after it');
});

test('a lone sunset ~12 h after noon mirrors about its own night, not the next day\'s', () => {
  // 65.75N 90E, the edge of midnight sun: SunCalc rounds this sunset to the
  // NEXT day's solar noon. The partner must still be the sunrise minutes later.
  const now = new Date('2026-06-19T09:00:00Z');
  const pair = sunEvents.nextSunEvents(now, 65.75, 90);
  assert.deepEqual(types(pair), ['sunset', 'sunrise']);
  assert.equal(pair[0].date.toISOString(), '2026-06-19T18:02:02.109Z');
  const gap = pair[1].date - pair[0].date;
  assert.ok(gap > 0 && gap < 3600 * 1000, 'a brief night, not two days: ' + gap / 60000 + ' min');
});

test('mirroredSunEvent reproduces an ordinary day\'s partner within minutes', () => {
  const now = new Date('2026-06-21T00:00:00Z');
  const real = sunEvents.sunCalcSunEvents(now, BERLIN[0], BERLIN[1]); // rise, set, rise, set
  const fromSunrise = sunEvents.mirroredSunEvent(real[0], BERLIN[0], BERLIN[1]);
  const fromSunset = sunEvents.mirroredSunEvent(real[1], BERLIN[0], BERLIN[1]);
  assert.equal(fromSunrise.type, 'sunset');
  assert.ok(Math.abs(fromSunrise.date - real[1].date) < 5 * 60 * 1000, 'the same day\'s sunset');
  assert.equal(fromSunset.type, 'sunrise');
  assert.ok(Math.abs(fromSunset.date - real[2].date) < 5 * 60 * 1000, 'the next morning\'s sunrise');
});

test('the day before polar night ends: a first sunrise over a day away gets the polar pair', () => {
  // Tomorrow's sunrise is the first of the season, ~34 h out. Sent as is, the
  // watch would repeat it only a day back and leave half the chart as day.
  const now = new Date('2026-01-14T00:17:00Z');
  const upcoming = pickNext24hSunEvents(sunEvents.sunCalcSunEvents(now, TROMSO[0], TROMSO[1]), now);
  assert.equal(upcoming.length, 2);
  assert.ok(upcoming[0].date - now > DAY_S * 1000);
  assert.deepEqual(types(sunEvents.nextSunEvents(now, TROMSO[0], TROMSO[1])), ['sunset', 'sunrise']);
  assert.deepEqual(chartShading(now, TROMSO), { wrong: 0, shaded: 23 * 60 });
});

test('ordinary latitudes keep the next two real events', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  assert.deepEqual(sunEvents.nextSunEvents(now, BERLIN[0], BERLIN[1]),
    pickNext24hSunEvents(sunEvents.sunCalcSunEvents(now, BERLIN[0], BERLIN[1]), now));
});

test('a provider\'s own candidates win when they hold two upcoming events', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const own = [
    { type: 'sunrise', date: new Date('2026-06-21T02:43:00Z') },
    { type: 'sunset', date: new Date('2026-06-21T19:33:00Z') },
    { type: 'sunrise', date: new Date('2026-06-22T02:43:00Z') },
    { type: 'sunset', date: new Date('2026-06-22T19:33:00Z') }
  ];
  assert.deepEqual(sunEvents.nextSunEvents(now, BERLIN[0], BERLIN[1], own), own.slice(1, 3));
});

test('candidates with no dates (OWM in polar periods) fall back to SunCalc', () => {
  const zeros = [
    { type: 'sunrise', date: new Date(0) }, { type: 'sunset', date: new Date(0) },
    { type: 'sunrise', date: new Date(NaN) }, { type: 'sunset', date: new Date(NaN) }
  ];
  const now = new Date('2026-06-21T12:00:00Z');
  assert.deepEqual(sunEvents.nextSunEvents(now, TROMSO[0], TROMSO[1], zeros),
    sunEvents.nextSunEvents(now, TROMSO[0], TROMSO[1]), 'the polar pair');
  assert.deepEqual(sunEvents.nextSunEvents(now, BERLIN[0], BERLIN[1], zeros),
    sunEvents.nextSunEvents(now, BERLIN[0], BERLIN[1]), 'a glitch elsewhere still gets real times');
});

// Around polar day/night a provider's daily list can hold a sunrise without
// its sunset (or the reverse), or a sunset listed after the same day's
// sunrise although it came first. The next two upcoming events are then no
// pair the watch can use: it takes the second's type as the opposite of the
// first's, rejects an out-of-order pair, and repeats the pair only a day
// either side.
test('provider candidates that make no usable pair fall back to SunCalc', () => {
  const at = (iso) => new Date(iso);
  const coords = [66.6, 25.7];
  const now = at('2026-06-20T00:30:00Z');
  const shapes = {
    'two sunrises (a day with no sunset)': [
      { type: 'sunrise', date: at('2026-06-20T01:00:00Z') }, { type: 'sunset', date: new Date(0) },
      { type: 'sunrise', date: at('2026-06-21T00:55:00Z') }, { type: 'sunset', date: at('2026-06-21T23:10:00Z') }
    ],
    'out of order (a sunset after midnight listed second)': [
      { type: 'sunrise', date: at('2026-06-20T01:55:00Z') }, { type: 'sunset', date: at('2026-06-20T00:50:00Z') },
      { type: 'sunrise', date: at('2026-06-21T01:57:00Z') }, { type: 'sunset', date: at('2026-06-21T00:49:00Z') }
    ],
    'two days apart (a sunrise, then the sunset of the next day)': [
      { type: 'sunrise', date: at('2026-06-20T01:00:00Z') }, { type: 'sunset', date: new Date(0) },
      { type: 'sunrise', date: new Date(0) }, { type: 'sunset', date: at('2026-06-21T23:30:00Z') }
    ]
  };
  const fromSunCalc = sunEvents.nextSunEvents(now, coords[0], coords[1]);
  Object.keys(shapes).forEach((name) => {
    assert.equal(pickNext24hSunEvents(shapes[name], now).length, 2, name + ': two upcoming events');
    assert.deepEqual(sunEvents.nextSunEvents(now, coords[0], coords[1], shapes[name]), fromSunCalc, name);
  });
});

test('isPolarSunPair tells the polar pair from any real one', () => {
  assert.equal(sunEvents.isPolarSunPair(0, 5 * DAY_S), true);
  assert.equal(sunEvents.isPolarSunPair(0, DAY_S + 3600), false, 'a real pair near the polar edge');
  assert.equal(sunEvents.isPolarSunPair(0, 2 * DAY_S), false);
});

test('a year at polar and ordinary latitudes: always a pair the watch accepts, shading within 90 min', () => {
  const places = { Tromso: TROMSO, Longyearbyen: [78.22, 15.65], McMurdo: [-77.85, 166.67], Berlin: BERLIN };
  const start = Date.UTC(2026, 0, 1, 0, 17);
  Object.keys(places).forEach((name) => {
    const coords = places[name];
    // Every 7 h, so the fetch hour walks round the clock through the year.
    for (let t = start; t < start + 365 * DAY_S * 1000; t += 7 * 3600 * 1000) {
      const now = new Date(t);
      const pair = sunEvents.nextSunEvents(now, coords[0], coords[1]);
      const where = name + ' ' + now.toISOString();
      assert.equal(pair.length, 2, where);
      assert.ok(pair.every(sunEvents.isValidSunEvent), where);
      assert.notEqual(pair[0].type, pair[1].type, where);
      const t0 = pair[0].date.getTime() / 1000;
      const t1 = pair[1].date.getTime() / 1000;
      assert.ok(t0 > 0 && t1 > t0, where + ': get_valid_sun_events would reject it');
      assert.ok(t1 - t0 < DAY_S || sunEvents.isPolarSunPair(t0, t1), where + ': neither real nor polar');
      assert.ok(chartShading(now, coords, 10).wrong <= 90, where + ': shading off by more than 90 min');
    }
  });
});
