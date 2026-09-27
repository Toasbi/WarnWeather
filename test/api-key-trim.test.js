// test/api-key-trim.test.js
// The settings page's "Test key" buttons trim paste whitespace, but the watch built
// its providers from the raw stored key -- so a key pasted with a trailing space
// showed "Key works" and then 401'd on the watch (tripping the auth backoff). These
// pin that the key the page tests is the key every fetch path sends.
const test = require('node:test');
const assert = require('node:assert/strict');

const PASTED = '  0123abcd\t ';
const KEY = '0123abcd';

/** Records every URL opened and every header set; never answers. */
class FakeXhr {
  open(method, url) { FakeXhr.urls.push(url); }
  send() {}
  setRequestHeader(name, value) { FakeXhr.headers.push({ name: name, value: value }); }
}
FakeXhr.urls = [];
FakeXhr.headers = [];

/**
 * Run fn with FakeXhr installed and return the URLs it opened.
 * @param {function():void} fn Code that issues requests.
 * @returns {string[]} Opened URLs.
 */
function capture(fn) {
  const real = globalThis.XMLHttpRequest;
  FakeXhr.urls = [];
  FakeXhr.headers = [];
  globalThis.XMLHttpRequest = FakeXhr;
  try { fn(); } finally {
    if (real === undefined) { delete globalThis.XMLHttpRequest; } else { globalThis.XMLHttpRequest = real; }
  }
  return FakeXhr.urls.slice();
}

/**
 * The raw (still encoded) value of one query parameter.
 * @param {string} url Request URL.
 * @param {string} name Parameter name.
 * @returns {?string} Its value up to the next '&', or null.
 */
function rawParam(url, name) {
  const m = new RegExp('[?&]' + name + '=([^&]*)').exec(url);
  return m ? m[1] : null;
}

test('OpenWeatherMap: the watch sends the same key the Test button checked', () => {
  const factory = require('../src/pkjs/provider-factory.js');
  const owmTest = require('../src/pkjs/settings/owm-key-test.js');
  const urls = capture(() => {
    factory.createProvider('openweathermap', { owmApiKey: PASTED })
      .withProviderData(52.5, 13.4, false, () => {}, () => {});
  });
  assert.equal(urls.length, 1);
  assert.equal(rawParam(urls[0], 'appid'), rawParam(owmTest.buildTestUrl(PASTED), 'appid'));
  assert.equal(rawParam(urls[0], 'appid'), KEY);
});

test('OpenWeatherMap: the key is URL-encoded like every other key-bearing URL', () => {
  const OpenWeatherMapProvider = require('../src/pkjs/weather/openweathermap.js');
  const urls = capture(() => {
    new OpenWeatherMapProvider('a&b=c').withProviderData(1, 2, false, () => {}, () => {});
  });
  assert.equal(rawParam(urls[0], 'appid'), 'a%26b%3Dc');
});

test('Tomorrow.io: forecast and radar send the same key the Test button checked', () => {
  const factory = require('../src/pkjs/provider-factory.js');
  const tioTest = require('../src/pkjs/settings/tomorrowio-key-test.js');
  const radar = require('../src/pkjs/weather/tomorrowio-radar.js');
  const urls = capture(() => {
    factory.createProvider('tomorrowio', { tomorrowioApiKey: PASTED })
      .withProviderData(52.5, 13.4, false, () => {}, () => {});
    radar.fetchRadarTuplesAt(PASTED, 52.5, 13.4, 1700000100, () => {});
  });
  assert.equal(urls.length, 2);
  const tested = rawParam(tioTest.buildTestUrl(PASTED), 'apikey');
  assert.equal(tested, KEY);
  assert.equal(rawParam(urls[0], 'apikey'), tested, 'forecast');
  assert.equal(rawParam(urls[1], 'apikey'), tested, 'radar');
});

test('Tomorrow.io radar: a whitespace-only key is a missing key, not a request', () => {
  const radar = require('../src/pkjs/weather/tomorrowio-radar.js');
  const radarWire = require('../src/pkjs/weather/radar-wire.js');
  let got;
  const urls = capture(() => { radar.fetchRadarTuplesAt(' \t', 1, 2, 1700000100, (t) => { got = t; }); });
  assert.equal(urls.length, 0);
  // A missing key clears the watch's radar, the same as an empty one.
  assert.deepEqual(got, radarWire.clearRadarTuples());
});

test('Rainbow (own key): the radar sends the trimmed key in the header, never in the URL', () => {
  const radar = require('../src/pkjs/weather/rainbow-radar.js');
  const urls = capture(() => { radar.fetchRadarTuplesWithKey(PASTED, 52.5, 13.4, 1700000100, () => {}); });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].indexOf(KEY), -1, 'the key is not in the URL');
  assert.deepEqual(FakeXhr.headers.filter((h) => h.name === 'Ocp-Apim-Subscription-Key'),
    [{ name: 'Ocp-Apim-Subscription-Key', value: KEY }]);
});

test('Rainbow (own key): a whitespace-only key is a missing key, not a request', () => {
  const radar = require('../src/pkjs/weather/rainbow-radar.js');
  const radarWire = require('../src/pkjs/weather/radar-wire.js');
  let got;
  const urls = capture(() => { radar.fetchRadarTuplesWithKey(' \t', 1, 2, 1700000100, (t) => { got = t; }); });
  assert.equal(urls.length, 0);
  assert.equal(FakeXhr.headers.length, 0);
  assert.deepEqual(got, radarWire.clearRadarTuples());
});

test('Rainbow (own key): the Test body carries the same key the radar sends', () => {
  const radarFactory = require('../src/pkjs/weather/radar-factory.js');
  const rbwTest = require('../src/pkjs/settings/rainbow-key-test.js');
  const urls = capture(() => {
    radarFactory.createRadarSource('rainbowkey', { rainbowApiKey: PASTED })
      .fetchRadarTuplesAt(52.5, 13.4, 1700000100, () => {});
  });
  assert.equal(urls.length, 1, 'the adapter sent one radar request');
  const sent = FakeXhr.headers.filter((h) => h.name === 'Ocp-Apim-Subscription-Key');
  assert.equal(sent.length, 1);
  const tested = JSON.parse(rbwTest.buildBody(PASTED)).key;
  assert.equal(tested, KEY);
  assert.equal(sent[0].value, tested, 'the radar header carries the key the Test checked');
});

test('settings Weather tab: OWM and Tomorrow.io graphs send the trimmed key', () => {
  const data = require('../src/pkjs/settings/weather-tab-data.js');
  const urls = capture(() => {
    data.fetchWeather('openweathermap', 10.5, 20.5, { owmApiKey: PASTED }, () => {});
    data.fetchWeather('tomorrowio', 11.5, 21.5, { tomorrowioApiKey: PASTED }, () => {});
  });
  const owm = urls.filter((u) => u.indexOf('openweathermap.org') >= 0);
  const tio = urls.filter((u) => u.indexOf('tomorrow.io') >= 0);
  assert.ok(owm.length >= 1 && tio.length === 1);
  owm.forEach((u) => assert.equal(rawParam(u, 'appid'), KEY));
  assert.equal(rawParam(tio[0], 'apikey'), KEY);
});

test('Save stores the API keys trimmed, and a key that only lost whitespace refetches', () => {
  global.PConf = { hooks: { onLoad: function () {}, onSubmit: function () {} } };
  const OB = require('../src/pkjs/settings/onbuild.js');
  const store = { provider: 'openweathermap', owmApiKey: KEY + ' ', yandexApiKey: '\tY',
    tomorrowioApiKey: PASTED, rainbowApiKey: PASTED, location: 'Berlin', fetch: false };
  const initial = { provider: 'openweathermap', owmApiKey: KEY + ' ', yandexApiKey: '\tY',
    tomorrowioApiKey: PASTED, rainbowApiKey: PASTED, location: 'Berlin' };
  OB.onSubmit({ get: (k) => store[k], set: (k, v) => { store[k] = v; }, getInitial: (k) => initial[k] });
  assert.equal(store.owmApiKey, KEY);
  assert.equal(store.yandexApiKey, 'Y');
  assert.equal(store.tomorrowioApiKey, KEY);
  assert.equal(store.rainbowApiKey, KEY, 'the Rainbow radar key is stored trimmed too');
  assert.equal(store.fetch, true, 'the provider now sends a different key, so refetch');

  // The Rainbow key alone: a key that only lost its whitespace still refetches.
  const rbw = { provider: 'dwd', rainbowApiKey: PASTED, location: 'Berlin', fetch: false };
  const rbwInitial = { provider: 'dwd', rainbowApiKey: PASTED, location: 'Berlin' };
  OB.onSubmit({ get: (k) => rbw[k], set: (k, v) => { rbw[k] = v; }, getInitial: (k) => rbwInitial[k] });
  assert.equal(rbw.rainbowApiKey, KEY);
  assert.equal(rbw.fetch, true, 'the Rainbow radar now sends a different key, so refetch');

  // Already-clean keys: nothing is rewritten and nothing forces a refetch.
  const clean = { provider: 'dwd', owmApiKey: KEY, tomorrowioApiKey: '', location: 'Berlin', fetch: false };
  OB.onSubmit({ get: (k) => clean[k], set: (k, v) => { clean[k] = v; }, getInitial: (k) => clean[k] });
  assert.equal(clean.fetch, false);
  assert.equal('yandexApiKey' in clean, false, 'an absent key is not created');
});
