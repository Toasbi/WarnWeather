// test/weather/adapter/provider-pins.test.js — every provider's weather fetch, end to end,
// against test/provider-pins.golden.json: the requests it makes, in order, and the payload
// the outbox gets, byte for byte, for a fresh install on a Pebble Time and on a Classic, the
// wind, feels-like and gust lines on a Pebble Time, and every other reading on an emery's
// long span. How the fetches run, and how to rewrite the pins after a deliberate change:
// test/helpers/provider-pins.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const pins = require('../../helpers/provider-pins.js');

const CURRENT = JSON.parse(pins.pinsTextInZone());
const GOLDEN = JSON.parse(fs.readFileSync(pins.GOLDEN_PATH, 'utf8'));
const REWRITE = 'If the change is deliberate, rewrite the pins with '
  + '`node test/helpers/provider-pins.js --write` and review the diff.';

test('the pins hold every provider on every scenario', () => {
  const expected = [];
  pins.PROVIDERS.forEach((id) => {
    Object.keys(pins.SCENARIOS).forEach((name) => { expected.push(id + '@' + name); });
  });
  assert.deepEqual(Object.keys(GOLDEN), expected);
  assert.deepEqual(Object.keys(CURRENT), expected);
});

test('every pinned fetch succeeds, and a service answers each of its requests', () => {
  Object.keys(CURRENT).forEach((name) => {
    assert.equal(CURRENT[name].outcome, 'ok', name);
    assert.ok(CURRENT[name].requests.every((r) => r.indexOf('no service answers') === -1),
      name + ' made a request no service in test/helpers/provider-world.js answers');
  });
});

Object.keys(GOLDEN).forEach((name) => {
  test(name + ': the same options, and the same requests in the same order', () => {
    const current = CURRENT[name];
    assert.ok(current, name + ' is no longer pinned');
    assert.deepEqual(current.options, GOLDEN[name].options, name + ': ' + REWRITE);
    assert.deepEqual(current.requests, GOLDEN[name].requests, name + ': ' + REWRITE);
  });

  test(name + ': the same payload, byte for byte', () => {
    const current = CURRENT[name].payload;
    const golden = GOLDEN[name].payload;
    assert.deepEqual(Object.keys(current), Object.keys(golden), name + ': the payload\'s keys. ' + REWRITE);
    Object.keys(golden).forEach((key) => {
      assert.equal(JSON.stringify(current[key]), JSON.stringify(golden[key]), name + ': ' + key + '. ' + REWRITE);
    });
  });
});
