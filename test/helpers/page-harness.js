// test/helpers/page-harness.js — boots the REAL generated settings page (the same
// concatenated bundle the phone loads) in a vm sandbox against a fake DOM, and hands
// back the live settings state plus the two hosts the engine delegates events to
// (#scroll and #modal). It lives here rather than being copied per test file: every
// caller drives the same boot path, and a drifted copy would leave one of them quietly
// booting something the page no longer is.
//
// Used by test/config-thresholds.test.js (threshold sheets: sliders, the inline
// scale-max editor) and test/config-night-color-sheet.test.js (the dim-backlight colour
// sheet) — the two places where a control has to be exercised INSIDE the edit-sheet
// dialog, which renders outside #scroll and wires its own handlers.
'use strict';
const assert = require('node:assert/strict');
const vm = require('vm');
const schema = require('../../src/pkjs/settings/schema.js');
const platformLib = require('../../src/pkjs/config-ui/lib/platform.js');

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
    style: {},
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
 * @returns {{S: Object, scroll: Object, modal: Object, clickTab: function,
 *   openEditSheet: function, clickModalToggle: function}}
 */
function bootGeneratedPage(cfg, platformName) {
  const html = require('../../src/pkjs/config-ui/scripts/build-page.js').previewPage({
    appFiles: require('../../scripts/build-config-page.js').APP_FILES,
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
    // Tap a row's Edit button: opens that sheetId's edit sheet in #modal.
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

module.exports = { bootGeneratedPage, makeEl };
