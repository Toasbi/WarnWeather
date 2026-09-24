const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const DwdProvider = require('../src/pkjs/weather/dwd.js');

test('DWD maps Brightsky forecast/current with °C→°F and km/h passthrough', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));   // °C
      return;
    }
    // Rain, chance and gust are "previous hour" values, so the 23:00 record's
    // belong to the 22:00 slot; the 23:00 slot has no later record → 0.
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 0, precipitation: 0, wind_speed: 18, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' },
      { temperature: 10, precipitation_probability: 40, precipitation: 1.2, wind_speed: 0, wind_gust_speed: 30, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();   // fetchUv unset → no UV request, onSuccess fires after current
  var ok = false;
  p.withProviderData(0, 0, false, function() { ok = true; }, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });

  assert.equal(ok, true, 'onSuccess fires');
  assert.deepEqual(p.tempTrend, [32, 50], '°C→°F (0→32, 10→50)');
  assert.deepEqual(p.precipTrend, [0.4, 0], 'probability /100');
  assert.deepEqual(p.rainTrend, [1.2, 0], 'precipitation mm passthrough');
  assert.deepEqual(p.windTrend, [18, 0], 'wind_speed km/h passthrough, on its own record');
  assert.deepEqual(p.gustTrend, [30, 0], 'wind_gust_speed km/h passthrough');
  assert.equal(p.currentTemp, 68, 'current 20°C → 68°F');
  assert.equal(p.startTime, Math.floor(Date.parse('2023-11-14T22:00:00+00:00') / 1000), 'startTime from hourly[0].timestamp');
});

// --- preceding-hour alignment -------------------------------------------------
// Brightsky reports precipitation, precipitation_probability and wind_gust_speed
// for the 60 minutes BEFORE a record's timestamp. The watch draws slot i as the
// hour STARTING at startTime + i h, so slot i reads the record an hour later.

const SLOT0 = Date.UTC(2026, 8, 23, 7); // 09:00 Berlin (CEST)

/**
 * Brightsky records stamped SLOT0 + i h for each i in `offsets`, dry and calm
 * except for a 3 mm / 90% / 60 km/h hour stamped `wetStamp` hours on.
 * @param {number[]} offsets Hour offsets from SLOT0 to emit a record for.
 * @param {number} wetStamp Offset of the record carrying the shower.
 * @returns {Object[]} Brightsky `weather` records.
 */
function stampedRecords(offsets, wetStamp) {
  return offsets.map((i) => ({
    timestamp: new Date(SLOT0 + i * 3600000).toISOString(),
    temperature: i, wind_speed: 10, pressure_msl: 1013,
    precipitation: i === wetStamp ? 3 : 0,
    precipitation_probability: i === wetStamp ? 90 : 5,
    wind_gust_speed: i === wetStamp ? 60 : 20
  }));
}

/**
 * Drive a DwdProvider at 09:20 Berlin over canned records.
 * @param {Object[]} hourly Brightsky forecast records
 * @returns {{p: Object, url: string, ok: boolean}} the settled provider, the
 *   forecast URL it asked for, and whether onSuccess fired
 */
function runAt0920(hourly) {
  var forecastUrl = null;
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 15 } }));
      return;
    }
    forecastUrl = url;
    onSuccess(JSON.stringify({ weather: hourly }));
  };
  const realNow = Date.now;
  Date.now = function() { return SLOT0 + 20 * 60000; };
  const p = new DwdProvider();
  var ok = false;
  try {
    p.withProviderData(0, 0, false, function() { ok = true; }, function(f) {
      throw new Error('unexpected failure ' + JSON.stringify(f));
    });
  } finally {
    Date.now = realNow;
  }
  return { p, url: decodeURIComponent(forecastUrl), ok };
}

test('DWD puts previous-hour rain, chance and gust in the slot of the hour they cover', () => {
  // MOSMIX forecasts rain 09:00-10:00 local and stamps it 10:00 (08Z). At
  // 09:20 that is the hour the user is standing in: slot 0, the current bar.
  const range = Array.from({ length: 25 }, (_, i) => i);
  const { p, ok } = runAt0920(stampedRecords(range, 1));
  assert.equal(ok, true);
  assert.equal(p.startTime, SLOT0 / 1000, 'slot 0 starts at 09:00');
  assert.deepEqual(p.rainTrend.slice(0, 2), [3, 0], 'rain drawn over 09:00-10:00, not 10:00-11:00');
  assert.deepEqual(p.precipTrend.slice(0, 2), [0.9, 0.05]);
  assert.deepEqual(p.gustTrend.slice(0, 2), [60, 20], 'the gust head is the current hour');
  // Instants stay on their own stamp.
  assert.deepEqual(p.tempTrend.slice(0, 2), [32, 33.8], '0 °C and 1 °C → °F');
  // The 25th record only feeds the last slot's totals: every graph series is 24 long.
  ['tempTrend', 'precipTrend', 'rainTrend', 'pressureTrend',
    'dewTrend', 'windDirTrend', 'feelsTrend'].forEach((key) => {
    assert.equal(p[key].length, 24, key + ' length');
  });
  // Wind and gusts read on to PEAK_HOURS for the slots' day max; past the
  // response they are null (the feed ended), never carried forward.
  ['windTrend', 'gustTrend'].forEach((key) => {
    assert.equal(p[key].length, 49, key + ' length');
    assert.equal(p[key][26], null, key + ' past the response');
  });
});

test('DWD wind and gusts read on past the graph for the day max, paired by timestamp', () => {
  const recs = stampedRecords(Array.from({ length: 50 }, (_, i) => i), -1);
  recs.forEach((r, i) => { r.wind_speed = 100 + i; r.wind_gust_speed = 200 + i; });
  const { p, ok } = runAt0920(recs);
  assert.equal(ok, true);
  assert.equal(p.windTrend.length, 49);
  assert.equal(p.windTrend[30], 130, 'wind from the hour\'s own record');
  assert.equal(p.gustTrend[30], 231, 'gust from the record an hour on');
  assert.equal(p.gustTrend[48], 249);
});

test('DWD asks Brightsky for one record past the day-max window (last_date is inclusive)', () => {
  const { url } = runAt0920(stampedRecords(Array.from({ length: 25 }, (_, i) => i), -1));
  assert.match(url, /[?&]date=2026-09-23T07:00:00\.000Z&/);
  // To the end of LOCAL tomorrow (the host's calendar, so this holds in any TZ the
  // suite runs in — CI is UTC), plus one record: the one holding that hour's gust.
  const now = new Date(SLOT0 + 20 * 60000);
  const end = new Date(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime()
    + 3600000).toISOString();
  assert.ok(url.indexOf('last_date=' + end + '&') !== -1,
    'the record stamped at the last day-max slot\'s end: ' + url);
});

test('DWD reads the last slot\'s totals from the record after the window, and survives its absence', () => {
  // Full response: the record stamped +24 h carries slot 23's rain.
  const full = runAt0920(stampedRecords(Array.from({ length: 25 }, (_, i) => i), 24));
  assert.equal(full.p.rainTrend[23], 3);
  // Short response (end of the MOSMIX horizon): no record after slot 23. That
  // slot degrades to dry and calm instead of throwing into the parse error path.
  const short = runAt0920(stampedRecords(Array.from({ length: 24 }, (_, i) => i), 5));
  assert.equal(short.ok, true, 'a missing trailing record must not fail the fetch');
  assert.equal(short.p.rainTrend.length, 24);
  assert.equal(short.p.rainTrend[23], 0);
  assert.equal(short.p.precipTrend[23], 0);
  assert.equal(short.p.gustTrend[23], 0);
  assert.equal(short.p.rainTrend[4], 3, 'earlier slots still pair normally');
});

test('DWD pairs a slot with the record one hour later by timestamp, not by index', () => {
  // Brightsky skips the 12:00Z record (offset 5). Index pairing would slide
  // every later hour one slot early; timestamp pairing leaves only slot 4
  // (whose totals were in the skipped record) without a value.
  const offsets = Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 5);
  const records = stampedRecords(offsets, 9);
  records[2].precipitation = 1; // stamped 09Z: the 08Z-09Z hour, before the gap
  const { p } = runAt0920(records);
  assert.equal(p.rainTrend[1], 1, 'before the gap: the 08Z-09Z rain is in the 08Z slot');
  assert.equal(p.rainTrend[4], 0, 'no record for 11Z-12Z → dry');
  assert.equal(p.rainTrend[8], 3, 'after the gap: the 15Z-16Z rain stays in the 15Z slot');
  assert.equal(p.rainTrend[7], 0);
});

test('DWD pairs a slot\'s instants by timestamp too, carrying a skipped hour forward', () => {
  // 24 records (the 12:00Z one skipped) is a full window once the extra record
  // is asked for — so the instants must not slide either, or slot 8 would draw
  // 16Z's temperature over 15Z's rain.
  const offsets = Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 5);
  const records = stampedRecords(offsets, 9);
  records.forEach((r, k) => { r.pressure_msl = 1000 + offsets[k]; });
  const { p, ok } = runAt0920(records);
  assert.equal(ok, true);
  assert.equal(p.tempTrend.length, 24);
  const celsius = p.tempTrend.map((f) => Math.round((f - 32) * 5 / 9));
  // stampedRecords sets temperature = offset: slot i reads i, the skip reads 4.
  assert.deepEqual(celsius.slice(3, 9), [3, 4, 4, 6, 7, 8], 'skipped 12Z carries 11Z; later slots on their own stamp');
  assert.equal(celsius[23], 23, 'the extra record past the window feeds no instant');
  assert.deepEqual(p.pressureTrend.slice(4, 7), [1004, 1004, 1006]);
  assert.equal(p.rainTrend[8], 3, 'and slot 8 still pairs with its own hour\'s rain');
});

test('DWD maps Brightsky pressure_msl into pressureTrend', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 40, precipitation: 1.2, wind_speed: 18, wind_gust_speed: 30, pressure_msl: 1012.5, timestamp: '2023-11-14T22:00:00+00:00' },
      // second hour omits pressure_msl -> 0, which forecast-series rejects (line off)
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.deepEqual(p.pressureTrend, [1012.5, 0], 'pressure_msl hPa passthrough, absent → 0');
});

const feelsLikeF = require('../src/pkjs/weather/feels-like.js').feelsLikeF;

test('DWD computes feelsTrend via Steadman from temperature/relative_humidity/wind_speed', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      // current_weather has no plain wind_speed — 10/30/60-minute means only.
      onSuccess(JSON.stringify({ weather: { temperature: 20, relative_humidity: 57, wind_speed_10: 8.3 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 20, relative_humidity: 50, precipitation_probability: 0, precipitation: 0, wind_speed: 20, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' },
      // no relative_humidity -> the hour falls back to the plain temp (°F)
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.equal(p.feelsTrend[0], feelsLikeF(68, 50, 20), 'Steadman on the internal °F/km/h units');
  assert.equal(p.feelsTrend[1], 50, 'missing humidity → the hour reads the actual 10 °C → 50 °F');
  assert.equal(p.currentFeels, feelsLikeF(68, 57, 8.3), 'current uses the 10-minute wind mean');
});

test('DWD computes feels from dew_point when relative_humidity is null (live MOSMIX shape)', () => {
  // Real Brightsky FORECAST records (MOSMIX sources) return relative_humidity:
  // null for every hour but always carry dew_point — before the dew-point path
  // existed, all 24 hours silently fell back to the plain temp, so the feels
  // curve rendered exactly under the temp curve and "never showed up".
  const feelsLikeFromDewF = require('../src/pkjs/weather/feels-like.js').feelsLikeFromDewF;
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      // Observation record: RH present → the existing RH path keeps priority.
      onSuccess(JSON.stringify({ weather: { temperature: 24.4, relative_humidity: 48, dew_point: 12.58, wind_speed_10: 16.6 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 24.5, relative_humidity: null, dew_point: 13.5, precipitation_probability: 0, precipitation: 0, wind_speed: 14.8, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' },
      // neither humidity nor dew point -> plain-temp fallback stays
      { temperature: 10, relative_humidity: null, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  const expected = feelsLikeFromDewF(24.5 * 9 / 5 + 32, 13.5 * 9 / 5 + 32, 14.8);
  assert.equal(p.feelsTrend[0], expected, 'dew-point Steadman when RH is null');
  assert.notEqual(p.feelsTrend[0], 24.5 * 9 / 5 + 32, 'must NOT silently equal the plain temp');
  assert.equal(p.feelsTrend[1], 50, 'no moisture data at all → plain 10 °C → 50 °F');
  assert.equal(p.currentFeels, feelsLikeF(24.4 * 9 / 5 + 32, 48, 16.6), 'RH keeps priority when present');
});

// --- dew point + wind bearing -------------------------------------------------
// Brightsky returns the full field set (no selector), so both values are already
// in the parsed JSON: dew_point (°C) was parsed for Steadman and thrown away,
// wind_direction was never read. Neither reaches the wire — both are transients
// consumed by the status-slot bake.

/**
 * Build a full 24-hour Brightsky forecast response so the mapped trends can be
 * asserted against provider.numEntries (24) rather than a short stub.
 * @param {function(number): Object} overrides per-hour extra fields
 * @returns {Object[]} Brightsky `weather` records
 */
function hours24(overrides) {
  return Array.from({ length: 24 }, (_, i) => Object.assign({
    temperature: 10,
    precipitation_probability: 0,
    precipitation: 0,
    wind_speed: 5,
    wind_gust_speed: 8,
    timestamp: new Date(Date.UTC(2023, 10, 14, 22) + i * 3600000).toISOString()
  }, overrides ? overrides(i) : {}));
}

/**
 * Drive a DwdProvider over a canned forecast + current_weather pair.
 * @param {Object[]} hourly Brightsky forecast records
 * @param {Object} current Brightsky current_weather record
 * @returns {Object} the settled provider
 */
function runDwd(hourly, current) {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: current || { temperature: 20 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: hourly }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) {
    throw new Error('unexpected failure ' + JSON.stringify(f));
  });
  return p;
}

test('DWD keeps the dew point it already parses, one °F entry per hour', () => {
  const p = runDwd(hours24((i) => ({ dew_point: 5 + i * 0.5 })));
  assert.equal(p.dewTrend.length, p.numEntries, 'one entry per hourly slot');
  p.dewTrend.forEach((v, i) => {
    assert.equal(typeof v, 'number', `hour ${i} is not a number`);
    assert.ok(v > -80 && v < 140, `${v} is not a plausible °F dew point`);
  });
  assert.equal(p.dewTrend[0], 41, '5 °C → 41 °F');
  assert.equal(p.dewTrend[2], 6 * 9 / 5 + 32, '°C→°F, unrounded');
});

test('DWD sources dew point even when the feels-like gate is off', () => {
  // dewTrend has no fetch gate: it costs no request and no per-hour arithmetic,
  // so fetchFeels must not silently blank the dew slot.
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: hours24(() => ({ dew_point: 5 })) }));
  };
  const p = new DwdProvider();
  p.fetchFeels = false;
  p.withProviderData(0, 0, false, function() {}, function(f) {
    throw new Error('unexpected failure ' + JSON.stringify(f));
  });
  assert.deepEqual(p.feelsTrend, [], 'the feels gate still holds');
  assert.equal(p.dewTrend.length, p.numEntries, 'dew is ungated');
  assert.equal(p.dewTrend[0], 41);
});

test('DWD degrades a missing dew point to null, not NaN', () => {
  const p = runDwd(hours24((i) => (i === 0 ? {} : { dew_point: 5 })));
  assert.equal(p.dewTrend.length, p.numEntries);
  assert.equal(p.dewTrend[0], null, 'null → the dew slot renders --');
  assert.equal(p.dewTrend[1], 41);
});

test('DWD maps wind_direction into windDirTrend, degrees 0-359 "comes from"', () => {
  const p = runDwd(hours24((i) => ({ wind_direction: i * 15 })));
  assert.equal(p.windDirTrend.length, p.numEntries, 'one entry per hourly slot');
  p.windDirTrend.forEach((v, i) => {
    assert.equal(typeof v, 'number', `hour ${i} is not a number`);
    assert.ok(v >= 0 && v < 360, `${v} is outside [0, 360)`);
  });
  assert.equal(p.windDirTrend[0], 0);
  assert.equal(p.windDirTrend[18], 270, 'a westerly is kept as 270, not flipped downwind here');
});

test('DWD normalizes an out-of-range bearing into [0, 360)', () => {
  const p = runDwd(hours24((i) => ({ wind_direction: [360, 450, -90, 720][i % 4] })));
  assert.deepEqual(p.windDirTrend.slice(0, 4), [0, 90, 270, 0]);
  p.windDirTrend.forEach((v) => assert.ok(v >= 0 && v < 360, `${v} is outside [0, 360)`));
});

test('DWD degrades a missing bearing to null, not NaN', () => {
  const p = runDwd(hours24((i) => (i === 0 ? {} : { wind_direction: 180 })));
  assert.equal(p.windDirTrend[0], null, 'null → no arrow, the slot renders as it does today');
  assert.equal(p.windDirTrend[1], 180);
});

test('DWD falls back to the current observation for a missing first-hour bearing', () => {
  // current_weather reports no plain wind_direction — only 10/30/60-minute
  // means, the same ladder currentFeelsFrom walks for the wind speed.
  const p = runDwd(hours24((i) => (i === 0 ? {} : { wind_direction: 180 })),
                   { temperature: 20, wind_direction_30: 200, wind_direction_60: 210 });
  assert.equal(p.windDirTrend[0], 200, 'shortest window present wins');
});

test('DWD prefers the forecast bearing over the observation when both exist', () => {
  // The arrow annotates windTrend[0], which is the MOSMIX forecast, so the two
  // must come from the same record.
  const p = runDwd(hours24(() => ({ wind_direction: 180 })),
                   { temperature: 20, wind_direction_10: 20 });
  assert.equal(p.windDirTrend[0], 180);
});

test('DWD leaves currentFeels null when current_weather lacks the Steadman inputs', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));   // no rh/wind
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.equal(p.currentFeels, null, 'null → FEELS_CURRENT omitted, temp slot degrades');
});

test('DWD drops the previous UV window when the shared UV fetch fails on a reused instance', () => {
  // DWD borrows Open-Meteo's UV fetch; index.js re-fetches on one provider
  // instance, so a failed UV call must not leave cycle 1's window in place.
  const HOUR = 3600;
  const START = Math.floor(Date.parse('2023-11-14T08:00:00+00:00') / 1000);
  function respond(startEpoch, uvFails) {
    return function(url, onSuccess, onError) {
      if (url.indexOf('hourly=uv_index') !== -1) {
        if (uvFails) { onError({ code: 0, message: 'timeout' }); return; }
        const time = [], uv_index = [];
        for (let i = 0; i < 72; i += 1) { time.push(START + i * HOUR); uv_index.push(i); }
        onSuccess(JSON.stringify({ hourly: { time, uv_index } }));
        return;
      }
      if (url.indexOf('/current_weather') !== -1) {
        onSuccess(JSON.stringify({ weather: { temperature: 20 } }));
        return;
      }
      onSuccess(JSON.stringify({ weather: [
        { temperature: 0, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0,
          timestamp: new Date(startEpoch * 1000).toISOString() }
      ] }));
    };
  }
  const p = new DwdProvider();
  p.fetchUv = true;
  responder = respond(START, false);
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('cycle 1 failed: ' + JSON.stringify(f)); });
  // Entry 0 is the 08:00-09:00 hour, whose GFS mean is stamped 09:00 (value 1).
  assert.equal(p.uvTrend[0], 1, 'cycle 1 adopted the UV window aligned to 08:00');
  assert.ok(p.uvTrend.length > 0);

  responder = respond(START + HOUR, true);
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('cycle 2 failed: ' + JSON.stringify(f)); });
  assert.equal(p.startTime, START + HOUR);
  assert.deepEqual(p.uvTrend, [], 'stale UV dropped when the UV call fails');
});
