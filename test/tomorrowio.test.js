// test/tomorrowio.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const tomorrowio = require('../src/pkjs/weather/tomorrowio.js');
const mapResponse = tomorrowio.mapResponse;

// BASE is hour-aligned: 1718841600 / 3600 === 477456 exactly.
const BASE = 1718841600;

/** One 1h Timelines interval, shaped like the tomorrow.io v4 response. @returns {Object} */
function interval(i) {
  return {
    startTime: new Date((BASE + i * 3600) * 1000).toISOString(),
    values: {
      temperature: 10 + i,             // °C (units=metric)
      precipitationProbability: i,     // percent 0..100
      precipitationIntensity: i / 10,  // mm/h
      windSpeed: i,                    // m/s
      windGust: i + 2,                 // m/s
      uvIndex: i % 12
    }
  };
}

/** A response with 30 hourly intervals starting at BASE. @returns {Object} */
function sampleResponse() {
  const intervals = [];
  for (let i = 0; i < 30; i += 1) intervals.push(interval(i));
  return { data: { timelines: [{ timestep: '1h', intervals }] } };
}

test('mapResponse anchors at the current hour and converts units', () => {
  const nowEpoch = BASE + 3 * 3600 + 600; // 03:10 -> anchor at bucket 3
  const out = mapResponse(sampleResponse(), nowEpoch);

  assert.equal(out.tempTrend.length, 24);
  assert.equal(out.startTime, BASE + 3 * 3600);
  assert.equal(out.tempTrend[0], 13 * 9 / 5 + 32);        // 13 °C -> 55.4 °F
  assert.equal(out.currentTemp, 13 * 9 / 5 + 32);         // anchor bucket doubles as "now"
  assert.equal(out.precipTrend[0], 0.03);                 // 3 % -> 0.03 fraction
  assert.equal(out.rainTrend[0], 0.3);                    // mm/h passthrough
  assert.equal(out.windTrend[0], 3 * 3.6);                // m/s -> km/h
  assert.equal(out.gustTrend[0], 5 * 3.6);
  assert.equal(out.uvTrend[0], 3);
  assert.equal(out.tempTrend[23], (13 + 23) * 9 / 5 + 32);
});

test('mapResponse returns null when fewer than 24 buckets remain after the anchor', () => {
  const nowEpoch = BASE + 10 * 3600; // 30 - 10 = 20 < 24
  assert.equal(mapResponse(sampleResponse(), nowEpoch), null);
});

test('mapResponse returns null on malformed input', () => {
  assert.equal(mapResponse(null, BASE), null);
  assert.equal(mapResponse({}, BASE), null);
  assert.equal(mapResponse({ data: {} }, BASE), null);
  assert.equal(mapResponse({ data: { timelines: [] } }, BASE), null);
  assert.equal(mapResponse({ data: { timelines: [{ intervals: 'nope' }] } }, BASE), null);
});

test('missing/non-numeric optional values collapse to 0 (temperature too — yandex convention)', () => {
  const r = sampleResponse();
  r.data.timelines[0].intervals[0].values = {}; // bucket 0 loses everything
  const out = mapResponse(r, BASE);              // anchor at bucket 0
  assert.equal(out.tempTrend[0], 0);
  assert.equal(out.precipTrend[0], 0);
  assert.equal(out.windTrend[0], 0);
  assert.equal(out.currentTemp, 0);
});

test('buildUrl floors the hour, requests 1h metric timelines with the reduced field list', () => {
  const url = tomorrowio.buildUrl(52.52, 13.41, 'KEY123', BASE + 1234);
  assert.match(url, /^https:\/\/api\.tomorrow\.io\/v4\/timelines\?/);
  assert.match(url, /location=52\.52,13\.41/);
  assert.match(url, /timesteps=1h/);
  assert.match(url, /units=metric/);
  assert.match(url, /fields=temperature,precipitationProbability,precipitationIntensity,windSpeed,windGust,uvIndex/);
  assert.match(url, /apikey=KEY123/);
  const startIso = encodeURIComponent(new Date(BASE * 1000).toISOString());
  const endIso = encodeURIComponent(new Date((BASE + 25 * 3600) * 1000).toISOString());
  assert.ok(url.indexOf('startTime=' + startIso) >= 0, 'startTime is the floored hour');
  assert.ok(url.indexOf('endTime=' + endIso) >= 0, 'endTime is floored hour + 25h');
  // no weatherCode / 1d fields — nothing consumes them (see plan spec-corrections)
  assert.doesNotMatch(url, /weatherCode/);
  assert.doesNotMatch(url, /1d/);
});

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const TomorrowIoProvider = tomorrowio.TomorrowIoProvider;

test('TomorrowIoProvider identity, inheritance, base sun events', () => {
  const p = new TomorrowIoProvider('KEY123');
  assert.equal(p.id, 'tomorrowio');
  assert.equal(p.name, 'Tomorrow.io');
  assert.equal(p.apiKey, 'KEY123');
  assert.ok(p instanceof WeatherProvider);
  assert.equal(p.withSunEvents, WeatherProvider.prototype.withSunEvents);
});

test('withProviderData fails fast without an API key and makes no request', () => {
  const p = new TomorrowIoProvider('');
  let failed = null;
  p.withProviderData(52.52, 13.41, false, () => { throw new Error('should not succeed'); },
    (f) => { failed = f; });
  assert.equal(failed.stage, 'provider_data');
  assert.equal(failed.code, 'tomorrowio_missing_api_key');
});

// Minimal XHR mock (yandex.test.js pattern).
function MockXhr() {
  this.headers = {};
  MockXhr.last = this;
}
MockXhr.prototype.open = function(type, url) { this.opened = { type: type, url: url }; };
MockXhr.prototype.setRequestHeader = function(name, value) { this.headers[name] = value; };
MockXhr.prototype.send = function(body) { this.sent = true; this.body = body; };

/** 30 hourly intervals spanning -3h..+26h around now, so >=24 future buckets always exist. */
function liveSampleResponse() {
  const hourFloorSec = Math.floor(Date.now() / 3600000) * 3600;
  const intervals = [];
  for (let i = -3; i < 27; i += 1) {
    intervals.push({
      startTime: new Date((hourFloorSec + i * 3600) * 1000).toISOString(),
      values: { temperature: 20, precipitationProbability: 10, precipitationIntensity: 0,
        windSpeed: 2, windGust: 4, uvIndex: 1 }
    });
  }
  return { data: { timelines: [{ timestep: '1h', intervals }] } };
}

test('withProviderData GETs the built URL; onload populates fields; uv gated on fetchUv', () => {
  const prevXhr = global.XMLHttpRequest;
  global.XMLHttpRequest = MockXhr;
  try {
    const p = new TomorrowIoProvider('KEY123');
    let succeeded = false;
    let failed = null;
    p.withProviderData(52.52, 13.41, false, () => { succeeded = true; }, (f) => { failed = f; });

    const xhr = MockXhr.last;
    assert.equal(xhr.opened.type, 'GET');
    assert.match(xhr.opened.url, /^https:\/\/api\.tomorrow\.io\/v4\/timelines\?/);
    assert.equal(succeeded, false, 'onSuccess must not fire before onload');

    xhr.status = 200;
    xhr.responseText = JSON.stringify(liveSampleResponse());
    xhr.onload();

    assert.equal(failed, null);
    assert.equal(succeeded, true);
    assert.equal(p.tempTrend.length, 24);
    assert.equal(p.uvTrend.length, 0, 'uvTrend stays empty unless fetchUv is set');
    assert.equal(typeof p.startTime, 'number');
  } finally {
    global.XMLHttpRequest = prevXhr;
  }
});

test('withProviderData maps HTTP 401 and 429 onto tomorrowio_status_* failure codes', () => {
  const prevXhr = global.XMLHttpRequest;
  global.XMLHttpRequest = MockXhr;
  try {
    for (const status of [401, 429]) {
      const p = new TomorrowIoProvider('BADKEY');
      let failed = null;
      p.withProviderData(0, 0, false, () => { throw new Error('no'); }, (f) => { failed = f; });
      const xhr = MockXhr.last;
      xhr.status = status;
      xhr.responseText = '';
      xhr.onload();
      assert.equal(failed.stage, 'provider_data');
      assert.equal(failed.code, 'tomorrowio_status_' + status);
    }
  } finally {
    global.XMLHttpRequest = prevXhr;
  }
});
