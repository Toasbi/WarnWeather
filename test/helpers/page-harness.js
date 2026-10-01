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
// dialog, which renders outside #scroll and wires its own handlers — and by
// test/config-rainbow-radar-label.test.js (a text commit relabelling a select trigger)
// and test/config-provider-key-sheets.test.js (a weather provider's key sheet: a text
// field, its Test button and a hint's copy button inside the dialog).
'use strict';
const assert = require('node:assert/strict');
const vm = require('vm');
const schema = require('../../src/pkjs/settings/schema.js');
const platformLib = require('../../src/pkjs/config-ui/lib/platform.js');

// A select trigger as engine.js renderSelectTrigger writes it; the groups the fake below
// reads and rewrites are 2 (the data-select key), 4 (the aria-label) and 6 (the label).
const TRIGGER_RE = /(<button type="button" class="sel-wrap" data-select=")([^"]*)(" aria-label=")([^"]*)("[^>]*><span>)([^<]*)(<\/span>)/g;
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const unescHtml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// A derived (hintFrom) hint as engine.js renderRow writes it; group 2 is its row key,
// group 4 its markup (no nested divs in any hint the harness drives).
const HINT_RE = /(<div class="hint" data-hint-for=")([^"]*)(">)([\s\S]*?)(<\/div>)/g;

/** A DOM-element stub for the handful of nodes boot() touches.
 *
 * `querySelectorAll('.sel-wrap[data-select]')` answers one stub per select trigger in
 * the current markup — the engine's in-place relabel after a text commit
 * (relabelSelectTriggers). Its span-text / aria-label writes are spliced back into the
 * markup WITHOUT counting as an innerHTML write (they bump `relabels` instead), so a
 * test can tell an in-place relabel from a full re-render.
 *
 * `querySelectorAll('.hint[data-hint-for]')` likewise answers one stub per derived hint
 * — the engine's in-place hint repaint after a keyboard nudge on a range thumb
 * (repaintDerivedHints). Its innerHTML writes are spliced back the same way and bump
 * `hintRepaints`, not `writes`.
 * @param {string} id element id
 * @returns {Object} stub exposing addEventListener/dispatch + an innerHTML counter
 */
function makeEl(id) {
  let raw = '';
  const handlers = {};
  // The current markup match for one trigger, by its data-select key (null once gone).
  function findTrigger(key) {
    TRIGGER_RE.lastIndex = 0;
    let m;
    while ((m = TRIGGER_RE.exec(raw))) { if (unescHtml(m[2]) === key) { return m; } }
    return null;
  }
  // Rewrite one captured group of that trigger's markup in place.
  function splice(key, group, value) {
    const m = findTrigger(key);
    if (!m) { return; }
    const parts = m.slice(1);
    parts[group - 1] = value;
    raw = raw.slice(0, m.index) + parts.join('') + raw.slice(m.index + m[0].length);
    el.relabels += 1;
  }
  function triggerStub(key) {
    const span = {};
    Object.defineProperty(span, 'textContent', {
      get() { const m = findTrigger(key); return m ? unescHtml(m[6]) : ''; },
      set(v) { splice(key, 6, escHtml(v)); }
    });
    return {
      getAttribute(n) {
        if (n === 'data-select') { return key; }
        if (n === 'aria-label') { const m = findTrigger(key); return m ? unescHtml(m[4]) : null; }
        return null;
      },
      setAttribute(n, v) { if (n === 'aria-label') { splice(key, 4, escHtml(v)); } },
      querySelector(sel) { return sel === 'span' ? span : null; }
    };
  }
  // One derived-hint element, by its data-hint-for key.
  function findHint(key) {
    HINT_RE.lastIndex = 0;
    let m;
    while ((m = HINT_RE.exec(raw))) { if (unescHtml(m[2]) === key) { return m; } }
    return null;
  }
  function hintStub(key) {
    const stub = { getAttribute: n => (n === 'data-hint-for' ? key : null) };
    Object.defineProperty(stub, 'innerHTML', {
      get() { const m = findHint(key); return m ? m[4] : ''; },
      set(v) {
        const m = findHint(key);
        if (!m) { return; }
        raw = raw.slice(0, m.index) + m[1] + m[2] + m[3] + v + m[5] + raw.slice(m.index + m[0].length);
        el.hintRepaints += 1;
      }
    });
    return stub;
  }
  const el = {
    id, className: '', textContent: '', writes: 0, relabels: 0, hintRepaints: 0,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    dispatch(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
    types() { return Object.keys(handlers); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '.hint[data-hint-for]') {
        const hints = [];
        HINT_RE.lastIndex = 0;
        let h;
        while ((h = HINT_RE.exec(raw))) { hints.push(unescHtml(h[2])); }
        return hints.map(hintStub);
      }
      if (sel !== '.sel-wrap[data-select]') { return []; }
      const keys = [];
      TRIGGER_RE.lastIndex = 0;
      let m;
      while ((m = TRIGGER_RE.exec(raw))) { keys.push(unescHtml(m[2])); }
      return keys.map(triggerStub);
    },
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
 * @param {Object} [cfg] stored settings to hydrate from (onboardingDone defaults to true)
 * @param {string} [platformName] Pebble platform for the injected env (default basalt)
 * @returns {{S: Object, scroll: Object, modal: Object, window: Object, clickTab: function,
 *   openEditSheet: function, clickModalToggle: function, clickToggle: function,
 *   typeText: function, openSelect: function, pickOption: function, save: function}}
 *   `window` is the sandbox's global, for a test that stubs a browser API the page
 *   reads at call time (navigator.clipboard).
 */
function bootGeneratedPage(cfg, platformName) {
  const html = require('../../src/pkjs/config-ui/scripts/build-page.js').previewPage({
    appFiles: require('../../scripts/build-config-page.js').APP_FILES,
    schema, env: platformLib.computeEnv({ platform: platformName || 'basalt' }),
    // An installed, already-onboarded config: the real boot injects a seeded blob,
    // and without onboardingDone the first-run wizard would auto-open over the page
    // (wizard.js shouldShow). A caller can still pass onboardingDone: false.
    cfg: Object.assign({ onboardingDone: true }, cfg || { provider: 'dwd' }),
    userData: {}, returnTo: '#'
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
  sandbox.location = { href: '' };   // save() navigates to RETURN_TO + the saved blob
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
    window: sandbox,
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
    },
    // Flip a toggle rendered in the page (#scroll) — the engine's shared controlClick.
    clickToggle(key) {
      assert.ok(els.scroll.innerHTML.indexOf('data-k="' + key + '" data-toggle="1"') !== -1,
        key + ' toggle is rendered in the page');
      const t = {
        getAttribute: n => (n === 'data-k' ? key : null),
        closest: sel => (sel === '[data-toggle]' ? t : null)
      };
      els.scroll.dispatch('click', { target: t });
    },
    // Type into a text field rendered in the page and commit it, the way a browser
    // reports it: focusin, one input (S follows per keystroke), then change (blur/Enter).
    typeText(key, value) {
      assert.ok(els.scroll.innerHTML.indexOf('data-k="' + key + '"') !== -1,
        key + ' text field is rendered in the page');
      const inp = {
        value,
        getAttribute: n => (n === 'data-k' ? key : null),
        closest: sel => (sel === 'input[type=text]' ? inp : null)
      };
      ['focusin', 'input', 'change'].forEach(type => els.scroll.dispatch(type, { target: inp }));
    },
    // Tap a select trigger in the page: opens its option sheet in #modal.
    openSelect(key) {
      assert.ok(els.scroll.innerHTML.indexOf('data-select="' + key + '"') !== -1,
        key + ' select trigger is rendered in the page');
      const t = {
        getAttribute: n => (n === 'data-select' ? key : null),
        closest: sel => (sel === '[data-select]' ? t : null)
      };
      els.scroll.dispatch('click', { target: t });
    },
    // Pick an option in a select sheet — the engine's #modal pick handler (sets the value,
    // runs the item's onChange, closes the sheet).
    pickOption(key, value) {
      const t = {
        getAttribute: n => (n === 'data-k' ? key : (n === 'data-select-pick' ? value : null)),
        closest: sel => (sel === '[data-select-pick]' ? t : null)
      };
      els.modal.dispatch('click', { target: t });
    },
    // Tap Save: the submit hooks run, the state serializes, and after the toast delay the
    // page navigates to RETURN_TO ('#') + the encoded blob. Resolves with that blob.
    save() {
      els.save.dispatch('click', { target: els.save });
      return new Promise(resolve => setTimeout(() => {
        resolve(JSON.parse(decodeURIComponent(sandbox.location.href.slice(1))));
      }, 350));
    }
  };
}

module.exports = { bootGeneratedPage, makeEl };
