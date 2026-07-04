// test/layout-flick-preview.test.js
// The Layout tab shows one combined preview: one column per non-OFF slot of the resolved
// layoutPreset (Default, Flick 1, Flick 2). Drive the real engine over the Layout tab and
// assert the flick column reflects radar/health availability (dimmed + a note when the
// watch would currently skip it, rather than omitted).
// Also covers the engine capability that a staticText item may host a blockBefore.
const test = require('node:test');
const assert = require('node:assert/strict');

// The lib modules share global.PConf across separate requires (show-when.js seeds it).
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js'); // registers layoutPreviewCombined
const plat = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/settings/schema.js');

function layoutBody(overrides) {
  const S = Object.assign(eng.hydrate(schema, {}), overrides);
  const ENV = plat.computeEnv({ platform: 'basalt' });
  const cx = {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
    selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env: ENV }),
  };
  return eng.renderBody(schema, 'layout', cx);
}

test('combined preview renders both columns for the default (classic) preset; flick column shows Radar', () => {
  const body = layoutBody({ radarProvider: 'dwd', healthMode: 'off' });
  assert.ok(body.indexOf('<svg') >= 0, 'preview SVG renders');
  assert.ok(body.indexOf('Default') >= 0 && body.indexOf('Flick 1') >= 0, 'both column headers');
  assert.ok(body.indexOf('Radar') >= 0, 'flick column shows the radar view');
  assert.strictEqual(body.indexOf('needs radar'), -1, 'radar is available, so no unavailable note');
});

test('combined preview flick column is dimmed with a "needs radar" note when radar has no provider', () => {
  const body = layoutBody({ radarProvider: 'disabled', healthMode: 'off' });
  assert.ok(body.indexOf('needs radar') >= 0, 'note shown when the radar flick is unavailable');
  assert.ok(body.indexOf('Default') >= 0 && body.indexOf('Flick 1') >= 0, 'both columns still render');
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
