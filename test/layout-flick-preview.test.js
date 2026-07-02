// test/layout-flick-preview.test.js
// The Layout tab shows one combined preview (default view | after-flick view) hosted on
// the Top view control. Drive the real engine over the Layout tab and assert the flick
// column reflects radar/health, and shows a placeholder when a flick reveals nothing.
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

test('combined preview renders both columns; flick column shows the radar swap when enabled', () => {
  const body = layoutBody({ radarProvider: 'dwd', healthMode: 'off' });
  assert.ok(body.indexOf('<svg') >= 0, 'preview SVG renders');
  assert.ok(body.indexOf('Default') >= 0 && body.indexOf('After flick') >= 0, 'both column headers');
  assert.ok(body.indexOf('Radar') >= 0, 'flick column shows the radar swap');
});

test('combined preview flick column shows the placeholder when a flick reveals nothing', () => {
  const body = layoutBody({ radarProvider: 'disabled', healthMode: 'off' });
  assert.ok(body.indexOf('Nothing to flick') >= 0, 'placeholder shown when nothing to reveal');
  assert.ok(body.indexOf('Default') >= 0, 'default column still present');
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
