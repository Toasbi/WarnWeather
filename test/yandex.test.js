// test/yandex.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const yandex = require('../src/pkjs/weather/yandex.js');
const mapResponse = yandex.mapResponse;

// BASE is hour-aligned: 1718841600 / 3600 === 477456 exactly.
const BASE = 1718841600;

/** One ForecastHour, shaped like the Yandex GraphQL response. @returns {Object} */
function hour(i) {
  return {
    timestamp: String(BASE + i * 3600), // Yandex returns unix seconds as a string
    temperature: 50 + i,                 // °F (requested via unit: FAHRENHEIT)
    precProbability: i / 100,            // already [0, 1]
    prec: i,                             // mm/h
    windSpeed: i,                        // km/h (requested via unit)
    windGust: i + 5,                     // km/h (requested via unit)
    uvIndex: i % 12
  };
}

/** A response with 3 days: 24 + 24 + 6 hourly buckets (distant day is partial). */
function sampleResponse() {
  const day0 = []; for (let i = 0; i < 24; i += 1) day0.push(hour(i));
  const day1 = []; for (let i = 24; i < 48; i += 1) day1.push(hour(i));
  const day2 = []; for (let i = 48; i < 54; i += 1) day2.push(hour(i));
  return {
    data: {
      weatherByPoint: {
        now: { temperature: 71 },
        forecast: { days: [{ hours: day0 }, { hours: day1 }, { hours: day2 }] }
      }
    }
  };
}

test('mapResponse flattens days, anchors at the current hour, returns 24-length trends', () => {
  const nowEpoch = BASE + 18 * 3600 + 600; // 18:10 into the window -> bucket 18
  const out = mapResponse(sampleResponse(), nowEpoch);

  assert.equal(out.tempTrend.length, 24);
  assert.equal(out.precipTrend.length, 24);
  assert.equal(out.rainTrend.length, 24);
  assert.equal(out.windTrend.length, 24);
  assert.equal(out.gustTrend.length, 24);
  assert.equal(out.uvTrend.length, 24);

  assert.equal(out.startTime, BASE + 18 * 3600);
  assert.equal(out.tempTrend[0], 68);        // 50 + 18
  assert.equal(out.tempTrend[23], 91);       // 50 + 41 (spans across the day boundary)
  assert.equal(out.precipTrend[0], 18 / 100); // already a [0,1] fraction, no division
  assert.equal(out.rainTrend[0], 18);        // mm passthrough
  assert.equal(out.windTrend[0], 18);        // km/h passthrough
  assert.equal(out.gustTrend[0], 23);        // (18 + 5) km/h passthrough
  assert.equal(out.uvTrend[0], 6);           // 18 % 12
  assert.equal(out.currentTemp, 71);
});

test('mapResponse returns null when fewer than 24 buckets remain after the anchor', () => {
  const nowEpoch = BASE + 48 * 3600; // anchor at bucket 48 -> only 6 left of 54
  assert.equal(mapResponse(sampleResponse(), nowEpoch), null);
});

test('mapResponse returns null on malformed or GraphQL-error input', () => {
  assert.equal(mapResponse({}, BASE), null);
  assert.equal(mapResponse({ data: {} }, BASE), null);
  assert.equal(mapResponse({ data: { weatherByPoint: { now: { temperature: 5 } } } }, BASE), null); // no forecast
  assert.equal(mapResponse({ errors: [{ message: 'bad key' }] }, BASE), null);
  assert.equal(mapResponse(null, BASE), null);
});

test('buildQuery requests server-side units and embeds unquoted numeric coordinates', () => {
  const q = yandex.buildQuery(52.52, 13.41);
  assert.match(q, /temperature\(unit: FAHRENHEIT\)/);
  assert.match(q, /windSpeed\(unit: KILOMETERS_PER_HOUR\)/);
  assert.match(q, /windGust\(unit: KILOMETERS_PER_HOUR\)/);
  assert.match(q, /days\(limit: 3\)/);
  assert.match(q, /lat: 52\.52/);
  assert.doesNotMatch(q, /lat: "/); // GraphQL Float literal must be unquoted
});

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const YandexProvider = yandex.YandexProvider;

test('YandexProvider has the expected identity and inherits the base class', () => {
  const p = new YandexProvider('KEY123');
  assert.equal(p.id, 'yandex');
  assert.equal(p.name, 'Yandex Weather');
  assert.equal(p.apiKey, 'KEY123');
  assert.ok(p instanceof WeatherProvider);
  assert.equal(typeof p.withProviderData, 'function');
  // Sun events are inherited from the base (local SunCalc), like openmeteo.js/dwd.js.
  assert.equal(p.withSunEvents, WeatherProvider.prototype.withSunEvents);
});

test('withProviderData fails fast without an API key and makes no request', () => {
  const p = new YandexProvider(''); // no key
  let failed = null;
  p.withProviderData(52.52, 13.41, false, () => { throw new Error('should not succeed'); },
    (f) => { failed = f; });
  assert.equal(failed.stage, 'provider_data');
  assert.equal(failed.code, 'yandex_missing_api_key');
});

// Minimal XHR mock, following the pattern in test/request-headers.test.js: records
// open()'s method/url and setRequestHeader's names/values, and captures send()'s body
// so onload() can be triggered manually to simulate a successful response.
function MockXhr() {
  this.headers = {};
  MockXhr.last = this;
}
MockXhr.prototype.open = function(type, url) { this.opened = { type: type, url: url }; };
MockXhr.prototype.setRequestHeader = function(name, value) { this.headers[name] = value; };
MockXhr.prototype.send = function(body) { this.sent = true; this.body = body; };

/**
 * A weatherByPoint-shaped fixture with 48 hourly buckets spanning from 6h before
 * "now" to 41h after it, so the >=24-future-buckets requirement holds regardless
 * of wall-clock time at test-run. @returns {Object} A full GraphQL response envelope.
 */
function liveSampleResponse() {
  const hourFloorSec = Math.floor(Date.now() / 3600000) * 3600;
  const startSec = hourFloorSec - 6 * 3600;
  const hours = [];
  for (let i = 0; i < 48; i += 1) {
    hours.push({
      timestamp: String(startSec + i * 3600),
      temperature: 50 + i,
      precProbability: i / 100,
      prec: i,
      windSpeed: i,
      windGust: i + 5,
      uvIndex: i % 12
    });
  }
  return {
    data: {
      weatherByPoint: {
        now: { temperature: 71 },
        forecast: { days: [{ hours: hours }] }
      }
    }
  };
}

test('withProviderData POSTs the built query with auth headers, and onload populates fields', () => {
  const prevXhr = global.XMLHttpRequest;
  global.XMLHttpRequest = MockXhr;
  try {
    const p = new YandexProvider('KEY123');
    let succeeded = false;
    let failed = null;
    p.withProviderData(52.52, 13.41, false, () => { succeeded = true; }, (f) => { failed = f; });

    const xhr = MockXhr.last;
    assert.equal(xhr.opened.type, 'POST');
    assert.equal(xhr.opened.url, 'https://api.weather.yandex.ru/graphql/query');
    assert.equal(xhr.body, JSON.stringify({ query: yandex.buildQuery(52.52, 13.41) }));
    assert.equal(xhr.headers['Content-Type'], 'application/json');
    assert.equal(xhr.headers['X-Yandex-Weather-Key'], 'KEY123');
    assert.equal(succeeded, false, 'onSuccess must not fire before onload');

    xhr.status = 200;
    xhr.responseText = JSON.stringify(liveSampleResponse());
    xhr.onload();

    assert.equal(failed, null);
    assert.equal(succeeded, true);
    assert.equal(p.tempTrend.length, 24);
    assert.equal(p.currentTemp, 71);
    assert.equal(typeof p.startTime, 'number');
  }
  finally {
    global.XMLHttpRequest = prevXhr;
  }
});
