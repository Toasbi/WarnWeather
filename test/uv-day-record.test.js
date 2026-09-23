// test/uv-day-record.test.js — the UV forecast of today's hours already begun,
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
const record = require('../src/pkjs/weather/uv-day-record.js');
const WeatherProvider = require('../src/pkjs/weather/provider.js');
const outbox = require('../src/pkjs/outbox.js');
const { uvShown } = require('../src/pkjs/wire-units.js');

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
  assert.deepEqual(fresh(Object.assign({}, SRC, { lat: 52.6 }), at(15, 10)), [90], 'moved 9 km north');
  assert.deepEqual(fresh(Object.assign({}, SRC, { lat: 52.56 }), at(15, 10)).length, 5,
    'GPS jitter (4 km) is the same place');
  assert.deepEqual(fresh(SRC, at(15, 14)), [90], 'the record ends at 12:00, before 13:00: a gap');
  assert.deepEqual(fresh(SRC, at(15, 10) + 1800), [90], 'a half-hour grid is another source\'s');
  assert.deepEqual(record.merge({ junk: true }, SRC, [9], at(15, 10)).v, [90], 'garbage: ignored');
});

test('earlierPeak: the peak of today\'s hours before entry 0, or unknown', () => {
  const r = record.merge(record.merge(null, SRC, [0, 6, 4, 5, 5, 4], at(15, 0)), SRC, [3], at(15, 5));
  assert.equal(record.earlierPeak(r, SRC, at(15, 5)), 6, '00:00-04:00 peaked at 6, at 01:00');
  assert.equal(record.earlierPeak(r, SRC, at(15, 0)), 0, 'today\'s first hour: nothing earlier');
  assert.equal(record.earlierPeak(null, SRC, at(15, 0)), 0, '...with or without a record');
  assert.equal(record.earlierPeak(null, SRC, at(15, 5)), null, 'no record: unknown');
  assert.equal(record.earlierPeak(r, Object.assign({}, SRC, { id: 'dwd' }), at(15, 5)), null,
    'another source\'s morning says nothing');
  const late = record.merge(null, SRC, [3, 3], at(15, 10));
  assert.equal(record.earlierPeak(late, SRC, at(15, 11)), null,
    'first fetched at 10:00: 00:00-09:00 are missing, so unknown rather than 3');
  const blind = record.merge(null, SRC, [null, null, 2], at(15, 0));
  assert.equal(record.earlierPeak(blind, SRC, at(15, 2)), null, 'no sourced earlier hour: unknown');
});

test('load and save: an unreadable record is cleared, an unchanged one not rewritten', () => {
  store[KEYS.UV_DAY_RECORD_KEY] = '{oops';
  assert.equal(record.load(), null);
  assert.equal(store[KEYS.UV_DAY_RECORD_KEY], undefined);
  const r = record.merge(null, SRC, [1], at(15, 9));
  record.save(r);
  record.save(JSON.parse(JSON.stringify(r)));
  assert.equal(writes, 1, 'the second, identical save skips the flash write');
  assert.deepEqual(record.load(), r);
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
      uvTrend: CURVE.slice(hour, hour + 49) });
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

test('without today\'s earlier hours the slot keeps the plain rule', () => {
  // A switch of provider at 13:10 cannot use the other feed's morning: at the
  // peak, the rest of the day never beats now, so tomorrow's shows (as before).
  const p = Object.assign(new WeatherProvider(), { id: 'openmeteo' });
  fetchAt(p, 0);
  p.id = 'dwd';
  assert.deepEqual(fetchAt(p, 13).UV_DAY_PEAKS.slice(2), [null], 'unknown');
  assert.equal(both(fetchAt(p, 13)), '5/»6');
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
  p.recallUvDay = WeatherProvider.prototype.recallUvDay;
  p.uvTrend = [];
  p.startTime = at(15, 9);
  assert.equal(p.recallUvDay(SRC.lat, SRC.lon), null);
  assert.equal(p.uvEarlierPeak, null);
  assert.equal(writes, 0);
});

test('DST days: the earlier hours are the day\'s own, 23 or 25 of them', () => {
  // Berlin springs forward on 29 Mar 2026 (02:00 -> 03:00) and falls back on
  // 25 Oct 2026 (03:00 -> 02:00). A record stored at 00:00 that day covers it;
  // at 13:00 local its earlier hours are 12 (spring) and 14 (autumn), and the
  // peak among them must be found by time, not by a 24-hour count.
  const { execFileSync } = require('child_process');
  const body = `
    const r = require(${JSON.stringify(require.resolve('../src/pkjs/weather/uv-day-record.js'))});
    const src = { id: 'openmeteo', lat: 52.5, lon: 13.4 };
    const out = {};
    [['spring', 2, 29], ['autumn', 9, 25]].forEach(([name, m, d]) => {
      const midnight = new Date(2026, m, d, 0, 0, 0).getTime() / 1000;
      const one = new Date(2026, m, d, 13, 0, 0).getTime() / 1000;
      const hours = (one - midnight) / 3600;
      // UV 7 in the day's last hour before 13:00, 1 elsewhere: the peak is found
      // only if every earlier hour is looked at.
      const series = []; for (let i = 0; i < 49; i += 1) { series.push(i === hours - 1 ? 7 : 1); }
      const rec = r.merge(null, src, series, midnight, midnight + 60);
      const next = r.merge(rec, src, [5], one, one + 60);
      out[name] = { hours, peak: r.earlierPeak(next, src, one, one + 60), t: next.t === midnight,
        len: next.v.length };
    });
    process.stdout.write(JSON.stringify(out));`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', body],
    { env: Object.assign({}, process.env, { TZ: 'Europe/Berlin' }), encoding: 'utf8' }));
  assert.deepEqual(out.spring, { hours: 12, peak: 7, t: true, len: 13 }, '23-hour day');
  assert.deepEqual(out.autumn, { hours: 14, peak: 7, t: true, len: 15 }, '25-hour day');
});
