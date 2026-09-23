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

// A forecast failure drops the extras that carried this cycle's radar answer, so the
// orchestrator hands that answer to onFailure: a radar CLEAR (radar off, or a source
// that can never answer) must still reach the watch — see index.js onFetchFailure.
test('runFetchCycle hands the cycle\'s radar answer to onFailure when the forecast fails', () => {
  [{ RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 }, null].forEach(function (answer) {
    var args = null;
    runFetchCycle({
      provider: {
        withCoordinates: function (ok) { ok(52.5, 13.4); },
        fetchWithCoordinates: function (lat, lon, onSuccess, onFailure) {
          onFailure({ stage: 'provider_data', code: 'tomorrowio_missing_api_key' });
        }
      },
      fetchRadar: function (lat, lon, cb) { cb(answer); },
      buildExtras: function () { return {}; },
      onSuccess: function () { assert.fail('should not succeed'); },
      onFailure: function () { args = Array.prototype.slice.call(arguments); },
      force: false,
      payloadTransform: null
    });
    assert.deepEqual(args, [{ stage: 'provider_data', code: 'tomorrowio_missing_api_key' }, answer]);
  });
});

test('runFetchCycle passes no radar answer on a coordinate failure (no radar was fetched)', () => {
  var args = null;
  runFetchCycle({
    provider: {
      withCoordinates: function (ok, fail) { fail({ category: 'coordinates', code: 'gps_1' }); },
      fetchWithCoordinates: function () { assert.fail('forecast must not run'); }
    },
    fetchRadar: function () { assert.fail('radar must not run'); },
    buildExtras: function () { return {}; },
    onSuccess: function () {},
    onFailure: function () { args = Array.prototype.slice.call(arguments); },
    force: false,
    payloadTransform: null
  });
  assert.deepEqual(args, [{ category: 'coordinates', code: 'gps_1' }]);
});
