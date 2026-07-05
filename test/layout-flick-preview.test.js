// test/layout-flick-preview.test.js
// The Layout tab shows one combined preview: one column per slot of the resolved
// preset's adaptive view cycle (Default, Flick 1, Flick 2). Drive the real engine over
// the Layout tab and assert the columns track the cycle — a disabled radar/health slot
// simply isn't in the cycle, so there's no column to dim.
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

test('compactCal + radar shows a Default and a Flick column (radar view present)', () => {
  const body = layoutBody({ layoutPreset: 'compactCal', radarProvider: 'dwd', healthMode: 'off' });
  assert.ok(body.indexOf('<svg') >= 0, 'preview SVG renders');
  assert.ok(body.indexOf('Default') >= 0 && body.indexOf('Flick 1') >= 0, 'two columns');
  assert.ok(body.indexOf('Radar') >= 0, 'radar view present in the cycle');
});

test('compactCal with radar disabled has no radar column', () => {
  const body = layoutBody({ layoutPreset: 'compactCal', radarProvider: 'disabled', healthMode: 'off' });
  assert.ok(body.indexOf('Default') >= 0, 'default column renders');
  assert.strictEqual(body.indexOf('Radar'), -1, 'no radar column when radar is disabled');
});

test('compactDense all + radar shows three columns incl. Health graph', () => {
  const body = layoutBody({ layoutPreset: 'compactDense', radarProvider: 'dwd', healthMode: 'all' });
  assert.ok(body.indexOf('Flick 2') >= 0, 'three columns');
  assert.ok(body.indexOf('Health graph') >= 0, 'graph flick present');
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
