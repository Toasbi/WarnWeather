// test/hourly-window.test.js
// The UV slot's day peaks: readHourly (the providers' UV_HOURS reach) and
// localDayPeaks (the [rest of today, tomorrow] split getPayload bakes into
// UV_DAY_PEAKS). Start times are LOCAL clock times so the day boundaries land
// on the same entries in any host timezone; the DST and :30-offset cases run in
// a child process with the zone set at start (see test/weather-tab-charts.test.js
// for why a mid-run process.env.TZ assignment is not trusted).
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const hourlyWindow = require('../src/pkjs/weather/hourly-window.js');
const openmeteo = require('../src/pkjs/weather/openmeteo.js');
const { localDayPeaks, readHourly, HOUR_SECONDS, UV_HOURS, FORECAST_HOURS } = hourlyWindow;

const at = (d, h) => new Date(2026, 6, d, h, 0, 0).getTime() / 1000;

/** @returns {number[]} n zeros with the given {index: value} overrides. */
function series(n, overrides) {
  const out = new Array(n).fill(0);
  Object.keys(overrides || {}).forEach((i) => { out[i] = overrides[i]; });
  return out;
}

test('a UV_HOURS series covers tomorrow to its end from every anchor hour', () => {
  // Behavioural, not arithmetic: the binding anchor is the EARLIEST (00:00), whose
  // rest of today is a whole day. The 25 h DST days are pinned in the Berlin child.
  for (let h = 0; h < 24; h += 1) {
    assert.deepEqual(localDayPeaks(new Array(UV_HOURS).fill(1), at(15, h)), [1, 1],
      'anchor ' + h + ':00');
  }
});

test('localDayPeaks splits the series at local midnight', () => {
  // 09:00 start: entries 0..14 are today (09..23), 15..38 tomorrow, 39+ the day after.
  // Each day's peak sits on its edge hour, so a midnight off by one moves it.
  const s = series(48, { 14: 7.1, 15: 9.5, 39: 11 });
  assert.deepEqual(localDayPeaks(s, at(15, 9)), [7.1, 9.5],
    'the day after\'s 11 at entry 39 never counts');
});

test('localDayPeaks: the rest of today includes the current hour', () => {
  assert.deepEqual(localDayPeaks(series(48, { 0: 8, 1: 7 }), at(15, 13)), [8, 0]);
});

test('localDayPeaks: a clock past entry 0\'s hour clamps to that hour\'s last second', () => {
  // A fixture replays an old start against today's clock, and the answer must not
  // depend on how old: from 23:00, the clamp's 23:59:59 is still the 15th.
  assert.deepEqual(localDayPeaks(series(48, { 0: 3, 5: 7 }), at(15, 23), at(15, 23) + 86400), [3, 7]);
});

test('localDayPeaks: tomorrow is unknown unless the series covers it to its end', () => {
  // From 09:00, the end of tomorrow is 39 entries out.
  assert.deepEqual(localDayPeaks(series(39, { 30: 6 }), at(15, 9)), [0, 6], 'exactly covered');
  assert.deepEqual(localDayPeaks(series(38, { 30: 6 }), at(15, 9)), [0, null],
    'one hour short: a peak it never reached would under-report');
  assert.deepEqual(localDayPeaks(series(24, { 3: 5 }), at(15, 9)), [5, null],
    'the 24 h forecast window alone never names tomorrow');
});

test('localDayPeaks: a null-padded feed end reads like a short one (alignHourly)', () => {
  // Open-Meteo's UV comes through mapUv, which always answers UV_HOURS entries and
  // pads the hours past the feed's end with null. A 30-bucket body from 09:00 ends
  // at 14:00 tomorrow — the afternoon is missing, so tomorrow is unknown, exactly
  // as for a 30-entry array.
  const start = at(15, 9);
  const time = [], uv_index = [];
  for (let i = 0; i < 30; i += 1) { time.push(start + i * HOUR_SECONDS); uv_index.push(i === 27 ? 2 : 0); }
  const padded = openmeteo.mapUv({ hourly: { time, uv_index } }, start);
  assert.equal(padded.length, UV_HOURS, 'null-padded to full length');
  assert.deepEqual(localDayPeaks(padded, start), [0, null]);
  assert.deepEqual(localDayPeaks(uv_index, start), [0, null], 'the short-array twin agrees');
});

test('localDayPeaks skips unsourced hours; a day with none is null', () => {
  // Non-finite values OPEN each day: read as a first peak, they would stick.
  const s = series(48, { 0: NaN, 1: 4, 2: null, 3: 'x', 15: Infinity, 16: 6 });
  assert.deepEqual(localDayPeaks(s, at(15, 9)), [4, 6]);
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
    // From 20:00 ON the long and the short day, midnight is entry 4 either way:
    // its own midnight + 24 h would put it an hour early (25 h) or late (23 h).
    const onFall = t(2026, 9, 25, 20), onSpring = t(2026, 2, 29, 20);
    // The UV_HOURS worst case: a 00:00 anchor with the 25 h day as tomorrow (the
    // 24th) or as today (the 25th) — 49 hours to the end of tomorrow either way.
    const eveOfFall = t(2026, 9, 24, 0), fallDay = t(2026, 9, 25, 0);
    const full = () => new Array(w.UV_HOURS).fill(1);
    process.stdout.write(JSON.stringify({
      offset: new Date(2026, 6, 1).getTimezoneOffset(),
      fall: w.localDayPeaks(s(48, { 28: 9, 29: 12 }), fall),
      fallShort: w.localDayPeaks(s(28, { 27: 9 }), fall),
      spring: w.localDayPeaks(s(48, { 26: 9, 27: 12 }), spring),
      onFall: w.localDayPeaks(s(48, { 3: 5, 4: 9 }), onFall),
      onSpring: w.localDayPeaks(s(48, { 3: 5, 4: 9 }), onSpring),
      eveOfFall: w.localDayPeaks(full(), eveOfFall),
      eveOfFall48: w.localDayPeaks(s(48, {}), eveOfFall),
      fallDay: w.localDayPeaks(full(), fallDay),
      fallDay48: w.localDayPeaks(s(48, {}), fallDay)
    }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', body],
    { env: Object.assign({}, process.env, { TZ: 'Europe/Berlin' }), encoding: 'utf8' }));
  assert.equal(out.offset, -120, 'the child really ran in Europe/Berlin (CEST in July)');
  assert.deepEqual(out.fall, [0, 9], 'the 25th hour of the long day is still tomorrow');
  assert.deepEqual(out.fallShort, [0, null], '28 entries stop an hour short of the long day\'s end');
  assert.deepEqual(out.spring, [0, 9], 'the short day ends after 23 hours');
  assert.deepEqual(out.onFall, [5, 9], 'on the long day, its 23:00 is still today');
  assert.deepEqual(out.onSpring, [5, 9], 'on the short day, the next 00:00 is already tomorrow');
  assert.deepEqual(out.eveOfFall, [1, 1], '00:00 before a 25 h tomorrow: UV_HOURS reach its end');
  assert.deepEqual(out.eveOfFall48, [0, null], '...48 entries stop an hour short');
  assert.deepEqual(out.fallDay, [1, 1], '00:00 on the 25 h day itself: UV_HOURS reach tomorrow\'s end');
  assert.deepEqual(out.fallDay48, [0, null], '...48 entries stop an hour short');
});

test('localDayPeaks: in a :30-offset zone the clock, not the bucket start, names today', () => {
  // Asia/Kolkata is UTC+5:30, so the anchor bucket (the floored UTC hour) runs
  // 23:30-00:30 local: at 00:10 it starts on YESTERDAY, and its start alone would
  // hand today's peak to tomorrow. getPayload passes the phone's clock in.
  const body = `
    const w = require(${JSON.stringify(require.resolve('../src/pkjs/weather/hourly-window.js'))});
    const WeatherProvider = require(${JSON.stringify(require.resolve('../src/pkjs/weather/provider.js'))});
    // 00:10 on 16 Jul is 18:40 UTC on the 15th; that UTC hour starts at 23:30 local
    // on the 15th. From there entries 0..24 are the 16th and 25..48 the 17th.
    const start = Date.UTC(2026, 6, 15, 18) / 1000, now = start + 40 * 60;
    const uv = new Array(w.UV_HOURS).fill(0);
    uv[13] = 8; uv[37] = 6;   // 12:30 on the 16th, 12:30 on the 17th
    Date.now = () => now * 1000;
    const p = Object.assign(new WeatherProvider(), {
      numEntries: 24, tempTrend: new Array(24).fill(50), precipTrend: new Array(24).fill(0),
      rainTrend: new Array(24).fill(0), currentTemp: 60, cityName: 'Testville',
      sunEvents: [{ type: 'sunrise', date: new Date(0) }, { type: 'sunset', date: new Date(1000) }],
      uvTrend: uv, startTime: start
    });
    process.stdout.write(JSON.stringify({
      offset: new Date(2026, 6, 1).getTimezoneOffset(),
      afterMidnight: w.localDayPeaks(uv, start, now),
      beforeMidnight: w.localDayPeaks(uv, start, start + 10 * 60),
      staleStart: w.localDayPeaks(uv, start, now + 30 * 86400),
      futureStart: w.localDayPeaks(uv, start, start - 86400),
      payload: p.getPayload().UV_DAY_PEAKS
    }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', body],
    { env: Object.assign({}, process.env, { TZ: 'Asia/Kolkata' }), encoding: 'utf8' }));
  assert.equal(out.offset, -330, 'the child really ran in Asia/Kolkata (UTC+5:30)');
  assert.deepEqual(out.afterMidnight, [8, 6], 'at 00:10, today\'s peak is today\'s');
  assert.deepEqual(out.beforeMidnight, [0, 8], 'the same bucket at 23:40 is still the 15th');
  assert.deepEqual(out.staleStart, [8, 6],
    'a clock far past the start (a fixture replay) clamps into the bucket: deterministic');
  assert.deepEqual(out.futureStart, [0, 8], '...and a clock behind it clamps up to its start');
  assert.deepEqual(out.payload, [80, 60, null],
    'getPayload judges the day by the phone\'s clock (no UV day record: the earlier hours unknown)');
});

/** @returns {Object[]} n hourly buckets {t, v: index} from an hour-aligned base. */
function buckets(n) {
  const base = 1000 * HOUR_SECONDS;
  const items = [];
  for (let i = 0; i < n; i += 1) { items.push({ t: base + i * HOUR_SECONDS, v: i }); }
  return items;
}
const epochOf = (x) => x.t;
const valueOf = (x) => x.v;

test('readHourly reads on to the target length into a fresh array', () => {
  const items = buckets(60);
  const out = readHourly(items, 2, UV_HOURS, epochOf, valueOf);
  assert.equal(out.length, UV_HOURS);
  assert.equal(out[0], 2, 'entry 0 is the anchor bucket');
  assert.equal(out[UV_HOURS - 1], 2 + UV_HOURS - 1);
  assert.equal(items.length, 60, 'the feed is left alone');
});

test('readHourly stops at the first bucket that is not the next hour', () => {
  const items = buckets(30);
  // Then the feed thins to 6-hourly steps: bucket 30 is +35 h, not +30 h.
  items.push({ t: items[0].t + 35 * HOUR_SECONDS, v: 99 });
  assert.equal(readHourly(items, 0, UV_HOURS, epochOf, valueOf).length, 30,
    'the coarse bucket is not passed off as hour 30');
});

test('readHourly stops at the feed end', () => {
  assert.deepEqual(readHourly(buckets(10), 0, UV_HOURS, epochOf, valueOf),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('readHourly reads the first FORECAST_HOURS unconditionally', () => {
  // An off-timestamp bucket inside the forecast window — up to its LAST entry — is
  // read like every other series in that window; only the reach past it checks the
  // next-hour rule.
  const items = buckets(60);
  items[FORECAST_HOURS - 1].t += HOUR_SECONDS / 2;
  const out = readHourly(items, 0, UV_HOURS, epochOf, valueOf);
  assert.equal(out.length, UV_HOURS);
  assert.equal(out[FORECAST_HOURS - 1], FORECAST_HOURS - 1);
  // ...whereas the same wobble on the first entry past it ends the series there.
  const late = buckets(60);
  late[FORECAST_HOURS].t += HOUR_SECONDS / 2;
  assert.equal(readHourly(late, 0, UV_HOURS, epochOf, valueOf).length, FORECAST_HOURS);
});

test('readHourly stops at a repeated or an earlier timestamp, not just a later one', () => {
  // Read on, a duplicate would shift every later hour one entry late.
  const dup = buckets(60);
  dup.splice(30, 0, { t: dup[29].t, v: 'dup' });
  assert.equal(readHourly(dup, 0, UV_HOURS, epochOf, valueOf).length, 30);
  const back = buckets(60);
  back[30].t -= HOUR_SECONDS / 2;
  assert.equal(readHourly(back, 0, UV_HOURS, epochOf, valueOf).length, 30);
});
