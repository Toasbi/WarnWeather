'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { eachItem } = require('../src/pkjs/config-ui/lib/schema-walk.js');
// The two color defaults are owned by the contract module (status-thresholds.js),
// which also reads these settings back at pack time — assert against the exported
// constants rather than re-inlining the hex a third time.
const thresholds = require('../src/pkjs/status-thresholds.js');

function itemsByKey() {
  const map = {};
  eachItem(schema, it => {
    if (!it.messageKey) { return; }
    (map[it.messageKey] = map[it.messageKey] || []).push(it);
  });
  return map;
}

const STEMS = ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance'];
const HEALTH_STEMS = ['Steps', 'Sleep', 'Distance'];

test('every threshold kind has warn/danger text fields wired to the validator', () => {
  const map = itemsByKey();
  STEMS.forEach(stem => {
    ['Warn', 'Danger'].forEach(which => {
      const items = map['thresh' + stem + which];
      assert.ok(items && items.length === 1, 'thresh' + stem + which + ' missing');
      assert.equal(items[0].type, 'text');
      assert.equal(items[0].defaultValue, '');
      assert.equal(items[0].onChange, 'validateThresholdPair');
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

test('threshold color pickers are COLOR-capability + bw-theme gated, int defaults', () => {
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
    });
    assert.equal(warn.defaultValue, thresholds.DEFAULT_WARN_COLOR);
    assert.equal(danger.defaultValue, thresholds.DEFAULT_DANGER_COLOR);
  });
});

// Health thresholds are inert wherever a health item can't reach a status slot:
// no health sensors (aplite) or healthMode 'off'. 'slot' mode DOES put health in the
// ordinary bars, so it must keep them — the same rule statusLineCatalog.itemAvailable
// applies to the items themselves. Asserted behaviorally through the real evaluator.
test('health-kind threshold fields are hidden on health-less platforms and with health off', () => {
  const map = itemsByKey();
  const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
  HEALTH_STEMS.forEach(stem => {
    ['Warn', 'Danger'].forEach(which => {
      const it = map['thresh' + stem + which][0];
      assert.ok(JSON.stringify(it.showWhen).includes('"env":"health"'),
        'thresh' + stem + which + ' must be env-health gated');
      const visibleIn = mode => showWhen.isVisible(it, {env: {health: true, color: true}, healthMode: mode});
      assert.equal(visibleIn('off'), false, it.messageKey + ' hidden when health is off');
      ['slot', 'status', 'all'].forEach(mode => {
        assert.equal(visibleIn(mode), true, it.messageKey + ' shown in healthMode ' + mode);
      });
      assert.equal(showWhen.isVisible(it, {env: {health: false, color: true}, healthMode: 'all'}),
        false, it.messageKey + ' hidden without health sensors');
    });
  });
});

// Finding: the 'Warn above' / 'Warn below' labels must not re-encode the direction.
// Iterate the CONTRACT's kind table (status-thresholds.js KINDS) — the same source the
// schema derives from and the watch packs with — so a flipped direction fails here.
test('warn/danger labels and the pair hint follow the contract direction', () => {
  const map = itemsByKey();
  thresholds.KINDS.forEach(kind => {
    const dir = kind.belowIsWorse ? 'below' : 'above';
    assert.equal(map['thresh' + kind.key + 'Warn'][0].label, 'Warn ' + dir);
    assert.equal(map['thresh' + kind.key + 'Danger'][0].label, 'Danger ' + dir);
    // The danger field's hint spells out the both-set + ordered requirement: a
    // half-filled or inverted pair highlights nothing.
    const hint = map['thresh' + kind.key + 'Danger'][0].hint;
    assert.match(hint, /both fields/i, kind.key + ' hint must mention both fields');
    assert.ok(hint.indexOf('at or ' + dir) >= 0,
      kind.key + ' hint must name the required ordering (' + dir + ')');
  });
});

// The built page is ONE flat <script> with no require() (see build-page.js), so
// threshold-validate.js reaches the contract module through window.StatusThresholds —
// which only exists if status-thresholds.js is bundled BEFORE it. Execute the real
// generated script the way the webview does: dropping either file from APP_FILES, or
// ordering them the other way round, breaks the hook here instead of silently in the
// phone webview.
test('the generated page registers the validator hook without require()', () => {
  const vm = require('vm');
  const html = require('../src/pkjs/config-ui/scripts/build-page.js')
    .buildPage({ appFiles: require('../scripts/build-config-page.js').APP_FILES });
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'page contains a <script> block');
  // boot() reaches into live DOM APIs this sandbox does not stub.
  const src = scriptMatch[1].replace(/PConf\.engine\.boot\(\);\s*$/, '');
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.document = { getElementById: () => ({ addEventListener() {} }), addEventListener() {} };
  sandbox.navigator = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'generated-page.js' });
  assert.equal(typeof sandbox.window.StatusThresholds, 'object', 'contract module exposed on window');
  const hook = sandbox.PConf.onChange.get('validateThresholdPair');
  assert.equal(typeof hook, 'function', 'validateThresholdPair hook registered');
  // And it validates for real in that context (not just registered).
  const S = { threshAqiWarn: '200', threshAqiDanger: '100' };
  hook(S, '', '100', {}, 'threshAqiDanger');
  assert.equal(S.threshAqiDanger, '', 'inverted edit reverted inside the webview context');
});

// status-thresholds.js reaches rain-tier through a GUARDED require() that is null in the
// flat concatenated page (no require() there), and buildSettingsBlob() dereferences it
// unconditionally (rainTier.rgbToGColor8). A call from page code would therefore throw and
// take down the ENTIRE settings page, not just the threshold rows — the blob is built
// phone-side by clay-payload.js, never in the webview. Guard that at the source level:
// every occurrence of the name in the page must be the module's own declaration/export,
// never a call site.
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

// --- end-to-end dispatch: the engine's text-field commit path ---------------
// Registering the hook is only half the wiring — the engine has to CALL it when a
// text field is committed. These tests boot the REAL generated page (same flat
// <script> the webview runs, real schema) against a fake DOM, then drive the real
// delegated #scroll handlers with synthetic events. Without the engine's
// change/focusin dispatch the revert never happens and they fail.
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
 * @returns {{S: Object, scroll: Object, clickTab: function, inputHtml: function}}
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
    clickTab(tabId) {
      const t = { getAttribute: n => (n === 'data-tab' ? tabId : null), closest: sel => (sel === '[data-tab]' ? t : null) };
      els.tabs.dispatch('click', { target: t });
    },
    inputHtml(key) {
      const m = els.scroll.innerHTML.match(new RegExp('<input[^>]*data-k="' + key + '"[^>]*>'));
      assert.ok(m, key + ' is rendered in the active tab');
      return m[0];
    }
  };
}

/** A text-input stub the engine's delegated handlers accept.
 * @param {string} key messageKey (data-k)
 * @param {string} value current field text
 * @returns {Object} input stub
 */
function fakeInput(key, value) {
  const el = {
    value,
    getAttribute: n => (n === 'data-k' ? key : null),
    closest: sel => (sel === 'input[type=text]' ? el : null)
  };
  return el;
}

test('committing an inverted threshold through the engine reverts it and repaints the field', () => {
  const page = bootGeneratedPage();
  page.S.threshAqiWarn = '200';
  page.S.threshAqiDanger = '300';
  page.clickTab('watch');
  assert.match(page.inputHtml('threshAqiWarn'), /value="200"/);
  const inp = fakeInput('threshAqiWarn', '200');
  page.scroll.dispatch('focusin', { target: inp });    // pre-edit value captured here
  inp.value = '400';                                   // 400 warn vs 300 danger = inverted
  page.scroll.dispatch('input', { target: inp });
  assert.equal(page.S.threshAqiWarn, '400', 'the input path keeps S live while typing');
  const writesBefore = page.scroll.writes;
  page.scroll.dispatch('change', { target: inp });
  assert.equal(page.S.threshAqiWarn, '200', 'the commit fired the hook, which reverted S');
  assert.ok(page.scroll.writes > writesBefore, 'the commit repainted the body');
  assert.match(page.inputHtml('threshAqiWarn'), /value="200"/);
  assert.ok(page.inputHtml('threshAqiWarn').indexOf('value="400"') === -1,
    'the rejected value is gone from the field');
});

test('a well-ordered commit is kept, and mid-typing keystrokes are never reverted', () => {
  const page = bootGeneratedPage();
  page.S.threshAqiWarn = '50';
  page.clickTab('watch');
  const inp = fakeInput('threshAqiDanger', '');
  page.scroll.dispatch('focusin', { target: inp });
  // Typing "100" passes through "1" and "10", both momentarily below warn=50 (inverted).
  ['1', '10', '100'].forEach(step => {
    inp.value = step;
    page.scroll.dispatch('input', { target: inp });
    assert.equal(page.S.threshAqiDanger, step, 'keystroke "' + step + '" must not be reverted');
  });
  const writesBefore = page.scroll.writes;
  page.scroll.dispatch('change', { target: inp });
  assert.equal(page.S.threshAqiDanger, '100', 'the ordered pair 50/100 survives the commit');
  // ...and the accepted commit must NOT repaint the body. In a webview focus moves on
  // mousedown, so `change` fires before mouseup: replacing #scroll.innerHTML here would
  // detach the control the user's next tap is landing on and swallow that tap. The field
  // already shows the typed text, so there is nothing to repaint.
  assert.equal(page.scroll.writes, writesBefore,
    'an accepted value needs no repaint (a repaint would swallow the next tap)');
});

test('committing a hookless text field just keeps the typed value', () => {
  const page = bootGeneratedPage();   // General tab is active; `location` lives there
  const inp = fakeInput('location', '');
  page.scroll.dispatch('focusin', { target: inp });
  inp.value = 'Berlin';
  page.scroll.dispatch('input', { target: inp });
  page.scroll.dispatch('change', { target: inp });
  assert.equal(page.S.location, 'Berlin', 'no onChange hook, nothing to revert');
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

// The section-level platform gate has to survive into the FLAT generated page (the
// concatenated <script> the webview really runs), not just the module-level engine:
// aplite compiles the highlight out (no WW_THRESHOLD_HIGHLIGHT), so a threshold card
// there would be a settings card that silently does nothing.
test('the real generated page renders no threshold controls on aplite', () => {
  const aplite = bootGeneratedPage({ provider: 'dwd' }, 'aplite');
  aplite.clickTab('watch');
  const apliteWatch = aplite.scroll.innerHTML;
  assert.equal(apliteWatch.indexOf('crossing the warn threshold'), -1,
    'no threshold intro on aplite');
  assert.equal(apliteWatch.indexOf('<div class="subhdr">Air quality (AQI)</div>'), -1,
    'no threshold sub-headers on aplite');
  ['threshAqiWarn', 'threshAqiDanger', 'threshWindWarn', 'threshStepsWarn',
    'threshAqiWarnColor'].forEach((k) =>
    assert.equal(apliteWatch.indexOf('data-k="' + k + '"'), -1, k + ' absent on aplite'));
  assert.ok(apliteWatch.indexOf('data-k="timeLeadingZero"') !== -1,
    'the rest of the Watch tab still renders on aplite');

  const basalt = bootGeneratedPage({ provider: 'dwd' }, 'basalt');
  basalt.clickTab('watch');
  const basaltWatch = basalt.scroll.innerHTML;
  assert.ok(basaltWatch.indexOf('crossing the warn threshold') !== -1,
    'basalt keeps the threshold intro');
  assert.ok(basaltWatch.indexOf('data-k="threshAqiWarn"') !== -1,
    'basalt keeps the threshold inputs');
});
