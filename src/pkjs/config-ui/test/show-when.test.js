// src/pkjs/config-ui/test/show-when.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/show-when.js');
const ctx = { secondaryLine: 'wind', provider: 'dwd', devStatsEnabled: true, env: { color: false, round: false, platform: 'flint' } };

test('leaf operators: eq/ne/in/nin/truthy + env', () => {
  assert.equal(W.evaluate({ key: 'secondaryLine', eq: 'wind' }, ctx), true);
  assert.equal(W.evaluate({ key: 'secondaryLine', eq: 'precip_prob' }, ctx), false);
  assert.equal(W.evaluate({ key: 'provider', ne: 'openweathermap' }, ctx), true);
  assert.equal(W.evaluate({ key: 'provider', in: ['dwd','wunderground'] }, ctx), true);
  assert.equal(W.evaluate({ key: 'provider', nin: ['dwd'] }, ctx), false);
  assert.equal(W.evaluate({ key: 'devStatsEnabled' }, ctx), true);   // bare = truthy
  assert.equal(W.evaluate({ env: 'color' }, ctx), false);            // flint = b&w
  assert.equal(W.evaluate({ env: 'color', eq: false }, ctx), true);
});

test('combinators: all/any/not/array-shorthand', () => {
  assert.equal(W.evaluate({ all: [{ key: 'provider', eq: 'dwd' }, { env: 'color' }] }, ctx), false);
  assert.equal(W.evaluate({ any: [{ key: 'provider', eq: 'dwd' }, { env: 'color' }] }, ctx), true);
  assert.equal(W.evaluate({ not: { env: 'color' } }, ctx), true);
  assert.equal(W.evaluate([{ key: 'provider', eq: 'dwd' }, { key: 'devStatsEnabled' }], ctx), true);
});

test('itemPredicate AND-merges COLOR capability; isVisible hides COLOR on b&w', () => {
  assert.deepEqual(W.itemPredicate({ capabilities: ['COLOR'] }), { env: 'color' });
  assert.deepEqual(W.itemPredicate({ showWhen: { key: 'barSource', eq: 'rain' }, capabilities: ['COLOR'] }),
    { all: [{ key: 'barSource', eq: 'rain' }, { env: 'color' }] });
  assert.equal(W.itemPredicate({ messageKey: 'x' }), null);
  assert.equal(W.isVisible({ capabilities: ['COLOR'] }, ctx), false);
  assert.equal(W.isVisible({ messageKey: 'x' }, ctx), true);
});
