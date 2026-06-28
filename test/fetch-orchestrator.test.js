// test/fetch-orchestrator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFetchCycle } = require('../src/pkjs/weather/fetch-orchestrator.js');

test('runFetchCycle resolves coordinates once and feeds both radar and forecast', () => {
  var resolveCount = 0;
  var radarCoords = null;
  var forecastArgs = null;
  var xform = function (payload) { return payload; };
  var provider = {
    withCoordinates: function (ok, fail) { resolveCount++; ok(52.5, 13.4); },
    fetchWithCoordinates: function (lat, lon, onSuccess, onFailure, force, extra, transform) {
      forecastArgs = { lat: lat, lon: lon, force: force, extra: extra, transform: transform };
    }
  };

  runFetchCycle({
    provider: provider,
    fetchRadar: function (lat, lon, cb) { radarCoords = { lat: lat, lon: lon }; cb({ R: 1 }); },
    buildExtras: function (tuples) { return { fromRadar: tuples }; },
    onSuccess: function () {},
    onFailure: function () { assert.fail('should not fail'); },
    force: true,
    payloadTransform: xform
  });

  assert.equal(resolveCount, 1);
  assert.deepEqual(radarCoords, { lat: 52.5, lon: 13.4 });
  assert.equal(forecastArgs.lat, 52.5);
  assert.equal(forecastArgs.lon, 13.4);
  assert.equal(forecastArgs.force, true);
  assert.deepEqual(forecastArgs.extra, { fromRadar: { R: 1 } });
  assert.equal(forecastArgs.transform, xform);
});

test('runFetchCycle reports failure and skips radar + forecast when coordinates fail', () => {
  var radarCalled = false;
  var failed = null;
  var provider = {
    withCoordinates: function (ok, fail) { fail({ category: 'coordinates', code: 'gps_1' }); },
    fetchWithCoordinates: function () { assert.fail('forecast must not run'); }
  };

  runFetchCycle({
    provider: provider,
    fetchRadar: function () { radarCalled = true; },
    buildExtras: function () { return {}; },
    onSuccess: function () {},
    onFailure: function (f) { failed = f; },
    force: false,
    payloadTransform: null
  });

  assert.equal(radarCalled, false);
  assert.deepEqual(failed, { category: 'coordinates', code: 'gps_1' });
});
