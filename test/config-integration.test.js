// test/config-integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const colors = require('../src/pkjs/theme/domain/pebble-colors.js');

test('library imports nothing app-specific (lift-out boundary)', () => {
  const dir = 'src/pkjs/config-ui';
  function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() && e.name !== 'test' ? walk(d + '/' + e.name) : (e.name.endsWith('.js') ? [d + '/' + e.name] : [])); }
  walk(dir).forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(src.indexOf("require('../settings"), -1, f + ' must not import the app');
    assert.equal(src.toLowerCase().indexOf('warnweather'), -1, f + ' must not reference WarnWeather');
  });
});

test('webviewclosed fills empty credential fields from the parked slot before saving', () => {
  // The wiring half of clay-settings' fillFromPreserved (its behavior is unit-tested
  // there): the save path must run the parsed response through it, or a post-reset
  // save persists '' keys and fetches fail until the next PKJS boot.
  const src = fs.readFileSync('src/pkjs/index.js', 'utf8');
  assert.ok(src.indexOf('claySettings.fillFromPreserved(settings.parseResponse(') !== -1,
    'the parsed config response must pass through fillFromPreserved before save');
});
