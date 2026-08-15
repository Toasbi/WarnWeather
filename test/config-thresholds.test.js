'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { eachItem } = require('../src/pkjs/config-ui/lib/schema-walk.js');
// The two color defaults are owned by the contract module (status-thresholds.js),
// which also reads these settings back at pack time — assert against the exported
// constants rather than re-inlining the hex a third time.
const thresholds = require('../src/pkjs/status-thresholds.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/engine.js');
const B = require('../src/pkjs/settings/blocks.js');
const onbuild = require('../src/pkjs/settings/onbuild.js');
const PC = global.PConf;

function itemsByKey() {
  const map = {};
  eachItem(schema, it => {
    if (!it.messageKey) { return; }
    (map[it.messageKey] = map[it.messageKey] || []).push(it);
  });
  return map;
}

const STEMS = ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance', 'Uv'];
const HEALTH_STEMS = ['Steps', 'Sleep', 'Distance'];
const ENV = { thresholds: true, color: true, health: true };

test('every threshold kind has toggle + slider + hidden companions wired up', () => {
  const map = itemsByKey();
  STEMS.forEach(stem => {
    const on = map['thresh' + stem + 'On'];
    assert.ok(on && on.length === 1, 'thresh' + stem + 'On missing');
    assert.equal(on[0].type, 'toggle');
    assert.equal(on[0].defaultValue, false);
    assert.equal(on[0].onChange, 'thresholdToggle');

    const warn = map['thresh' + stem + 'Warn'];
    assert.ok(warn && warn.length === 1, 'thresh' + stem + 'Warn missing');
    assert.equal(warn[0].type, 'range');
    assert.equal(warn[0].defaultValue, '');
    assert.equal(warn[0].dangerKey, 'thresh' + stem + 'Danger');
    assert.equal(warn[0].maxKey, 'thresh' + stem + 'Max');
    assert.deepEqual(warn[0].rangeFrom,
      { resolver: 'thresholdRange', args: { keyStem: stem } });
    // The slider stays VISIBLE while the highlight is off — muted + inert, not hidden.
    assert.deepEqual(warn[0].disabledWhen, { not: { key: 'thresh' + stem + 'On' } },
      'thresh' + stem + 'Warn slider must disable (not hide) on its toggle');
    assert.deepEqual(warn[0].labelAction,
      { action: 'resetThresholds', arg: stem, label: 'Reset to defaults' },
      'thresh' + stem + 'Warn carries the reset-to-defaults label button');

    // Companion storage rows: hydrated + serialized, never drawn.
    ['Danger', 'Max'].forEach(which => {
      const it = map['thresh' + stem + which];
      assert.ok(it && it.length === 1, 'thresh' + stem + which + ' missing');
      assert.equal(it[0].type, 'hidden');
      assert.equal(it[0].defaultValue, '');
    });
  });
});

// Collect every {key:'theme', ...} leaf in a showWhen tree, so the assertion below
// pins the gate's SHAPE. A substring check for 'bw' would also pass for the
// inverted gate {key:'theme', in:['bw','bw-light']} — pickers ONLY on B&W.
function themeLeaves(pred, out) {
  out = out || [];
  if (!pred || typeof pred !== 'object') { return out; }
  if (Array.isArray(pred)) { pred.forEach(p => themeLeaves(p, out)); return out; }
  if (pred.key === 'theme') { out.push(pred); }
  ['all', 'any'].forEach(comb => { if (pred[comb]) { themeLeaves(pred[comb], out); } });
  if (pred.not) { themeLeaves(pred.not, out); }
  return out;
}

test('threshold color pickers are COLOR + bw-theme + toggle gated, auto (unset) defaults', () => {
  const map = itemsByKey();
  STEMS.forEach(stem => {
    const warn = map['thresh' + stem + 'WarnColor'][0];
    const danger = map['thresh' + stem + 'DangerColor'][0];
    [warn, danger].forEach(it => {
      assert.equal(it.type, 'color');
      assert.deepEqual(it.capabilities, ['COLOR']);
      const leaves = themeLeaves(it.showWhen);
      assert.equal(leaves.length, 1, it.messageKey + ' has exactly one theme gate');
      // nin (not eq/in): the picker shows on every theme EXCEPT the two B&W ones.
      assert.deepEqual(leaves[0], {key: 'theme', nin: ['bw', 'bw-light']},
        it.messageKey + ' must be hidden on B&W themes only');
      assert.deepEqual(it.disabledWhen, { not: { key: 'thresh' + stem + 'On' } },
        it.messageKey + ' must disable (not hide) while the highlight is off');
      // Weather kinds hydrate '' (warn: the no-outline sentinel; danger: auto ->
      // onLoad derives the theme fg). Goal kinds hydrate the green celebration
      // default — '' would read as outline-off in the seeded store, which is
      // exactly the bug that shipped the first cut of the rework (MEASURED:
      // bold-but-no-outline on the emulator).
      const goal = ['Steps', 'Sleep', 'Distance'].indexOf(stem) >= 0;
      assert.equal(it.defaultValue, goal ? '#55FF00' : '',
        it.messageKey + ' default');
    });
  });
});

// Health thresholds are inert wherever a health item can't reach a status slot:
// no health sensors (aplite) or healthMode 'off'. 'slot' mode DOES put health in the
// ordinary bars, so it must keep them — the same rule statusLineCatalog.itemAvailable
// applies to the items themselves. Asserted behaviorally through the real evaluator.
test('health-kind threshold rows are hidden on health-less platforms and with health off', () => {
  const map = itemsByKey();
  const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
  HEALTH_STEMS.forEach(stem => {
    ['On', 'Warn'].forEach(which => {
      const it = map['thresh' + stem + which][0];
      assert.ok(JSON.stringify(it.showWhen).includes('"env":"health"'),
        'thresh' + stem + which + ' must be env-health gated');
      // threshXOn: true so the slider's own toggle gate can't mask the health gate.
      const ctx = mode => Object.assign(
        { env: { health: true, color: true } },
        { healthMode: mode, ['thresh' + stem + 'On']: true });
      assert.equal(showWhen.isVisible(it, ctx('off')), false,
        it.messageKey + ' hidden when health is off');
      ['slot', 'status', 'all'].forEach(mode => {
        assert.equal(showWhen.isVisible(it, ctx(mode)), true,
          it.messageKey + ' shown in healthMode ' + mode);
      });
      const noSensors = Object.assign({ env: { health: false, color: true } },
        { healthMode: 'all', ['thresh' + stem + 'On']: true });
      assert.equal(showWhen.isVisible(it, noSensors), false,
        it.messageKey + ' hidden without health sensors');
    });
  });
});

// Defaults ship disabled: every kind starts with both thresholds blank, so
// kindConfig() reports it disabled until the user opts in (no invented numbers).
test('shipped defaults leave every kind disabled', () => {
  const map = itemsByKey();
  const S = {};
  STEMS.forEach(stem => {
    S['thresh' + stem + 'Warn'] = map['thresh' + stem + 'Warn'][0].defaultValue;
    S['thresh' + stem + 'Danger'] = map['thresh' + stem + 'Danger'][0].defaultValue;
  });
  thresholds.KINDS.forEach((kind, index) => {
    assert.equal(thresholds.kindConfig(S, index).enabled, false,
      kind.key + ' must ship disabled');
  });
});

// --- the range resolver (blocks.js thresholdRange) --------------------------

test('resolver direction comes from the contract for every kind', () => {
  thresholds.KINDS.forEach(kind => {
    const cfg = B.thresholdRangeCfg({}, ENV, { keyStem: kind.key });
    assert.equal(cfg.dir, kind.belowIsWorse ? 'below' : 'above',
      kind.key + ' direction must mirror the contract');
    // Seeds must form a valid ordered pair — enabling a kind must highlight
    // immediately, not silently store an unordered pair.
    assert.ok(kind.belowIsWorse
      ? cfg.seedDanger <= cfg.seedWarn : cfg.seedDanger >= cfg.seedWarn,
      kind.key + ' seeds must be ordered for its direction');
    assert.ok(cfg.seedWarn >= cfg.min && cfg.seedWarn <= cfg.max
      && cfg.seedDanger >= cfg.min && cfg.seedDanger <= cfg.max,
      kind.key + ' seeds must sit inside the track');
    // The two thumbs must be separable on the step grid.
    assert.equal(cfg.minSpan, cfg.step, kind.key + ' minSpan pins to the step');
  });
});

test('wind/gust/distance scales follow the General-tab unit pickers', () => {
  const kph = B.thresholdRangeCfg({}, ENV, { keyStem: 'Wind' });
  assert.deepEqual([kph.max, kph.seedWarn, kph.seedDanger, kph.unit], [120, 40, 60, 'kph']);
  const mph = B.thresholdRangeCfg({ windUnits: 'mph' }, ENV, { keyStem: 'Wind' });
  assert.deepEqual([mph.max, mph.seedWarn, mph.seedDanger, mph.unit], [75, 25, 40, 'mph']);
  const kn = B.thresholdRangeCfg({ windUnits: 'knots' }, ENV, { keyStem: 'Gust' });
  assert.deepEqual([kn.max, kn.seedWarn, kn.seedDanger, kn.unit], [85, 30, 50, 'kn']);
  // Distance seeds order upward since the goal rework (close, then the goal).
  const km = B.thresholdRangeCfg({}, ENV, { keyStem: 'Distance' });
  assert.deepEqual([km.max, km.seedWarn, km.seedDanger, km.unit], [20, 4, 5, 'km']);
  const mi = B.thresholdRangeCfg({ distanceUnits: 'imperial' }, ENV, { keyStem: 'Distance' });
  assert.deepEqual([mi.max, mi.seedWarn, mi.seedDanger, mi.unit], [12, 2.5, 3, 'mi']);
});

test('AQI scale: European only when Open-Meteo is the source and the picker says so', () => {
  const eu = B.thresholdRangeCfg({ aqiSource: 'openmeteo', aqiScale: 'european' }, ENV, { keyStem: 'Aqi' });
  assert.deepEqual([eu.max, eu.seedWarn, eu.seedDanger], [150, 60, 80]);
  const us = B.thresholdRangeCfg({ aqiSource: 'openmeteo', aqiScale: 'us' }, ENV, { keyStem: 'Aqi' });
  assert.deepEqual([us.max, us.seedWarn, us.seedDanger], [300, 100, 150]);
  // WAQI (and auto, which prefers it) reports US-style AQI regardless of the picker.
  ['waqi', 'auto'].forEach(src => {
    const cfg = B.thresholdRangeCfg({ aqiSource: src, aqiScale: 'european' }, ENV, { keyStem: 'Aqi' });
    assert.equal(cfg.max, 300, src + ' uses the US-style scale');
  });
});

test('bounded kinds have no scale-max editor; unbounded kinds do', () => {
  ['Pollen', 'Sleep'].forEach(stem => {
    assert.equal(B.thresholdRangeCfg({}, ENV, { keyStem: stem }).maxEditable, false, stem);
  });
  ['Aqi', 'Wind', 'Gust', 'Steps', 'Distance'].forEach(stem => {
    assert.equal(B.thresholdRangeCfg({}, ENV, { keyStem: stem }).maxEditable, true, stem);
  });
});

test('scale max: override honored, garbage ignored, always grows to fit stored values', () => {
  const overridden = B.thresholdRangeCfg({ threshStepsMax: '30000' }, ENV, { keyStem: 'Steps' });
  assert.equal(overridden.max, 30000);
  const garbage = B.thresholdRangeCfg({ threshStepsMax: 'abc' }, ENV, { keyStem: 'Steps' });
  assert.equal(garbage.max, 20000);
  const blank = B.thresholdRangeCfg({ threshStepsMax: '' }, ENV, { keyStem: 'Steps' });
  assert.equal(blank.max, 20000);
  // A stored pair beyond the (default or overridden) max stretches the track —
  // a pair typed under the old text UI must never strand a thumb off the track.
  const grown = B.thresholdRangeCfg({ threshStepsWarn: '25100' }, ENV, { keyStem: 'Steps' });
  assert.equal(grown.max, 25250, 'grows to the next step multiple');
  const shrunk = B.thresholdRangeCfg(
    { threshStepsMax: '10000', threshStepsWarn: '15000' }, ENV, { keyStem: 'Steps' });
  assert.equal(shrunk.max, 15000, 'an override below a stored threshold loses');
  // Bounded kinds ignore stray max keys entirely.
  const sleep = B.thresholdRangeCfg({ threshSleepMax: '40' }, ENV, { keyStem: 'Sleep' });
  assert.equal(sleep.max, 12);
});

test('resolver colors: auto tracks the theme fg, picks stick, garbage sanitized', () => {
  // Unset WARN = no outline: the slider draws its warn pieces in the neutral gray
  // (the zone still shows where warn spans). Unset DANGER = auto theme fg.
  const dflt = B.thresholdRangeCfg({}, ENV, { keyStem: 'Wind' });
  assert.equal(dflt.warnColor, '#8A8E97');
  assert.equal(dflt.dangerColor, '#FFFFFF');
  assert.equal(dflt.dangerText, '#20232A', 'white auto fill takes dark ink');
  const light = B.thresholdRangeCfg({ theme: 'light' }, ENV, { keyStem: 'Wind' });
  assert.equal(light.warnColor, '#8A8E97', 'no-outline neutral is theme-independent');
  assert.equal(light.dangerText, '#FFFFFF', 'black auto fill takes white ink');
  // User picks — the old orange/red defaults included — are ordinary colors now.
  const picked = B.thresholdRangeCfg(
    { threshWindWarnColor: '#00aaff', threshWindDangerColor: '#FFFF00' }, ENV, { keyStem: 'Wind' });
  assert.equal(picked.warnColor, '#00AAFF');
  assert.equal(picked.warnGlow, 'rgba(0,170,255,0.35)');
  assert.equal(picked.dangerText, '#20232A', 'light fill takes dark ink');
  const orange = B.thresholdRangeCfg({ threshWindWarnColor: '#FFAA00' }, ENV, { keyStem: 'Wind' });
  assert.equal(orange.warnColor, '#FFAA00', 'orange is a pick, not auto');
  // A hostile stored string must never reach the inline styles (normalizes to auto
  // -> theme fg; it is a non-empty value, so it does not read as "no outline").
  const evil = B.thresholdRangeCfg(
    { threshWindWarnColor: '"><script>x</script>' }, ENV, { keyStem: 'Wind' });
  assert.equal(evil.warnColor, '#FFFFFF');
});

// --- the toggle hook (blocks.js thresholdToggle) ----------------------------

test('toggling on seeds an ordered pair in the current unit; off blanks it', () => {
  const hook = PC.onChange.get('thresholdToggle');
  assert.equal(typeof hook, 'function');
  const S = { windUnits: 'mph', threshWindWarn: '', threshWindDanger: '' };
  hook(S, false, true, ENV, 'threshWindOn');
  assert.equal(S.threshWindWarn, '25');
  assert.equal(S.threshWindDanger, '40');
  hook(S, true, false, ENV, 'threshWindOn');
  assert.equal(S.threshWindWarn, '');
  assert.equal(S.threshWindDanger, '');
});

test('toggling on preserves a stored ordered pair, reseeds a broken one', () => {
  const hook = PC.onChange.get('thresholdToggle');
  // Goal kinds order upward since the celebration rework: close <= goal.
  const kept = { threshStepsWarn: '4000', threshStepsDanger: '8000' };
  hook(kept, false, true, ENV, 'threshStepsOn');
  assert.equal(kept.threshStepsWarn, '4000', 'valid pair untouched');
  // A legacy below-ordered pair (goal under close) is broken now → reseed.
  const broken = { threshStepsWarn: '8000', threshStepsDanger: '4000' };
  hook(broken, false, true, ENV, 'threshStepsOn');
  assert.equal(broken.threshStepsWarn, '8000');
  assert.equal(broken.threshStepsDanger, '10000');
});

// --- derived toggle state (onbuild.js onLoad) -------------------------------

test('onLoad derives each toggle from its stored pair (the kindConfig rule)', () => {
  const S = {
    threshStepsWarn: '2500', threshStepsDanger: '5000',   // ordered upward (goal) → on
    threshWindWarn: '60', threshWindDanger: '40',         // inverted (above-worse) → off
    threshSleepWarn: '7', threshSleepDanger: '',          // half pair → off
    location: ''
  };
  onbuild.onLoad({
    env: { platform: 'basalt' },
    get: k => S[k],
    set: (k, v) => { S[k] = v; },
    getInitial: k => S[k]
  });
  assert.equal(S.threshStepsOn, true);
  assert.equal(S.threshWindOn, false);
  assert.equal(S.threshSleepOn, false);
  assert.equal(S.threshAqiOn, false, 'unset pair derives off');
});

test('onLoad derives auto colors from the theme; user picks survive', () => {
  /**
   * @param {Object} S settings state to run onLoad against (mutated)
   * @returns {Object} the same S, after the hook
   */
  function loaded(S) {
    onbuild.onLoad({
      env: { platform: 'basalt' },
      get: k => S[k],
      set: (k, v) => { S[k] = v; },
      getInitial: k => S[k]
    });
    return S;
  }
  // Fresh install, dark (default) theme: DANGER lands on the theme fg; WARN stays
  // blank — no outline is the warn default (bold text only) — and the derived
  // outline toggle reads off.
  const dark = loaded({});
  assert.equal(dark.threshAqiWarnColor, '');
  assert.equal(dark.threshAqiWarnOutlineOn, false);
  // Goal kinds seed the green celebration colors (outline on) instead.
  assert.equal(dark.threshStepsWarnColor, '#55FF00');
  assert.equal(dark.threshStepsWarnOutlineOn, true);
  assert.equal(dark.threshStepsDangerColor, '#55FF00');
  // A STALE pre-outline-toggle auto value (theme fg) converts to blank — those
  // installs get the new bold-only default; danger still re-derives per theme.
  const light = loaded({ theme: 'light', threshAqiWarnColor: '#FFFFFF' });
  assert.equal(light.threshAqiWarnColor, '');
  assert.equal(light.threshAqiWarnOutlineOn, false);
  // A user pick is never touched — the contract's orange/red included (nobody
  // shipped with them as page defaults, so they are ordinary picks) — and it means
  // the outline toggle reads ON.
  const custom = loaded({ theme: 'light', threshAqiWarnColor: '#00AAFF' });
  assert.equal(custom.threshAqiWarnColor, '#00AAFF');
  assert.equal(custom.threshAqiWarnOutlineOn, true);
  const orange = loaded({ threshAqiWarnColor: '#FFAA00', threshAqiDangerColor: '#FF0000' });
  assert.equal(orange.threshAqiWarnColor, '#FFAA00');
  assert.equal(orange.threshAqiDangerColor, '#FF0000');
});

// --- the engine's role/zone mapping -----------------------------------------

test('thresholdValues maps roles to track order by direction and clamps strays', () => {
  const E = PC.engine;
  const below = { min: 0, max: 20000, dir: 'below', seedWarn: 5000, seedDanger: 2500 };
  assert.deepEqual(E.thresholdValues(below, '5000', '2500'),
    { lo: 2500, hi: 5000, warn: 5000, danger: 2500 });
  const above = { min: 0, max: 120, dir: 'above', seedWarn: 40, seedDanger: 60 };
  assert.deepEqual(E.thresholdValues(above, '40', '60'),
    { lo: 40, hi: 60, warn: 40, danger: 60 });
  // Blanks fall back to the seeds; decimals and comma decimals both parse.
  assert.deepEqual(E.thresholdValues(above, '', ''),
    { lo: 40, hi: 60, warn: 40, danger: 60 });
  const sleep = { min: 0, max: 12, dir: 'below', seedWarn: 7, seedDanger: 6 };
  assert.equal(E.thresholdValues(sleep, '7,5', '6').warn, 7.5);
  // A stored value beyond the track pins to the bound instead of stranding a thumb.
  assert.equal(E.thresholdValues(above, '40', '500').danger, 120);
});

// The built page is ONE flat <script> with no require() (see build-page.js), so
// status-thresholds.js reaches rain-tier through a GUARDED require() that is null in the
// flat concatenated page, and buildSettingsBlob() dereferences it unconditionally
// (rainTier.rgbToGColor8). A call from page code would therefore throw and take down the
// ENTIRE settings page, not just the threshold rows — the blob is built phone-side by
// clay-payload.js, never in the webview. Guard that at the source level: every occurrence
// of the name in the page must be the module's own declaration/export, never a call site.
test('the generated page never references buildSettingsBlob outside its own module', () => {
  const html = require('../src/pkjs/config-ui/scripts/build-page.js')
    .buildPage({ appFiles: require('../scripts/build-config-page.js').APP_FILES });
  // The builder concatenates each file verbatim behind a `/* app: <basename> */` marker;
  // splitting on those isolates the one segment allowed to name the function (the contract
  // module, which declares and exports it) from every other segment of the page.
  const parts = html.split(/\/\* app: ([\w.-]+) \*\//);
  const seen = [];
  assert.equal(parts[0].indexOf('buildSettingsBlob'), -1,
    'shell + config-ui library must not reference buildSettingsBlob');
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    seen.push(name);
    if (name === 'status-thresholds.js') {
      assert.ok(parts[i + 1].indexOf('function buildSettingsBlob') !== -1,
        'sanity: the declaring module really is bundled into the page');
      continue;
    }
    assert.equal(parts[i + 1].indexOf('buildSettingsBlob'), -1,
      name + ' must not call buildSettingsBlob — rainTier is null in the flat page (no '
      + 'require()), so the call would throw and take down the whole settings screen');
  }
  assert.ok(seen.indexOf('status-thresholds.js') !== -1, 'sanity: app segments were split');
});

// --- end-to-end: the real generated page against a fake DOM ------------------
const vm = require('vm');
const platformLib = require('../src/pkjs/config-ui/lib/platform.js');

/** A DOM-element stub for the handful of nodes boot() touches.
 * @param {string} id element id
 * @returns {Object} stub exposing addEventListener/dispatch + an innerHTML counter
 */
function makeEl(id) {
  let raw = '';
  const handlers = {};
  const el = {
    id, className: '', textContent: '', writes: 0,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    dispatch(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
    types() { return Object.keys(handlers); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {} },
    focus() {}, getAttribute() { return null; }, setAttribute() {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return raw; },
    set(v) { raw = v; el.writes += 1; }
  });
  return el;
}

/** Boot the real generated page in a vm sandbox with a fake DOM.
 * @param {Object} [cfg] stored settings to hydrate from
 * @param {string} [platformName] Pebble platform for the injected env (default basalt)
 * @returns {{S: Object, scroll: Object, modal: Object, clickTab: function}}
 */
function bootGeneratedPage(cfg, platformName) {
  const html = require('../src/pkjs/config-ui/scripts/build-page.js').previewPage({
    appFiles: require('../scripts/build-config-page.js').APP_FILES,
    schema, env: platformLib.computeEnv({ platform: platformName || 'basalt' }),
    cfg: cfg || { provider: 'dwd' }, userData: {}, returnTo: '#'
  });
  const src = html.match(/<script>([\s\S]*)<\/script>/)[1]
    .replace(/PConf\.engine\.boot\(\);\s*$/, '');   // boot explicitly, after wiring onReady
  const els = {};
  const sandbox = { console, setTimeout };
  sandbox.window = sandbox;
  sandbox.document = {
    getElementById(id) { return (els[id] = els[id] || makeEl(id)); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}
  };
  sandbox.navigator = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'generated-page.js' });
  let ready = null;
  sandbox.PConf.hooks.onReady(ctx => { ready = ctx; });   // the only handle on the live S
  sandbox.PConf.engine.boot();
  assert.ok(ready, 'onReady ran (boot completed against the fake DOM)');
  return {
    S: ready.S,
    scroll: els.scroll,
    modal: els.modal,
    clickTab(tabId) {
      const t = { getAttribute: n => (n === 'data-tab' ? tabId : null), closest: sel => (sel === '[data-tab]' ? t : null) };
      els.tabs.dispatch('click', { target: t });
    },
    // Tap a slot row's pencil: opens that sheetId's edit sheet in #modal.
    openEditSheet(sheetId) {
      const t = {
        getAttribute: n => (n === 'data-edit-sheet' ? sheetId : null),
        closest: sel => (sel === '[data-edit-sheet]' ? t : null)
      };
      els.scroll.dispatch('click', { target: t });
      assert.ok(els.modal.innerHTML.length > 0, 'the edit sheet rendered into #modal');
    },
    // Flip a toggle rendered in the open edit sheet.
    clickModalToggle(key) {
      assert.ok(els.modal.innerHTML.indexOf('data-k="' + key + '"') !== -1,
        key + ' toggle is rendered in the open sheet');
      const t = {
        getAttribute: n => (n === 'data-k' ? key : null),
        closest: sel => (sel === '[data-toggle]' ? t : null)
      };
      els.modal.dispatch('click', { target: t });
    }
  };
}

test('the sheet: toggle off shows a disabled seeded slider; on enables and seeds it', () => {
  const page = bootGeneratedPage();
  page.clickTab('watch');
  assert.ok(page.scroll.innerHTML.indexOf('data-edit-sheet="threshAqi"') !== -1,
    'the default AQI forecast slot renders its pencil');
  page.openEditSheet('threshAqi');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshAqiOn"') !== -1,
    'the sheet carries the highlight toggle');
  // The master toggle lives in the sheet's TITLE row, not the body.
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshAqiOn"')
    < page.modal.innerHTML.indexOf('ssel-list'),
    'the toggle renders in the header, before the scroll body');
  // Off = visible but disabled, previewing the seeds (default cfg is WAQI → US AQI).
  assert.ok(page.modal.innerHTML.indexOf('data-range="threshAqiWarn"') !== -1,
    'the slider renders even while the highlight is off');
  assert.ok(/class="row stack[^"]*\bdis\b/.test(page.modal.innerHTML),
    'the off-state slider row is disabled');
  assert.ok(page.modal.innerHTML.indexOf('Warn 100') !== -1,
    'the disabled slider previews the seed values');
  assert.ok(page.modal.innerHTML.indexOf('crossing the warn threshold') !== -1,
    'the sheet carries the threshold intro');

  page.clickModalToggle('threshAqiOn');
  assert.equal(page.S.threshAqiOn, true);
  assert.equal(page.S.threshAqiWarn, '100');
  assert.equal(page.S.threshAqiDanger, '150');
  const sheet = page.modal.innerHTML;
  assert.ok(!/class="row stack[^"]*\bdis\b/.test(sheet),
    'the enabled slider row is no longer disabled');
  assert.ok(sheet.indexOf('data-zone="warn"') !== -1 && sheet.indexOf('data-zone="danger"') !== -1,
    'semantic zones rendered');
  assert.ok(sheet.indexOf('th-warn') !== -1 && sheet.indexOf('th-danger') !== -1,
    'role-styled thumbs rendered');
  assert.ok(sheet.indexOf('Example:') === -1,
    'no "Example:" label on the chip readout (dropped by user request)');
  assert.ok(sheet.indexOf('Warn 100') !== -1 && sheet.indexOf('Danger 150') !== -1,
    'readout chips carry the values');
  assert.ok(sheet.indexOf('data-max-edit="threshAqiMax"') !== -1,
    'AQI is unbounded → scale-max editor present');
  assert.ok(sheet.indexOf('data-action="resetThresholds"') !== -1
    && sheet.indexOf('data-action-arg="Aqi"') !== -1,
    'the reset-to-defaults button rides the slider label');

  page.clickModalToggle('threshAqiOn');
  assert.equal(page.S.threshAqiWarn, '', 'toggling off blanks the pair');
  assert.ok(/class="row stack[^"]*\bdis\b/.test(page.modal.innerHTML),
    'the slider is back to its disabled preview');
});

test('the reset button restores seeds, default colors, and clears the scale max', () => {
  const page = bootGeneratedPage({
    provider: 'dwd',
    threshAqiWarn: '42', threshAqiDanger: '77',
    threshAqiWarnColor: '#00AAFF', threshAqiDangerColor: '#5500FF',
    threshAqiMax: '900'
  });
  page.openEditSheet('threshAqi');
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetThresholds'
      : n === 'data-action-arg' ? 'Aqi' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  const writesBefore = page.modal.writes;
  page.modal.dispatch('click', { target: t });
  assert.equal(page.S.threshAqiWarn, '100', 'warn back to its seed');
  assert.equal(page.S.threshAqiDanger, '150', 'danger back to its seed');
  assert.equal(page.S.threshAqiWarnColor, '', 'warn back to no outline (bold only)');
  assert.equal(page.S.threshAqiWarnOutlineOn, false, 'outline toggle back off');
  assert.equal(page.S.threshAqiDangerColor, '#FFFFFF', 'danger color back to the auto theme fg');
  assert.equal(page.S.threshAqiMax, '', 'scale-max override cleared');
  assert.ok(page.modal.writes > writesBefore, 'the reset re-rendered the sheet');
});

test('an enabled kind shows the ring+dot badge on its slot pencil', () => {
  const page = bootGeneratedPage({
    provider: 'dwd',
    threshAqiWarn: '50', threshAqiDanger: '100'
  });
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  const pen = html.slice(html.indexOf('data-edit-sheet="threshAqi"') - 400,
    html.indexOf('data-edit-sheet="threshAqi"') + 900);
  assert.ok(pen.indexOf('pen-dot warn') !== -1, 'warn ring rendered');
  assert.ok(pen.indexOf('pen-dot danger') !== -1, 'danger dot rendered');
  // Never-customized colors are auto: they track the theme fg (dark default → white).
  assert.ok(pen.indexOf('--th-c:#FFFFFF') !== -1, 'auto colors resolve to the theme fg');
  assert.ok(pen.indexOf('highlighting on') !== -1, 'aria-label says the state');

  const off = bootGeneratedPage();
  off.clickTab('watch');
  assert.equal(off.scroll.innerHTML.indexOf('pen-dot'), -1,
    'no badge while every kind is disabled');
});

test('the derived toggle is on after hydrating a stored ordered pair', () => {
  const page = bootGeneratedPage({
    provider: 'dwd',
    threshAqiWarn: '50', threshAqiDanger: '100'
  });
  assert.equal(page.S.threshAqiOn, true, 'onLoad derived the toggle from the pair');
  page.clickTab('watch');
  page.openEditSheet('threshAqi');
  assert.ok(page.modal.innerHTML.indexOf('data-range="threshAqiWarn"') !== -1,
    'the slider renders immediately with the stored values');
  assert.ok(page.modal.innerHTML.indexOf('Warn 50') !== -1, 'stored warn on the chip');
});

// --- serialize/hydrate round-trip of the hidden companions ------------------
// The type:'hidden' Danger/Max rows are the ONLY thing keeping those keys in the
// save blob (serialize walks schema items); dropping them from the walk would
// silently discard the second thumb + scale max on every save.
test('hidden Danger/Max companions survive hydrate → serialize', () => {
  const stored = { threshStepsWarn: '8000', threshStepsDanger: '4000', threshStepsMax: '30000' };
  const S = PC.engine.hydrate(schema, stored, ENV);
  const blob = PC.engine.serialize(schema, S);
  assert.equal(blob.threshStepsWarn, '8000');
  assert.equal(blob.threshStepsDanger, '4000', 'the hidden danger key rides the save blob');
  assert.equal(blob.threshStepsMax, '30000', 'the hidden scale-max key rides the save blob');
  const fresh = PC.engine.serialize(schema, PC.engine.hydrate(schema, {}, ENV));
  assert.equal(fresh.threshStepsDanger, '', 'hidden keys hydrate their blank defaults');
  assert.equal(fresh.threshStepsMax, '');
});

// --- thresholdValues minSpan repair -----------------------------------------
// The old text UI accepted warn == danger; a stacked pair puts the danger thumb on
// top and, pinned at a track end, could never be separated by touch again. The
// resolve step separates the pair by one span, keeping the danger thumb's stored
// position wherever possible.
test('an equal legacy pair renders separated, even pinned at a track end', () => {
  const E = PC.engine;
  const above = { min: 0, max: 300, dir: 'above', step: 10, minSpan: 10, seedWarn: 100, seedDanger: 150 };
  assert.deepEqual(E.thresholdValues(above, '300', '300'),
    { lo: 290, hi: 300, warn: 290, danger: 300 }, 'above-kind at max: warn pushed down');
  assert.deepEqual(E.thresholdValues(above, '0', '0'),
    { lo: 0, hi: 10, warn: 0, danger: 10 }, 'above-kind at min: danger pushed up');
  const below = { min: 0, max: 20000, dir: 'below', step: 250, minSpan: 250, seedWarn: 5000, seedDanger: 2500 };
  assert.deepEqual(E.thresholdValues(below, '20000', '20000'),
    { lo: 19750, hi: 20000, warn: 20000, danger: 19750 }, 'below-kind at max: danger pushed down');
  assert.deepEqual(E.thresholdValues(below, '0', '0'),
    { lo: 0, hi: 250, warn: 250, danger: 0 }, 'below-kind at min: warn pushed up');
});

// --- badge resolver: env gate + picked colors --------------------------------
test('thresholdPenState honors its env gate and the color pickers', () => {
  const resolver = PC.badgeResolvers.get('thresholdPenState');
  const S = { statusForecastRight: 'aqi', threshAqiWarn: '50', threshAqiDanger: '100' };
  const args = { messageKey: 'statusForecastRight' };
  assert.equal(resolver(S, { thresholds: false }, args), null, 'gated off without env.thresholds');
  assert.deepEqual(resolver(S, ENV, args),
    { label: 'Warn', enabled: true, warnColor: '#8A8E97', dangerColor: '#FFFFFF' },
    'weather kind labels its button Warn; no-outline warn shows the neutral ring');
  const picked = Object.assign({}, S, { threshAqiWarnColor: '#00AAFF', threshAqiDangerColor: '#5500FF' });
  assert.deepEqual(resolver(picked, ENV, args),
    { label: 'Warn', enabled: true, warnColor: '#00AAFF', dangerColor: '#5500FF' });
  // A half pair (disabled kind) still gets its labeled button — just without the
  // enabled state dots (the button must exist to configure the kind at all).
  assert.deepEqual(resolver(Object.assign({}, S, { threshAqiDanger: '' }), ENV, args).enabled, false);
  // Goal kinds label their button Goal.
  const goalArgs = { messageKey: 'statusHealthLeft' };
  const goalS = { statusHealthLeft: 'steps', threshStepsWarn: '4000', threshStepsDanger: '8000' };
  const goalBadge = resolver(goalS, ENV, goalArgs);
  assert.equal(goalBadge.label, 'Goal');
  assert.equal(goalBadge.enabled, true);
});

// --- interaction stubs: drive the shared range machinery on the booted page ---

/** A .rng root stub the drag/keyboard handlers and paint fns accept.
 * @param {string} key data-range messageKey
 * @param {number|string} lo data-lo
 * @param {number|string} hi data-hi
 * @returns {Object} root stub
 */
function makeRngRoot(key, lo, hi) {
  const attrs = { 'data-range': key, 'data-lo': String(lo), 'data-hi': String(hi) };
  const styled = () => ({ style: {}, setAttribute() {}, innerHTML: '' });
  const nodes = {
    '[data-zone="warn"]': styled(),
    '[data-zone="danger"]': styled(),
    '[data-range-thumb=lo]': styled(),
    '[data-range-thumb=hi]': styled(),
    '.rng-val': styled(),
    '.rng-fill': styled(),
    '.rng-track': { getBoundingClientRect: () => ({ left: 0, width: 100 }) }
  };
  const root = {
    isConnected: true,
    getAttribute: n => (attrs[n] == null ? null : attrs[n]),
    setAttribute(n, v) { attrs[n] = String(v); },
    querySelector: sel => nodes[sel] || null,
    querySelectorAll: () => [],
    closest: sel => (sel === '.rng' ? root : null)
  };
  return root;
}

/** A thumb-button stub inside a root stub.
 * @param {Object} root rng root stub
 * @param {string} which 'lo' | 'hi'
 * @returns {Object} thumb stub
 */
function thumbOn(root, which) {
  const th = {
    getAttribute: n => (n === 'data-range-thumb' ? which : null),
    closest: sel => (sel === '[data-range-thumb]' ? th : (sel === '.rng' ? root : null)),
    focus() {}, setPointerCapture() {}, style: {}, setAttribute() {}
  };
  return th;
}
const NO_TARGET = { closest: () => null };

test('a pointer drag in the sheet commits both wire keys through the role mapping', () => {
  const page = bootGeneratedPage();   // healthMode defaults allow the Steps kind
  page.S.threshStepsWarn = '2500';
  page.S.threshStepsDanger = '5000';
  // Steps orders upward since the goal rework: lo = warn ("close") thumb. Track
  // stub is 100px over 0..20000.
  const root = makeRngRoot('threshStepsWarn', 2500, 5000);
  const th = thumbOn(root, 'lo');
  page.modal.dispatch('pointerdown', { target: th, pointerId: 7, preventDefault() {} });
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 7, clientX: 10 });
  // 10% of 20000 = 2000, on the 250 grid.
  assert.equal(page.S.threshStepsWarn, '2000', 'the lo thumb wrote the WARN (close) key');
  assert.equal(page.S.threshStepsDanger, '5000', 'the goal key kept its value');
  page.modal.dispatch('pointerup', { target: NO_TARGET, pointerId: 7 });
  // After release the drag is over: further moves must not write.
  page.modal.dispatch('pointermove', { target: NO_TARGET, pointerId: 7, clientX: 90 });
  assert.equal(page.S.threshStepsWarn, '2000', 'no writes after pointerup');
});

test('keyboard nudge steps half-units and keeps the untouched decimal thumb intact', () => {
  const page = bootGeneratedPage();
  page.S.threshSleepWarn = '6.5';
  page.S.threshSleepDanger = '7.5';
  // Sleep orders upward since the goal rework: hi = danger ("goal") thumb; step
  // 0.5. parseInt on data-lo would silently turn the untouched close 6.5 into 6 —
  // the float regression this pins.
  const root = makeRngRoot('threshSleepWarn', 6.5, 7.5);
  const th = thumbOn(root, 'hi');
  page.modal.dispatch('keydown', { target: th, key: 'ArrowRight', preventDefault() {} });
  assert.equal(page.S.threshSleepDanger, '8', 'goal nudged one 0.5 step up');
  assert.equal(page.S.threshSleepWarn, '6.5', 'close kept its stored half-unit');
});

test('the pre-existing plain slider (hrScale) still commits its lo-hi string', () => {
  const page = bootGeneratedPage();
  page.S.hrScale = '40-180';
  const root = makeRngRoot('hrScale', 40, 180);
  const th = thumbOn(root, 'lo');
  page.scroll.dispatch('keydown', { target: th, key: 'ArrowLeft', preventDefault() {} });
  assert.equal(page.S.hrScale, '35-180', 'the shared path still writes the "lo-hi" contract');
});

test('the inline scale-max editor: open, sanitize, and untouched-blur writes nothing', () => {
  const page = bootGeneratedPage();
  page.openEditSheet('threshAqi');
  page.clickModalToggle('threshAqiOn');
  // openMaxEdit: the click swaps the wrap's markup for a seeded numeric field.
  const wrap = { innerHTML: '', querySelector: () => ({ focus() {}, select() {} }) };
  const btn = {
    getAttribute: n => (n === 'data-max-edit' ? 'threshAqiMax'
      : n === 'data-max-current' ? '300' : null),
    closest: sel => (sel === '[data-max-edit]' ? btn : (sel === '.rng-max' ? wrap : null))
  };
  page.modal.dispatch('click', { target: btn });
  assert.ok(wrap.innerHTML.indexOf('data-max-input="threshAqiMax"') !== -1,
    'the max label swapped for the inline field');
  assert.ok(wrap.innerHTML.indexOf('data-max-seed="300"') !== -1,
    'the field carries its seed for the untouched-blur check');
  /**
   * @param {string} value field text at blur
   * @returns {Object} focusout event stub
   */
  function blurWith(value) {
    const inp = {
      value,
      getAttribute: n => (n === 'data-max-input' ? 'threshAqiMax'
        : n === 'data-max-seed' ? '300' : null),
      closest: sel => (sel === '[data-max-input]' ? inp : null)
    };
    return { target: inp };
  }
  page.modal.dispatch('focusout', blurWith('300'));
  assert.equal(page.S.threshAqiMax, '', 'blurring the untouched field stores no override');
  page.modal.dispatch('focusout', blurWith('500'));
  assert.equal(page.S.threshAqiMax, '500', 'an edited value is stored raw');
  assert.ok(page.modal.innerHTML.indexOf('data-max-current="500"') !== -1,
    'the re-render shows the grown scale');
  page.modal.dispatch('focusout', blurWith('abc'));
  assert.equal(page.S.threshAqiMax, '', 'garbage clears the override instead of storing it');
});

// The section-level platform gate has to survive into the FLAT generated page (the
// concatenated <script> the webview really runs), not just the module-level engine:
// aplite compiles the highlight out (no WW_THRESHOLD_HIGHLIGHT), so a threshold card
// there would be a settings card that silently does nothing.
test('the real generated page: threshold pencils + sheet on basalt, nothing on aplite', () => {
  const aplite = bootGeneratedPage({ provider: 'dwd' }, 'aplite');
  aplite.clickTab('watch');
  const apliteWatch = aplite.scroll.innerHTML;
  assert.equal(apliteWatch.indexOf('data-edit-sheet'), -1,
    'no threshold pencil on aplite (env.thresholds is false)');
  ['threshAqiOn', 'threshAqiWarn', 'threshWindOn', 'threshStepsOn',
    'threshAqiWarnColor'].forEach((k) =>
    assert.equal(apliteWatch.indexOf('data-k="' + k + '"'), -1, k + ' absent on aplite'));
  assert.ok(apliteWatch.indexOf('data-k="timeLeadingZero"') !== -1,
    'the rest of the Watch tab still renders on aplite');
});
