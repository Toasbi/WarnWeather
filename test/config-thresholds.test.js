'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { eachItem } = require('../src/pkjs/config-ui/lib/schema-walk.js');
// The two color defaults are owned by the contract module (status-thresholds.js),
// which also reads these settings back at pack time — assert against the exported
// constants rather than re-inlining the hex a third time.
const thresholds = require('../src/pkjs/status-thresholds.js');
const catalog = require('../src/pkjs/status-line-catalog.js');
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
    // The reset button moved onto the group's sub-header — see "the group header
    // owns the title and the reset action" below.

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
    // boldOnly kinds have no pair at all — kindConfig only owes them a boldMode,
    // so 'disabled' is asserted as falsy rather than strictly false.
    assert.ok(!thresholds.kindConfig(S, index).enabled,
      kind.key + ' must ship disabled');
  });
});

// --- the range resolver (blocks.js thresholdRange) --------------------------

test('resolver direction comes from the contract for every kind', () => {
  thresholds.KINDS.forEach(kind => {
    if (kind.boldOnly) { return; }   // level-less kinds have no slider to configure
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
  // The master toggle moved OUT of the sheet's title row and onto the threshold
  // group's sub-header, inside the scroll body — below the slot-level Bold row.
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshAqiOn"')
    > page.modal.innerHTML.indexOf('ssel-list'),
    'the toggle renders inside the scroll body, not the title row');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshAqiBoldMode"')
    < page.modal.innerHTML.indexOf('subhdr grp'),
    'the Bold row sits above the threshold group header');
  assert.ok(/<div class="subhdr grp">[\s\S]*?data-k="threshAqiOn"/.test(page.modal.innerHTML),
    'the master toggle rides the group sub-header');
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
    'the reset-to-defaults button rides the group sub-header');

  page.clickModalToggle('threshAqiOn');
  assert.equal(page.S.threshAqiWarn, '', 'toggling off blanks the pair');
  assert.ok(/class="row stack[^"]*\bdis\b/.test(page.modal.innerHTML),
    'the slider is back to its disabled preview');
});

test('the reset button blanks the pair, restores default colors, clears the scale max', () => {
  // Wind, not Aqi: the wizard seeds no wind row, so its fresh-install state is the
  // plain schema one — blank pair, highlight off. Aqi's wizard-seeded landing has
  // its own test ('Aqi reset lands on the wizard-seeded fresh-install state').
  const page = bootGeneratedPage({
    provider: 'dwd',
    threshWindWarn: '42', threshWindDanger: '77',
    threshWindWarnColor: '#00AAFF', threshWindDangerColor: '#5500FF',
    threshWindMax: '900'
  });
  page.openEditSheet('threshWind');
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetThresholds'
      : n === 'data-action-arg' ? 'Wind' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  const writesBefore = page.modal.writes;
  page.modal.dispatch('click', { target: t });
  // Blank, not seeded: the highlight toggle is derived from "is there a complete
  // ordered pair?", so seeding real numbers would switch highlighting ON — the one
  // thing a button labelled "Reset to defaults" must not do.
  assert.equal(page.S.threshWindWarn, '', 'warn blanked');
  assert.equal(page.S.threshWindDanger, '', 'danger blanked');
  assert.equal(page.S.threshWindWarnColor, '', 'warn back to no outline (bold only)');
  assert.equal(page.S.threshWindWarnOutlineOn, false, 'outline toggle back off');
  assert.equal(page.S.threshWindDangerColor, '#FFFFFF', 'danger color back to the auto theme fg');
  assert.equal(page.S.threshWindMax, '', 'scale-max override cleared');
  assert.ok(page.modal.writes > writesBefore, 'the reset re-rendered the sheet');
});

test('an enabled kind shows the ring+dot swatch beside its slot control', () => {
  const page = bootGeneratedPage({
    provider: 'dwd',
    threshAqiWarn: '50', threshAqiDanger: '100'
  });
  page.clickTab('watch');
  const html = page.scroll.innerHTML;
  // Slice the whole control cell rather than a window around the Edit button: the
  // swatch LEADS the control and the button TRAILS it, so a window anchored on the
  // button would have to reach backwards past the dropdown to find the dots.
  const at = html.indexOf('data-edit-sheet="threshAqi"');
  const cell = html.slice(html.lastIndexOf('<div class="rgt has-pen">', at), at + 300);
  assert.ok(cell.indexOf('pen-dot warn') !== -1, 'warn ring rendered');
  assert.ok(cell.indexOf('pen-dot danger') !== -1, 'danger dot rendered');
  // Never-customized colors are auto: they track the theme fg (dark default → white).
  assert.ok(cell.indexOf('--th-c:#FFFFFF') !== -1, 'auto colors resolve to the theme fg');
  assert.ok(cell.indexOf('highlighting on') !== -1, 'aria-label says the state');
  // The swatch is a preview, not a control: outside the button, nothing to press.
  assert.ok(/thr-swatch[\s\S]*?data-select=/.test(cell), 'swatch leads the dropdown');
  assert.ok(!/thr-btn[^>]*>[\s\S]*?pen-dot/.test(cell), 'dots must not sit inside the button');

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
  // The sheet configures the whole slot now, so the button says "Edit" for every
  // kind instead of naming one of its sections.
  assert.deepEqual(resolver(S, ENV, args),
    { label: 'Edit', enabled: true, warnColor: '#8A8E97', dangerColor: '#FFFFFF' },
    'no-outline warn shows the neutral ring');
  const picked = Object.assign({}, S, { threshAqiWarnColor: '#00AAFF', threshAqiDangerColor: '#5500FF' });
  assert.deepEqual(resolver(picked, ENV, args),
    { label: 'Edit', enabled: true, warnColor: '#00AAFF', dangerColor: '#5500FF' });
  // A half pair (disabled kind) still gets its labeled button — just without the
  // enabled state dots (the button must exist to configure the kind at all).
  assert.deepEqual(resolver(Object.assign({}, S, { threshAqiDanger: '' }), ENV, args).enabled, false);
  const goalArgs = { messageKey: 'statusHealthLeft' };
  const goalS = { statusHealthLeft: 'steps', threshStepsWarn: '4000', threshStepsDanger: '8000' };
  const goalBadge = resolver(goalS, ENV, goalArgs);
  assert.equal(goalBadge.label, 'Edit', 'goal kinds get the same button label');
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
    'threshAqiWarnColor', 'statusBoldAll'].forEach((k) =>
    assert.equal(apliteWatch.indexOf('data-k="' + k + '"'), -1, k + ' absent on aplite'));
  // Time/Calendar moved to the Layout tab, so probe an always-shown
  // Watch-Status-Bar toggle instead.
  assert.ok(apliteWatch.indexOf('data-k="showQt"') !== -1,
    'the rest of the Status-slots tab still renders on aplite');
});

// --- the slot sheet's shape: Bold row above its own thresholds/goals group ----

/** @returns {Object[]} Every threshold sheet section, in schema order. */
function sheetSections() {
  const out = [];
  schema.tabs.forEach(t => (t.sections || []).forEach(s => {
    if (s.sheetOnly && /^thresh/.test(s.sheetId || '')) { out.push(s); }
  }));
  return out;
}
/** @param {string} stem Kind key stem. @returns {Object} That kind's sheet. */
function sheetFor(stem) {
  const s = sheetSections().find(x => x.sheetId === 'thresh' + stem);
  assert.ok(s, 'no sheet for ' + stem);
  return s;
}
/** @param {string} stem Kind key stem. @returns {Object} Its subheader item. */
function headerFor(stem) {
  const hdr = sheetFor(stem).items.find(it => it.type === 'subheader');
  assert.ok(hdr, stem + ' has no subheader');
  return hdr;
}
/** @param {string} stem Kind key stem. @returns {Object} Its Bold row. */
function boldFor(stem) {
  const b = sheetFor(stem).items.find(it => it.messageKey === 'thresh' + stem + 'BoldMode');
  assert.ok(b, stem + ' has no bold row');
  return b;
}

test('each sheet is titled "<kind> slot", not "<kind> thresholds/goal"', () => {
  assert.equal(sheetFor('Wind').title, 'Wind speed slot');
  assert.equal(sheetFor('Gust').title, 'Wind gusts slot');
  assert.equal(sheetFor('Steps').title, 'Steps slot');
  assert.equal(sheetFor('Distance').title, 'Walked distance slot');
  sheetSections().forEach(s => {
    assert.match(s.title, / slot$/, s.sheetId + ' title');
  });
});

test('the master toggle moved off the sheet title row onto the group header', () => {
  sheetSections().forEach(s => {
    assert.equal(s.headerToggleKey, undefined, s.sheetId + ' still has headerToggleKey');
  });
  // Only the threshold sheets have a group header; the bold-only sheets carry no
  // subheader at all (their single Bold row IS the sheet).
  STEMS.forEach(stem => {
    assert.equal(headerFor(stem).toggleKey, 'thresh' + stem + 'On');
  });
});

test('the group header owns the title and the reset action', () => {
  assert.equal(headerFor('Wind').text, 'Thresholds');
  assert.deepEqual(headerFor('Wind').labelAction,
    { action: 'resetThresholds', arg: 'Wind', label: 'Reset to defaults' });
  assert.equal(headerFor('Steps').text, 'Goals');
});

test('the slider no longer carries the group title or the reset action', () => {
  STEMS.forEach(stem => {
    const range = sheetFor(stem).items.find(it => it.type === 'range');
    assert.equal(range.labelAction, undefined, stem + ' slider still has the reset button');
    assert.ok(!range.label, stem + ' slider still has a label duplicating the header');
  });
});

test('the intro describes the group, so it hangs off the header, not the sheet', () => {
  sheetSections().forEach(s => {
    assert.equal(s.intro, undefined, s.sheetId + ' still has a sheet-level intro');
  });
  STEMS.forEach(stem => {
    assert.match(String(headerFor(stem).intro), /\S/, stem + ' header carries no intro');
  });
  assert.match(headerFor('Wind').intro, /threshold/i);
  assert.match(headerFor('Steps').intro, /goal/i);
});

test('Bold sits above the group and is never gated by the master toggle', () => {
  STEMS.forEach(stem => {
    const items = sheetFor(stem).items;
    const boldIdx = items.indexOf(boldFor(stem));
    const hdrIdx = items.indexOf(headerFor(stem));
    assert.ok(boldIdx < hdrIdx, stem + ' bold row is not above the group header');
    const bold = boldFor(stem);
    assert.equal(bold.type, 'segmented');
    assert.equal(bold.label, 'Bold value');
    assert.equal(bold.defaultValue, 'warn');
    // The row must stay live while the kind's thresholds are off (Always needs
    // none) — its only mute is the Watch-tab master row's override.
    assert.deepEqual(bold.disabledWhen, { key: 'statusBoldAll', eq: 'all' },
      stem + ' bold row must mute only under the master Bold values row');
  });
});

test('the Bold middle option speaks the kind vocabulary, over one stored value', () => {
  // Only the LABEL differs — the stored value stays 'warn' for both, so the blob
  // keeps a single bold vocabulary (status-thresholds.js BOLD_MODES).
  assert.deepEqual(boldFor('Wind').options,
    [['Off', 'off'], ['Warn', 'warn'], ['Always', 'always']]);
  assert.deepEqual(boldFor('Steps').options,
    [['Off', 'off'], ['Close', 'warn'], ['Always', 'always']]);
  STEMS.forEach(stem => {
    assert.deepEqual(boldFor(stem).options.map(o => o[1]), ['off', 'warn', 'always'], stem);
  });
});

test('the Bold hint adds information instead of restating the options', () => {
  const bold = boldFor('Wind');
  assert.match(String(bold.hint), /\S/, 'bold row has no hint');
  ['Off', 'Always'].forEach(word => {
    assert.equal(bold.hint.indexOf(word), -1, 'hint restates the "' + word + '" option');
  });
});

test('the middle Bold option goes inert while the kind thresholds are off', () => {
  STEMS.forEach(stem => {
    assert.deepEqual(boldFor(stem).optionDisabledWhen,
      { warn: { not: { key: 'thresh' + stem + 'On' } } }, stem);
  });
});

test('the outline toggle says what it does to the slot', () => {
  const wind = sheetFor('Wind').items.find(
    it => it.messageKey === 'threshWindWarnOutlineOn');
  assert.equal(wind.label, 'Outline on warn');
  assert.equal(wind.hint,
    'Adds an outline to the slot when the warn threshold is reached.');
  const steps = sheetFor('Steps').items.find(
    it => it.messageKey === 'threshStepsWarnOutlineOn');
  assert.equal(steps.label, 'Outline on close');
  assert.equal(steps.hint,
    'Adds an outline to the slot when you get close to the goal.');
});

test('the reset button leaves the Bold setting alone', () => {
  const S = { theme: 'dark', threshWindBoldMode: 'always', threshWindOn: true,
    threshWindWarn: '10', threshWindDanger: '20', threshWindMax: '200' };
  PC.actions.resetThresholds('Wind', S, ENV);
  assert.equal(S.threshWindBoldMode, 'always', 'reset must not touch Bold');
  assert.equal(S.threshWindMax, '', 'reset still clears the scale max');
  assert.equal(S.threshWindWarn, '', 'reset blanks the pair — that IS the off state');
});

test('reset lands on exactly what a fresh install has, highlight included', () => {
  // "Reset to defaults" has to mean the shipped defaults. Seeding real numbers made
  // the highlight switch itself ON, because the toggle is derived from "is there a
  // complete ordered pair?" — so a user who had highlighting off got their slot
  // outlined on the watch after pressing a button that promised defaults.
  const parse = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
  const derivedOn = (S, stem) =>
    parse(S['thresh' + stem + 'Warn']) !== null && parse(S['thresh' + stem + 'Danger']) !== null;

  // Aqi is deliberately NOT in this list: its fresh-install state is highlight ON
  // — the first-run wizard seeds it (defaults-policy 'wizard-aqi-keeps-a-warn-signal')
  // — so its reset landing is pinned by its own test below.
  ['Wind', 'Gust', 'Steps'].forEach((stem) => {
    const S = { theme: 'dark' };
    S['thresh' + stem + 'On'] = true;
    S['thresh' + stem + 'Warn'] = '10';
    S['thresh' + stem + 'Danger'] = '20';
    S['thresh' + stem + 'Max'] = '200';
    PC.actions.resetThresholds(stem, S, ENV);
    assert.equal(derivedOn(S, stem), false,
      stem + ': the highlight must be OFF after a reset, as on a fresh install');
    assert.equal(S['thresh' + stem + 'Max'], '', stem + ': scale max cleared');
  });
});

test('reset flips the rendered highlight toggle off in the same render', () => {
  // The On toggle is derived state, recomputed from the pair only on the NEXT page
  // open (onbuild.js onLoad). Reset blanks the pair — the real off state — so it
  // must also write the toggle, or the re-rendered sheet keeps showing "Highlight
  // this value" ON with an enabled slider while what actually saves is highlight
  // off: the exact silent-flip-on-next-open failure the reset fix was for, inverted.
  const S = { theme: 'dark', threshWindOn: true,
    threshWindWarn: '40', threshWindDanger: '60' };
  PC.actions.resetThresholds('Wind', S, ENV);
  assert.strictEqual(S.threshWindOn, false,
    'the rendered toggle must agree with the blanked pair immediately');
});

test('Aqi reset lands on the wizard-seeded fresh-install state, not schema-off', () => {
  // Every install that finishes the first-run wizard gets AQI highlighting ON with
  // the warn outline (defaults-policy 'wizard-aqi-keeps-a-warn-signal') — that IS
  // the out-of-box state. A reset that lands on highlight-off instead produces
  // always-bold-with-no-warn-signal, the state that rule's why-text forbids.
  const S = { theme: 'dark', threshAqiOn: true,
    threshAqiWarn: '42', threshAqiDanger: '77', threshAqiMax: '400' };
  PC.actions.resetThresholds('Aqi', S, ENV);
  assert.strictEqual(S.threshAqiOn, true, 'AQI highlighting is on out of the box');
  const warn = Number(S.threshAqiWarn), danger = Number(S.threshAqiDanger);
  assert.ok(warn > 0 && danger > warn,
    'the pair is reseeded ordered (' + S.threshAqiWarn + '/' + S.threshAqiDanger + ')');
  assert.strictEqual(S.threshAqiWarnOutlineOn, true, 'the warn outline is on out of the box');
  assert.equal(S.threshAqiWarnColor, '#FFFFFF',
    'the outline color is the theme fg, as the toggle hook seeds it');
  assert.equal(S.threshAqiMax, '', 'the scale max is still cleared');
  // Bold stays out of it — the reset deliberately leaves Bold alone (pinned above),
  // so the wizard's threshAqiBoldMode row must NOT be applied here.
  assert.ok(!('threshAqiBoldMode' in S), 'reset must not write the Bold mode');
});

test("a kind's reset never reaches outside that kind (the policy veto's scope)", () => {
  // The defaults-policy table also carries rows for OTHER kinds and for the
  // status-bar layout (the health-slot swap); resetThresholds' mayWrite veto is
  // all that keeps a Wind-sheet reset from applying them through applyDefaults.
  // Foreign keys must stay ABSENT, not merely unchanged.
  const S = { theme: 'dark', threshWindOn: true,
    threshWindWarn: '40', threshWindDanger: '60' };
  PC.actions.resetThresholds('Wind', S, ENV);
  ['statusTopRight', 'statusHealthLeft', 'threshAqiOn', 'threshAqiWarnOutlineOn',
    'threshStepsBoldMode', 'threshWindBoldMode', 'threshTempBoldMode'].forEach((key) => {
    assert.ok(!(key in S), key + ' must not be written by a Wind reset');
  });
});

test('a weather-kind outline survives the next page open (stored toggle disambiguates)', () => {
  // thresholdOutlineToggle ON seeds the theme fg — but the fg is also what a LEGACY
  // auto warn color looks like, and onLoad converts auto colors back to '' (no
  // outline) for weather kinds. The stored outline toggle rides the save, so it is
  // what tells "the user turned this on" apart from "pre-toggle residue": with it
  // true the outline must survive the reopen (and keep tracking the theme fg);
  // without it the auto color still converts to ''. On B&W there is no color picker
  // at all, so fg-seeded is the ONLY on-state — losing it loses the feature there.
  const outlineHook = PC.onChange.get('thresholdOutlineToggle');
  const S = { theme: 'dark', threshWindOn: true,
    threshWindWarn: '40', threshWindDanger: '60' };
  outlineHook(S, false, true, ENV, 'threshWindWarnOutlineOn');
  S.threshWindWarnOutlineOn = true;   // the engine stores the toggle value itself
  assert.equal(S.threshWindWarnColor, '#FFFFFF', 'precondition: ON seeds the dark fg');

  // Simulate the next settings open over the saved state.
  const ctx = { env: { platform: 'basalt' },
    get: (k) => S[k], set: (k, v) => { S[k] = v; }, getInitial: (k) => S[k] };
  onbuild.onLoad(ctx);
  assert.strictEqual(S.threshWindWarnOutlineOn, true,
    'the outline the user turned on must still be on');
  assert.equal(S.threshWindWarnColor, '#FFFFFF', 'the auto color keeps tracking the fg');

  // Theme switched between opens: the auto color follows the new theme's fg.
  S.theme = 'light';
  onbuild.onLoad(ctx);
  assert.strictEqual(S.threshWindWarnOutlineOn, true);
  assert.equal(S.threshWindWarnColor, '#000000', 'auto fg re-derives for the light theme');

  // And WITHOUT the stored toggle, a legacy auto color still converts to no-outline.
  const legacy = { theme: 'dark', threshWindWarn: '40', threshWindDanger: '60',
    threshWindWarnColor: '#FFFFFF' };
  onbuild.onLoad({ env: { platform: 'basalt' },
    get: (k) => legacy[k], set: (k, v) => { legacy[k] = v; }, getInitial: (k) => legacy[k] });
  assert.equal(legacy.threshWindWarnColor, '', 'legacy residue still reads as no outline');
  assert.strictEqual(legacy.threshWindWarnOutlineOn, false);

  // A STORED false behaves the same: the toggle owns the weather-kind state, so
  // auto residue next to an explicit off reads as off, never as a pick.
  const off = { theme: 'dark', threshWindWarnOutlineOn: false,
    threshWindWarn: '40', threshWindDanger: '60', threshWindWarnColor: '#FFFFFF' };
  onbuild.onLoad({ env: { platform: 'basalt' },
    get: (k) => off[k], set: (k, v) => { off[k] = v; }, getInitial: (k) => off[k] });
  assert.equal(off.threshWindWarnColor, '', 'stored-off + auto residue stays no-outline');
  assert.strictEqual(off.threshWindWarnOutlineOn, false);
});

test('a stored-ON weather toggle heals a blank or null warn color back to the fg', () => {
  // The toggle owns the state, so ON beside an empty-ish color — a state no UI
  // flow produces, but a hand-edited or partially-healed blob could — re-seeds
  // the fg and keeps the outline, rather than silently flipping the user's
  // deliberate ON back off.
  ['', null].forEach((rawColor) => {
    const S = { theme: 'dark', threshWindWarnOutlineOn: true,
      threshWindWarn: '40', threshWindDanger: '60', threshWindWarnColor: rawColor };
    onbuild.onLoad({ env: { platform: 'basalt' },
      get: (k) => S[k], set: (k, v) => { S[k] = v; }, getInitial: (k) => S[k] });
    assert.equal(S.threshWindWarnColor, '#FFFFFF',
      JSON.stringify(rawColor) + ': the fg is re-seeded');
    assert.strictEqual(S.threshWindWarnOutlineOn, true,
      JSON.stringify(rawColor) + ': the outline stays on');
  });
});

test('the slot button is labelled Edit for every kind', () => {
  const S = { theme: 'dark', statusLine1Left: 'wind', threshWindOn: true,
    threshWindWarn: '40', threshWindDanger: '60' };
  const badge = PC.badgeResolvers.get('thresholdPenState')(
    S, ENV, { messageKey: 'statusLine1Left' });
  assert.equal(badge.label, 'Edit');
  const goalS = { theme: 'dark', statusLine1Left: 'steps', threshStepsOn: true,
    threshStepsWarn: '8000', threshStepsDanger: '10000' };
  assert.equal(PC.badgeResolvers.get('thresholdPenState')(
    goalS, ENV, { messageKey: 'statusLine1Left' }).label, 'Edit');
  // Bold-only kinds get the same button; with no pair there is no enabled
  // highlight state to badge.
  const boldBadge = PC.badgeResolvers.get('thresholdPenState')(
    { theme: 'dark', statusLine1Left: 'city' }, ENV, { messageKey: 'statusLine1Left' });
  assert.ok(boldBadge, 'a city slot offers the Edit button');
  assert.equal(boldBadge.label, 'Edit');
  assert.ok(!boldBadge.enabled, 'a bold-only kind never badges as enabled');
});

// --- bold-only slot sheets: every level-less kind, one Bold row each ---------
// (wire ids 8..16 in status-thresholds.js; the battery GLYPH item deliberately
// absent — its slot draws a glyph, not text, so a Bold option would be a no-op
// lie. The battery PERCENTAGE kind renders text, so it gets a normal sheet.
// Temp's sheet additionally carries the tempSlotDisplay row — see below.)

const BOLD_STEMS = ['Temp', 'Pressure', 'Sun', 'Date', 'Week', 'City', 'Countdown', 'Hr', 'BatteryPct'];
const BOLD_CODES = {
  temp: 'Temp', pressure: 'Pressure', sun: 'Sun', date: 'Date',
  week: 'Week', city: 'City', countdown: 'Countdown', hr: 'Hr',
  batteryPct: 'BatteryPct'
};
// Rows a bold-only sheet carries BELOW its Bold row, in order. Absent stem = Bold
// alone. The unit toggles exist only for the kinds the phone bakes the text for
// (status-lines.js); the watch-formatted ones — Hr, BatteryPct — have no such row.
const BOLD_SHEET_EXTRA_ROWS = {
  Temp: ['tempSlotDisplay', 'tempSlotUnit'],
  Pressure: ['pressureSlotUnit'],
  Countdown: ['countdownSlotUnit']
};

// Bold value opens EVERY slot sheet — the bold-only ones, where it is the sole
// control, and the threshold ones, where it sits above the Thresholds subheader.
// Asserted across all of them at once rather than per kind, so a sheet added later
// cannot quietly become the second exception (the Temp sheet was the first).
test('Bold value is the first row of every slot sheet, threshold and bold-only alike', () => {
  const sheets = sheetSections();
  assert.ok(sheets.length >= 17, 'found ' + sheets.length + ' slot sheets');
  sheets.forEach((s) => {
    const first = s.items[0];
    assert.ok(first, s.title + ' has no rows');
    assert.match(String(first.messageKey), /BoldMode$/,
      s.title + ' must open with its Bold row, got ' + (first.label || first.messageKey));
    assert.equal(first.label, 'Bold value', s.title + ' Bold row label');
  });
});

test('every bold-only kind gets a sheet whose Bold row is its FIRST control', () => {
  const titles = {
    Temp: 'Temperature slot', Pressure: 'Air pressure (hPa) slot',
    Sun: 'Sunrise/sunset slot', Date: 'Date slot', Week: 'Calendar week slot',
    City: 'City slot', Countdown: 'Date countdown slot', Hr: 'Heart rate slot',
    BatteryPct: 'Battery percentage slot'
  };
  BOLD_STEMS.forEach(stem => {
    const s = sheetFor(stem);
    assert.equal(s.title, titles[stem], stem + ' sheet title');
    assert.deepEqual(s.showWhen, { env: 'thresholds' },
      stem + ' sheet carries the platform gate');
    // Bold is the row all of these sheets share, so it leads everywhere; a few kinds
    // add their own controls below it — Temp its display mode, and the phone-baked
    // unit kinds their "Show unit" toggle. Naming the extra rows per stem rather than
    // counting them keeps this a real guard: a row added later has to be declared
    // here, and it cannot be declared in the wrong sheet or above the Bold row.
    assert.deepEqual(s.items.slice(1).map(it => it.messageKey),
      BOLD_SHEET_EXTRA_ROWS[stem] || [], stem + ' rows below Bold');
    const bold = boldFor(stem);
    assert.equal(s.items[0], bold,
      stem + ' Bold row must open the sheet');
    assert.equal(bold.type, 'segmented');
    assert.equal(bold.label, 'Bold value');
    assert.equal(bold.defaultValue, 'off', stem + ' defaults to off');
    assert.equal(bold.hint, 'Show this value in heavier text.', stem + ' hint');
    assert.deepEqual(bold.disabledWhen, { key: 'statusBoldAll', eq: 'all' },
      stem + ' row mutes only under the master Bold values row');
  });
});

test('bold-only sheets offer Off/Always only — no level, no Warn pill', () => {
  BOLD_STEMS.forEach(stem => {
    assert.deepEqual(boldFor(stem).options,
      [['Off', 'off'], ['Always', 'always']], stem);
    assert.equal(boldFor(stem).optionDisabledWhen, undefined,
      stem + ' has no threshold toggle to go inert on');
  });
});

test('the Hr sheet row mirrors the hr slot availability (health + sensor)', () => {
  const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
  const it = boldFor('Hr');
  // HEALTH_SLOT_WHEN plus env.hr — the rule statusLineCatalog.itemAvailable
  // applies to the hr item itself (needsHealth AND needsHr).
  assert.deepEqual(it.showWhen,
    { all: [{ env: 'health' }, { key: 'healthMode', ne: 'off' }, { env: 'hr' }] });
  const ctx = (health, hr, mode) =>
    Object.assign({ env: { health, hr, color: true } }, { healthMode: mode });
  assert.equal(showWhen.isVisible(it, ctx(true, false, 'all')), false,
    'hidden without a heart-rate sensor');
  assert.equal(showWhen.isVisible(it, ctx(false, true, 'all')), false,
    'hidden without health sensors');
  assert.equal(showWhen.isVisible(it, ctx(true, true, 'off')), false,
    'hidden with health off');
  ['slot', 'status', 'all'].forEach(mode => {
    assert.equal(showWhen.isVisible(it, ctx(true, true, mode)), true,
      'shown in healthMode ' + mode);
  });
  // The other bold-only kinds need no availability gate at all.
  BOLD_STEMS.filter(stem => stem !== 'Hr').forEach(stem => {
    assert.equal(boldFor(stem).showWhen, undefined, stem + ' needs no gate');
  });
});

test('battery GLYPH has NO sheet (draws a glyph, not text); battery % has one', () => {
  assert.equal(sheetSections().find(s => s.sheetId === 'threshBattery'), undefined,
    'no threshBattery sheet exists');
  const resolve = PC.sheetResolvers.get('statusSlotEditSheet');
  assert.equal(resolve({ statusTopRight: 'battery' }, ENV, { messageKey: 'statusTopRight' }),
    null, 'no pencil on a battery-glyph slot');
  // The battery PERCENTAGE kind renders text (a real bold cell, wire id 16), so
  // the same machinery gives it a sheet and a pencil.
  assert.ok(sheetFor('BatteryPct'), 'threshBatteryPct sheet exists');
  assert.equal(resolve({ statusTopRight: 'batteryPct' }, ENV, { messageKey: 'statusTopRight' }),
    'threshBatteryPct', 'the battery-% slot resolves its bold sheet');
});

test('the Temp sheet puts its display-mode pills below the Bold row', () => {
  const items = sheetFor('Temp').items;
  assert.equal(items[0].messageKey, 'threshTempBoldMode', 'Bold leads, as in every sibling sheet');
  const disp = items[1];
  assert.equal(disp.messageKey, 'tempSlotDisplay');
  assert.equal(disp.type, 'segmented');
  assert.equal(disp.defaultValue, 'actual', 'shipped behaviour: the actual temp');
  assert.equal(disp.label, 'Temperature selection');
  assert.deepEqual(disp.options,
    [['Temp', 'actual'], ['Feels like', 'feels'], ['Both', 'both']]);
  assert.match(String(disp.hint), /both/i, 'hint explains the Both mode');
  assert.match(String(disp.hint), /feels/i, 'hint names the feels-like value');
  // No gate of its own: it inherits the sheet's THRESHOLD_WHEN, so aplite (which
  // has no Edit sheets) deliberately never reaches it — feels-like is left out
  // there entirely (slot mode AND graph metric, see the forecastMetric resolver).
  assert.equal(disp.showWhen, undefined);
  // NOT muted by the master Bold row: display mode is not a bold setting.
  assert.equal(disp.disabledWhen, undefined);
});

test('the slot pencil resolves the bold-only sheet for every new kind', () => {
  const resolve = PC.sheetResolvers.get('statusSlotEditSheet');
  Object.keys(BOLD_CODES).forEach(code => {
    assert.equal(resolve({ statusLine1Left: code }, ENV, { messageKey: 'statusLine1Left' }),
      'thresh' + BOLD_CODES[code], code + ' resolves its sheet');
  });
  assert.equal(resolve({ statusLine1Left: 'wind' }, ENV, { messageKey: 'statusLine1Left' }),
    'threshWind', 'threshold kinds keep their sheets');
  assert.equal(resolve({ statusLine1Left: 'city' }, { thresholds: false },
    { messageKey: 'statusLine1Left' }), null, 'the env gate still applies');
});

test('bold-only BoldMode keys hydrate their default and ride the save blob', () => {
  const S = PC.engine.hydrate(schema, {}, ENV);
  const blob = PC.engine.serialize(schema, S);
  BOLD_STEMS.forEach(stem => {
    assert.equal(blob['thresh' + stem + 'BoldMode'], 'off',
      stem + ' BoldMode must survive hydrate → serialize');
  });
  assert.equal(blob.tempSlotDisplay, 'actual',
    'tempSlotDisplay must survive hydrate → serialize');
});

// --- the Watch-tab master Bold row (statusBoldAll) ---------------------------
// A settings-store key only — it has no AppMessage key of its own: 'all'
// overrides the PACKED bold cell of every kind at blob-build time
// (status-thresholds.js buildSettingsBlob), the stored per-kind modes stay
// untouched, and the Clay change-detector resends because the blob content
// changes.

test('the master Bold values row leads the slot selects, thresholds-gated', () => {
  const watch = schema.tabs.find(t => t.id === 'watch');
  // The master governs EVERY bar, so it lives in the watchStatus card's
  // title-less intro section — ABOVE the per-bar sub-headers ("Forecast
  // Status Bar", ...), not inside the first bar's own group.
  const sections = watch.sections.filter(s => s.groupCard === 'watchStatus');
  const masterIdx = sections.findIndex(s =>
    (s.items || []).some(it => it.messageKey === 'statusBoldAll'));
  const slotsIdx = sections.findIndex(s =>
    (s.items || []).some(it => it.messageKey === 'statusForecastLeft'));
  assert.ok(masterIdx !== -1, 'master row exists in the watchStatus card');
  assert.ok(masterIdx < slotsIdx,
    'master row renders above the first status-bar group');
  assert.equal(sections[masterIdx].title, undefined,
    'master row lives in the title-less intro section, not under a bar header');
  const master = sections[masterIdx].items
    .find(it => it.messageKey === 'statusBoldAll');
  assert.equal(master.type, 'segmented');
  assert.equal(master.label, 'Bold values');
  assert.equal(master.defaultValue, 'perSlot');
  assert.deepEqual(master.options, [['Per slot', 'perSlot'], ['All', 'all']]);
  // Same platform gate as the sheets: aplite compiles the bold machinery out.
  assert.deepEqual(master.showWhen, { env: 'thresholds' },
    'the master row must be hidden on aplite');
  assert.match(String(master.hint), /heavier text/, 'master row explains itself');
});

test('every per-slot Bold row carries the master-disable predicate', () => {
  STEMS.concat(BOLD_STEMS).forEach(stem => {
    assert.deepEqual(boldFor(stem).disabledWhen, { key: 'statusBoldAll', eq: 'all' },
      stem + ' bold row must mute while the master is "all"');
  });
});

/** Class attribute of the row div holding the given data-k control.
 * @param {string} html rendered body/sheet HTML
 * @param {string} key messageKey to locate
 * @returns {string} the row div's opening tag up to (not including) '>'
 */
function rowClassFor(html, key) {
  const at = html.indexOf('data-k="' + key + '"');
  assert.ok(at !== -1, key + ' rendered');
  const open = html.lastIndexOf('<div class="row', at);
  return html.slice(open, html.indexOf('>', open));
}

test('the sheets gray their Bold row out while the master is "all"', () => {
  const page = bootGeneratedPage({ provider: 'dwd', statusBoldAll: 'all' });
  page.clickTab('watch');
  assert.ok(page.scroll.innerHTML.indexOf('data-k="statusBoldAll"') !== -1,
    'the master row renders in the Watch tab');
  page.openEditSheet('threshAqi');
  assert.match(rowClassFor(page.modal.innerHTML, 'threshAqiBoldMode'), /\bdis\b/,
    'the sheet Bold row is muted under the master override');
  const perSlot = bootGeneratedPage({ provider: 'dwd' });
  perSlot.clickTab('watch');
  perSlot.openEditSheet('threshAqi');
  assert.doesNotMatch(rowClassFor(perSlot.modal.innerHTML, 'threshAqiBoldMode'), /\bdis\b/,
    'the default perSlot leaves the Bold row live');
});

test('the generated page renders the Temp display pills and the battery-% sheet', () => {
  const page = bootGeneratedPage({ provider: 'dwd' });
  page.clickTab('watch');
  page.openEditSheet('threshTemp');
  assert.ok(page.modal.innerHTML.indexOf('data-k="tempSlotDisplay"') !== -1,
    'the Temp sheet renders the display-mode control');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshTempBoldMode"') !== -1,
    'the Temp sheet still renders its Bold row');
  page.openEditSheet('threshBatteryPct');
  assert.ok(page.modal.innerHTML.indexOf('data-k="threshBatteryPctBoldMode"') !== -1,
    'the battery-% sheet renders its Bold row');
});

// --- the status-card reset button (blocks.js resetStatusSlots) ---------------
// One text button in the Watch tab's intro puts every slot of every bar back to
// its platform-aware default and the bold settings back to their shipped
// defaults. Thresholds, colors, outlines, and scale maxes stay put — each sheet
// carries its own reset for those.

/** @returns {Object} A settings state with nothing at its default. */
function scrambledSlotState() {
  const S = { statusBoldAll: 'all', tempSlotDisplay: 'both' };
  // 'uv' is not the default of any of the 12 slots.
  catalog.allSlotKeys().forEach(k => { S[k] = 'uv'; });
  thresholds.KINDS.forEach((kind, i) => {
    S['thresh' + kind.key + 'BoldMode'] = (i % 2 === 0) ? 'always' : 'off';
  });
  S.threshWindOn = true;
  S.threshWindWarn = '10'; S.threshWindDanger = '20'; S.threshWindMax = '200';
  S.threshWindWarnColor = '#00AAFF'; S.threshWindDangerColor = '#5500FF';
  return S;
}

test('resetStatusSlots restores every slot default (hr and non-hr) and the bold defaults', () => {
  const hrEnv = Object.assign({}, ENV, { hr: true });
  // Sanity: the two envs really differ (the health bar's hrDefaults flavor).
  assert.notEqual(catalog.slotDefault('statusHealthRight', ENV),
    catalog.slotDefault('statusHealthRight', hrEnv));
  const map = itemsByKey();
  [{ env: ENV, name: 'non-hr' }, { env: hrEnv, name: 'hr' }].forEach(({ env, name }) => {
    const S = scrambledSlotState();
    // The same stored-shape resolver the engine hands actions (defaultAsStored),
    // rebuilt from the real schema so the assertions stay end-to-end honest.
    const defaultOf = (key) => PC.engine.resolveDefaultFrom(map[key][0], env);
    assert.equal(PC.actions.resetStatusSlots(null, S, env, defaultOf), true,
      name + ': returns true so the engine re-renders');
    catalog.allSlotKeys().forEach(k => {
      assert.equal(S[k], catalog.slotDefault(k, env),
        name + ': ' + k + ' back to its platform-aware default');
    });
    assert.equal(S.statusBoldAll, 'perSlot', name + ': master Bold row back to perSlot');
    assert.equal(S.tempSlotDisplay, 'actual',
      name + ': temp display pills back to Temp (same sheet, no reset path of its own)');
    thresholds.KINDS.forEach(kind => {
      assert.equal(S['thresh' + kind.key + 'BoldMode'], kind.boldOnly ? 'off' : 'warn',
        name + ': ' + kind.key + ' BoldMode back to its sheet default');
    });
    // Thresholds/colors/outline/max belong to the per-sheet reset — untouched here.
    assert.equal(S.threshWindOn, true, name + ': highlight toggle untouched');
    assert.equal(S.threshWindWarn, '10', name + ': warn threshold untouched');
    assert.equal(S.threshWindDanger, '20', name + ': danger threshold untouched');
    assert.equal(S.threshWindMax, '200', name + ': scale max untouched');
    assert.equal(S.threshWindWarnColor, '#00AAFF', name + ': warn color untouched');
    assert.equal(S.threshWindDangerColor, '#5500FF', name + ': danger color untouched');
  });
});

test('the intro reset button resets a live page (slots + bold) on click', () => {
  const page = bootGeneratedPage({
    provider: 'dwd',
    statusForecastLeft: 'uv', statusTopMid: 'week', statusHealthRight: 'steps',
    statusBoldAll: 'all', threshCityBoldMode: 'always', threshWindBoldMode: 'off'
  });
  page.clickTab('watch');
  assert.ok(page.scroll.innerHTML.indexOf('data-action="resetStatusSlots"') !== -1,
    'the Watch-tab intro renders the reset button');
  const t = {
    getAttribute: n => (n === 'data-action' ? 'resetStatusSlots' : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  const writesBefore = page.scroll.writes;
  page.scroll.dispatch('click', { target: t });
  assert.equal(page.S.statusForecastLeft, 'temp', 'forecast left back to its default');
  assert.equal(page.S.statusTopMid, 'date', 'top mid back to its default');
  // The harness boots basalt (no HR sensor) → the non-hr health flavor.
  assert.equal(page.S.statusHealthRight, 'sleep', 'health right back to the non-hr default');
  assert.equal(page.S.statusBoldAll, 'perSlot', 'master Bold row back to perSlot');
  assert.equal(page.S.threshCityBoldMode, 'off', 'bold-only kind back to off');
  assert.equal(page.S.threshWindBoldMode, 'warn', 'threshold kind back to warn');
  assert.ok(page.scroll.writes > writesBefore, 'the reset re-rendered the page');
});

test('the temp slot keeps Both and the degree sign apart, in both directions', () => {
  // "-12/-10" is 7 of an edge slot's 8 bytes and the degree is 2 more, so the two
  // cannot coexist. Whichever the user just picked wins; the other steps aside.
  const hook = PConf.onChange.get('tempUnitExclusive');
  assert.ok(hook, 'tempUnitExclusive hook is registered');

  // Choosing Both while the degree is on clears the degree.
  const a = { tempSlotDisplay: 'actual', tempSlotUnit: true };
  a.tempSlotDisplay = 'both';
  hook(a, 'actual', 'both', {}, 'tempSlotDisplay');
  assert.equal(a.tempSlotUnit, false);

  // Turning the degree on while in Both drops the mode back to Temp.
  const b = { tempSlotDisplay: 'both', tempSlotUnit: false };
  b.tempSlotUnit = true;
  hook(b, false, true, {}, 'tempSlotUnit');
  assert.equal(b.tempSlotDisplay, 'actual');

  // Turning the degree OFF never touches the mode.
  const c = { tempSlotDisplay: 'both', tempSlotUnit: true };
  hook(c, true, false, {}, 'tempSlotUnit');
  assert.equal(c.tempSlotDisplay, 'both');

  // Choosing a non-Both mode never touches the degree.
  const d = { tempSlotDisplay: 'both', tempSlotUnit: true };
  hook(d, 'both', 'feels', {}, 'tempSlotDisplay');
  assert.equal(d.tempSlotUnit, true);
});

test("a goal kind's legacy null warn color heals to outline-off on page open", () => {
  // The old parseResponse stored hexToInt('') = NaN -> JSON null for an
  // explicitly turned-off goal outline. Never-touched keys are absent, not null,
  // so null can only be that bug's footprint: it must land on the off state the
  // user chose, not reseed the default green.
  const healed = { theme: 'dark', threshSleepWarn: '360', threshSleepDanger: '480',
    threshSleepWarnColor: null };
  onbuild.onLoad({ env: { platform: 'basalt' },
    get: (k) => healed[k], set: (k, v) => { healed[k] = v; }, getInitial: (k) => healed[k] });
  assert.equal(healed.threshSleepWarnColor, '', 'null normalizes to the explicit-off sentinel');
  assert.strictEqual(healed.threshSleepWarnOutlineOn, false);

  // An ABSENT color is a genuinely never-touched install: default green, outline on.
  const fresh = { theme: 'dark', threshSleepWarn: '360', threshSleepDanger: '480' };
  onbuild.onLoad({ env: { platform: 'basalt' },
    get: (k) => fresh[k], set: (k, v) => { fresh[k] = v; }, getInitial: (k) => fresh[k] });
  assert.equal(fresh.threshSleepWarnColor, '#55FF00', 'absent still seeds the goal default');
  assert.strictEqual(fresh.threshSleepWarnOutlineOn, true);
});
