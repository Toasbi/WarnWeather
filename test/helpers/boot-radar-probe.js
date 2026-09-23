// test/helpers/boot-radar-probe.js
//
// Child-process probe for test/index-aplite-radar.test.js: boots the REAL
// index.js on fresh-install defaults (radarMode 'graph', radarProvider
// 'rainbow' — what an install whose settings page was never saved still holds)
// for the platform named in argv[2], lets the first fetch cycle run, and
// prints one JSON line: how many Rainbow radar requests went out.
//
// A separate process per platform because index.js registers its Pebble
// listeners and module state at require time — it can only boot once.
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var platform = process.argv[2] || 'basalt';

var store = {};
global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
};
// Keep the daily update check throttled (no XHR of its own).
store.last_update_check = String(Date.now());

// A production-style build: the Rainbow proxy endpoint is set.
var pkg = require(path.join(ROOT, 'package.json'));
pkg.rainbow = { endpoint: 'https://proxy.example/functions/v1/rainbow-nowcast' };

// Record every request through the shared provider transport. Answer the radar
// with a dry forecast; never answer anything else (the forecast stays pending).
var radarRequests = 0;
var WeatherProvider = require(path.join(ROOT, 'src/pkjs/weather/provider.js'));
WeatherProvider.request = function (url, type, onSuccess) {
    if (url.indexOf('rainbow-nowcast') !== -1) {
        radarRequests += 1;
        onSuccess(JSON.stringify({ forecast: [] }));
    }
};
// Inert XHR for the auxiliary fetches that bypass the provider transport.
global.XMLHttpRequest = function () {
    this.open = function () {};
    this.setRequestHeader = function () {};
    this.send = function () {};
};
Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { geolocation: { getCurrentPosition: function (ok) {
        ok({ coords: { latitude: 52.52, longitude: 13.405 }, timestamp: Date.now() });
    } } }
});

var listeners = {};
global.Pebble = {
    addEventListener: function (name, fn) { listeners[name] = fn; },
    getActiveWatchInfo: function () { return { platform: platform, model: 'qemu_platform_' + platform, language: 'en' }; },
    getAccountToken: function () { return 'test-token'; },
    sendAppMessage: function (dict, ack) { if (ack) { ack(); } },
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
    process.stdout.write(JSON.stringify({ radarRequests: radarRequests }) + '\n');
    process.exit(0);
}, 500);
