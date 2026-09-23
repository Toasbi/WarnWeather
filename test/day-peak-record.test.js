// test/day-peak-record.test.js — the UV forecast of today's hours already begun,
// kept across fetches so the UV slot's day max can hold today's peak while it
// runs (a peak of 5 from 13:00 to 15:00 shows until the reading drops below it)
// and give way to tomorrow's once it is behind us. Times are LOCAL clock times so
// the day edges land the same in any host time zone.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const store = {};
let writes = 0;
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { writes += 1; store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

const KEYS = require('../src/pkjs/storage-keys.js');
const record = require('../src/pkjs/weather/day-peak-record.js');
const WeatherProvider = require('../src/pkjs/weather/provider.js');
const outbox = require('../src/pkjs/outbox.js');
// The UV slot's reader, in the (trend, peaks, mode) shape these tests grew up on.
const uvShown = (trend, peaks, mode) => require('../src/pkjs/wire-units.js')
  .dayMaxShown('uv', { UV_TREND_UINT8: trend, UV_DAY_PEAKS: peaks }, { uvSlotDisplay: mode });

const at = (day, hour) => new Date(2026, 6, day, hour, 0, 0).getTime() / 1000;
const SRC = { id: 'openmeteo', lat: 52.52, lon: 13.4 };

test.beforeEach(() => { Object.keys(store).forEach((k) => { delete store[k]; }); writes = 0; });

test('merge keeps a fetch\'s series from entry 0, in UV tenths', () => {
  const r = record.merge(null, SRC, [1.24, null, 3], at(15, 9), at(15, 9) + 600);
  assert.deepEqual(r, { id: 'openmeteo', lat: 52.52, lon: 13.4, t: at(15, 9), v: [12, null, 30] });
});

test('merge puts today\'s earlier hours from the stored record in front, and only those', () => {
  // Stored at 22:00 yesterday: 22:00 yesterday .. 04:00 today.
  const old = record.merge(null, SRC, [9, 8, 1, 2, 3, 4, 5], at(14, 22));
  const r = record.merge(old, SRC, [7, 7], at(15, 3), at(15, 3) + 60);
  assert.equal(r.t, at(15, 0), 'yesterday\'s 22:00 and 23:00 are dropped at midnight');
  assert.deepEqual(r.v, [10, 20, 30, 70, 70], '00:00-02:00 from the record, 03:00 on from this fetch');
});

test('merge starts afresh for another provider, another place, a gap, or another hour grid', () => {
  const old = record.merge(null, SRC, [1, 2, 3, 4, 5, 6], at(15, 6));
  const fresh = (source, start) => record.merge(old, source, [9], start).v;
  assert.deepEqual(fresh(SRC, at(15, 10)), [10, 20, 30, 40, 90], 'same source: kept');
  assert.deepEqual(fresh(Object.assign({}, SRC, { id: 'dwd' }), at(15, 10)), [90], 'another provider');
  assert.deepEqual(fresh(Object.assign({}, SRC, { lat: 53.6 }), at(15, 10)), [90], 'moved 120 km north');
  assert.deepEqual(fresh(Object.assign({}, SRC, { lat: 52.7, lon: 13.6 }), at(15, 10)).length, 5,
    'a 25 km commute is the same place: UV is regional');
  assert.deepEqual(fresh(SRC, at(15, 14)), [90], 'the record ends at 12:00, before 13:00: a gap');
  assert.deepEqual(fresh(SRC, at(15, 10) + 1800), [90], 'a half-hour grid is another source\'s');
  assert.deepEqual(record.merge({ junk: true }, SRC, [9], at(15, 10)).v, [90], 'garbage: ignored');
});

test('earlierPeak: today\'s earlier hours back to the last one below the peak held', () => {
  // 00:00-04:00 = 0, 6, 4, 5, 5; the fetch at 05:00 holds the rest of the day's peak.
  const r = record.merge(record.merge(null, SRC, [0, 6, 4, 5, 5, 4], at(15, 0)), SRC, [3], at(15, 5));
  const back = (hold) => record.earlierPeak(r, SRC, at(15, 5), at(15, 5) + 60, hold);
  assert.equal(back(5), 5, 'holding 5: 04:00 and 03:00 printed 5, 02:00 dipped to 4 — the 6 before it is another peak\'s');
  assert.equal(back(4), 6, 'holding 4: no dip below 4 since 00:00, so the 01:00 6 counts — 4 is behind us');
  assert.equal(back(7), 0, 'holding 7: the hour before already dipped below it — nothing came between');
  assert.equal(back(4.45), 5, 'the peak held rounds as the slot prints it: 4.45 -> 4.5 -> 5, so like 5...');
  assert.equal(back(4.44), 6, '...and 4.44 prints 4, so like 4');
  assert.equal(back(null), null, 'no peak to hold: nothing to judge');
  assert.equal(record.earlierPeak(r, SRC, at(15, 0), at(15, 0) + 60, 5), 0, 'today\'s first hour: nothing earlier');
  assert.equal(record.earlierPeak(null, SRC, at(15, 0), at(15, 0) + 60, 5), 0, '...with or without a record');
  assert.equal(record.earlierPeak(null, SRC, at(15, 5), at(15, 5) + 60, 5), null, 'no record: unknown');
  assert.equal(record.earlierPeak(r, Object.assign({}, SRC, { id: 'dwd' }), at(15, 5), at(15, 5) + 60, 5), null,
    'another feed\'s morning says nothing');
  // First fetched at 10:00 (install day, a move): 10:00-11:00 printed 3, 3.
  const late = record.merge(null, SRC, [3, 3, 5], at(15, 10));
  assert.equal(record.earlierPeak(late, SRC, at(15, 12), at(15, 12) + 60, 5), 0,
    'holding 5 at noon: 11:00 already dipped below it, so the missing morning does not matter');
  assert.equal(record.earlierPeak(late, SRC, at(15, 12), at(15, 12) + 60, 3), null,
    'holding 3: no dip back to 10:00, and 09:00 is missing — unknown');
  const blind = record.merge(null, SRC, [null, null, 2], at(15, 0));
  assert.equal(record.earlierPeak(blind, SRC, at(15, 2), at(15, 2) + 60, 2), null, 'an unsourced hour: unknown');
});

test('load and save: an unreadable record is cleared, an unchanged one not rewritten', () => {
  store[KEYS.UV_DAY_RECORD_KEY] = '{oops';
  assert.equal(record.load(KEYS.UV_DAY_RECORD_KEY), null);
  assert.equal(store[KEYS.UV_DAY_RECORD_KEY], undefined);
  const r = record.merge(null, SRC, [1], at(15, 9));
  record.save(r, KEYS.UV_DAY_RECORD_KEY);
  record.save(JSON.parse(JSON.stringify(r)), KEYS.UV_DAY_RECORD_KEY);
  assert.equal(writes, 1, 'the second, identical save skips the flash write');
  assert.deepEqual(record.load(KEYS.UV_DAY_RECORD_KEY), r);
});

// ---------------------------------------------------------------------------
// Through a real fetch cycle: fetchWithCoordinates, with the network steps
// stubbed, stores each fetch's series and hands getPayload the earlier peak.

// The owner's day: 5 from 13:00 to 15:00; tomorrow peaks at 6.
const TODAY = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 4, 4, 5, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0];
const TOMORROW = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 5, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0];
const CURVE = TODAY.concat(TOMORROW, [0, 0]);

/**
 * One fetch at `hour`:10 on the 15th; resolves with the composed payload, or
 * null when it was abandoned before sending.
 */
function fetchAt(provider, hour, opts) {
  const o = opts || {};
  const realNow = Date.now;
  const realSend = outbox.sendWeather;
  const start = at(15, hour);
  let payload = null;
  Date.now = () => (start + 600) * 1000;
  outbox.sendWeather = (p, ok) => { payload = p; ok(); };
  provider.withCityName = (lat, lon, cb) => cb('Testville', 'DE');
  provider.withSunEvents = (lat, lon, cb) => cb([{ type: 'sunrise', date: new Date(0) },
    { type: 'sunset', date: new Date(1000) }]);
  provider.withProviderData = function (lat, lon, force, ok) {
    Object.assign(this, { numEntries: 24, startTime: start, currentTemp: 60,
      tempTrend: new Array(24).fill(60), precipTrend: new Array(24).fill(0),
      uvTrend: (o.curve || CURVE).slice(hour, hour + 49) });
    ok();
  };
  try {
    provider.fetchWithCoordinates(o.lat || SRC.lat, SRC.lon, () => {}, (f) => {
      throw new Error('fetch failed: ' + JSON.stringify(f));
    }, false, null, null, o.abandoned ? () => false : undefined);
  } finally {
    Date.now = realNow;
    outbox.sendWeather = realSend;
  }
  return payload;
}

/** The UV slot in Both mode, as the text reads: "now/peak", "»" for tomorrow. */
function both(payload) {
  const uv = uvShown(payload.UV_TREND_UINT8, payload.UV_DAY_PEAKS, 'both');
  return uv.now + '/' + (uv.nextDay ? '»' : '') + uv.peak;
}

test('the owner\'s day: 5 holds from 13:00 until the reading drops below it at 15:00', () => {
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  assert.equal(both(fetchAt(p, 0)), '0/5', '00:10: nothing earlier, the peak ahead');
  assert.equal(both(fetchAt(p, 11)), '4/5', '11:10: ahead');
  assert.equal(both(fetchAt(p, 13)), '5/5', '13:10: running — not yet tomorrow\'s');
  assert.equal(both(fetchAt(p, 14)), '5/5', '14:10: still running');
  assert.equal(both(fetchAt(p, 15)), '4/»6', '15:10: below 5 — tomorrow\'s peak takes over');
  assert.equal(both(fetchAt(p, 20)), '0/»6', '20:10');
  const stored = JSON.parse(store[KEYS.UV_DAY_RECORD_KEY]);
  assert.equal(stored.t, at(15, 0), 'the record reaches back to today\'s midnight, no further');
  assert.ok(stored.v.length <= 24 + 49, 'and forward only as far as the last series');
});

test('fetches hours apart still see the peak they skipped', () => {
  // 12:10 and then 16:10: the 13:00-15:00 hours were only ever forecast, by the
  // 12:10 fetch — the record keeps that forecast as the day's word on them.
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  fetchAt(p, 0);
  assert.equal(both(fetchAt(p, 12)), '4/5');
  assert.equal(both(fetchAt(p, 16)), '3/»6');
});

test('without today\'s earlier hours back to a dip the slot keeps the plain rule', () => {
  // A switch to another UV feed at 13:10 cannot use the old feed's morning, and
  // the new record starts at 13:00: at the peak, the rest of the day never beats
  // now, so tomorrow's shows (as before this change) — for that hour only.
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  fetchAt(p, 0);
  p.id = 'tomorrowio';
  assert.deepEqual(fetchAt(p, 13).UV_DAY_PEAKS.slice(2), [null], 'unknown');
  assert.equal(both(fetchAt(p, 13)), '5/»6');
  assert.equal(both(fetchAt(p, 14)), '5/»6', '14:00: 13:00 printed 5, and before it the record ends');
});

test('a switch between DWD and Open-Meteo keeps the record: both read Open-Meteo\'s UV', () => {
  const DwdProvider = require('../src/pkjs/weather/dwd.js');
  const Dwd = DwdProvider.DwdProvider || DwdProvider;
  const om = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  fetchAt(om, 0);
  fetchAt(om, 11);
  const dwd = new Dwd();
  assert.equal(both(fetchAt(dwd, 13)), '5/5');
});

test('a commute keeps the record; a move far away still judges from the last dip', () => {
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  fetchAt(p, 0);
  fetchAt(p, 7);
  assert.equal(both(fetchAt(p, 8, { lat: SRC.lat + 0.18 })), '2/5', '08:10 at the office, 20 km away');
  assert.equal(both(fetchAt(p, 13, { lat: SRC.lat + 0.18 })), '5/5');
  // Across the country at 08:10: a new record from 08:00, which by 13:00 holds
  // the dip below 5 (12:00 printed 4), so the peak still holds.
  const q = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  fetchAt(q, 0);
  [8, 9, 10, 11, 12].forEach((h) => fetchAt(q, h, { lat: SRC.lat + 3 }));
  assert.equal(both(fetchAt(q, 13, { lat: SRC.lat + 3 })), '5/5');
  assert.equal(both(fetchAt(q, 15, { lat: SRC.lat + 3 })), '4/»6');
});

test('a second, lower peak after a cloudy noon holds like the first', () => {
  // 11:00 6, noon 4 (clouds), 13:00-14:00 5, then down; tomorrow 6.
  const day = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 5, 6, 4, 5, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0];
  const curve = day.concat(TOMORROW, [0, 0]);
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  const seen = [0, 10, 11, 12, 13, 14, 15].map((h) => both(fetchAt(p, h, { curve })));
  assert.deepEqual(seen, ['0/6', '5/6', '6/6', '4/5', '5/5', '5/5', '3/»6']);
  // Down from a 6 with no dip: the 5s after it are the way down, not a peak.
  const slope = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 5, 6, 5, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0];
  const q = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  const down = [0, 11, 12, 13].map((h) => both(fetchAt(q, h, { curve: slope.concat(TOMORROW, [0, 0]) })));
  assert.deepEqual(down, ['0/6', '6/6', '5/»6', '5/»6']);
});

test('an abandoned fetch reads the record but never writes it', () => {
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  fetchAt(p, 0);
  const before = store[KEYS.UV_DAY_RECORD_KEY];
  assert.equal(fetchAt(p, 13, { abandoned: true }), null, 'nothing sent');
  assert.equal(store[KEYS.UV_DAY_RECORD_KEY], before);
});

test('a UV day record that cannot be read never fails the fetch', () => {
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  const realGet = global.localStorage.getItem;
  global.localStorage.getItem = (k) => {
    if (k === KEYS.UV_DAY_RECORD_KEY) { throw new Error('storage gone'); }
    return realGet(k);
  };
  try {
    const payload = fetchAt(p, 13);
    assert.ok(payload, 'the fetch still sends');
    assert.deepEqual(payload.UV_DAY_PEAKS.slice(2), [null], 'with the earlier hours unknown');
  } finally {
    global.localStorage.getItem = realGet;
  }
});

test('without UV nothing is read or stored', () => {
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  p.uvTrend = [];
  p.startTime = at(15, 9);
  assert.deepEqual(p.recallDayPeaks(SRC.lat, SRC.lon).map((e) => e.storageKey)
    .filter((k) => k === KEYS.UV_DAY_RECORD_KEY), []);
  assert.equal(p.earlierPeaks.uv == null, true, 'no earlier peak');
  assert.equal(writes, 0);
});

test('DST days: the earlier hours are the day\'s own, 23 or 25 of them', () => {
  // Berlin springs forward on 29 Mar 2026 (02:00 -> 03:00) and falls back on
  // 25 Oct 2026 (03:00 -> 02:00). A record stored at 00:00 that day covers it;
  // at 13:00 local its earlier hours are 12 (spring) and 14 (autumn), and the
  // peak among them must be found by time, not by a 24-hour count.
  const { execFileSync } = require('child_process');
  const body = `
    const r = require(${JSON.stringify(require.resolve('../src/pkjs/weather/day-peak-record.js'))});
    const src = { id: 'openmeteo', lat: 52.5, lon: 13.4 };
    const out = {};
    [['spring', 2, 29], ['autumn', 9, 25]].forEach(([name, m, d]) => {
      const midnight = new Date(2026, m, d, 0, 0, 0).getTime() / 1000;
      const one = new Date(2026, m, d, 13, 0, 0).getTime() / 1000;
      const hours = (one - midnight) / 3600;
      // UV 7 in the day's first hour, 1 after it, and a peak of 1 held: no hour
      // dips below it, so the walk reaches midnight and finds the 7 only if it
      // steps through exactly the day's own hours.
      const series = []; for (let i = 0; i < 49; i += 1) { series.push(i === 0 ? 7 : 1); }
      const rec = r.merge(null, src, series, midnight, midnight + 60);
      const next = r.merge(rec, src, [1], one, one + 60);
      out[name] = { hours, peak: r.earlierPeak(next, src, one, one + 60, 1), t: next.t === midnight,
        len: next.v.length };
    });
    process.stdout.write(JSON.stringify(out));`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', body],
    { env: Object.assign({}, process.env, { TZ: 'Europe/Berlin' }), encoding: 'utf8' }));
  assert.deepEqual(out.spring, { hours: 12, peak: 7, t: true, len: 13 }, '23-hour day');
  assert.deepEqual(out.autumn, { hours: 14, peak: 7, t: true, len: 15 }, '25-hour day');
});
