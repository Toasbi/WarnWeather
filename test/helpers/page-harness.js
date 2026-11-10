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
// test/config-provider-key-sheets.test.js (a weather provider's key sheet: a text
// field, its Test button and a hint's copy button inside the dialog), by
// test/config-key-status.test.js and test/config-radar-key-status.test.js (the key's
// status: the tab bar's dot and the Save button's confirm dialog, which needs `dialog`
// below), and by test/config-radar-rainbow-options.test.js (the Radar tab's two Rainbow
// options, opened on and saved as radarProvider). The trigger stubs
// below also report the engine's in-place relabel after a text commit (`relabels`).
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
// A card title that follows the settings (engine.js titleByAttr); group 2 is its section id,
// group 4 its text.
const TITLE_RE = /(<span class="ttl" data-title-by=")([^"]*)(">)([^<]*)(<\/span>)/g;

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
 *
 * `querySelectorAll('.ttl[data-title-by]')` answers one stub per card title that follows the
 * settings — the engine's in-place retitle after a text commit (retitleCards). Its
 * textContent writes are spliced back the same way and bump `retitles`.
 *
 * `focuses` counts focus() calls; `document.querySelector('#save')` answers the Save
 * button's stub, so a test can see the Save dialog hand focus back to it.
 * @param {string} id element id
 * @returns {Object} stub exposing addEventListener/dispatch + an innerHTML counter
 */
function makeEl(id, fields) {
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
  // One card title, by its section id.
  function findTitle(secId) {
    TITLE_RE.lastIndex = 0;
    let m;
    while ((m = TITLE_RE.exec(raw))) { if (unescHtml(m[2]) === secId) { return m; } }
    return null;
  }
  function titleStub(secId) {
    const stub = { getAttribute: n => (n === 'data-title-by' ? secId : null) };
    Object.defineProperty(stub, 'textContent', {
      get() { const m = findTitle(secId); return m ? unescHtml(m[4]) : ''; },
      set(v) {
        const m = findTitle(secId);
        if (!m) { return; }
        raw = raw.slice(0, m.index) + m[1] + m[2] + m[3] + escHtml(v) + m[5] + raw.slice(m.index + m[0].length);
        el.retitles += 1;
      }
    });
    return stub;
  }
  const el = {
    id, className: '', textContent: '', writes: 0, relabels: 0, hintRepaints: 0, retitles: 0, focuses: 0,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    dispatch(type, ev) { (handlers[type] || []).forEach(fn => fn(ev)); },
    types() { return Object.keys(handlers); },
    // A name field the page reads back when OK is tapped (a dialog title's): what the test
    // typed into it (typeName), while the markup holds one.
    querySelector(sel) { return fieldStub(fields, sel, raw, el); },
    querySelectorAll(sel) {
      if (sel === '.ttl[data-title-by]') {
        const ids = [];
        TITLE_RE.lastIndex = 0;
        let t;
        while ((t = TITLE_RE.exec(raw))) { ids.push(unescHtml(t[2])); }
        return ids.map(titleStub);
      }
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
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {},
    focus() { el.focuses += 1; }, getAttribute() { return null; }, setAttribute() {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return raw; },
    set(v) { raw = v; el.writes += 1; }
  });
  return el;
}

/**
 * A name field's stub, for a selector the test typed into (typeName) while the host's markup
 * holds that field: its value, and focus/select that count on the host.
 * @param {?Object} fields selector -> the text typed
 * @param {string} sel the selector asked for
 * @param {string} raw the host's markup
 * @param {Object} host the host stub (its `focuses` counter)
 * @returns {?Object} the field, null for none
 */
function fieldStub(fields, sel, raw, host) {
  if (!fields || !Object.prototype.hasOwnProperty.call(fields, sel)) { return null; }
  if (raw.indexOf(sel.replace(/^\[|\]$/g, '')) === -1) { return null; }
  return { value: fields[sel], focus() { host.focuses += 1; }, select() {},
    closest: (s) => (s === sel ? this : null) };
}

/**
 * A node the page builds itself (document.createElement: the screen editor's overlay,
 * screens-page.js): attributes, innerHTML, listeners it can be dispatched to, and the
 * children querySelector answers, made on first ask and kept per selector so a test reads
 * what the page wrote into them.
 * @param {string} tag Its tag name.
 * @returns {Object} The stub.
 */
function makeNode(tag) {
  const handlers = {};
  const attrs = {};
  const found = {};
  const node = {
    tagName: String(tag).toUpperCase(), id: '', innerHTML: '', textContent: '', scrollTop: 0, style: {},
    parentNode: null, children: [], value: '', focuses: 0,
    focus() { node.focuses += 1; },
    select() {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute(n, v) { attrs[n] = String(v); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); },
    dispatch(type, ev) { (handlers[type] || []).slice().forEach((fn) => fn(ev)); },
    appendChild(c) { c.parentNode = node; node.children.push(c); return c; },
    removeChild(c) { node.children = node.children.filter((x) => x !== c); c.parentNode = null; return c; },
    querySelector(sel) { return (found[sel] = found[sel] || makeNode('div')); }
  };
  return node;
}

/** Boot the real generated page in a vm sandbox with a fake DOM.
 * @param {Object} [cfg] stored settings to hydrate from (onboardingDone defaults to true)
 * @param {string} [platformName] Pebble platform for the injected env (default basalt)
 * @param {{userData: (Object|undefined), dialog: (boolean|undefined)}} [opts] `userData`:
 *   what the phone injects (default {}); `dialog`: give #modal a native <dialog>'s
 *   showModal()/close()/open, so the Save button's confirm dialog can open (without it
 *   the page behaves like a webview with no <dialog>, and Save saves at once).
 * @returns {{S: Object, scroll: Object, modal: Object, tabs: Object, window: Object,
 *   clickTab: function, openEditSheet: function, clickModalToggle: function,
 *   clickToggle: function, tapSegment: function, typeText: function, openSelect: function, openModalSelect: function,
 *   pickOption: function,
 *   save: function, tapSave: function, saved: function, asked: string[]}}
 *   `window` is the sandbox's global, for a test that stubs a browser API the page
 *   reads at call time (navigator.clipboard). `asked` lists every selector the page asked the
 *   document for (a closing dialog's focus target among them).
 */
function bootGeneratedPage(cfg, platformName, opts) {
  opts = opts || {};
  const html = require('../../src/pkjs/config-ui/scripts/build-page.js').previewPage({
    appFiles: require('../../scripts/build-config-page.js').APP_FILES,
    schema, env: platformLib.computeEnv({ platform: platformName || 'basalt' }),
    // An installed, already-onboarded config: the real boot injects a seeded blob,
    // and without onboardingDone the first-run wizard would auto-open over the page
    // (wizard.js shouldShow). A caller can still pass onboardingDone: false.
    cfg: Object.assign({ onboardingDone: true }, cfg || { provider: 'dwd' }),
    userData: opts.userData || {}, returnTo: '#'
  });
  const src = html.match(/<script>([\s\S]*)<\/script>/)[1]
    .replace(/PConf\.engine\.boot\(\);\s*$/, '');   // boot explicitly, after wiring onReady
  const els = {};
  // What a test typed into a name field, by its selector (typeName).
  const fields = {};
  // The document's own listeners (the Screens card's ≡: its drag and arrow keys).
  const docHandlers = {};
  // Every selector the page asked the document for, in order (asked: e.g. the trigger a closing
  // dialog hands the focus back to).
  const asked = [];
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.document = {
    getElementById(id) { return (els[id] = els[id] || makeEl(id, fields)); },
    // The Save button; a name field in the page or the open dialog (the Your graphs card's).
    querySelector(sel) {
      asked.push(sel);
      if (sel === '#save') { return sandbox.document.getElementById('save'); }
      return fieldStub(fields, sel, (els.scroll ? els.scroll.innerHTML : '') + (els.modal ? els.modal.innerHTML : ''),
        els.scroll || { focuses: 0 });
    },
    querySelectorAll(sel) { asked.push(sel); return []; },
    addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
    removeEventListener(type, fn) { docHandlers[type] = (docHandlers[type] || []).filter((f) => f !== fn); },
    // The screen editor's overlay is built by the page and appended to the body.
    createElement: makeNode,
    body: makeNode('body')
  };
  sandbox.navigator = {};
  sandbox.location = { href: '' };   // save() navigates to RETURN_TO + the saved blob
  if (opts.dialog) {
    const modal = sandbox.document.getElementById('modal');
    modal.open = false;
    modal.showModal = function () { modal.open = true; };
    modal.close = function () { modal.open = false; };
  }
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'generated-page.js' });
  let ready = null;
  // A tap on one of the open dialog's header buttons, by its selector.
  function tapModal(selector) {
    const t = { getAttribute: () => null, closest: sel => (sel === selector ? t : null) };
    els.modal.dispatch('click', { target: t });
  }
  sandbox.PConf.hooks.onReady(ctx => { ready = ctx; });   // the only handle on the live S
  sandbox.PConf.engine.boot();
  assert.ok(ready, 'onReady ran (boot completed against the fake DOM)');
  return {
    S: ready.S,
    scroll: els.scroll,
    modal: els.modal,
    tabs: els.tabs,
    window: sandbox,
    asked,
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
    // Tap a row INSIDE the open dialog that opens another dialog (a nested one, ‹ back).
    openNestedSheet(sheetId) {
      assert.ok(els.modal.innerHTML.indexOf('data-edit-sheet="' + sheetId + '"') !== -1,
        sheetId + ' row is rendered in the open dialog');
      const t = {
        getAttribute: n => (n === 'data-edit-sheet' ? sheetId : null),
        closest: sel => (sel === '[data-edit-sheet]' ? t : null)
      };
      els.modal.dispatch('click', { target: t });
    },
    // The full-screen dialog's header: Done (keep the edits), ‹ (back to the parent,
    // keeping them) and × (close and put back every value it changed).
    doneDialog() { tapModal('[data-dlg-done]'); },
    backDialog() { tapModal('[data-dlg-back]'); },
    cancelDialog() { tapModal('[data-dlg-close]'); },
    // A dialog title that renames: its pencil, then OK (what typeName typed into the field);
    // Enter in the field and leaving it, as a browser reports them.
    renameDialog() { tapModal('[data-dlg-rename]'); },
    okRename() { tapModal('[data-dlg-rename-ok]'); },
    enterRename(text) {
      const inp = { value: text, closest: sel => (sel === '[data-dlg-rename-in]' ? inp : null) };
      els.modal.dispatch('keydown', { key: 'Enter', target: inp, preventDefault() {} });
    },
    leaveRename(text, to) {
      const inp = { value: text, closest: sel => (sel === '[data-dlg-rename-in]' ? inp : null) };
      els.modal.dispatch('focusout', { target: inp, relatedTarget: to || null });
    },
    // Escape in the open dialog (its native cancel).
    escapeDialog() { els.modal.dispatch('cancel', { preventDefault() {} }); },
    // Type into a name field the page reads back by its selector when OK is tapped (a dialog
    // title's '[data-dlg-rename-in]', the Your graphs card's '[data-gl-rename-in]').
    typeName(selector, text) { fields[selector] = text; },
    // Open every card's More options in a host ('scroll' or 'modal'), so rows behind it
    // render. Repeats until none is left closed (opening one can show another card).
    openAllMore(host) {
      const h = els[host || 'scroll'];
      const re = /data-more="([^"]+)" aria-expanded="false"/g;
      let m, guard = 0;
      while ((m = re.exec(h.innerHTML)) && guard++ < 50) {
        const id = unescHtml(m[1]);
        const t = { getAttribute: n => (n === 'data-more' ? id : null), closest: sel => (sel === '[data-more]' ? t : null) };
        h.dispatch('click', { target: t });
        re.lastIndex = 0;
      }
    },
    // Tap a '?' (data-info id) in a host: its info text shows (or hides again).
    toggleInfo(id, host) {
      const h = els[host || 'scroll'];
      assert.ok(h.innerHTML.indexOf('data-info="' + escHtml(id) + '"') !== -1, id + ' info button is rendered');
      const t = { getAttribute: n => (n === 'data-info' ? id : null), closest: sel => (sel === '[data-info]' ? t : null) };
      h.dispatch('click', { target: t });
    },
    // Tap a pane of a tab with panes (the Graphs tab's Forecast · Rain radar · Health).
    clickPane(tabId, paneId) {
      const v = tabId + ':' + paneId;
      assert.ok(els.scroll.innerHTML.indexOf('data-pane="' + v + '"') !== -1, v + ' pane is offered');
      const t = { getAttribute: n => (n === 'data-pane' ? v : null), closest: sel => (sel === '[data-pane]' ? t : null) };
      els.scroll.dispatch('click', { target: t });
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
    // Tap one segment of a segmented control (or one option of a radio), the engine's [data-v]
    // path, in the page or ('modal') the open sheet.
    tapSegment(key, value, where) {
      const host = where === 'modal' ? els.modal : els.scroll;
      assert.ok(host.innerHTML.indexOf('data-k="' + key + '" data-v="' + value + '"') !== -1,
        key + ' ' + value + ' is rendered in the ' + (where === 'modal' ? 'open sheet' : 'page'));
      const t = {
        getAttribute: n => (n === 'data-k' ? key : (n === 'data-v' ? value : null)),
        closest: sel => (sel === '[data-v]' ? t : null)
      };
      host.dispatch('click', { target: t });
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
    // Tap a select row's trigger inside the open dialog: its options expand under it, so a
    // pick (pickOption) then leaves the dialog open, as a tap does on the phone.
    openModalSelect(key) {
      assert.ok(els.modal.innerHTML.indexOf('data-select="' + key + '"') !== -1, key + ' select is in the open dialog');
      const t = {
        getAttribute: n => (n === 'data-select' ? key : null),
        closest: sel => (sel === '[data-select]' ? t : null)
      };
      els.modal.dispatch('click', { target: t });
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
    // Tap a [data-action] button in a host (the Screens card's rows, + Add screen, a ✕,
    // Undo; the pinned watch's screens): the engine runs the action with its arg.
    tapAction(action, arg, host) {
      const h = els[host || 'scroll'];
      const t = { getAttribute: n => (n === 'data-action' ? action : (n === 'data-action-arg' ? (arg === undefined ? null
        : String(arg)) : null)), closest: sel => (sel === '[data-action]' ? t : null) };
      h.dispatch('click', { target: t });
    },
    // Dispatch an event to the document's own listeners (the Screens card's ≡, the editor's
    // Escape), e.g. { key: 'ArrowUp', target } for a key on a focused handle.
    docDispatch(type, ev) {
      (docHandlers[type] || []).slice().forEach((fn) => fn(ev));
    },
    // The screen editor's overlay (screens-page.js), while it is open; else null.
    editor() {
      return sandbox.document.body.children.find((c) => c.id === 'screenEditor') || null;
    },
    // Tap a [data-se] control in the open screen editor, by its attributes (data-se, data-j,
    // data-k, data-key, data-v; `disabled` for a disabled button).
    tapEditor(attrs) {
      const ed = this.editor();
      assert.ok(ed, 'the screen editor is open');
      const t = { disabled: Boolean(attrs.disabled), getAttribute: n => {
        const k = n.replace(/^data-/, '');
        return Object.prototype.hasOwnProperty.call(attrs, k) ? String(attrs[k]) : null;
      }, closest: sel => (sel === '[data-se]' ? t : null) };
      ed.dispatch('click', { target: t });
    },
    // Tap Save: the submit hooks run, the state serializes, and after the toast delay the
    // page navigates to RETURN_TO ('#') + the encoded blob. Resolves with that blob.
    save() {
      els.save.dispatch('click', { target: els.save });
      return new Promise(resolve => setTimeout(() => {
        resolve(JSON.parse(decodeURIComponent(sandbox.location.href.slice(1))));
      }, 350));
    },
    // Tap Save and return at once: a confirm dialog may open in #modal instead of a save
    // (see `saved`).
    tapSave() {
      els.save.dispatch('click', { target: els.save });
    },
    // After the toast delay: the saved blob, or null when nothing navigated (no save).
    saved() {
      return new Promise(resolve => setTimeout(() => {
        const href = sandbox.location.href;
        resolve(href ? JSON.parse(decodeURIComponent(href.slice(1))) : null);
      }, 350));
    }
  };
}

module.exports = { bootGeneratedPage };
