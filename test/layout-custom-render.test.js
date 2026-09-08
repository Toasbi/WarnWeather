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

test('the Layout tab offers Custom (Beta) on basalt and hides it on aplite', () => {
  const basalt = layoutBody({ layoutPreset: 'compactCal' }).body;
  assert.ok(basalt.indexOf('Custom (Beta)') >= 0, 'Custom (Beta) option rendered');
  const aplite = layoutBody({ layoutPreset: 'compactCal' }, 'aplite').body;
  assert.equal(aplite.indexOf('Custom (Beta)'), -1, 'no Custom option on aplite');
});

test('the Custom layout row with its Edit button renders only in custom mode', () => {
  const preset = layoutBody({ layoutPreset: 'compactCal' }).body;
  assert.equal(preset.indexOf('data-action="openViewEditor"'), -1);
  const custom = layoutBody({
    layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '1',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather',
    viewLower0: 'off', viewOrder0: 'TACB',
  }).body;
  assert.ok(custom.indexOf('data-action="openViewEditor"') >= 0, 'Edit dispatches the action');
  assert.ok(custom.indexOf('class="thr-btn"') >= 0, 'the outlined Edit-button look');
  assert.ok(custom.indexOf('Custom layout') >= 0, 'row label present');
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

test('a dormant stored custom on aplite renders neither the Edit button nor the option', () => {
  const r = layoutBody({
    layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '1',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather',
    viewLower0: 'off', viewOrder0: 'TACB',
  }, 'aplite');
  assert.equal(r.body.indexOf('data-action="openViewEditor"'), -1, 'no editor row on aplite');
  assert.equal(r.body.indexOf('Custom (Beta)'), -1, 'no Custom option on aplite');
});

// The editor's ONLY select surface is the sheet path (openSheet -> renderSelectModal);
// the tab-body renderers' disabledOptions never applied there, so the declared
// optionDisabledWhen gates were dead — a radar pick under radarMode 'off' was accepted
// and silently folded, the editor row lying about the layout. Pin the sheet path.
test('select SHEETS render optionDisabledWhen gates inert (the editor path)', () => {
  const S = Object.assign(eng.hydrate(schema, {}), {
    radarMode: 'off', healthMode: 'off',
    layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '1',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather',
    viewLower0: 'off', viewOrder0: 'TACB',
  });
  const ENV = plat.computeEnv({ platform: 'basalt' });
  const cx = {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: 'viewTop0',
    openDate: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: ENV }),
  };
  const sheet = eng.renderSelectModal(schema, cx);
  assert.ok(sheet.indexOf('Rain radar') >= 0, 'the gated option stays VISIBLE');
  // The gated option must be inert: disabled attr, no pick handle for its value.
  const radarBtn = sheet.slice(sheet.lastIndexOf('<button', sheet.indexOf('Rain radar')),
    sheet.indexOf('Rain radar'));
  assert.ok(radarBtn.indexOf('disabled') >= 0, 'radar option is disabled under radarMode off');
  assert.equal(radarBtn.indexOf('data-select-pick'), -1, 'no pick handle on the gated option');
  // A capable mode renders it pickable again.
  const S2 = Object.assign({}, S, { radarMode: 'graph' });
  const cx2 = Object.assign({}, cx, { S: S2, evalCtx: Object.assign({}, S2, { env: ENV }) });
  const sheet2 = eng.renderSelectModal(schema, cx2);
  const radarBtn2 = sheet2.slice(sheet2.lastIndexOf('<button', sheet2.indexOf('Rain radar')),
    sheet2.indexOf('Rain radar'));
  assert.ok(radarBtn2.indexOf('data-select-pick="radar"') >= 0, 'pickable when capable');
});
