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
 * JS twin of forecast_night.h: get_valid_sun_events + compute_night_segments.
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

// ---------------------------------------------------------------------------
// Emery's forecast span (forecast-span.js): 14, 24 (26 with no left axis) or the long span's 68
// hours. The watch repeats the pair a day back and up to two days on, keeps only the nights its
// chart meets (at most FORECAST_NIGHTS_MAX = 4), and shades from the last sunset listed to the
// graph's end (forecast_night.h compute_night_segments, the PBL_PLATFORM_EMERY arm); the
// polar pair reaches a day further past 24 h (26 and 48) and two at 68.
// ---------------------------------------------------------------------------
const EMERY_NIGHTS_MAX = 4;

/**
 * JS twin of forecast_night.h's emery arm: offsets -1..2, the nights the graph meets, at most
 * four, then the trailing close from the last sunset listed to the graph's end.
 * @param {{type: string, date: Date}[]} pair The two SUN_EVENTS events.
 * @param {number} gstart Graph start, epoch seconds.
 * @param {number} gend Graph end, epoch seconds.
 * @returns {number[][]} Night spans [start, end] in epoch seconds.
 */
function emeryNightSegments(pair, gstart, gend) {
  const st = pair[0].type === 'sunrise' ? 0 : 1;
  const t0 = Math.trunc(pair[0].date.getTime() / 1000);
  const t1 = Math.trunc(pair[1].date.getTime() / 1000);
  if (t0 <= 0 || t1 <= 0 || t1 <= t0) { return []; }
  return nightsOver([t0, t1], st, gstart, gend, -1, 2, true, EMERY_NIGHTS_MAX);
}

/**
 * The night rule over a pair repeated on day offsets lo..hi: the twin's (-1..2, trailing close,
 * four slots) or, repeated over many days with no cap, the reference it stands in for.
 * @param {number[]} times The pair's epoch seconds.
 * @param {number} type0 The first event's type (1 = sunset).
 * @param {number} gstart Graph start, epoch seconds.
 * @param {number} gend Graph end, epoch seconds.
 * @param {number} lo First day offset.
 * @param {number} hi Last day offset.
 * @param {boolean} trailing Whether the last sunset listed closes at the graph's end.
 * @param {number} cap Night slots.
 * @returns {number[][]} Night spans [start, end] in epoch seconds.
 */
function nightsOver(times, type0, gstart, gend, lo, hi, trailing, cap) {
  const events = [];
  for (let k = lo; k <= hi; k += 1) {
    events.push({ ts: times[0] + k * DAY_S, type: type0 }, { ts: times[1] + k * DAY_S, type: 1 - type0 });
  }
  events.sort((a, b) => a.ts - b.ts);
  const segments = [];
  const add = (a, b) => { if (segments.length < cap && b > a) { segments.push([a, b]); } };
  for (let i = 0; i < events.length - 1; i += 1) {
    if (events[i].type !== 1 || events[i + 1].type !== 0) { continue; }
    if (events[i + 1].ts <= gstart || events[i].ts >= gend) { continue; }
    add(events[i].ts, events[i + 1].ts);
  }
  if (trailing && events[events.length - 1].type === 1) { add(events[events.length - 1].ts, gend); }
  return segments;
}

/**
 * Minutes of an `hours`-entry chart (the shading runs on through the last hour's column)
 * where emery's shading disagrees with the sun.
 * @param {Date} now Fetch time.
 * @param {number[]} coords [lat, lon].
 * @param {number} hours The hours sent (48 here for a short feed, 68 for the long span).
 * @returns {{wrong: number, shaded: number}} Disagreeing / shaded minutes.
 */
function emeryChartShading(now, coords, hours) {
  const step = 5 * 60;
  const nowS = Math.floor(now.getTime() / 1000);
  const start = nowS - (nowS % 3600);
  const end = start + hours * 3600;
  const segments = emeryNightSegments(sunEvents.nextSunEvents(now, coords[0], coords[1], undefined, hours),
    start, end);
  let wrong = 0;
  let shaded = 0;
  for (let t = start; t < end; t += step) {
    const isShaded = segments.some((s) => t >= s[0] && t < s[1]);
    const isNight = SunCalc.getPosition(new Date(t * 1000), coords[0], coords[1]).altitude < SUNRISE_ALT;
    if (isShaded) { shaded += step / 60; }
    if (isShaded !== isNight) { wrong += step / 60; }
  }
  return { wrong: wrong, shaded: shaded };
}

test('the polar pair reaches five days past today\'s UTC midnight at 68 h, four at 48 h and 26 h, three at 24 h and less', () => {
  ['2026-06-21T12:00:00Z', '2026-12-15T12:00:00Z'].forEach((iso) => {
    const now = new Date(iso);
    const midnight = Math.floor(now.getTime() / (DAY_S * 1000)) * DAY_S * 1000;
    [[68, 5], [48, 4], [26, 4], [24, 3], [14, 3], [12, 3], [undefined, 3]].forEach(([span, days]) => {
      const far = sunEvents.polarSunEvents(now, TROMSO[0], TROMSO[1], span);
      assert.equal(far[1].date.getTime(), midnight + days * DAY_S * 1000, iso + ' at ' + span);
      assert.equal(far[0].date.getTime(), midnight - 2 * DAY_S * 1000, iso + ': the near end stays');
    });
    // nextSunEvents passes the span through, and the six- and seven-day pairs still read as polar.
    [48, 68].forEach((span) => {
      const pair = sunEvents.nextSunEvents(now, TROMSO[0], TROMSO[1], undefined, span);
      assert.equal(pair[1].date.getTime(), sunEvents.polarSunEvents(now, TROMSO[0], TROMSO[1], span)[1].date.getTime());
      assert.equal(sunEvents.isPolarSunPair(pair[0].date.getTime() / 1000, pair[1].date.getTime() / 1000), true,
        span + ' h');
    });
  });
});

test('polar night shades the whole 48 h and 68 h chart from any fetch hour, midnight sun none of it', () => {
  [48, 68].forEach((hours) => {
    for (let h = 0; h < 24; h += 3) {
      const hh = String(h).padStart(2, '0');
      assert.deepEqual(emeryChartShading(new Date('2026-12-15T' + hh + ':10:00Z'), TROMSO, hours),
        { wrong: 0, shaded: hours * 60 }, 'polar night ' + hh + ' at ' + hours);
      assert.deepEqual(emeryChartShading(new Date('2026-06-21T' + hh + ':10:00Z'), TROMSO, hours),
        { wrong: 0, shaded: 0 }, 'midnight sun ' + hh + ' at ' + hours);
    }
  });
});

test('ordinary latitudes shade the 48 h chart\'s nights, and the 68 h chart\'s up to four, within minutes', () => {
  ['2026-03-20T09:30:00Z', '2026-06-21T20:30:00Z', '2026-10-25T03:30:00Z', '2026-12-21T15:30:00Z']
    .forEach((iso) => {
      const r = emeryChartShading(new Date(iso), BERLIN, 48);
      assert.ok(r.wrong <= 30, iso + ': ' + r.wrong + ' min off');
      assert.ok(r.shaded > 12 * 60, iso + ': both nights shaded');
      // 68 h: the pair repeats by whole days, so the far end drifts a little more (the sun
      // pair is from today); the last night, opened by the trailing close, is shaded too.
      const long = emeryChartShading(new Date(iso), BERLIN, 68);
      assert.ok(long.wrong <= 45, iso + ': ' + long.wrong + ' min off at 68 h');
      assert.ok(long.shaded > r.shaded, iso + ': the 68 h chart shades more nights');
    });
  // A 68 h chart from a winter night's small hours meets four nights: the one it starts in,
  // two whole ones and the fourth's start, which only the trailing close shades (the pair's
  // repeats list no sunrise after it); the four slots hold them all.
  const nightsFrom = (iso) => {
    const now = new Date(iso);
    const nowS = Math.floor(now.getTime() / 1000);
    const start = nowS - (nowS % 3600);
    return emeryNightSegments(sunEvents.nextSunEvents(now, BERLIN[0], BERLIN[1], undefined, 68),
      start, start + 68 * 3600);
  };
  const four = nightsFrom('2026-12-21T05:10:00Z');
  assert.equal(four.length, 4, 'four nights');
  assert.equal(four[3][1], Date.parse('2026-12-24T01:00:00Z') / 1000, 'the fourth runs to the graph\'s end');
  assert.equal(nightsFrom('2026-12-21T15:10:00Z').length, 3, 'from a winter afternoon: three');
});

test('the twin\'s night rule is the pair repeated over many days, past hour 24 at 68 h (seeded sweep)', () => {
  // Port of the plan's night3 check: for generated pairs (any first event in the coming day, any
  // gap under a day, either type) the twin's four slots and trailing close shade exactly what
  // the pair repeated from 6 days back to 9 on, uncapped, shades -- past the first 24 hours,
  // whose rule is the 24 h grid's own. Without the trailing close or with three slots it fails.
  let seed = 20261009;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const H = 3600;
  const covered = (segs, gs, ge) => {
    const out = [];
    for (let t = gs + 24 * H; t < ge; t += 600) { out.push(segs.some((x) => t >= x[0] && t < x[1]) ? 1 : 0); }
    return out.join('');
  };
  let bad = 0, badCap3 = 0, badNoTrail = 0;
  const CASES = 4000;
  for (let c = 0; c < CASES; c += 1) {
    const now = 10 * DAY_S + Math.floor(rand() * 24 * 60) * 60;
    const gs = now - (now % H);
    const ge = gs + 68 * H;
    const first = now + (1 + Math.floor(rand() * 24 * 60)) * 60;
    const times = [first, first + (30 + Math.floor(rand() * (24 * 60 - 31))) * 60];
    const type0 = rand() < 0.5 ? 0 : 1;
    const ref = covered(nightsOver(times, type0, gs, ge, -6, 9, false, 99), gs, ge);
    if (covered(nightsOver(times, type0, gs, ge, -1, 2, true, EMERY_NIGHTS_MAX), gs, ge) !== ref) { bad += 1; }
    if (covered(nightsOver(times, type0, gs, ge, -1, 2, true, 3), gs, ge) !== ref) { badCap3 += 1; }
    if (covered(nightsOver(times, type0, gs, ge, -1, 2, false, EMERY_NIGHTS_MAX), gs, ge) !== ref) { badNoTrail += 1; }
  }
  assert.equal(bad, 0, 'the twin matches the reference');
  assert.ok(badCap3 > 0, 'the sweep reaches a fourth night (three slots fail it)');
  assert.ok(badNoTrail > 0, 'the sweep needs the trailing close');
});

// The providers' own wiring: the base class and OpenWeatherMap's override (test/openweathermap.test.js)
// both hand the fetch's span to nextSunEvents, so a long fetch at a polar latitude gets the
// six- or seven-day pair. Without it the watch finds only the night [M, M + 2 d] and leaves the
// long chart's last hours unshaded in polar night.
const WeatherProvider = require('../src/pkjs/weather/provider.js');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');

test('WeatherProvider#withSunEvents passes the fetch\'s span to the polar pair', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-15T18:00:00Z') });
  const midnight = Date.parse('2026-12-15T00:00:00Z');
  [[68, 5], [48, 4], [26, 4], [24, 3], [14, 3], [12, 3]].forEach(([span, days]) => {
    const p = new WeatherProvider();
    p.options = fetchOptions.defaults({ forecastHours: span });
    let got = null;
    p.withSunEvents(TROMSO[0], TROMSO[1], (events) => { got = events; },
      (f) => { throw new Error('unexpected failure ' + JSON.stringify(f)); });
    assert.deepEqual(got.map((e) => e.type), ['sunset', 'sunrise'], span + ' h: polar night');
    assert.equal(got[1].date.getTime(), midnight + days * DAY_S * 1000,
      span + ' h: the far end ' + days + ' days past UTC midnight');
  });
});

// The JS twin above (emeryNightSegments) stands in for the emery arm of forecast_night.h, which
// has no host test (a fragment of the SDK-bound forecast_layer.c, compiled in its translation
// unit: in one of its own it would cost bytes). Pin the facts the twin copies to the C source,
// so neither side drifts alone.
test('the JS night twin matches forecast_night.h\'s emery night arm', () => {
  const read = (file) => require('fs').readFileSync(
    require('path').join(__dirname, '..', file), 'utf8');
  const src = read('src/c/layers/forecast_night.h');
  const layer = read('src/c/layers/forecast_layer.c');
  const span = read('src/c/appendix/forecast_span.h');
  /**
   * A define's value in forecast_span.h's emery arm and in its #else arm.
   * @param {string} name The macro.
   * @returns {number[]} [emery, elsewhere].
   */
  const arms = (name) => {
    const m = span.match(new RegExp('#if defined\\(PBL_PLATFORM_EMERY\\)[\\s\\S]*?#define ' + name
      + ' (\\d+)[\\s\\S]*?#else[\\s\\S]*?#define ' + name + ' (\\d+)'));
    assert.ok(m, 'forecast_span.h keeps its emery / else ' + name + ' arms');
    return [Number(m[1]), Number(m[2])];
  };
  // The pair repeats on day offsets -1..FORECAST_NIGHT_LAST_DAY: 2 on emery (the twin's, 8
  // events), 1 elsewhere (6).
  assert.match(src, /SunEvent events\[2 \* \(FORECAST_NIGHT_LAST_DAY \+ 2\)\];/);
  assert.match(src, /for \(int day_offset = -1; day_offset <= FORECAST_NIGHT_LAST_DAY; \+\+day_offset\)/);
  assert.deepEqual(arms('FORECAST_NIGHT_LAST_DAY'), [2, 1]);
  // Only the nights the graph meets take one of the slots (emery only).
  assert.match(src, /#if defined\(PBL_PLATFORM_EMERY\)\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*if \(event_end\.timestamp <= graph_start \|\| event_start\.timestamp >= graph_end\)/);
  // The slots: FORECAST_NIGHTS_MAX, 4 on emery (the twin's EMERY_NIGHTS_MAX), 3 elsewhere.
  assert.match(src, /NightSegment segments\[FORECAST_NIGHTS_MAX\];/);
  assert.deepEqual(arms('FORECAST_NIGHTS_MAX'), [EMERY_NIGHTS_MAX, 3]);
  // The trailing close (emery only): the last event listed, a sunset, runs to the graph's end.
  assert.match(src, /#if defined\(PBL_PLATFORM_EMERY\)\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*if \(event_count > 0 && events\[event_count - 1\]\.type == 1\)\n[ \t]*\{\n[ \t]*night_segments_add\(&night_segments, events\[event_count - 1\]\.timestamp, graph_end\);\n[ \t]*\}\n#endif/);
  // The graph's end is num_entries hours on (emery), num_entries - 1 elsewhere: the twin's
  // emeryChartShading shades `hours` h of an `hours`-entry chart.
  assert.deepEqual(arms('FORECAST_NIGHT_PAST_LAST'), [1, 0]);
  assert.match(layer, /forecast_start\s*\+ \(ds->num_entries - 1 \+ FORECAST_NIGHT_PAST_LAST\)\s*\* BOTTOM_VIEW_STEP_SECONDS/);
});
