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
    'timeformat=unixtime', 'past_minutely_15=1'].forEach((part) => {
    assert.ok(url.indexOf(part) >= 0, part);
  });
});

test('maps cloud %, sunshine seconds and lightning by timestamp onto the slots', () => {
  const start = radarSky.skyStartFor(SLOT0);
  // The response starts one bucket early (past_minutely_15=1): the mapper must
  // pick by timestamp, not by index.
  const json = response(start - Q, 12, {
    cloud_cover: (i) => (i === 1 ? 50 : 100),
    sunshine_duration: (i) => (i === 1 ? 900 : (i === 2 ? 450 : 0)),
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
  assert.equal(radarSky.skySourceIdFor(null), 'disabled');
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
