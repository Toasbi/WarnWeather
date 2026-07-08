const test = require('node:test');
const assert = require('node:assert/strict');
const radar = require('../src/pkjs/weather/radar.js');
const rainbowRadar = require('../src/pkjs/weather/rainbow-radar.js');
const radarFactory = require('../src/pkjs/weather/radar-factory.js');
const schema = require('../src/pkjs/settings/schema.js');

const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };

test("createRadarSource('dwd') routes to radar.fetchRadarTuplesAt with lat/lon/slot", () => {
  let seen = null;
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [2], RAIN_RADAR_START: 100 };
  const orig = radar.fetchRadarTuplesAt;
  radar.fetchRadarTuplesAt = function(lat, lon, slot, cb) { seen = { lat, lon, slot }; cb(fetched); };
  try {
    const source = radarFactory.createRadarSource('dwd', { rainbowEndpoint: '' });
    let result;
    source.fetchRadarTuplesAt(52.5, 13.4, 100, function(t) { result = t; });
    assert.deepEqual(seen, { lat: 52.5, lon: 13.4, slot: 100 });
    assert.equal(result, fetched);
  } finally {
    radar.fetchRadarTuplesAt = orig;
  }
});

test("createRadarSource('rainbow') binds cfg.rainbowEndpoint and routes to rainbowRadar.fetchRadarTuplesAt", () => {
  let seen = null;
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [0], RAIN_RADAR_START: 100 };
  const orig = rainbowRadar.fetchRadarTuplesAt;
  rainbowRadar.fetchRadarTuplesAt = function(endpoint, lat, lon, slot, cb) {
    seen = { endpoint, lat, lon, slot }; cb(fetched);
  };
  try {
    const source = radarFactory.createRadarSource('rainbow', { rainbowEndpoint: 'https://proxy.example/rainbow-nowcast' });
    let result;
    source.fetchRadarTuplesAt(52.5, 13.4, 100, function(t) { result = t; });
    assert.deepEqual(seen, { endpoint: 'https://proxy.example/rainbow-nowcast', lat: 52.5, lon: 13.4, slot: 100 });
    assert.equal(result, fetched);
  } finally {
    rainbowRadar.fetchRadarTuplesAt = orig;
  }
});

test("createRadarSource('disabled') yields clearing tuples without fetching", () => {
  const origDwd = radar.fetchRadarTuplesAt;
  const origRainbow = rainbowRadar.fetchRadarTuplesAt;
  radar.fetchRadarTuplesAt = function() { throw new Error('dwd must not be called'); };
  rainbowRadar.fetchRadarTuplesAt = function() { throw new Error('rainbow must not be called'); };
  try {
    const source = radarFactory.createRadarSource('disabled', { rainbowEndpoint: '' });
    let result;
    source.fetchRadarTuplesAt(0, 0, 0, function(t) { result = t; });
    assert.deepEqual(result, CLEAR);
  } finally {
    radar.fetchRadarTuplesAt = origDwd;
    rainbowRadar.fetchRadarTuplesAt = origRainbow;
  }
});

test('unknown and unset ids fall back to disabled (clearing tuples)', () => {
  [undefined, 'bogus'].forEach(function(id) {
    const source = radarFactory.createRadarSource(id, { rainbowEndpoint: '' });
    let result;
    source.fetchRadarTuplesAt(0, 0, 0, function(t) { result = t; });
    assert.deepEqual(result, CLEAR, 'id ' + String(id) + ' clears radar');
  });
});

test('isKnownRadarSource recognizes registered ids only', () => {
  assert.equal(radarFactory.isKnownRadarSource('dwd'), true);
  assert.equal(radarFactory.isKnownRadarSource('rainbow'), true);
  assert.equal(radarFactory.isKnownRadarSource('disabled'), true);
  assert.equal(radarFactory.isKnownRadarSource('bogus'), false);
  assert.equal(radarFactory.DEFAULT_RADAR_ID, 'disabled');
});

test('schema radarProvider options exactly match the registered factory ids', () => {
  const items = [];
  schema.tabs.forEach(function(t) {
    t.sections.forEach(function(sec) {
      sec.items.forEach(function(it) { items.push(it); });
    });
  });
  const radarItem = items.filter(function(i) { return i.messageKey === 'radarProvider'; })[0];
  assert.ok(radarItem, 'radarProvider item exists in the schema');
  const schemaIds = radarItem.options.map(function(o) { return o[1]; }).sort();
  const registryIds = Object.keys(radarFactory.RADAR_FACTORIES).sort();
  assert.deepEqual(schemaIds, registryIds,
    'radarProvider schema options must equal the registered radar factory ids');
});
