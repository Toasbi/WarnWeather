// test/openmeteo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const openmeteo = require('../src/pkjs/weather/openmeteo.js');
const mapResponse = openmeteo.mapResponse;

// BASE is hour-aligned: 1718841600 / 3600 === 477456 exactly.
const BASE = 1718841600;

/**
 * Build a synthetic 48-bucket Open-Meteo forecast response.
 * @returns {Object} A response shaped like api.open-meteo.com/v1/forecast.
 */
function sampleResponse() {
  const time = [];
  const temperature_2m = [];
  const precipitation_probability = [];
  const precipitation = [];
  const windspeed_10m = [];
  const windgusts_10m = [];
  for (let i = 0; i < 48; i += 1) {
    time.push(BASE + i * 3600);
    temperature_2m.push(50 + i);
    precipitation_probability.push(i);
    precipitation.push(i);
    windspeed_10m.push(i);
    windgusts_10m.push(i + 5);
  }
  return {
    current: { temperature_2m: 71.5 },
    hourly: {
      time: time,
      temperature_2m: temperature_2m,
      precipitation_probability: precipitation_probability,
      precipitation: precipitation,
      windspeed_10m: windspeed_10m,
      windgusts_10m: windgusts_10m
    }
  };
}

test('mapResponse anchors at the current hour and returns 24-length trends', () => {
  // nowEpoch is 18:10 into the window -> floors to bucket index 18.
  const nowEpoch = BASE + 18 * 3600 + 600;
  const out = mapResponse(sampleResponse(), nowEpoch);

  assert.equal(out.tempTrend.length, 24);
  assert.equal(out.precipTrend.length, 24);
  assert.equal(out.rainTrend.length, 24);
  assert.equal(out.windTrend.length, 24);
  assert.equal(out.gustTrend.length, 24);

  // Bucket 18 is the first slot; bucket 41 is the last (spans into tomorrow).
  assert.equal(out.startTime, BASE + 18 * 3600);
  assert.equal(out.tempTrend[0], 68);   // 50 + 18
  assert.equal(out.tempTrend[23], 91);  // 50 + 41
  assert.equal(out.precipTrend[0], 18 / 100); // probability 18% -> 0.18 fraction
  assert.equal(out.rainTrend[0], 18);   // mm passthrough
  assert.equal(out.windTrend[0], 18);   // km/h passthrough
  assert.equal(out.gustTrend[0], 23);   // (18 + 5) km/h passthrough
  assert.equal(out.currentTemp, 71.5);
  // Element [1] proves the per-element transform applies across the whole slice.
  assert.equal(out.tempTrend[1], 69);          // 50 + 19
  assert.equal(out.precipTrend[1], 19 / 100);  // probability 19% at bucket 19
});

test('mapResponse returns null when fewer than 24 buckets remain after the anchor', () => {
  // Anchor at bucket 30 -> only 18 buckets left in a 48-bucket response.
  const nowEpoch = BASE + 30 * 3600;
  assert.equal(mapResponse(sampleResponse(), nowEpoch), null);
});

test('mapResponse returns null on malformed input', () => {
  assert.equal(mapResponse({}, BASE), null);
  assert.equal(mapResponse({ hourly: {} }, BASE), null);
  assert.equal(mapResponse(null, BASE), null);
});

test('buildForecastUrl pins the ecmwf_ifs025 model for region-robust precipitation', () => {
  // best_match blends models, decoupling precipitation_probability (the line)
  // from precipitation amount (the bars) so rain bars vanish at high probability.
  // ecmwf_ifs025 is a single coherent global model whose amount tracks its
  // probability everywhere, so the bars appear wherever the watch is used.
  const url = openmeteo.buildForecastUrl(52.52, 13.41);
  assert.match(url, /&models=ecmwf_ifs025(&|$)/);
});

/**
 * Split an Open-Meteo URL's `hourly=` list into its field names.
 * Asserting membership rather than the exact list keeps this test from breaking
 * every time another derived field joins the always-fetched aux call.
 * @param {string} url An Open-Meteo request URL.
 * @returns {string[]} The requested hourly field names (empty when absent).
 */
function hourlyFields(url) {
  const m = /[?&]hourly=([^&]*)/.exec(url);
  return m ? m[1].split(',') : [];
}

test('buildGustUrl requests gusts + feels and avoids the derived-field-less ECMWF pin', () => {
  // ECMWF IFS (the main forecast's pinned model) returns windgusts_10m and
  // apparent_temperature as all-null, so the aux call must NOT pin an ecmwf_*
  // model — both derived fields ride this always-fetched best_match call.
  const url = openmeteo.buildGustUrl(52.52, 13.41);
  const fields = hourlyFields(url);
  ['windgusts_10m', 'apparent_temperature'].forEach((f) => {
    assert.ok(fields.includes(f), 'the aux call must request ' + f);
  });
  assert.match(url, /&current=apparent_temperature(&|$)/);
  assert.doesNotMatch(url, /models=ecmwf/);
  assert.match(url, /&forecast_days=2(&|$)/);
  assert.match(url, /&timeformat=unixtime(&|$)/);
  assert.match(url, /&windspeed_unit=kmh(&|$)/);
  // temperature_unit applies per-request — without it the feels come back °C.
  assert.match(url, /&temperature_unit=fahrenheit(&|$)/);
});

test('mapGusts aligns gusts to the forecast start time by timestamp', () => {
  const time = [];
  const windgusts_10m = [];
  for (let i = 0; i < 48; i += 1) {
    time.push(BASE + i * 3600);
    windgusts_10m.push(i + 100);
  }
  const startTime = BASE + 18 * 3600;
  const out = openmeteo.mapGusts({ hourly: { time, windgusts_10m } }, startTime);
  assert.equal(out.length, 24);
  assert.equal(out[0], 118);  // bucket 18
  assert.equal(out[23], 141); // bucket 41 (spans into tomorrow)
});

test('mapGusts aligns even when the gust feed array is offset from the main forecast', () => {
  // The gust model's hourly array can start at a different bucket than the main
  // (ecmwf) forecast; alignment is by absolute timestamp, not array index.
  const time = [];
  const windgusts_10m = [];
  for (let i = 0; i < 48; i += 1) {
    time.push(BASE + (i + 6) * 3600); // feed starts 6h after BASE
    windgusts_10m.push(i);
  }
  const startTime = BASE + 18 * 3600; // sits at feed index 12
  const out = openmeteo.mapGusts({ hourly: { time, windgusts_10m } }, startTime);
  assert.equal(out.length, 24);
  assert.equal(out[0], 12);
});

test('mapGusts yields null for missing or non-numeric buckets (rendered as no gust)', () => {
  const out = openmeteo.mapGusts({ hourly: { time: [BASE, BASE + 3600], windgusts_10m: [null, 5] } }, BASE);
  assert.equal(out.length, 24);
  assert.equal(out[0], null); // explicit null in the feed
  assert.equal(out[1], 5);
  assert.equal(out[2], null); // beyond the feed -> missing
});

test('mapGusts returns null on malformed input', () => {
  assert.equal(openmeteo.mapGusts({}, BASE), null);
  assert.equal(openmeteo.mapGusts({ hourly: { time: [BASE] } }, BASE), null); // no windgusts_10m
  assert.equal(openmeteo.mapGusts(null, BASE), null);
});

test('buildUvUrl requests only uv_index from the keyless best_match model', () => {
  const url = openmeteo.buildUvUrl(52.52, 13.41);
  assert.match(url, /[?&]hourly=uv_index(&|$)/);
  assert.doesNotMatch(url, /models=/);          // best_match (DWD/ecmwf both lack UV)
  assert.match(url, /[?&]forecast_days=2(&|$)/); // same 48-bucket window as gusts
});

test('mapUv aligns uv_index to the forecast start by timestamp', () => {
  const time = [], uv_index = [];
  for (let i = 0; i < 26; i += 1) { time.push(BASE + i * 3600); uv_index.push(i); }
  const out = openmeteo.mapUv({ hourly: { time, uv_index } }, BASE + 3600); // start one hour in
  assert.equal(out.length, 24);
  assert.equal(out[0], 1);   // bucket at start
  assert.equal(out[23], 24);
});

test('mapUv: missing/non-numeric buckets become null; malformed → null', () => {
  const out = openmeteo.mapUv({ hourly: { time: [BASE, BASE + 3600], uv_index: [null, 5] } }, BASE);
  assert.equal(out[0], null);
  assert.equal(out[1], 5);
  assert.equal(openmeteo.mapUv({ hourly: { time: [BASE] } }, BASE), null); // no uv_index array
});

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const OpenMeteoProvider = openmeteo.OpenMeteoProvider;

test('OpenMeteoProvider has the expected identity and inherits the base class', () => {
  const p = new OpenMeteoProvider();
  assert.equal(p.id, 'openmeteo');
  assert.equal(p.name, 'Open-Meteo');
  assert.ok(p instanceof WeatherProvider);
  assert.equal(typeof p.withProviderData, 'function');
  // Sun events are inherited (no override), like dwd.js.
  assert.equal(p.withSunEvents, WeatherProvider.prototype.withSunEvents);
});

// ---- Sea-level pressure --------------------------------------------------
test('open-meteo requests pressure_msl', () => {
  assert.ok(openmeteo.buildForecastUrl(52.52, 13.41).includes('pressure_msl'),
    'forecast URL must request pressure_msl');
});

test('open-meteo maps hourly pressure_msl into pressureTrend', () => {
  const json = sampleResponse();
  json.hourly.pressure_msl = json.hourly.time.map((_, i) => 1010 + i);
  const mapped = mapResponse(json, BASE);
  assert.equal(mapped.pressureTrend.length, 24);
  assert.equal(mapped.pressureTrend[0], 1010);
});

// pressure_msl must NOT join the hard field guard: a response missing it should
// still yield a usable forecast, with pressure degrading to line-off.
test('open-meteo tolerates a response with no pressure_msl', () => {
  const json = sampleResponse();
  const mapped = mapResponse(json, BASE);
  assert.notEqual(mapped, null);
  assert.deepEqual(mapped.pressureTrend, []);
});

// ---- Feels-like (apparent temperature) -----------------------------------
test('mapFeels aligns apparent_temperature to the forecast start by timestamp', () => {
  const time = [], apparent_temperature = [];
  for (let i = 0; i < 26; i += 1) { time.push(BASE + i * 3600); apparent_temperature.push(60 + i); }
  const out = openmeteo.mapFeels({ hourly: { time, apparent_temperature } }, BASE + 3600);
  assert.equal(out.length, 24);
  assert.equal(out[0], 61);   // bucket at start
  assert.equal(out[23], 84);
});

test('mapFeels: missing/non-numeric buckets become null; malformed → null', () => {
  const out = openmeteo.mapFeels({ hourly: { time: [BASE, BASE + 3600], apparent_temperature: [null, 55] } }, BASE);
  assert.equal(out[0], null);
  assert.equal(out[1], 55);
  assert.equal(out[2], null); // beyond the feed
  assert.equal(openmeteo.mapFeels({ hourly: { time: [BASE] } }, BASE), null); // no series
  assert.equal(openmeteo.mapFeels(null, BASE), null);
});

test('adoptFeels fills feelsTrend/currentFeels, temp-backfilling null buckets', () => {
  const p = new OpenMeteoProvider();
  p.startTime = BASE;
  p.tempTrend = new Array(24).fill(0).map((_, i) => 50 + i);
  const time = [], apparent_temperature = [];
  for (let i = 0; i < 26; i += 1) { time.push(BASE + i * 3600); apparent_temperature.push(i === 2 ? null : 40 + i); }
  openmeteo.adoptFeels(p, {
    hourly: { time, apparent_temperature },
    current: { apparent_temperature: 41.5 }
  });
  assert.equal(p.feelsTrend.length, 24);
  assert.equal(p.feelsTrend[0], 40);
  assert.equal(p.feelsTrend[2], 52, 'null bucket backfills from tempTrend (50 + 2)');
  assert.equal(p.currentFeels, 41.5);
});

test('adoptFeels leaves the defaults on a malformed/absent response', () => {
  const p = new OpenMeteoProvider();
  p.startTime = BASE;
  p.tempTrend = new Array(24).fill(50);
  openmeteo.adoptFeels(p, null);                    // parse failure upstream
  assert.deepEqual(p.feelsTrend, []);
  assert.equal(p.currentFeels, null);
  openmeteo.adoptFeels(p, { hourly: { time: [BASE] } }); // no apparent_temperature
  assert.deepEqual(p.feelsTrend, []);
  assert.equal(p.currentFeels, null);
});

// ---- Dew point + wind bearing --------------------------------------------
// Both ride the always-fetched gust/feels aux call, never the main forecast:
// that one pins models=ecmwf_ifs025, which returns derived fields all-null.

/**
 * Build a synthetic aux (gust/feels) response carrying dew point and bearing.
 * @param {number} [count] Number of hourly buckets to emit.
 * @returns {Object} A response shaped like the buildGustUrl call's payload.
 */
function auxResponse(count = 48) {
  const time = [], windgusts_10m = [], apparent_temperature = [],
    dew_point_2m = [], wind_direction_10m = [];
  for (let i = 0; i < count; i += 1) {
    time.push(BASE + i * 3600);
    windgusts_10m.push(i + 5);
    apparent_temperature.push(60 + i);
    dew_point_2m.push(45 + (i % 20));        // plausible °F (the aux call asks for °F)
    wind_direction_10m.push((i * 15) % 360); // walks the compass, 15° a bucket
  }
  return {
    hourly: { time, windgusts_10m, apparent_temperature, dew_point_2m, wind_direction_10m },
    current: { apparent_temperature: 61 }
  };
}

test('buildGustUrl also carries dew point and wind bearing (no extra request)', () => {
  const fields = hourlyFields(openmeteo.buildGustUrl(52.52, 13.41));
  ['dew_point_2m', 'wind_direction_10m'].forEach((f) => {
    assert.ok(fields.includes(f), 'the aux call must request ' + f);
  });
  // The main call must NOT grow them: ecmwf_ifs025 returns derived fields null.
  const main = hourlyFields(openmeteo.buildForecastUrl(52.52, 13.41));
  assert.ok(!main.includes('dew_point_2m'));
  assert.ok(!main.includes('wind_direction_10m'));
  // Dew point is a temperature, so it needs the per-request °F ask (already
  // asserted above for feels) — restated here because dew depends on it too.
  assert.match(openmeteo.buildGustUrl(52.52, 13.41), /&temperature_unit=fahrenheit(&|$)/);
});

test('mapDew aligns dew_point_2m to the forecast start by timestamp', () => {
  const out = openmeteo.mapDew(auxResponse(), BASE + 3600); // start one hour in
  assert.equal(out.length, 24);
  assert.equal(out[0], 46);  // 45 + (1 % 20)
  assert.equal(out[23], 49); // 45 + (24 % 20)
});

test('mapDew: missing/non-numeric buckets become null; malformed → null', () => {
  const out = openmeteo.mapDew(
    { hourly: { time: [BASE, BASE + 3600], dew_point_2m: [null, 51.8] } }, BASE);
  assert.equal(out[0], null);
  assert.equal(out[1], 51.8);
  assert.equal(out[2], null); // beyond the feed
  assert.equal(openmeteo.mapDew({ hourly: { time: [BASE] } }, BASE), null); // no series
  assert.equal(openmeteo.mapDew(null, BASE), null);
});

test('mapWindDirection aligns wind_direction_10m by timestamp', () => {
  const out = openmeteo.mapWindDirection(auxResponse(), BASE + 2 * 3600);
  assert.equal(out.length, 24);
  assert.equal(out[0], 30); // bucket 2 -> 2 * 15
  assert.ok(out.every((v) => v >= 0 && v < 360), 'every bearing sits in [0, 360)');
});

test('mapWindDirection normalizes a bearing into [0, 360)', () => {
  // 360 is "north" in some feeds; the sector maths downstream assumes [0, 360).
  const out = openmeteo.mapWindDirection(
    { hourly: { time: [BASE, BASE + 3600, BASE + 7200], wind_direction_10m: [360, 725, -90] } },
    BASE);
  assert.equal(out[0], 0);
  assert.equal(out[1], 5);
  assert.equal(out[2], 270);
});

test('mapWindDirection: missing buckets become null; malformed → null', () => {
  const out = openmeteo.mapWindDirection(
    { hourly: { time: [BASE, BASE + 3600], wind_direction_10m: [null, 180] } }, BASE);
  assert.equal(out[0], null);
  assert.equal(out[1], 180);
  assert.equal(out[2], null);
  assert.equal(openmeteo.mapWindDirection({ hourly: { time: [BASE] } }, BASE), null);
  assert.equal(openmeteo.mapWindDirection(null, BASE), null);
});

test('adoptDewAndDirection fills a full window of °F dew points and bearings', () => {
  const p = new OpenMeteoProvider();
  p.startTime = BASE;
  openmeteo.adoptDewAndDirection(p, auxResponse());

  assert.equal(p.dewTrend.length, p.numEntries);
  assert.ok(p.dewTrend.every((v) => typeof v === 'number' && v > -80 && v < 120),
    'dew points are plausible °F numbers: ' + JSON.stringify(p.dewTrend));

  assert.equal(p.windDirTrend.length, p.numEntries);
  assert.ok(p.windDirTrend.every((v) => typeof v === 'number' && v >= 0 && v < 360),
    'bearings sit in [0, 360): ' + JSON.stringify(p.windDirTrend));
});

test('adoptDewAndDirection leaves the empty defaults on a malformed/absent response', () => {
  const p = new OpenMeteoProvider();
  p.startTime = BASE;
  openmeteo.adoptDewAndDirection(p, null);                    // parse failure upstream
  assert.deepEqual(p.dewTrend, []);
  assert.deepEqual(p.windDirTrend, []);
  openmeteo.adoptDewAndDirection(p, { hourly: { time: [BASE] } }); // neither series present
  assert.deepEqual(p.dewTrend, []);
  assert.deepEqual(p.windDirTrend, []);
});

test('adoptDewAndDirection adopts each series independently', () => {
  // A feed carrying only one of the two must not block the other.
  const p = new OpenMeteoProvider();
  p.startTime = BASE;
  openmeteo.adoptDewAndDirection(p, { hourly: { time: [BASE], dew_point_2m: [50] } });
  assert.equal(p.dewTrend.length, 24);
  assert.deepEqual(p.windDirTrend, [], 'no bearing series -> no bearings');
});
