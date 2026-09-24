const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const radarSky = require('../src/pkjs/weather/radar-sky.js');

const Q = radarSky.SLOT_SECONDS;
const SLOT0 = 1790200800 + 5 * 60;   // a 5-min radar slot, 5 min past a quarter hour

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

test('the Open-Meteo request asks for the four 15-minute fields in unix time', () => {
  const url = radarSky.buildOpenMeteoSkyUrl(52.5, 13.4);
  ['minutely_15=cloud_cover,sunshine_duration,lightning_potential,weather_code',
    'timeformat=unixtime', 'past_minutely_15=1',
    'forecast_minutely_15=' + (radarSky.NUM_SLOTS + 2)].forEach((part) => {
    assert.ok(url.indexOf(part) >= 0, part);
  });
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
      cloud_cover: () => 100, sunshine_duration: () => 900, weather_code: () => 3
    }), SLOT0);
    const at = 'server quarter hour ' + (serverQuarter - start) / Q + ' slot(s) from the start';
    assert.deepEqual(sky.clouds, Array(radarSky.NUM_SLOTS).fill(250), at + ': every cloud bucket');
    assert.deepEqual(sky.suns, Array(radarSky.NUM_SLOTS).fill(250), at + ': every sun bucket');
  });
});

test('maps cloud %, sunshine seconds and lightning by timestamp onto the slots', () => {
  const start = radarSky.skyStartFor(SLOT0);
  // The response starts one bucket early (past_minutely_15=1): the mapper must
  // pick by timestamp, not by index. Bucket i is stamped start + (i - 1) Q.
  const json = response(start - Q, 12, {
    cloud_cover: (i) => (i === 1 ? 50 : 100),
    // Sunshine is a PRECEDING-15-minutes sum: the bucket stamped at the start
    // (i = 1) is the quarter hour BEFORE slot 0, and slot k reads bucket k + 2.
    sunshine_duration: (i) => ({ 1: 300, 2: 900, 3: 450 }[i] || 0),
    weather_code: (i) => (i === 3 ? 95 : 3),
    lightning_potential: (i) => (i === 4 ? 2.5 : 0)
  });
  const sky = radarSky.mapOpenMeteoSky(json, SLOT0);
  assert.equal(sky.start, start);
  assert.equal(sky.clouds.length, 9);
  assert.deepEqual(sky.clouds.slice(0, 2), [125, 250], '50 % -> 125, 100 % -> 250');
  assert.deepEqual(sky.suns.slice(0, 3), [250, 125, 0], 'a whole sunny quarter hour is full scale');
  assert.deepEqual(sky.bolts.slice(0, 5), [false, false, true, true, false],
    'thunderstorm code in slot 2, lightning potential in slot 3');
});

test('slot k\'s sun comes from the bucket stamped at its END; cloud and lightning from its start', () => {
  const start = radarSky.skyStartFor(SLOT0);
  // Sun comes out at start + 1 Q after a cloudy quarter hour: Open-Meteo reports
  // the first sunny quarter hour under the NEXT stamp, start + 2 Q. That is slot 1.
  const json = response(start, radarSky.NUM_SLOTS + 1, {
    cloud_cover: (i) => (i === 0 ? 100 : 0),
    sunshine_duration: (i) => (i >= 2 ? 900 : 0),
    weather_code: (i) => (i === 1 ? 95 : 0)
  });
  const sky = radarSky.mapOpenMeteoSky(json, SLOT0);
  assert.deepEqual(sky.suns.slice(0, 3), [0, 250, 250], 'slot 0 cloudy, sun from slot 1');
  assert.deepEqual(sky.clouds.slice(0, 2), [250, 0], 'instants read at the slot start');
  assert.deepEqual(sky.bolts.slice(0, 3), [false, true, false], 'weather code read at the slot start');
  assert.equal(sky.suns[radarSky.NUM_SLOTS - 1], 250, 'the last slot reads the bucket after the window');
  // Drop that end bucket: the last slot's sun reads 0, its cloud still maps.
  const short = response(start, radarSky.NUM_SLOTS, {
    cloud_cover: () => 40, sunshine_duration: () => 900, weather_code: () => 0
  });
  const cut = radarSky.mapOpenMeteoSky(short, SLOT0);
  assert.equal(cut.suns[radarSky.NUM_SLOTS - 1], 0, 'a missing end bucket reads sunless');
  assert.equal(cut.suns[radarSky.NUM_SLOTS - 2], 250);
  assert.equal(cut.clouds[radarSky.NUM_SLOTS - 1], 100);
});

test('toByte: missing or negative readings are 0; it rounds and clamps at full scale', () => {
  [null, undefined, NaN, 'x', -5, 0].forEach((v) => {
    assert.equal(radarSky.toByte(v, 100), 0, String(v));
  });
  assert.equal(radarSky.toByte(50, 100), 125);
  assert.equal(radarSky.toByte(33, 100), 83, '82.5 rounds up');
  assert.equal(radarSky.toByte(450, Q), 125);
  assert.equal(radarSky.toByte(120, 100), radarSky.FULL_SCALE, 'clamped');
});

test('the fixture sky rows scale with the live path\'s toByte', () => {
  const { getFixtureRadarTuples } = require('../src/pkjs/fixture-weather.js');
  const tuples = getFixtureRadarTuples({ weather: {
    rainRadarExactMm: [0], rainRadarAreaMm: [0], radarStartEpoch: SLOT0,
    sky: { cloudPct: [50, null, 120, 'x'], sunPct: [-10, 33, 100, 0], lightning: [0, 1, 0, 0] }
  } });
  const bytes = tuples.RADAR_SKY_UINT8;
  assert.equal(bytes[4], 4, 'four slots');
  assert.deepEqual(bytes.slice(5, 9), [125, 0, 250, 0], 'clouds: null reads 0, 120 % clamps, a non-number reads 0 (not NaN)');
  assert.deepEqual(bytes.slice(9, 13), [0, 83, 250, 0], 'suns: a negative reads 0');
});

test('a slot the response lacks reads as clear, sunless and calm; no slots at all is null', () => {
  const start = radarSky.skyStartFor(SLOT0);
  const sky = radarSky.mapOpenMeteoSky(response(start, 3, {
    cloud_cover: () => 80, sunshine_duration: () => 0, weather_code: () => 3
  }), SLOT0);
  assert.equal(sky.clouds[3], 0);
  assert.equal(sky.bolts[8], false);
  assert.equal(radarSky.mapOpenMeteoSky(response(start + 100 * Q, 3, { cloud_cover: () => 1 }), SLOT0), null);
  assert.equal(radarSky.mapOpenMeteoSky({}, SLOT0), null);
  assert.equal(radarSky.mapOpenMeteoSky(null, SLOT0), null);
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
    WeatherProvider.request = (url, method, onOk) => onOk(JSON.stringify(response(start, 10, {
      cloud_cover: () => 100, sunshine_duration: () => 0, weather_code: () => 3, lightning_potential: () => 0
    })));
    let got;
    radarSky.createSkySource('openmeteo').fetchSkyTupleAt(52, 13, SLOT0, (t) => { got = t; });
    assert.equal(got.RADAR_SKY_UINT8.length, 25);
    assert.equal(got.RADAR_SKY_UINT8[5], 250, 'first slot overcast');
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
