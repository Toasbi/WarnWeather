// test/when-resolvers.test.js — the settings page's when resolvers
// (src/pkjs/settings/when-resolvers.js), the rules the schema's { when } leaves ask:
// lineRow, the picker a Forecast-tab row that follows its metric sits under;
// onDemandPlaced, an Alerts item on a status bar; defaultViewLacksOnDemand, a Default
// view that draws no Alerts item; tempAxisLineDrawn, a drawn feels-like or dew point line.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const WR = require('../src/pkjs/settings/when-resolvers.js');
const drawFrom = require('../src/pkjs/draw-from.js');
const OD = require('../src/pkjs/on-demand.js');
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

test('onDemandPlaced is on-demand.js placedAnywhere: on a bar that exists, on a watch with Alerts', () => {
  assert.equal(global.PConf.whenResolvers.get('onDemandPlaced'), WR.onDemandPlaced);
  const none = Object.assign({}, OD.DEFAULTS, { statusTopOnDemandLeftItems: '', statusTopOnDemandRightItems: '' });
  const states = [
    OD.DEFAULTS,
    none,
    Object.assign({}, none, { statusForecastOnDemandRightItems: 'rain,uv' }),
    Object.assign({}, none, { statusRadarOnDemandLeftItems: 'rain', radarMode: 'graph' }),
    Object.assign({}, none, { statusRadarOnDemandLeftItems: 'rain', radarMode: 'countdown' }),
    Object.assign({}, none, { statusHealthOnDemandLeftItems: 'uv', healthMode: 'all' }),
    Object.assign({}, none, { statusHealthOnDemandLeftItems: 'uv', healthMode: 'slot' })
  ];
  let held = 0;
  states.forEach((S) => [BASALT, APLITE].forEach((env) => OD.ITEMS.forEach((item) => {
    const want = OD.placedAnywhere(S, item.code, env);
    if (want) { held += 1; }
    assert.equal(WR.onDemandPlaced(S, env, { code: item.code }), want, item.code + ' ' + JSON.stringify(S));
    assert.equal(showWhen.evaluate({ when: 'onDemandPlaced', args: { code: item.code } }, Object.assign({ env }, S)),
      want, 'leaf ' + item.code);
  })));
  assert.ok(held > 10, 'premise: the states place items');
  // The radar bar does not exist in Rain alert only, the health bar not in 'slot'.
  assert.equal(WR.onDemandPlaced(states[4], BASALT, { code: 'rain' }), false);
  assert.equal(WR.onDemandPlaced(states[6], BASALT, { code: 'uv' }), false);
});

// emery's Heart rate item: placed only on an emery reading health (on-demand.js
// hrAvailable), whatever its lists hold; every other watch reads it as on no bar.
test('onDemandPlaced: the Heart rate item is placed on an emery alone', () => {
  const EMERY = platform.computeEnv({ platform: 'emery' });
  const DIORITE = platform.computeEnv({ platform: 'diorite' });
  const UNKNOWN = platform.computeEnv(null);
  const S = Object.assign({}, OD.DEFAULTS, { statusTopOnDemandRightItems: 'battery,hr', healthMode: 'status' });
  [[EMERY, true], [BASALT, false], [DIORITE, false], [APLITE, false], [UNKNOWN, false]].forEach(([env, want]) => {
    assert.equal(OD.placedAnywhere(S, 'hr', env), want, String(env.platform));
    assert.equal(WR.onDemandPlaced(S, env, { code: 'hr' }), want, String(env.platform));
    assert.equal(showWhen.evaluate({ when: 'onDemandPlaced', args: { code: 'hr' } }, Object.assign({ env }, S)), want);
  });
  assert.equal(WR.onDemandPlaced(Object.assign({}, S, { healthMode: 'off' }), EMERY, { code: 'hr' }), false,
    'an emery with health off');
  assert.equal(WR.onDemandPlaced(Object.assign({}, S, { statusTopOnDemandRightItems: 'battery' }), EMERY,
    { code: 'hr' }), false, 'an emery with it on no list');
});

test('defaultViewLacksOnDemand: the Default view the watch runs has no strip and no bar with an item', () => {
  assert.equal(global.PConf.whenResolvers.get('defaultViewLacksOnDemand'), WR.defaultViewLacksOnDemand);
  const lacks = (over, env) => WR.defaultViewLacksOnDemand(Object.assign({}, OD.DEFAULTS, over), env || BASALT);
  // Weather only drops the strip in every radar mode but Rain alert only; its Default view
  // shows the forecast bar, plus the radar bar in radar mode Status.
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'graph' }), true);
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'off' }), true);
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'graph', statusForecastOnDemandLeftItems: 'uv' }), false);
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'status', statusRadarOnDemandRightItems: 'rain' }), false);
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'status' }), true);
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'graph', statusRadarOnDemandRightItems: 'rain' }), true,
    'no radar bar on the graph mode\'s Default view');
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'countdown' }), false, 'Rain alert only keeps the strip');
  // The calendar presets keep the strip.
  ['fullCal', 'compactCal', 'compactDense', 'noCal', 'classic', undefined].forEach((layoutPreset) =>
    ['off', 'status', 'graph'].forEach((radarMode) => assert.equal(lacks({ layoutPreset, radarMode,
      statusTopOnDemandLeftItems: '', statusTopOnDemandRightItems: '' }), false, layoutPreset + ' ' + radarMode)));
  // A custom layout: the Default view's strip switch and the bars its seats keep.
  const custom = { layoutPreset: 'custom', viewStripOff0: true, viewUpper0: 'weather', viewLower0: 'off' };
  assert.equal(lacks(custom), true);
  assert.equal(lacks(Object.assign({}, custom, { statusForecastOnDemandRightItems: 'bt' })), false);
  assert.equal(lacks(Object.assign({}, custom, { viewStripOff0: false })), false);
  const health = Object.assign({}, custom, { viewLower0: 'health', statusHealthOnDemandLeftItems: 'battery' });
  assert.equal(lacks(Object.assign({ healthMode: 'status' }, health)), false, 'a health seat carrying items');
  assert.equal(lacks(Object.assign({ healthMode: 'off' }, health)), true, 'a health seat folded away');
  const radar = Object.assign({}, custom, { viewUpper0: 'radar', statusRadarOnDemandLeftItems: 'rain' });
  assert.equal(lacks(Object.assign({ radarMode: 'status' }, radar)), false, 'a radar seat carrying items');
  assert.equal(lacks(Object.assign({ radarMode: 'off' }, radar)), true, 'a radar seat folded away');
  // aplite runs Weather only and a custom layout as Compact calendar, strip and all.
  assert.equal(lacks({ layoutPreset: 'weatherOnly', radarMode: 'graph' }, APLITE), false);
  assert.equal(lacks(custom, APLITE), false);
  // The leaf asks it.
  assert.equal(showWhen.evaluate({ when: 'defaultViewLacksOnDemand' },
    Object.assign({ env: BASALT }, OD.DEFAULTS, custom)), true);
});

// The Left axis card's 'Include feels-like & dew point' gate is forecast-axis.js' own
// function, the one the wire and the bake read it through, registered as is.
test('tempAxisLineDrawn is forecast-axis.js\' own reading, and a leaf asks it', () => {
  const forecastAxis = require('../src/pkjs/forecast-axis.js');
  assert.equal(global.PConf.whenResolvers.get('tempAxisLineDrawn'), forecastAxis.tempAxisLineDrawn);
  const EMERY = platform.computeEnv({ platform: 'emery' });
  const UNKNOWN = platform.computeEnv(null);
  const leaf = (S, env) => showWhen.evaluate({ when: 'tempAxisLineDrawn' }, Object.assign({ env }, S));
  const states = [{}, { secondaryLine: 'feels' }, { thirdLine: 'dew' }, { fourthLine: 'dew' },
    { fifthLine: 'feels' }, { secondaryLine: 'wind', thirdLine: 'uv' }, { secondaryLine: 'dew', thirdLine: 'dew' }];
  let shown = 0;
  [EMERY, BASALT, APLITE, UNKNOWN].forEach((env) => {
    states.forEach((S) => {
      const want = forecastAxis.tempAxisLineDrawn(S, env);
      assert.equal(leaf(S, env), want, JSON.stringify([env.platform, S]));
      if (want) { shown += 1; }
    });
  });
  assert.ok(shown > 0, 'premise: some state draws one');
  assert.equal(leaf({ fifthLine: 'dew' }, APLITE), false, 'aplite draws no Fourth metric line');
});
