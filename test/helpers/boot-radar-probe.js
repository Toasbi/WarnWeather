// test/helpers/boot-radar-probe.js
//
// Child-process probe for test/index-aplite-radar.test.js and
// test/index-radar-clear-on-failure.test.js: boots the REAL index.js on
// fresh-install defaults (radarMode 'graph', radarProvider 'rainbow' — what an
// install whose settings page was never saved still holds) for the platform
// named in argv[2], lets the first fetch cycle run, and prints one JSON line:
// how many Rainbow radar requests went out, and the radar tuples of every
// AppMessage that carried them; likewise how many Open-Meteo sky requests
// (radar-sky.js) went out, and the length of every RADAR_SKY_UINT8 sent.
//
// argv[3] (optional JSON): {settings: {...}} seeds a partial settings blob the
// boot's seedDefaults completes; {answerXhr: true} answers the reverse geocode
// and fails every other raw XHR, so the forecast half runs to its own verdict
// instead of hanging on an unanswered request; {holdRadar: true} answers the
// Rainbow radar a moment late instead of at once, and reports whether the sky
// request had gone out by then (skyBeforeRadarAnswer; null without holdRadar).
//
// A separate process per platform because index.js registers its Pebble
// listeners and module state at require time — it can only boot once.
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var platform = process.argv[2] || 'basalt';
var opts = process.argv[3] ? JSON.parse(process.argv[3]) : {};

var store = {};
global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
};
// Keep the daily update check throttled (no XHR of its own).
store.last_update_check = String(Date.now());
if (opts.settings) { store['clay-settings'] = JSON.stringify(opts.settings); }

// A production-style build: the Rainbow proxy endpoint is set.
var pkg = require(path.join(ROOT, 'package.json'));
pkg.rainbow = { endpoint: 'https://proxy.example/functions/v1/rainbow-nowcast' };

// Record every request through the shared provider transport. Answer the radar
// with a dry forecast and the sky rows with an overcast, half-sunny, stormy
// quarter-hour grid around now; never answer anything else (the forecast stays
// pending).
var radarRequests = 0;
var skyRequests = 0;
var skyBeforeRadarAnswer = null;
var WeatherProvider = require(path.join(ROOT, 'src/pkjs/weather/provider.js'));
WeatherProvider.request = function (url, type, onSuccess) {
    if (url.indexOf('rainbow-nowcast') !== -1) {
        radarRequests += 1;
        if (!opts.holdRadar) {
            onSuccess(JSON.stringify({ forecast: [] }));
            return;
        }
        setTimeout(function () {
            if (skyBeforeRadarAnswer === null) { skyBeforeRadarAnswer = skyRequests > 0; }
            onSuccess(JSON.stringify({ forecast: [] }));
        }, 20);
    } else if (url.indexOf('minutely_15') !== -1) {
        skyRequests += 1;
        var first = Math.floor(Date.now() / 1000 / 900) * 900 - 900;
        var m = { time: [], cloud_cover: [], sunshine_duration: [], lightning_potential: [], weather_code: [] };
        for (var i = 0; i < 12; i += 1) {
            m.time.push(first + i * 900);
            m.cloud_cover.push(100);
            m.sunshine_duration.push(450);
            m.lightning_potential.push(0);
            m.weather_code.push(95);
        }
        onSuccess(JSON.stringify({ minutely_15: m }));
    }
};
// Raw XHR for the fetches that bypass the provider transport (reverse geocode,
// auxiliary fetches): inert by default; with answerXhr the reverse geocode
// answers and everything else errors.
global.XMLHttpRequest = function () {
    var xhr = this;
    var url = '';
    this.open = function (method, u) { url = u; };
    this.setRequestHeader = function () {};
    this.send = function () {
        if (!opts.answerXhr) { return; }
        setTimeout(function () {
            if (url.indexOf('geocode.arcgis.com') !== -1) {
                xhr.status = 200;
                xhr.responseText = JSON.stringify({ address: { City: 'Berlin', CountryCode: 'DEU' } });
                xhr.onload();
            } else if (xhr.onerror) {
                xhr.onerror();
            }
        }, 0);
    };
};
Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { geolocation: { getCurrentPosition: function (ok) {
        ok({ coords: { latitude: 52.52, longitude: 13.405 }, timestamp: Date.now() });
    } } }
});

var listeners = {};
var radarSends = [];
var skySends = [];
global.Pebble = {
    addEventListener: function (name, fn) { listeners[name] = fn; },
    getActiveWatchInfo: function () { return { platform: platform, model: 'qemu_platform_' + platform, language: 'en' }; },
    getAccountToken: function () { return 'test-token'; },
    sendAppMessage: function (dict, ack) {
        if ('RAIN_RADAR_START' in dict) {
            radarSends.push({ start: dict.RAIN_RADAR_START, len: dict.RAIN_RADAR_TREND_UINT8.length });
        }
        if ('RADAR_SKY_UINT8' in dict) {
            skySends.push({ len: dict.RADAR_SKY_UINT8.length });
        }
        if (ack) { ack(); }
    },
    showSimpleNotificationOnPebble: function () {},
    openURL: function () {}
};
// Neutralise a developer's local dev-config.js and an armed fixture, so the
// probe always walks the real boot + fetch path (same as index-boot.test.js).
try {
    var devConfigPath = require.resolve(path.join(ROOT, 'src/pkjs/dev-config.js'));
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
} catch (e) { /* absent */ }
var fixturePath = require.resolve(path.join(ROOT, 'src/pkjs/active-fixture.generated.js'));
require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };

// index.js logs heavily; keep stdout for the one result line.
console.log = function () {};

require(path.join(ROOT, 'src/pkjs/index.js'));
listeners.ready({});
// The watch's boot handshake, which drains the channel scheduler.
listeners.appmessage({ payload: { WATCH_HAS_CONFIG: 1, WATCH_HAS_FORECAST_DATA: 0 } });

setTimeout(function () {
    process.stdout.write(JSON.stringify({
        radarRequests: radarRequests, radarSends: radarSends,
        skyRequests: skyRequests, skySends: skySends,
        skyBeforeRadarAnswer: skyBeforeRadarAnswer
    }) + '\n');
    process.exit(0);
}, 500);
