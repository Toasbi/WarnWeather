// test/hourly-window.test.js
// The UV slot's day peaks: extendHourly (the providers' 48 h UV reach) and
// localDayPeaks (the [rest of today, tomorrow] split getPayload bakes into
// UV_DAY_PEAKS). Start times are LOCAL clock times so the day boundaries land
// on the same entries in any host timezone; the DST cases run in a child
// process with the zone set at start (see test/weather-tab-charts.test.js for
// why a mid-run process.env.TZ assignment is not trusted).
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const hourlyWindow = require('../src/pkjs/weather/hourly-window.js');
const { localDayPeaks, extendHourly, HOUR_SECONDS, UV_HOURS, FORECAST_HOURS } = hourlyWindow;

const at = (d, h) => new Date(2026, 6, d, h, 0, 0).getTime() / 1000;

/** @returns {number[]} n zeros with the given {index: value} overrides. */
function series(n, overrides) {
  const out = new Array(n).fill(0);
  Object.keys(overrides || {}).forEach((i) => { out[i] = overrides[i]; });
  return out;
}

test('UV_HOURS reaches past the end of tomorrow from any anchor hour', () => {
  assert.equal(UV_HOURS, 2 * FORECAST_HOURS);
  // The latest anchor is 23:00 today: the day after starts 25 h later.
  assert.ok(UV_HOURS >= 25);
});

test('localDayPeaks splits the series at local midnight', () => {
  // 09:00 start: entries 0..14 are today (09..23), 15..38 tomorrow, 39+ the day after.
  const s = series(48, { 4: 7.1, 14: 0.2, 15: 0.1, 27: 9.5, 39: 11 });
  assert.deepEqual(localDayPeaks(s, at(15, 9)), [7.1, 9.5],
    'the day after\'s 11 at entry 39 never counts');
});

test('localDayPeaks: the rest of today includes the current hour', () => {
  assert.deepEqual(localDayPeaks(series(48, { 0: 8, 1: 7 }), at(15, 13)), [8, 0]);
});

test('localDayPeaks: tomorrow is unknown unless the series covers it to its end', () => {
  // From 09:00, the end of tomorrow is 39 entries out.
  assert.deepEqual(localDayPeaks(series(39, { 30: 6 }), at(15, 9)), [0, 6], 'exactly covered');
  assert.deepEqual(localDayPeaks(series(38, { 30: 6 }), at(15, 9)), [0, null],
    'one hour short: a peak it never reached would under-report');
  assert.deepEqual(localDayPeaks(series(24, { 3: 5 }), at(15, 9)), [5, null],
    'the 24 h forecast window alone never names tomorrow');
});

test('localDayPeaks skips unsourced hours; a day with none is null', () => {
  const s = series(48, { 0: null, 1: 4, 2: NaN, 3: 'x' });
  assert.deepEqual(localDayPeaks(s, at(15, 9)), [4, 0]);
  const blank = new Array(48).fill(null);
  assert.deepEqual(localDayPeaks(blank, at(15, 9)), [null, null]);
});

test('localDayPeaks answers [null, null] for unusable input', () => {
  assert.deepEqual(localDayPeaks([], at(15, 9)), [null, null]);
  assert.deepEqual(localDayPeaks(undefined, at(15, 9)), [null, null]);
  assert.deepEqual(localDayPeaks(series(48), undefined), [null, null]);
  assert.deepEqual(localDayPeaks(series(48), NaN), [null, null]);
});

test('localDayPeaks follows the phone calendar across DST (23 h and 25 h days)', () => {
  const body = `
    const w = require(${JSON.stringify(require.resolve('../src/pkjs/weather/hourly-window.js'))});
    const s = (n, o) => { const a = new Array(n).fill(0); for (const k in o) a[k] = o[k]; return a; };
    const t = (y, m, d, h) => new Date(y, m, d, h, 0, 0).getTime() / 1000;
    // Fall back, 2026-10-25 is 25 h long. From 20:00 on the 24th: tomorrow is
    // entries 4..28 (its last hour, 23:00 CET, is entry 28); 29 is the 26th.
    const fall = t(2026, 9, 24, 20);
    // Spring forward, 2026-03-29 is 23 h long: tomorrow is entries 4..26.
    const spring = t(2026, 2, 28, 20);
    process.stdout.write(JSON.stringify({
      offset: new Date(2026, 6, 1).getTimezoneOffset(),
      fall: w.localDayPeaks(s(48, { 28: 9, 29: 12 }), fall),
      fallShort: w.localDayPeaks(s(28, { 27: 9 }), fall),
      spring: w.localDayPeaks(s(48, { 26: 9, 27: 12 }), spring)
    }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', body],
    { env: Object.assign({}, process.env, { TZ: 'Europe/Berlin' }), encoding: 'utf8' }));
  assert.equal(out.offset, -120, 'the child really ran in Europe/Berlin (CEST in July)');
  assert.deepEqual(out.fall, [0, 9], 'the 25th hour of the long day is still tomorrow');
  assert.deepEqual(out.fallShort, [0, null], '28 entries stop an hour short of the long day\'s end');
  assert.deepEqual(out.spring, [0, 9], 'the short day ends after 23 hours');
});

test('extendHourly reads on to the target length, in place', () => {
  const items = [];
  for (let i = 0; i < 60; i += 1) { items.push({ t: 1000 * HOUR_SECONDS + i * HOUR_SECONDS, v: i }); }
  const s = [2, 3, 4];                       // already mapped from anchor 2
  const out = extendHourly(s, items, 2, 48, (x) => x.t, (x) => x.v);
  assert.equal(out, s);
  assert.equal(s.length, 48);
  assert.equal(s[47], 49);
});

test('extendHourly stops at the first bucket that is not the next hour, or at the feed end', () => {
  const base = 1000 * HOUR_SECONDS;
  const items = [];
  for (let i = 0; i < 30; i += 1) { items.push({ t: base + i * HOUR_SECONDS, v: i }); }
  // Then the feed thins to 6-hourly steps: bucket 30 is +35 h, not +30 h.
  items.push({ t: base + 35 * HOUR_SECONDS, v: 99 });
  const s = [0];
  extendHourly(s, items, 0, 48, (x) => x.t, (x) => x.v);
  assert.equal(s.length, 30, 'the coarse bucket is not passed off as hour 30');
  const short = [0];
  extendHourly(short, items.slice(0, 10), 0, 48, (x) => x.t, (x) => x.v);
  assert.equal(short.length, 10, 'a feed that ends leaves the series short');
});
