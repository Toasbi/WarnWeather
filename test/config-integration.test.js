// test/config-integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const rainTier = require('../src/pkjs/weather/rain-tier.js');
const colors = require('../src/pkjs/pebble-colors.js');

test('rain-tier consumes library platform classification (flint -> single white/fg stop)', () => {
  assert.deepEqual(rainTier.buildPalette('flint', 'multicolor').rgb, [colors.GColorWhite]);
  assert.deepEqual(rainTier.buildPalette('basalt', 'white').rgb, [colors.GColorWhite]);
  assert.ok(rainTier.buildPalette('basalt', 'multicolor').rgb.length > 1, 'color platform keeps tier stops');
});

test('index.js builds the page through the instance; no Clay, no local env logic', () => {
  const src = fs.readFileSync('src/pkjs/index.js', 'utf8');
  ["require('./clay/_source.js')", "require('./clay/config.js')", "require('./clay/inject.js')", 'new Clay(', 'clay.setSettings(', 'function computeEnv']
    .forEach((needle) => assert.equal(src.indexOf(needle), -1, 'should be gone: ' + needle));
  ["require('./settings')", 'settings.generateUrl(', 'settings.parseResponse(', 'watchInfo: app.watchInfo']
    .forEach((needle) => assert.ok(src.indexOf(needle) !== -1, 'missing: ' + needle));
});

test('clay-settings sources defaults AND color-key set from the instance', () => {
  const cs = fs.readFileSync('src/pkjs/clay-settings.js', 'utf8');
  assert.ok(cs.indexOf("require('./settings')") !== -1, 'requires the instance');
  assert.ok(cs.indexOf('.isColorKey') !== -1, 'reuses instance color-key check');
});

test('library imports nothing app-specific (lift-out boundary)', () => {
  const dir = 'src/pkjs/config-ui';
  function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() && e.name !== 'test' ? walk(d + '/' + e.name) : (e.name.endsWith('.js') ? [d + '/' + e.name] : [])); }
  walk(dir).forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(src.indexOf("require('../settings"), -1, f + ' must not import the app');
    assert.equal(src.toLowerCase().indexOf('warnweather'), -1, f + ' must not reference WarnWeather');
  });
});
