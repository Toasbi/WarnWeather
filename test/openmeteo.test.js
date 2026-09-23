// test/openmeteo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const openmeteo = require('../src/pkjs/weather/openmeteo.js');
const { UV_HOURS } = require('../src/pkjs/weather/hourly-window.js');
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
  assert.equal(out.windTrend[0], 18);   // km/h passthrough, an instant: read at the anchor
  assert.equal(out.currentTemp, 71.5);
  // The preceding-hour fields read one bucket ahead (bucket 19 for slot 0);
  // the chance reads its 3-hour block's boundary bucket (21 for 18:00-21:00).
  assert.equal(out.precipTrend[0], 21 / 100); // probability 21% -> 0.21 fraction
  assert.equal(out.rainTrend[0], 19);   // mm passthrough
  assert.equal(out.gustTrend[0], 24);   // (19 + 5) km/h passthrough
  assert.equal(out.rainTrend[23], 42);  // the last slot reads the bucket after the window
  // Element [1] proves the per-element transform applies across the whole slice.
  assert.equal(out.tempTrend[1], 69);          // 50 + 19
  assert.equal(out.precipTrend[1], 21 / 100);  // same block, same chance
  assert.equal(out.precipTrend[3], 24 / 100);  // 21:00-22:00 opens the next block
});

test('mapResponse puts a preceding-hour value in the slot of the hour it covers', () => {
  // Open-Meteo stamps precipitation and windgusts_10m at the END of the hour
  // they cover: 5 mm / 60 km/h stamped 16:00 fell between 15:00 and 16:00.
  // The watch draws slot i as the hour STARTING at startTime + i h, so at
  // 15:10 that hour is slot 0 — the current-hour bar — not slot 1. (The
  // chance reads by 3-hour block; see the ensemble test below.)
  const json = sampleResponse();
  json.hourly.precipitation = json.hourly.time.map(() => 0);
  json.hourly.windgusts_10m = json.hourly.time.map(() => 15);
  json.hourly.precipitation[16] = 5;
  json.hourly.windgusts_10m[16] = 60;
  const out = mapResponse(json, BASE + 15 * 3600 + 600);
  assert.equal(out.startTime, BASE + 15 * 3600, 'slot 0 starts at 15:00');
  assert.equal(out.rainTrend[0], 5, 'the 15:00-16:00 rain fills the 15:00-16:00 slot');
  assert.equal(out.gustTrend[0], 60);
  assert.equal(out.rainTrend[1], 0, 'and does not leak into 16:00-17:00');
  assert.equal(out.gustTrend[1], 15);
  // Instants are untouched: temperature stays on its own stamp.
  assert.equal(out.tempTrend[0], 50 + 15);
});

/**
 * A 72-bucket response (forecast_days=3) carrying one wet 3-hour ensemble
 * block, 12:00-15:00 GMT, as Open-Meteo serves it for models=ecmwf_ifs025:
 * the rain's 3 mm spread evenly over the stamps 13, 14 and 15, and the
 * ensemble chance -- 90 % for that block, 10 % for its neighbours -- exact
 * at the 3-hour stamps and hermite-blended between them.
 * @returns {Object} The response.
 */
function ensembleResponse() {
  const json = sampleResponse();
  const blend = { 12: 10, 13: 37, 14: 72, 15: 90, 16: 72, 17: 37 };
  const time = [];
  const chance = [];
  const rain = [];
  for (let i = 0; i < 72; i += 1) {
    time.push(BASE + i * 3600);
    chance.push(blend[i] === undefined ? 10 : blend[i]);
    rain.push(i >= 13 && i <= 15 ? 1 : 0);
  }
  json.hourly.time = time;
  json.hourly.precipitation_probability = chance;
  json.hourly.precipitation = rain;
  ['temperature_2m', 'windspeed_10m', 'windgusts_10m'].forEach((key) => {
    json.hourly[key] = time.map((_, i) => i);
  });
  return json;
}

test('mapResponse reads the ensemble chance by 3-hour block, in step with the rain', () => {
  // Read one bucket ahead like the rain, the blended stamps put 37/72/90 %
  // over the wet hours and 72/37 % over the two dry hours after them: the
  // chance peaked an hour after the rain and trailed it by two.
  const out = mapResponse(ensembleResponse(), BASE + 11 * 3600 + 600);
  assert.equal(out.startTime, BASE + 11 * 3600);
  assert.deepEqual(out.rainTrend.slice(0, 5), [0, 1, 1, 1, 0]);
  assert.deepEqual(out.precipTrend.slice(0, 8), [0.1, 0.9, 0.9, 0.9, 0.1, 0.1, 0.1, 0.1]);
});

test('three GMT days hold the last slot\'s block boundary; a missing one keeps the next bucket', () => {
  // A 23:00 anchor's last slot, 22:00-23:00 the next evening, belongs to the
  // block that ends at 00:00 two days on: bucket 48, the third GMT day's first.
  const json = ensembleResponse();
  json.hourly.precipitation_probability = json.hourly.time.map((_, i) => i);
  const out = mapResponse(json, BASE + 23 * 3600);
  assert.equal(out.precipTrend[22], 0.48);
  assert.equal(out.precipTrend[23], 0.48);
  // Cut to two days, that boundary is past the response: the slot keeps the
  // bucket after it, as before the block read.
  ['time', 'temperature_2m', 'precipitation_probability', 'precipitation',
    'windspeed_10m', 'windgusts_10m'].forEach((key) => {
    json.hourly[key] = json.hourly[key].slice(0, 48);
  });
  const cut = mapResponse(json, BASE + 23 * 3600);
  assert.equal(cut.precipTrend[21], 0.45, 'boundary 45 is still there');
  assert.equal(cut.precipTrend[22], 0.46);
  assert.equal(cut.precipTrend[23], 0.47);
});

test('buildForecastUrl asks for three GMT days', () => {
  assert.match(openmeteo.buildForecastUrl(52.52, 13.41), /&forecast_days=3(&|$)/);
});

test('mapResponse returns null when fewer than 24 buckets remain after the anchor', () => {
  // Anchor at bucket 30 -> only 18 buckets left in a 48-bucket response.
  const nowEpoch = BASE + 30 * 3600;
  assert.equal(mapResponse(sampleResponse(), nowEpoch), null);
});

test('mapResponse reads the last slot from the bucket after the window', () => {
  const out = mapResponse(sampleResponse(), BASE + 23 * 3600);
  assert.notEqual(out, null);
  assert.equal(out.rainTrend.length, 24);
  assert.equal(out.rainTrend[23], 47, 'the last slot reads the final bucket');
});

test('mapResponse degrades the last slot, not the fetch, when that bucket is missing', () => {
  // Anchor at bucket 24 leaves exactly 24 buckets (a truncated response; the
  // real 72-bucket one needs an anchor of 48, two GMT days stale): every
  // instant is there, only the last
  // slot's preceding-hour bucket is not. That slot reads dry / no gust; the
  // fetch still succeeds, as it did before the one-bucket-ahead read.
  const out = mapResponse(sampleResponse(), BASE + 24 * 3600);
  assert.notEqual(out, null);
  ['tempTrend', 'precipTrend', 'rainTrend', 'windTrend', 'gustTrend'].forEach((key) => {
    assert.equal(out[key].length, 24, key + ' length');
  });
  assert.equal(out.rainTrend[0], 25, 'slot 0 still reads one bucket ahead');
  assert.equal(out.rainTrend[22], 47);
  assert.equal(out.rainTrend[23], 0);
  assert.equal(out.precipTrend[23], 0);
  assert.equal(out.gustTrend[23], null, 'no gust → getPayload coerces to 0');
  // A field array shorter than `time` is still short, not padded.
  const short = sampleResponse();
  short.hourly.precipitation_probability.pop();
  short.hourly.precipitation_probability.pop();
  assert.equal(mapResponse(short, BASE + 24 * 3600).precipTrend.length, 21);
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

test('mapGusts aligns gusts to the forecast start time by timestamp, one hour ahead', () => {
  // windgusts_10m is the max of the PRECEDING hour, so slot i (the hour
  // starting at startTime + i h) reads the bucket stamped an hour later.
  const time = [];
  const windgusts_10m = [];
  for (let i = 0; i < 48; i += 1) {
    time.push(BASE + i * 3600);
    windgusts_10m.push(i + 100);
  }
  const startTime = BASE + 18 * 3600;
  const out = openmeteo.mapGusts({ hourly: { time, windgusts_10m } }, startTime);
  assert.equal(out.length, 24);
  assert.equal(out[0], 119);  // bucket 19: the 18:00-19:00 max
  assert.equal(out[23], 142); // bucket 42 (spans into tomorrow)
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
  const startTime = BASE + 18 * 3600; // sits at feed index 12; its hour ends at index 13
  const out = openmeteo.mapGusts({ hourly: { time, windgusts_10m } }, startTime);
  assert.equal(out.length, 24);
  assert.equal(out[0], 13);
});

test('mapGusts yields null for missing or non-numeric buckets (rendered as no gust)', () => {
  // Window starts an hour before the feed: slot 0 reads the BASE bucket.
  const out = openmeteo.mapGusts(
    { hourly: { time: [BASE, BASE + 3600], windgusts_10m: [null, 5] } }, BASE - 3600);
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

test('buildUvUrl requests only uv_index, from GFS', () => {
  const url = openmeteo.buildUvUrl(52.52, 13.41);
  assert.match(url, /[?&]hourly=uv_index(&|$)/);
  // GFS everywhere: best_match hands the UK/Ireland to UKMO, whose UV is an
  // instant, where GFS's is the mean of the hour ending at the stamp.
  assert.match(url, /[?&]models=ncep_gfs_global(&|$)/);
  // Four GMT days: the UV window runs UV_HOURS ahead (to tomorrow's end in any
  // zone), read one bucket ahead.
  assert.match(url, /[?&]forecast_days=4(&|$)/);
});

test('mapUv aligns uv_index to the forecast start by timestamp, one bucket ahead, UV_HOURS deep', () => {
  const time = [], uv_index = [];
  for (let i = 0; i < 52; i += 1) { time.push(BASE + i * 3600); uv_index.push(i); }
  const out = openmeteo.mapUv({ hourly: { time, uv_index } }, BASE + 3600); // start one hour in
  // UV_HOURS, not FORECAST_HOURS: the UV slot needs tomorrow's peak; the graph slices 24.
  assert.equal(out.length, UV_HOURS);
  // GFS UV stamped T is the mean of the hour before T, so entry 0 -- the hour
  // starting at the start -- reads the bucket stamped an hour after it.
  assert.equal(out[0], 2);
  assert.equal(out[23], 25);
  assert.equal(out[UV_HOURS - 1], UV_HOURS + 1);
});

test('a midday UV peak lands on the hour it was measured in, not the hour after', () => {
  // The 12:00-13:00 mean (UV 7) is stamped 13:00; entry 12 is 12:00-13:00.
  const time = [], uv_index = [];
  for (let i = 0; i < 52; i += 1) { time.push(BASE + i * 3600); uv_index.push(i === 13 ? 7 : 1); }
  const out = openmeteo.mapUv({ hourly: { time, uv_index } }, BASE);
  assert.equal(out[12], 7);
  assert.equal(out[13], 1);
});

test('four GMT days (forecast_days=4) source every UV_HOURS bucket from the latest start', () => {
  // The start is the floored current hour, at most 23:00 on the response's first
  // GMT day; the one-bucket-ahead read's last bucket is UV_HOURS hours later,
  // 00:00 on the fourth GMT day -- one past what three days hold.
  const day0 = Date.UTC(2026, 6, 15) / 1000;
  const time = [], uv_index = [];
  for (let i = 0; i < 96; i += 1) { time.push(day0 + i * 3600); uv_index.push(1); }
  const out = openmeteo.mapUv({ hourly: { time, uv_index } }, day0 + 23 * 3600);
  assert.equal(out.length, UV_HOURS);
  assert.ok(out.every((v) => v === 1), 'no null tail: ' + JSON.stringify(out));
  const three = openmeteo.mapUv({ hourly: { time: time.slice(0, 72), uv_index } }, day0 + 23 * 3600);
  assert.equal(three[UV_HOURS - 1], null, 'three days miss the last bucket');
});

test('mapUv: missing/non-numeric buckets become null; malformed → null', () => {
  const out = openmeteo.mapUv({ hourly: { time: [BASE, BASE + 3600, BASE + 7200], uv_index: [5, null, 6] } }, BASE);
  assert.equal(out[0], null);
  assert.equal(out[1], 6);
  assert.equal(out[2], null);
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
