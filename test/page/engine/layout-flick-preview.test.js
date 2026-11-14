// test/page/engine/layout-flick-preview.test.js
// The Watchface tab pins the watch preview at its top: one card per screen of the resolved
// view cycle (Default, Flick 1, Flick 2), each a button that opens its editor off aplite.
// Drive the real engine over the Watchface tab and assert the cards track the cycle — a
// screen a preset's modes leave out simply isn't in the cycle, so there's no card to dim.
// Also covers the engine capability that a staticText item may host a blockBefore.
const test = require('node:test');
const assert = require('node:assert/strict');

// The lib modules share global.PConf across separate requires (show-when.js seeds it).
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js'); // registers watchPreview
const plat = require('../../../src/pkjs/config-ui/lib/platform.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const onbuild = require('../../../src/pkjs/page/settings/onbuild.js');

/**
 * The Watchface tab rendered through the real engine, every card's More options open.
 * @param {Object} overrides Stored values over the hydrated defaults.
 * @param {string} [platformName] Platform (basalt by default).
 * @returns {{body: string, pin: string}} The whole tab body and its pinned header (the
 *   watch preview, which sits above every card).
 */
function watchfaceTab(overrides, platformName) {
  const S = Object.assign(eng.hydrate(schema, {}), overrides);
  const ENV = plat.computeEnv({ platform: platformName || 'basalt' });
  onbuild.onLoad({
    env: ENV,
    get: function (k) { return S[k]; },
    set: function (k, v) { S[k] = v; },
    getInitial: function (k) { return S[k]; },
  });
  const cx = {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
    selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env: ENV }), schema: schema,
    // Every More options row open, so a row gated off is absent for its gate alone.
    moreOpen: new Proxy({}, { get: () => true }),
  };
  const body = eng.renderBody(schema, 'watchface', cx);
  assert.equal(body.indexOf('<div class="pin-scope"><div class="pin">'), 0,
    'the tab opens on its pinned preview, scoped to the screens\' cards');
  return { body: body, pin: body.slice(0, body.indexOf('<div class="card')) };
}

/**
 * The watch preview the Watchface tab pins above its cards.
 * @param {Object} overrides Stored values over the hydrated defaults.
 * @param {string} [platformName] Platform (basalt by default).
 * @returns {string} The pinned header's HTML.
 */
function layoutBody(overrides, platformName) {
  return watchfaceTab(overrides, platformName).pin;
}

/**
 * Each pinned card's spoken description: its name, then its bands.
 * @param {string} pin The pinned header's HTML.
 * @returns {string[]}
 */
function views(pin) {
  return (pin.match(/class="wpv-v[^"]*"[^>]*aria-label="[^"]*"/g) || [])
    .map((m) => /aria-label="(?:Edit )?([^"]*)"/.exec(m)[1]);
}

test('compactCal + radar shows a Default and a Flick card (radar view present)', () => {
  const body = layoutBody({ layoutPreset: 'compactCal', radarMode: 'graph', healthMode: 'off', swapClockStatus: false });
  assert.ok(body.indexOf('<svg') >= 0, 'preview SVG renders');
  assert.deepEqual(views(body), [
    'Default: Watch bar, Calendar (2 rows), Forecast bar, Clock, Forecast',
    'Flick 1: Watch bar, Calendar (2 rows), Radar bar, Clock, Radar'
  ], 'two cards, the second the radar view');
});

test('compactCal with radar disabled has no radar card', () => {
  const body = layoutBody({ layoutPreset: 'compactCal', radarMode: 'off', healthMode: 'off' });
  assert.equal(views(body).length, 1, 'the Default view alone');
  assert.strictEqual(body.indexOf('Radar'), -1, 'no radar card when radar is disabled');
});

test('compactDense all + radar shows three cards incl. Health graph', () => {
  const v = views(layoutBody({ layoutPreset: 'compactDense', radarMode: 'graph', healthMode: 'all' }));
  assert.deepEqual(v.map((d) => d.split(':')[0]), ['Default', 'Flick 1', 'Flick 2'], 'three cards');
  assert.ok(v.some((d) => /Health graph$/.test(d)), 'graph flick present');
});

test('aplite normalizes stale enabled settings to a single Default view', () => {
  const stale = { layoutPreset: 'compactDense', radarMode: 'graph', healthMode: 'all' };
  const tab = watchfaceTab(stale, 'aplite');
  const body = tab.pin;
  assert.deepEqual(views(body).map((d) => d.split(':')[0]), ['Default'], 'the Default card alone');
  // The Screen switching card (Back to Default after) is hidden on aplite; on basalt the
  // same state, three screens, shows it.
  assert.equal(tab.body.indexOf('Back to Default after'), -1, 'reset control is hidden');
  assert.ok(watchfaceTab(stale).body.indexOf('>Back to Default after<') >= 0, 'premise: basalt shows the reset control');
});

test('engine renders a blockBefore hosted on a staticText item', () => {
  // Regression for the engine limitation where staticText returned early and dropped its block.
  global.PConf.blocks.register('tprev', function () { return '<svg data-tprev></svg>'; });
  const synthetic = {
    appName: 'X', versionLabel: 'v0',
    tabs: [{ id: 't', label: 'T', sections: [{ items: [
      { type: 'staticText', text: 'CAP', blockBefore: 'tprev', blockBeforeSticky: true },
    ] }] }],
  };
  const cx = {
    S: {}, ENV: {}, USERDATA: {}, openColor: null, openSelect: null,
    selectQuery: '', collapsed: {}, evalCtx: { env: {} },
  };
  const html = eng.renderBody(synthetic, 't', cx);
  assert.ok(html.indexOf('data-tprev') >= 0, 'staticText renders its blockBefore');
  assert.ok(html.indexOf('CAP') >= 0, 'staticText text still renders');
});
