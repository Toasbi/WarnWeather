const test = require('node:test');
const assert = require('node:assert/strict');

const owm = require('../src/pkjs/settings/owm-key-test');

test('buildTestUrl targets the One Call 3.0 endpoint with the key', () => {
  const url = owm.buildTestUrl('abc123');
  assert.match(url, /^https:\/\/api\.openweathermap\.org\/data\/3\.0\/onecall\?/);
  assert.match(url, /appid=abc123(&|$)/);
});

test('buildTestUrl trims and encodes the key', () => {
  assert.match(owm.buildTestUrl('  a b  '), /appid=a%20b(&|$)/);
  assert.match(owm.buildTestUrl(undefined), /appid=(&|$)/);
});

test('interpretStatus: 2xx is valid', () => {
  assert.equal(owm.interpretStatus(200).ok, true);
  assert.equal(owm.interpretStatus(204).ok, true);
});

test('interpretStatus: 401 explains the One Call subscription, not "paid"', () => {
  const r = owm.interpretStatus(401);
  assert.equal(r.ok, false);
  assert.match(r.message, /401/);
  assert.match(r.message, /One Call by Call/);
  assert.doesNotMatch(r.message, /paid/i);
});

test('interpretStatus: 429 valid-but-limited, network/other are not ok', () => {
  assert.equal(owm.interpretStatus(429).ok, false);
  assert.match(owm.interpretStatus(429).message, /429/);
  assert.equal(owm.interpretStatus(0).ok, false);
  assert.match(owm.interpretStatus(0).message, /reach/i);
  assert.equal(owm.interpretStatus(500).ok, false);
  assert.match(owm.interpretStatus(500).message, /500/);
});
