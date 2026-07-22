// test/tomorrowio-key-test.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const tio = require('../src/pkjs/settings/tomorrowio-key-test');

test('buildTestUrl targets the realtime endpoint with the key', () => {
  const url = tio.buildTestUrl('abc123');
  assert.match(url, /^https:\/\/api\.tomorrow\.io\/v4\/weather\/realtime\?/);
  assert.match(url, /apikey=abc123(&|$)/);
});

test('buildTestUrl trims and encodes the key', () => {
  assert.match(tio.buildTestUrl('  a b  '), /apikey=a%20b(&|$)/);
  assert.match(tio.buildTestUrl(undefined), /apikey=(&|$)/);
});

test('interpretStatus: 2xx is valid', () => {
  assert.equal(tio.interpretStatus(200).ok, true);
});

test('interpretStatus: 401 invalid key, 403 access-restricted, both point at the dashboard', () => {
  const r401 = tio.interpretStatus(401);
  assert.equal(r401.ok, false);
  assert.match(r401.message, /401/);
  const r403 = tio.interpretStatus(403);
  assert.equal(r403.ok, false);
  assert.match(r403.message, /403/);
});

test('interpretStatus: 429 valid-but-limited, network/other not ok', () => {
  assert.equal(tio.interpretStatus(429).ok, false);
  assert.match(tio.interpretStatus(429).message, /429/);
  assert.equal(tio.interpretStatus(0).ok, false);
  assert.match(tio.interpretStatus(0).message, /reach/i);
  assert.equal(tio.interpretStatus(500).ok, false);
  assert.match(tio.interpretStatus(500).message, /500/);
});
