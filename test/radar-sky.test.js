const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const radarSky = require('../src/pkjs/weather/radar-sky.js');

const Q = radarSky.SLOT_SECONDS;
const SLOT0 = 1790200800 + 5 * 60;   // a 5-min radar slot, 5 min past a quarter hour
// SLOT0 is 2026-09-23 22:05 UTC. Places whose sun suits a test over that window:
// Honolulu around local noon (elevation 57-69 deg), Berlin at night (below -35 deg),
// and Perth at sunrise (slot 0's quarter hour -0.3 deg at its middle, then +3 deg
// a slot, 2.9 deg in slot 1 to 24.9 deg in slot 8).
const HONOLULU = [21.3, -157.86];
const BERLIN = [52.5, 13.4];
const PERTH = [-31.95, 115.86];
const [NONE, L1, L2, L3, FULL] = [0, 62, 125, 187, 250];

/**
 * chart_stripe_level(v, 0, 250) (src/c/appendix/chart_stripe.h) ported: the level
 * the watch draws for a received byte. It rounds UP, ceil(v * 4 / 250).
 * @param {number} v Byte 0..250.
 * @returns {number} Level 0..4.
 */
function chartStripeLevel(v) {
  if (v <= 0) { return 0; }
  return Math.min(4, Math.ceil(v * 4 / 250));
}

/**
 * A minutely_15 response with one bucket per quarter hour from `from`.
 * @param {number} from First bucket start.
 * @param {number} count Buckets.
 * @param {Object} fields Field name -> function(i) value.
 * @returns {Object} Parsed-response shape.
 */
function response(from, count, fields) {
  const m = { time: [] };
  Object.keys(fields).forEach((k) => { m[k] = []; });
  for (let i = 0; i < count; i += 1) {
    m.time.push(from + i * Q);
    Object.keys(fields).forEach((k) => { m[k].push(fields[k](i)); });
  }
  return { minutely_15: m };
}

test('nine quarter-hour slots always cover the two-hour radar window', () => {
  assert.equal(radarSky.NUM_SLOTS, 9);
  assert.equal(radarSky.skyStartFor(SLOT0), 1790200800, 'the quarter hour holding slot 0');
  assert.equal(radarSky.skyStartFor(1790200800), 1790200800);
});

test('the Open-Meteo request asks for cloud by layer, the direct beam and lightning in unix time', () => {
  const url = radarSky.buildOpenMeteoSkyUrl(52.5, 13.4);
  ['minutely_15=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,'
    + 'direct_normal_irradiance,lightning_potential,weather_code&',
  'latitude=52.5', 'longitude=13.4', 'timeformat=unixtime', 'past_minutely_15=1',
  'forecast_minutely_15=' + (radarSky.NUM_SLOTS + 2)].forEach((part) => {
    assert.ok(url.indexOf(part) >= 0, part);
  });
  assert.equal(url.indexOf('sunshine_duration'), -1, 'sunshine duration is no longer asked for');
});

test('the request reaches the last slot\'s sun bucket, past the window, whatever the server\'s quarter hour', () => {
  // Open-Meteo answers `past` buckets before its current quarter hour and
  // `forecast` from it. The request goes out after slot 0 is pinned, so that
  // quarter hour is the sky's start or later; a phone clock running ahead of
  // the server's can put it one earlier.
  const url = radarSky.buildOpenMeteoSkyUrl(52.5, 13.4);
  const past = Number(/past_minutely_15=(\d+)/.exec(url)[1]);
  const forecast = Number(/forecast_minutely_15=(\d+)/.exec(url)[1]);
  const start = radarSky.skyStartFor(SLOT0);
  [start - Q, start, start + Q].forEach((serverQuarter) => {
    const sky = radarSky.mapOpenMeteoSky(response(serverQuarter - past * Q, past + forecast, {
      cloud_cover: () => 100, cloud_cover_low: () => 100, cloud_cover_mid: () => 0,
      cloud_cover_high: () => 0, direct_normal_irradiance: () => 1000, weather_code: () => 3
    }), SLOT0, ...HONOLULU);
    const at = 'server quarter hour ' + (serverQuarter - start) / Q + ' slot(s) from the start';
    assert.deepEqual(sky.clouds, Array(radarSky.NUM_SLOTS).fill(250), at + ': every cloud bucket');
    assert.deepEqual(sky.suns, Array(radarSky.NUM_SLOTS).fill(250), at + ': every sun bucket');
  });
});

test('maps weighted cloud, sun strength and lightning by timestamp onto the slots', () => {
  const start = radarSky.skyStartFor(SLOT0);
  // The response starts one bucket early (past_minutely_15=1): the mapper must
  // pick by timestamp, not by index. Bucket i is stamped start + (i - 1) Q.
  const layers = { 1: [0, 0, 100], 2: [100, 0, 0], 3: [30, 0, 0], 4: [0, 0, 0] };
  const json = response(start - Q, 12, {
    // Total cover reads 100 % in every bucket: only the layers tell a veil of
    // high cloud (slot 0) from an overcast (slot 1).
    cloud_cover: () => 100,
    cloud_cover_low: (i) => (layers[i] || [100, 0, 0])[0],
    cloud_cover_mid: (i) => (layers[i] || [100, 0, 0])[1],
    cloud_cover_high: (i) => (layers[i] || [100, 0, 0])[2],
    // The direct beam is a PRECEDING-15-minutes mean: the bucket stamped at the
    // start (i = 1) is the quarter hour BEFORE slot 0, and slot k reads bucket
    // k + 2. Over Honolulu's noon 80 % of the clear-sky beam is about 740 W/m².
    direct_normal_irradiance: (i) => ({ 1: 0, 2: 900, 3: 370 }[i] || 0),
    weather_code: (i) => (i === 3 ? 95 : 3),
    lightning_potential: (i) => (i === 4 ? 2.5 : 0)
  });
  const sky = radarSky.mapOpenMeteoSky(json, SLOT0, ...HONOLULU);
  assert.equal(sky.start, start);
  assert.equal(sky.clouds.length, 9);
  assert.deepEqual(sky.clouds.slice(0, 4), [L2, FULL, L1, NONE],
    'thin high cloud alone counts half; overcast is full; 30 % low cloud is level 1; clear is nothing');
  assert.deepEqual(sky.suns.slice(0, 3), [FULL, L2, NONE],
    'above 80 % of a clear sky\'s beam is full, half of that is level 2');
  assert.deepEqual(sky.bolts.slice(0, 5), [false, false, true, true, false],
    'thunderstorm code in slot 2, lightning potential in slot 3');
  sky.clouds.concat(sky.suns).forEach((b) => assert.ok(radarSky.LEVEL_BYTES.indexOf(b) >= 0,
    b + ' is a level byte'));
});

test('slot k\'s sun comes from the bucket stamped at its END; cloud and lightning from its start', () => {
  const start = radarSky.skyStartFor(SLOT0);
  // Sun comes out at start + 1 Q after a cloudy quarter hour: Open-Meteo reports
  // the first sunny quarter hour under the NEXT stamp, start + 2 Q. That is slot 1.
  const json = response(start, radarSky.NUM_SLOTS + 1, {
    cloud_cover: (i) => (i === 0 ? 100 : 0),
    direct_normal_irradiance: (i) => (i >= 2 ? 1000 : 0),
    weather_code: (i) => (i === 1 ? 95 : 0)
  });
  const sky = radarSky.mapOpenMeteoSky(json, SLOT0, ...HONOLULU);
  assert.deepEqual(sky.suns.slice(0, 3), [NONE, FULL, FULL], 'slot 0 cloudy, sun from slot 1');
  assert.deepEqual(sky.clouds.slice(0, 2), [FULL, NONE], 'instants read at the slot start');
  assert.deepEqual(sky.bolts.slice(0, 3), [false, true, false], 'weather code read at the slot start');
  assert.equal(sky.suns[radarSky.NUM_SLOTS - 1], FULL, 'the last slot reads the bucket after the window');
  // Drop that end bucket: the last slot's sun reads 0, its cloud still maps.
  const short = response(start, radarSky.NUM_SLOTS, {
    cloud_cover: () => 40, direct_normal_irradiance: () => 1000, weather_code: () => 0
  });
  const cut = radarSky.mapOpenMeteoSky(short, SLOT0, ...HONOLULU);
  assert.equal(cut.suns[radarSky.NUM_SLOTS - 1], NONE, 'a missing end bucket reads sunless');
  assert.equal(cut.suns[radarSky.NUM_SLOTS - 2], FULL);
  assert.equal(cut.clouds[radarSky.NUM_SLOTS - 1], L2, '40 % total cover (no layers) is nearest level 2');
});

test('the sun\'s elevation is taken half way through the quarter hour the beam was measured over', () => {
  // Perth at sunrise. Slot 0's beam bucket, stamped at its end (22:15 UTC), covers
  // 22:00-22:15, whose middle has the sun 0.3 deg below the horizon: no sun, though
  // at the end stamp itself it is already up by more than a degree. Slot 1's middle
  // (22:22:30) has it 2.9 deg up, where 80 % of a clear sky's beam is about 110 W/m²
  // (at its end stamp, 4.5 deg, some 180 W/m²).
  const start = radarSky.skyStartFor(SLOT0);
  const json = response(start, radarSky.NUM_SLOTS + 1, {
    cloud_cover: () => 0, direct_normal_irradiance: (i) => (i >= 1 && i <= 2 ? 100 : 0)
  });
  const sky = radarSky.mapOpenMeteoSky(json, SLOT0, ...PERTH);
  assert.ok(radarSky.solarElevationDeg(start + Q / 2, ...PERTH) < radarSky.SUN_MIN_ELEVATION_DEG);
  assert.ok(radarSky.solarElevationDeg(start + Q, ...PERTH) > radarSky.SUN_MIN_ELEVATION_DEG);
  assert.deepEqual(sky.suns.slice(0, 2), [NONE, FULL]);
});

test('a clear low-sun morning draws a full sun row, a hazy one a weaker row', () => {
  // Perth's clear sunrise, slot by slot: a clear sky's direct beam rises from about
  // 150 W/m² at 3 deg to 630 at 25 deg. Measured against the clear sky at each
  // elevation, every slot with the sun up is full; the first, before sunrise, is
  // empty even with a stray reading.
  const clear = [40, 150, 280, 380, 450, 520, 560, 600, 630];
  const start = radarSky.skyStartFor(SLOT0);
  const json = response(start + Q, radarSky.NUM_SLOTS, {
    direct_normal_irradiance: (i) => clear[i]
  });
  const sky = radarSky.mapOpenMeteoSky(json, SLOT0, ...PERTH);
  assert.deepEqual(sky.suns, [NONE].concat(Array(radarSky.NUM_SLOTS - 1).fill(FULL)));
  // Through haze the beam drops to a third, and the row thins with it to level 1
  // or 2: the beam's strength sets the row, not whether the sun counts as shining.
  const hazy = radarSky.mapOpenMeteoSky(response(start + Q, radarSky.NUM_SLOTS, {
    direct_normal_irradiance: (i) => clear[i] / 3
  }), SLOT0, ...PERTH);
  hazy.suns.slice(1).forEach((b, k) => assert.ok(b === L1 || b === L2, 'slot ' + (k + 1) + ': ' + b));
});

test('shareToLevelByte: the nearest of the four levels; missing or negative is 0, above 1 is full', () => {
  [null, undefined, NaN, 'x', Infinity, -0.5, 0, 0.1249].forEach((v) => {
    assert.equal(radarSky.shareToLevelByte(v), NONE, String(v));
  });
  [[0.125, L1], [0.3749, L1], [0.375, L2], [0.5, L2], [0.6249, L2], [0.625, L3], [0.8749, L3],
    [0.875, FULL], [1, FULL], [1.7, FULL], ['0.5', L2]].forEach(([share, byte]) => {
    assert.equal(radarSky.shareToLevelByte(share), byte, String(share));
  });
});

test('LEVEL_BYTES: each byte draws exactly its level on the watch, and is the largest that does', () => {
  assert.deepEqual(radarSky.LEVEL_BYTES, [0, 62, 125, 187, 250]);
  assert.equal(radarSky.LEVEL_BYTES[4], radarSky.FULL_SCALE);
  radarSky.LEVEL_BYTES.forEach((b, level) => {
    assert.equal(chartStripeLevel(b), level, b + ' draws level ' + level);
    if (level < 4) { assert.equal(chartStripeLevel(b + 1), level + 1, (b + 1) + ' is already the next level'); }
  });
  // Rounded rather than floored, the odd levels' bytes would draw a level too high.
  assert.equal(chartStripeLevel(Math.round(250 / 4)), 2);
  assert.equal(chartStripeLevel(Math.round(3 * 250 / 4)), 4);
  // End to end: any share draws the level nearest to it (ties up), never one more.
  for (let i = 0; i <= 1000; i += 1) {
    const share = i / 1000;
    assert.equal(chartStripeLevel(radarSky.shareToLevelByte(share)), Math.round(share * 4), 'share ' + share);
  }
});

test('weightedCloudCover: the layers overlap with high cloud at half weight; else the total stands in', () => {
  assert.equal(radarSky.HIGH_CLOUD_WEIGHT, 0.5);
  assert.equal(radarSky.weightedCloudCover(0, 0, 100, 100), 50, 'a veil of high cloud alone draws half');
  assert.equal(radarSky.weightedCloudCover(100, 0, 0, 100), 100, 'overcast low cloud is full');
  assert.equal(radarSky.weightedCloudCover(0, 100, 100, 100), 100, 'overcast mid cloud is full');
  assert.equal(radarSky.weightedCloudCover(50, 0, 0, 50), 50);
  assert.ok(Math.abs(radarSky.weightedCloudCover(40, 50, 100, 100) - 85) < 1e-9, '1 - 0.6 * 0.5 * 0.5');
  assert.equal(radarSky.weightedCloudCover(0, 0, 25, 25), 12.5, 'a quarter veil of high cloud: the level-1 edge');
  assert.equal(radarSky.weightedCloudCover(0, 0, 0, 0), 0);
  assert.ok(Math.abs(radarSky.weightedCloudCover('20', '0', '0', '90') - 20) < 1e-9,
    'numeric strings are readings (the layers win over the total)');
  assert.equal(radarSky.weightedCloudCover(150, -10, 0, 100), 100, 'layers clamp to 0..100 %');
  // Capped at the model's total: independent layers can sum above the total the
  // model reports for overlapping ones (live Tokyo: 50/60/76 % over a 77 % total
  // would weigh in at 87.6 %, a full row where the total draws level 3).
  assert.equal(radarSky.weightedCloudCover(50, 60, 76, 77), 77, 'never above the total');
  assert.ok(Math.abs(radarSky.weightedCloudCover(50, 60, 76, null) - 87.6) < 1e-9,
    'no total to cap against: the weighted cover stands');
  // Without the layer split (any layer missing or not a number), the total cover.
  assert.equal(radarSky.weightedCloudCover(null, 0, 100, 70), 70, 'a missing layer');
  assert.equal(radarSky.weightedCloudCover(0, undefined, 100, 70), 70);
  assert.equal(radarSky.weightedCloudCover(0, 0, 'x', 70), 70, 'a non-numeric layer');
  assert.equal(radarSky.weightedCloudCover(null, null, null, 130), 100, 'the total clamps');
  assert.equal(radarSky.weightedCloudCover(null, null, null, -4), 0);
  assert.equal(radarSky.weightedCloudCover(null, null, null, null), 0, 'nothing at all reads clear');
  assert.equal(radarSky.weightedCloudCover(undefined, undefined, undefined, 'x'), 0);
});

test('clearSkyDni: Meinel with the Kasten-Young air mass, 0 with the sun down', () => {
  // 1353 * 0.7^(AM^0.678): about 947 W/m² overhead (AM ~ 1), 431 at 10 deg, 51 at 1 deg.
  assert.ok(Math.abs(radarSky.clearSkyDni(90) - 947.2) < 0.1, String(radarSky.clearSkyDni(90)));
  assert.ok(Math.abs(radarSky.clearSkyDni(10) - 430.6) < 0.1, String(radarSky.clearSkyDni(10)));
  assert.ok(Math.abs(radarSky.clearSkyDni(1) - 51.2) < 0.1, String(radarSky.clearSkyDni(1)));
  for (let h = 1; h < 90; h += 1) {
    assert.ok(radarSky.clearSkyDni(h + 1) > radarSky.clearSkyDni(h), 'rises with the sun at ' + h);
  }
  [0, -5, null, undefined, NaN].forEach((h) => assert.equal(radarSky.clearSkyDni(h), 0, String(h)));
});

test('sunShare: the beam against 80 % of a clear sky\'s at that elevation; no sun under 1 deg', () => {
  assert.equal(radarSky.SUN_FULL_CLEAR_SHARE, 0.8);
  assert.equal(radarSky.SUN_MIN_ELEVATION_DEG, 1);
  [5, 12, 30, 60, 85].forEach((h) => {
    const full = radarSky.SUN_FULL_CLEAR_SHARE * radarSky.clearSkyDni(h);
    assert.equal(radarSky.sunShare(full, h), 1, '0.8 x clear is full at ' + h + ' deg');
    assert.equal(radarSky.shareToLevelByte(radarSky.sunShare(full, h)), FULL);
    assert.equal(radarSky.sunShare(full * 1.3, h), 1, 'a clearer sky than the model clamps at full');
    assert.equal(radarSky.sunShare(full / 2, h), 0.5);
    assert.equal(radarSky.shareToLevelByte(radarSky.sunShare(full / 2, h)), L2, 'half is level 2');
  });
  // A clear low sun: at 8 deg a clear sky's beam is some 360 W/m², so a clear
  // morning's 300 W/m² is full, where a fixed W/m² scale would show it weak.
  assert.equal(radarSky.shareToLevelByte(radarSky.sunShare(300, 8)), FULL);
  assert.equal(radarSky.sunShare(500, 0.99), 0, 'below 1 deg there is no sun to draw');
  assert.equal(radarSky.sunShare(500, -10), 0);
  assert.equal(radarSky.sunShare(500, 1), 1, 'from 1 deg on');
  [null, undefined, NaN, 'x', 0, -3].forEach((d) => assert.equal(radarSky.sunShare(d, 40), 0, 'beam ' + d));
  assert.equal(radarSky.sunShare(500, null), 0, 'no elevation (no location): no sun');
});

test('solarElevationDeg: SunCalc\'s altitude in degrees; no location is null', () => {
  const SunCalc = require('suncalc');
  const mid = radarSky.skyStartFor(SLOT0) + Q / 2;
  assert.equal(radarSky.solarElevationDeg(mid, ...BERLIN),
    SunCalc.getPosition(new Date(mid * 1000), ...BERLIN).altitude * 180 / Math.PI);
  assert.ok(radarSky.solarElevationDeg(mid, ...BERLIN) < -30, 'night in Berlin');
  assert.ok(radarSky.solarElevationDeg(mid, ...HONOLULU) > 60, 'noon in Honolulu');
  assert.equal(radarSky.solarElevationDeg(mid, null, 13.4), null);
  assert.equal(radarSky.solarElevationDeg(mid, 52.5, undefined), null);
  assert.equal(radarSky.solarElevationDeg(mid, 'x', 13.4), null);
});

test('the fixture sky rows take the live path\'s nearest-level quantiser', () => {
  const { getFixtureRadarTuples } = require('../src/pkjs/fixture-weather.js');
  const cloudPct = [50, null, 120, 'x', 12, 12.5, 80, undefined];
  const sunPct = [-10, 33, 100, 0, 37.5, 87.5, NaN, 62];
  const tuples = getFixtureRadarTuples({ weather: {
    rainRadarExactMm: [0], rainRadarAreaMm: [0], radarStartEpoch: SLOT0,
    sky: { cloudPct, sunPct, lightning: [0, 1, 0, 0, 0, 0, 0, 0] }
  } });
  const bytes = tuples.RADAR_SKY_UINT8;
  assert.equal(bytes[4], 8, 'eight slots');
  assert.equal(bytes.length, 5 + 8 + 8 + 2);
  assert.deepEqual(bytes.slice(5, 13), [L2, NONE, FULL, NONE, NONE, L1, L3, NONE],
    'clouds: null, a non-number and undefined read 0 (not NaN); 120 % clamps; under 12.5 % draws nothing');
  assert.deepEqual(bytes.slice(13, 21), [NONE, L1, FULL, NONE, L2, FULL, NONE, L2],
    'suns: a negative and NaN read 0; each percentage takes its nearest level');
  cloudPct.concat(sunPct).forEach((pct, k) => assert.equal(bytes[5 + k],
    radarSky.shareToLevelByte(Number(pct) / 100), 'byte ' + k + ' is the live quantiser\'s'));
  assert.deepEqual(bytes.slice(21), [0x02, 0x00], 'lightning in slot 1');
});

test('a slot the response lacks reads as clear, sunless and calm; no slots at all is null', () => {
  const start = radarSky.skyStartFor(SLOT0);
  const sky = radarSky.mapOpenMeteoSky(response(start, 3, {
    cloud_cover: () => 80, direct_normal_irradiance: () => 1000, weather_code: () => 3
  }), SLOT0, ...HONOLULU);
  assert.equal(sky.clouds[2], L3, '80 % is nearest level 3');
  assert.equal(sky.clouds[3], NONE);
  assert.equal(sky.suns[1], FULL, 'slot 1 reads bucket 2, the last one');
  assert.equal(sky.suns[2], NONE);
  assert.equal(sky.bolts[8], false);
  assert.equal(radarSky.mapOpenMeteoSky(response(start + 100 * Q, 3, { cloud_cover: () => 1 }), SLOT0,
    ...HONOLULU), null);
  assert.equal(radarSky.mapOpenMeteoSky({}, SLOT0, ...HONOLULU), null);
  assert.equal(radarSky.mapOpenMeteoSky(null, SLOT0, ...HONOLULU), null);
});

test('without a location the sun row is empty; the cloud and lightning rows still map', () => {
  const start = radarSky.skyStartFor(SLOT0);
  const sky = radarSky.mapOpenMeteoSky(response(start, radarSky.NUM_SLOTS + 1, {
    cloud_cover: () => 60, direct_normal_irradiance: () => 1000, weather_code: () => 95
  }), SLOT0);
  assert.deepEqual(sky.suns, Array(radarSky.NUM_SLOTS).fill(NONE));
  assert.deepEqual(sky.clouds, Array(radarSky.NUM_SLOTS).fill(L2));
  assert.deepEqual(sky.bolts, Array(radarSky.NUM_SLOTS).fill(true));
});

test('lightning: thunderstorm codes or a potential at the threshold; null potential is none', () => {
  assert.equal(radarSky.isLightning(95, null), true);
  assert.equal(radarSky.isLightning(99, undefined), true);
  assert.equal(radarSky.isLightning(3, radarSky.LIGHTNING_POTENTIAL_MIN), true);
  assert.equal(radarSky.isLightning(3, radarSky.LIGHTNING_POTENTIAL_MIN - 0.1), false);
  assert.equal(radarSky.isLightning(3, null), false, 'outside ICON-D2 the potential is absent');
});

// The literal blob test/c/radar_sky_test.c decodes on the C side.
test('packSky writes radar_sky.h\'s layout: LE start, N, clouds, suns, LE lightning mask', () => {
  const bytes = radarSky.packSky({
    start: 1799086560, clouds: [0, 125, 250], suns: [250, 0, 10], bolts: [false, true, false]
  });
  assert.deepEqual(bytes, [0xE0, 0xE1, 0x3B, 0x6B, 3, 0, 125, 250, 250, 0, 10, 0x02, 0x00]);
  // Nine slots, bolt in the last: the mask's high byte carries it.
  const nine = radarSky.packSky({ start: 0, clouds: Array(9).fill(0), suns: Array(9).fill(0),
    bolts: [false, false, false, false, false, false, false, false, true] });
  assert.equal(nine.length, 5 + 18 + 2);
  assert.deepEqual(nine.slice(-2), [0x00, 0x01]);
});

test('the source follows the radar graph and the toggle; disabled clears the rows', () => {
  assert.equal(radarSky.skySourceIdFor({ radarSky: true }), 'openmeteo', 'graph is the default mode');
  assert.equal(radarSky.skySourceIdFor({ radarSky: true, radarMode: 'graph' }), 'openmeteo');
  assert.equal(radarSky.skySourceIdFor({ radarSky: true, radarMode: 'countdown' }), 'disabled');
  assert.equal(radarSky.skySourceIdFor({ radarSky: false }), 'disabled');
  // On by default: a blob without the key (or no settings yet) fetches the rows.
  assert.equal(radarSky.skySourceIdFor({}), 'openmeteo');
  assert.equal(radarSky.skySourceIdFor(null), 'openmeteo');
  let got;
  radarSky.createSkySource('disabled').fetchSkyTupleAt(0, 0, SLOT0, (t) => { got = t; });
  assert.deepEqual(got, { RADAR_SKY_UINT8: [] });
  radarSky.createSkySource('bogus').fetchSkyTupleAt(0, 0, SLOT0, (t) => { got = t; });
  assert.deepEqual(got, { RADAR_SKY_UINT8: [] }, 'an unknown id falls back to clearing');
});

test('the Open-Meteo source packs a response, and a failure is transient (null)', () => {
  const orig = WeatherProvider.request;
  const start = radarSky.skyStartFor(SLOT0);
  try {
    const urls = [];
    WeatherProvider.request = (url, method, onOk) => {
      urls.push(url);
      onOk(JSON.stringify(response(start, 10, {
        cloud_cover: () => 100, cloud_cover_low: () => 0, cloud_cover_mid: () => 0,
        cloud_cover_high: () => 100, direct_normal_irradiance: () => 1000, weather_code: () => 3,
        lightning_potential: () => 0
      })));
    };
    let got;
    radarSky.createSkySource('openmeteo').fetchSkyTupleAt(...HONOLULU, SLOT0, (t) => { got = t; });
    assert.equal(urls[0], radarSky.buildOpenMeteoSkyUrl(...HONOLULU));
    assert.equal(got.RADAR_SKY_UINT8.length, 25);
    assert.equal(got.RADAR_SKY_UINT8[5], L2, 'first slot: a veil of high cloud draws half');
    assert.equal(got.RADAR_SKY_UINT8[5 + 9], FULL, 'first slot: full sun at Honolulu\'s noon');
    // The same answer for Berlin, at night there: the source hands its location on
    // to the elevation, so the beam draws no sun.
    radarSky.createSkySource('openmeteo').fetchSkyTupleAt(...BERLIN, SLOT0, (t) => { got = t; });
    assert.deepEqual(got.RADAR_SKY_UINT8.slice(14, 23), Array(9).fill(NONE));
    WeatherProvider.request = (url, method, onOk, onErr) => onErr({ code: 'network_error' });
    radarSky.createSkySource('openmeteo').fetchSkyTupleAt(52, 13, SLOT0, (t) => { got = t; });
    assert.equal(got, null);
    WeatherProvider.request = (url, method, onOk) => onOk('not json');
    radarSky.createSkySource('openmeteo').fetchSkyTupleAt(52, 13, SLOT0, (t) => { got = t; });
    assert.equal(got, null);
  } finally {
    WeatherProvider.request = orig;
  }
});

test('isClearSkyTuple: only an empty RADAR_SKY_UINT8 is the clear', () => {
  assert.equal(radarSky.isClearSkyTuple(radarSky.clearSkyTuple()), true);
  assert.equal(radarSky.isClearSkyTuple({ RAIN_RADAR_TREND_UINT8: [1], RADAR_SKY_UINT8: [] }), true,
    'a clear merged into a radar answer');
  assert.equal(radarSky.isClearSkyTuple({ RADAR_SKY_UINT8: [0, 0, 0, 0, 0] }), false, 'real sky data');
  assert.equal(radarSky.isClearSkyTuple({ RAIN_RADAR_TREND_UINT8: [] }), false, 'no sky key at all');
  assert.equal(radarSky.isClearSkyTuple(null), false);
  assert.equal(radarSky.isClearSkyTuple(undefined), false);
});

// joinRadarAndSky: both requests start before either answers, and the callback
// runs once, when the second one does.
const RADAR = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [0], RAIN_RADAR_START: 300 };
const SKY = { RADAR_SKY_UINT8: [1, 2, 3] };

/**
 * A branch whose request is held until the test answers it.
 * @returns {{start: Function, answer: Function, started: Function}} The branch.
 */
function heldBranch() {
  let cb = null;
  return {
    start: (done) => { cb = done; },
    answer: (value) => cb(value),
    started: () => cb !== null
  };
}

test('join: both answer synchronously -> one merged callback', () => {
  const calls = [];
  radarSky.joinRadarAndSky((cb) => cb(RADAR), (cb) => cb(SKY), (t) => calls.push(t));
  assert.deepEqual(calls, [Object.assign({}, RADAR, SKY)]);
});

test('join: both requests start before either answers, in either answer order', () => {
  [['radar', 'sky'], ['sky', 'radar']].forEach((order) => {
    const radar = heldBranch();
    const sky = heldBranch();
    const calls = [];
    radarSky.joinRadarAndSky(radar.start, sky.start, (t) => calls.push(t));
    assert.ok(radar.started() && sky.started(), order.join(' then ') + ': both in flight');
    const branches = { radar: [radar, RADAR], sky: [sky, SKY] };
    branches[order[0]][0].answer(branches[order[0]][1]);
    assert.deepEqual(calls, [], order.join(' then ') + ': waits for the second');
    branches[order[1]][0].answer(branches[order[1]][1]);
    assert.deepEqual(calls, [Object.assign({}, RADAR, SKY)], order.join(' then '));
  });
});

test('join: a sync sky beside an async radar (the disabled sky source)', () => {
  const radar = heldBranch();
  const calls = [];
  radarSky.joinRadarAndSky(radar.start, (cb) => cb(radarSky.clearSkyTuple()), (t) => calls.push(t));
  assert.deepEqual(calls, []);
  radar.answer(RADAR);
  assert.deepEqual(calls, [Object.assign({}, RADAR, { RADAR_SKY_UINT8: [] })]);
});

test('join: null answers -- both null is null, one answer is that answer', () => {
  const run = (radar, sky) => {
    const calls = [];
    radarSky.joinRadarAndSky((cb) => cb(radar), (cb) => cb(sky), (t) => calls.push(t));
    assert.equal(calls.length, 1);
    return calls[0];
  };
  assert.equal(run(null, null), null);
  assert.equal(run(undefined, null), null, 'no answer at all is null');
  assert.deepEqual(run(RADAR, null), RADAR);
  assert.deepEqual(run(null, SKY), SKY);
});

test('join: a second callback from the same branch is ignored', () => {
  const radar = heldBranch();
  const sky = heldBranch();
  const calls = [];
  radarSky.joinRadarAndSky(radar.start, sky.start, (t) => calls.push(t));
  radar.answer(RADAR);
  radar.answer({ RAIN_RADAR_TREND_UINT8: [9] });
  assert.deepEqual(calls, [], 'a repeat radar answer does not stand in for the sky');
  sky.answer(SKY);
  sky.answer(null);
  radar.answer(null);
  assert.deepEqual(calls, [Object.assign({}, RADAR, SKY)], 'exactly one callback, with the first answers');
});
