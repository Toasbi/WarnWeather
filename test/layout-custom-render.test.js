// test/layout-custom-render.test.js
// Drive the REAL engine over the Layout tab in custom mode (the
// layout-flick-preview lesson: pure-function tests alone once missed a render-path
// bug). Covers: the Custom radio option (and its aplite absence), the Edit button's
// visibility, the combined preview rendering the CUSTOM cycle, the seeding hook
// through the registered onChange path, and the editor action being a safe no-op
// under Node (no DOM).
const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');       // registers preview + resolvers + hook
require('../src/pkjs/settings/view-editor.js');  // registers openViewEditor
const plat = require('../src/pkjs/config-ui/lib/platform.js');
const schema = require('../src/pkjs/settings/schema.js');
const onbuild = require('../src/pkjs/settings/onbuild.js');
const vc = require('../src/pkjs/view-cycle.js');

function layoutBody(overrides, platformName) {
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
    selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env: ENV }),
  };
  return { body: eng.renderBody(schema, 'layout', cx), S: S };
}

test('the Layout tab offers Custom on basalt and hides it on aplite', () => {
  const basalt = layoutBody({ layoutPreset: 'compactCal' }).body;
  assert.ok(basalt.indexOf('>Custom<') >= 0, 'Custom option rendered');
  const aplite = layoutBody({ layoutPreset: 'compactCal' }, 'aplite').body;
  assert.equal(aplite.indexOf('>Custom<'), -1, 'no Custom option on aplite');
});

test('the Edit custom layout button renders only in custom mode', () => {
  const preset = layoutBody({ layoutPreset: 'compactCal' }).body;
  assert.equal(preset.indexOf('Edit custom layout'), -1);
  const custom = layoutBody({
    layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '1',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather',
    viewLower0: 'off', viewOrder0: 'TACB',
  }).body;
  assert.ok(custom.indexOf('Edit custom layout') >= 0);
  assert.ok(custom.indexOf('data-action="openViewEditor"') >= 0, 'button dispatches the action');
});

test('the combined preview renders the CUSTOM cycle (a stacked clockless flick shows through)', () => {
  const r = layoutBody({
    layoutPreset: 'custom', customLayoutSeeded: true,
    radarMode: 'graph', healthMode: 'off', viewCount: '2',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'none', viewBody1: 'radar', viewUpper1: 'off', viewLower1: 'off', viewOrder1: 'TACB',
    viewClockOff1: true, viewStripOff1: true,
  });
  assert.ok(r.body.indexOf('<svg') >= 0, 'preview SVG renders');
  assert.ok(r.body.indexOf('Flick 1') >= 0, 'the custom flick column exists');
  assert.ok(r.body.indexOf('Radar') >= 0, 'the full-screen radar body shows');
  // The flick column must NOT show a Clock band (clockOff view).
  const flickCol = r.body.slice(r.body.indexOf('Flick 1'));
  assert.equal(flickCol.indexOf('Clock'), -1, 'clockless flick previews without a Clock band');
});

test('the registered layoutPresetChanged hook seeds once through the engine registry', () => {
  const hook = global.PConf.onChange.get('layoutPresetChanged');
  assert.equal(typeof hook, 'function', 'hook registered');
  const S = { healthMode: 'off', radarMode: 'off', swapClockStatus: false, layoutPreset: 'custom' };
  hook(S, 'compactCal', 'custom');
  assert.equal(S.customLayoutSeeded, true);
  assert.deepStrictEqual(vc.buildCustomCycle(S).map(vc.packSpec),
    vc.buildViewCycle('compactCal', 'off', 'off', false).map(vc.packSpec),
    'seed round-trips byte-identical');
  // Leaving custom fires the hook too — it must not disturb the stored keys.
  const before = S.viewTop0;
  hook(S, 'custom', 'fullCal');
  assert.equal(S.viewTop0, before, 'preset re-pick leaves custom keys dormant');
});

test('openViewEditor is a safe no-op under Node (no DOM, no ctx)', () => {
  assert.equal(typeof global.PConf.actions.openViewEditor, 'function');
  assert.doesNotThrow(() => global.PConf.actions.openViewEditor());
});
