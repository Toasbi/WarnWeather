// test/metno-headers.test.js
// api.met.no TOS: identify via User-Agent (app + contact) with Origin as the
// fallback where the runtime forbids UA, and truncate coordinates to max
// 4 decimals (5+ → 403 Forbidden).
const test = require('node:test');
const assert = require('node:assert/strict');
const metnoHeaders = require('../src/pkjs/weather/metno-headers.js');

test('HEADERS identify the app via User-Agent and Origin', () => {
  assert.equal(metnoHeaders.HEADERS['User-Agent'], 'WarnWeather github.com/Toasbi/WarnWeather');
  assert.equal(metnoHeaders.HEADERS['Origin'], 'https://github.com/Toasbi/WarnWeather');
});

test('trunc4 limits coordinates to 4 decimals', () => {
  assert.equal(metnoHeaders.trunc4(52.520008), 52.52);
  assert.equal(metnoHeaders.trunc4(10.1234567), 10.1235);
  assert.equal(metnoHeaders.trunc4(52.5), 52.5);
  assert.equal(metnoHeaders.trunc4(-33.86785), -33.8679);
});
