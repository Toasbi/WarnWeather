// test/config-integration-build.test.js — integration: build pipeline + createConfig instance
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Step 1: require the repo-root build wrapper and run it to emit page.generated.js
const build = require('../scripts/build-config-page.js');
build.run();

// Step 2: require the WarnWeather settings instance (which requires page.generated.js)
const settings = require('../src/pkjs/settings/index.js');

// The instance now carries an emulatorConfigUrl, and in Node (no Pebble global) generateUrl
// would read as "emulator" and emit the hosted-helper URL. This suite verifies the device
// data:-URL build output, so simulate a real basalt watch. isEmulator() reads Pebble at
// generateUrl call time (not at createConfig time), so setting this after the require is
// fine. (node:test isolates files in separate processes, so the global does not leak.)
global.Pebble = { platform: 'basalt' };

test('generateUrl returns a data: URL', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    assert.ok(url.indexOf('data:text/html;charset=utf-8,') === 0, 'must be a data: URL');
});

test('decoded HTML contains schema injected with defaults-as-hex', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    assert.ok(decoded.indexOf('"messageKey":"provider"') !== -1, 'schema injected');
    // color defaults must be hex strings, not raw integers
    assert.ok(decoded.indexOf('"colorTime":"#FFFFFF"') !== -1, 'colorTime as hex');
    assert.ok(decoded.indexOf('"colorSunday":"#FF0055"') !== -1, 'colorSunday as hex');
});

test('decoded HTML contains computed env for basalt (color platform)', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    assert.ok(decoded.indexOf('"color":true') !== -1, 'basalt env: color=true');
});

test('decoded HTML contains app blocks (blocks.js) and PConf.engine.boot()', function () {
    var url = settings.generateUrl({ values: settings.getDefaults(), watchInfo: { platform: 'basalt' }, userData: {} });
    var decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    assert.ok(decoded.indexOf('forecastPreview') !== -1, 'blocks.js forecastPreview present');
    assert.ok(decoded.indexOf('PConf.engine.boot();') !== -1, 'boot call present');
});
