// test/when-resolvers.test.js — the settings page's when resolvers
// (src/pkjs/settings/when-resolvers.js), the rules the schema's { when } leaves ask:
// lineRow, the picker a Forecast-tab row that follows its metric sits under.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const WR = require('../src/pkjs/settings/when-resolvers.js');
const drawFrom = require('../src/pkjs/draw-from.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const PICKERS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];

test('lineRow is registered, and a leaf asks it with the settings, their env and its args', () => {
  assert.equal(global.PConf.whenResolvers.get('lineRow'), WR.lineRow);
  const S = { secondaryLine: 'cloud', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off' };
  const leaf = (picker) => ({ when: 'lineRow', args: { picker, metrics: ['uv'] } });
  assert.equal(showWhen.evaluate(leaf('thirdLine'), Object.assign({ env: BASALT }, S)), true);
  assert.equal(showWhen.evaluate(leaf('secondaryLine'), Object.assign({ env: BASALT }, S)), false);
});

test('metrics: the first picker whose line draws one of them', () => {
  const host = (S, metrics, env) => WR.hostLine(S, env || BASALT, { metrics });
  const S = { secondaryLine: 'precip_prob', thirdLine: 'gust', fourthLine: 'wind', fifthLine: 'pressure' };
  assert.equal(host(S, ['wind', 'gust']), 'thirdLine', 'wind and gusts: the first of the two');
  assert.equal(host(S, ['wind']), 'fourthLine');
  assert.equal(host(S, ['pressure']), 'fifthLine');
  assert.equal(host(S, ['uv']), null, 'no line draws it');
  // A stored repeat draws nothing (line-style.js effectiveLineMetric): the first line keeps it.
  assert.equal(host({ secondaryLine: 'uv', thirdLine: 'uv', fourthLine: 'uv' }, ['uv']), 'secondaryLine');
  assert.equal(host({ secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'uv' }, ['uv']), 'fourthLine');
  // A stripe still shows its metric, so the scale and Visible values rows stay with it.
  assert.equal(host({ secondaryLine: 'uv', secondaryLineStyle: 'stripeTop' }, ['uv']), 'secondaryLine');
});

test('metrics: the Third and Fourth metric pickers count only on a watch with line styles', () => {
  const S = { secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'wind', fifthLine: 'uv' };
  assert.equal(WR.hostLine(S, BASALT, { metrics: ['wind'] }), 'fourthLine');
  assert.equal(WR.hostLine(S, BASALT, { metrics: ['uv'] }), 'fifthLine');
  [APLITE, {}, undefined].forEach((env) => {
    assert.equal(WR.hostLine(S, env, { metrics: ['wind'] }), null, JSON.stringify(env));
    assert.equal(WR.hostLine(S, env, { metrics: ['uv'] }), null, JSON.stringify(env));
  });
  assert.equal(WR.hostLine({ secondaryLine: 'cloud', thirdLine: 'wind' }, APLITE, { metrics: ['wind'] }), 'thirdLine');
});

test('from: a Draw from key sits under draw-from.js rowLine, the line that hangs from it', () => {
  const states = [
    { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'off', fifthLine: 'off' },
    { secondaryLine: 'wind', secondaryLineStyle: 'stripeTop', thirdLine: 'wind', fourthLine: 'gust' },
    { secondaryLine: 'cloud', secondaryLineStyle: 'stripeBottom', thirdLine: 'cloud', fourthLine: 'off' },
    { secondaryLine: 'pressure', thirdLine: 'uv', fourthLine: 'precip_prob', fifthLine: 'cloud' }
  ];
  states.forEach((S) => [BASALT, APLITE].forEach((env) => drawFrom.ROWS.forEach((row) => {
    const want = drawFrom.rowLine(S, row.key, env);
    assert.equal(WR.hostLine(S, env, { from: row.key }), want, row.key + ' ' + JSON.stringify(S));
    PICKERS.forEach((picker) => assert.equal(WR.lineRow(S, env, { picker, from: row.key }), want === picker,
      picker + ' ' + row.key + ' ' + JSON.stringify(S)));
  })));
  // The stripe the metrics path keeps moves the Draw from row on.
  const striped = { secondaryLine: 'uv', secondaryLineStyle: 'stripeTop', thirdLine: 'off', fourthLine: 'off' };
  assert.equal(WR.hostLine(striped, BASALT, { from: 'uvLineFrom' }), null);
});
