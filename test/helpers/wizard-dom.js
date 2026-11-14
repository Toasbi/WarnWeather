'use strict';
// A small fake DOM for the onboarding wizard (src/pkjs/page/settings/wizard/wizard.js): just the surface its
// controller touches, so its real event handlers can run in Node, and the one way the suites open it
// (openSetup).
//
// Every overlay the controller creates is its own object with its own listeners (so a second "Run
// setup again" can be told apart from the first). Whatever HTML the controller writes into an
// overlay's body is tokenized into element stubs, whatever the attributes' order: start tags with
// their attributes and inner HTML, matched by the selector forms the controller uses (`tag`, `[a]`,
// `[a="v"]`, `[a=v]`, `.class`, combined), so in-place updates are observable: picker() reads the
// segments' live aria-checked, not the HTML of the last render. Events go to the current overlay's
// listeners, with a target whose closest() answers the selectors a test names.

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const VOID = { img: true, input: true, br: true, hr: true, meta: true, link: true };
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);

/**
 * The elements of an HTML string, in document order: each start tag's name, attributes, span in the
 * string and inner HTML.
 * @param {string} html HTML.
 * @returns {Array.<{tag: string, attrs: Object, start: number, end: number, inner: string}>}
 */
function elementsOf(html) {
  const out = [];
  const open = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[1]) {
      for (let i = open.length - 1; i >= 0; i -= 1) {
        if (open[i].tag === m[2]) {
          open[i].inner = html.slice(open[i].innerStart, m.index);
          open[i].end = tagRe.lastIndex;
          open.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = {};
    const attrRe = /([^\s=]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = attrRe.exec(m[3]))) { attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]); }
    const el = { tag: m[2].toLowerCase(), attrs, start: m.index, end: tagRe.lastIndex, innerStart: tagRe.lastIndex, inner: '' };
    out.push(el);
    if (!m[4] && !VOID[el.tag]) { open.push(el); }
  }
  return out;
}

/**
 * Whether an element matches a simple selector: an optional tag, then [a], [a="v"], [a=v] and
 * .class parts, all of which must hold.
 * @param {{tag: string, attrs: Object}} el Element.
 * @param {string} selector Selector.
 * @returns {boolean}
 */
function matches(el, selector) {
  const m = /^([a-zA-Z][\w-]*)?((?:\[[^\]]+\]|\.[\w-]+)*)$/.exec(selector);
  if (!m) { throw new Error('the fake DOM does not handle the selector ' + selector); }
  if (m[1] && el.tag !== m[1].toLowerCase()) { return false; }
  const parts = m[2].match(/\[[^\]]+\]|\.[\w-]+/g) || [];
  return parts.every((part) => {
    if (part[0] === '.') { return (el.attrs.class || '').split(/\s+/).indexOf(part.slice(1)) !== -1; }
    const a = /^\[([^=\]]+)(?:="?([^"\]]*)"?)?\]$/.exec(part);
    return has(el.attrs, a[1]) && (a[2] === undefined || el.attrs[a[1]] === a[2]);
  });
}

/**
 * An element stand-in: `spec` is either one already (it has getAttribute) or a map of attributes.
 * @param {Object} spec Element or attributes.
 * @returns {Object} Element with getAttribute.
 */
function element(spec) {
  if (typeof spec.getAttribute === 'function') { return spec; }
  return { getAttribute: (name) => (has(spec, name) ? spec[name] : null) };
}

/**
 * A focusable stub with attributes.
 * @param {Object} doc The fake document (records activeElement).
 * @param {Object} [attrs] Initial attributes.
 * @param {Object} [props] More properties.
 * @returns {Object} Stub.
 */
function stub(doc, attrs, props) {
  return Object.assign({
    attrs: Object.assign({}, attrs),
    getAttribute(name) { return has(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    focus() { doc.activeElement = this; }
  }, props);
}

/**
 * The stubs of an HTML string's elements, each answering querySelector over its own descendants.
 * @param {Object} doc The fake document.
 * @param {string} html HTML.
 * @returns {Array.<Object>} Stubs, in document order.
 */
function stubsOf(doc, html) {
  const els = elementsOf(html);
  const stubs = els.map((el) => {
    const s = stub(doc, el.attrs, {
      tag: el.tag,
      innerHTML: el.inner,
      textContent: decode(el.inner.replace(/<[^>]*>/g, '')),
      focus() { doc.activeElement = this; if (has(this.attrs, 'data-wiz-title')) { doc.titleFocus += 1; } },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        return stubs.filter((t, i) => els[i].start > el.start && els[i].start < el.end && matches(els[i], sel));
      }
    });
    s.attrs = el.attrs;
    // Live views of the reflected attributes.
    Object.defineProperty(s, 'className', { get() { return this.attrs.class || ''; }, set(v) { this.attrs.class = v; } });
    Object.defineProperty(s, 'src', { get() { return this.attrs.src; }, set(v) { this.attrs.src = v; } });
    Object.defineProperty(s, 'alt', { get() { return this.attrs.alt; }, set(v) { this.attrs.alt = v; } });
    Object.defineProperty(s, 'hidden', { get() { return has(this.attrs, 'hidden'); } });
    return s;
  });
  stubs.forEach((s, i) => { s.matches = (sel) => matches(els[i], sel); });
  return stubs;
}

/**
 * Install the fake document and return handles on the wizard's overlays.
 * @returns {Object} The fake DOM's handles (see the returned object).
 */
function fakeWizardDom() {
  const overlays = [];
  const doc = { activeElement: null, titleFocus: 0 };

  /** The page around the wizard: what it hides while up, and where focus returns. */
  const page = {
    topbar: stub(doc, { class: 'topbar' }, { inert: false }),
    scroll: stub(doc, { id: 'scroll' }, { inert: false }),
    activeTab: stub(doc, { class: 'tab on' }),
    setupRow: stub(doc, { 'data-action': 'startWizard' })
  };

  /**
   * A new overlay, as document.createElement('div') returns one.
   * @returns {Object} Overlay stub.
   */
  function makeOverlay() {
    const listeners = {};
    const top = { innerHTML: '' };
    const foot = { innerHTML: '' };
    let html = '';
    let parsed = [];
    const body = {};
    Object.defineProperty(body, 'innerHTML', {
      get: () => html,
      set: (h) => { html = h; parsed = stubsOf(doc, h); }
    });
    const containers = { '[data-wiz-top]': top, '[data-wiz-body]': body, '[data-wiz-foot]': foot };
    const overlay = {
      id: '',
      className: '',
      innerHTML: '',
      parentNode: null,
      removed: false,
      attributes: {},
      listeners,
      top, body, foot,
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      querySelector(sel) { return containers[sel] || parsed.find((s) => s.matches(sel)) || null; },
      querySelectorAll: (sel) => parsed.filter((s) => s.matches(sel))
    };
    overlays.push(overlay);
    return overlay;
  }

  const bodyNode = {
    appendChild: (node) => { node.parentNode = bodyNode; },
    removeChild: (node) => { node.removed = true; node.parentNode = null; }
  };
  global.document = {
    getElementById: (id) => (id === 'scroll' ? page.scroll : null),
    querySelector: (sel) => ({
      '.topbar': page.topbar, '.tab.on': page.activeTab, '[data-action="startWizard"]': page.setupRow
    })[sel] || null,
    createElement: (tag) => (tag === 'div' ? makeOverlay() : { id: '', textContent: '' }),
    head: { appendChild: () => {} },
    body: bodyNode
  };
  Object.defineProperty(global.document, 'activeElement', { get: () => doc.activeElement });

  const current = () => overlays[overlays.length - 1];
  /**
   * Dispatch an event through the current overlay's listeners.
   * @param {string} ev Event type.
   * @param {Object} closest Selector -> element (or attribute map) the target's closest() returns.
   * @param {Object} [extra] More event fields (key, touches, changedTouches).
   * @returns {void}
   */
  const fire = (ev, closest, extra) => {
    const target = { closest: (sel) => (has(closest, sel) ? element(closest[sel]) : null) };
    (current().listeners[ev] || []).forEach((fn) => fn(Object.assign({ target, preventDefault: () => {} }, extra)));
  };

  const api = {
    page,
    doc,
    overlays,
    fire,
    get overlay() { return current(); },
    get top() { return current().top; },
    get body() { return current().body; },
    get foot() { return current().foot; },
    /** How many times a step title has taken focus. */
    get titleFocus() { return doc.titleFocus; },
    /** A stub the current body holds, by the selector the controller uses. */
    find: (sel) => current().querySelector(sel),
    findAll: (sel) => current().querySelectorAll(sel),
    /**
     * One of the current step's pickers (the first one, or the one named), read from its live
     * segments.
     * @param {string} [group] The picker's group; the step's first picker when left out.
     * @returns {?{group: string, options: string[], labels: string[], selected: ?string}} Null on a
     *   step without it.
     */
    picker(group) {
      const all = current().querySelectorAll('[data-wiz-opt]');
      if (!all.length) { return null; }
      const name = group || all[0].getAttribute('data-wiz-group');
      const segs = all.filter((s) => s.getAttribute('data-wiz-group') === name);
      if (!segs.length) { return null; }
      const on = segs.filter((s) => s.getAttribute('aria-checked') === 'true');
      return {
        group: name,
        options: segs.map((s) => s.getAttribute('data-wiz-opt')),
        labels: segs.map((s) => s.textContent),
        selected: on.length === 1 ? on[0].getAttribute('data-wiz-opt') : null
      };
    },
    nav: (name) => fire('click', { '[data-wiz-nav]': { 'data-wiz-nav': name } }),
    pick: (group, val) => fire('click', { '[data-wiz-opt]': { 'data-wiz-group': group, 'data-wiz-opt': val } }),
    key: (group, val, key) => fire('keydown', { '[data-wiz-opt]': { 'data-wiz-group': group, 'data-wiz-opt': val } }, { key }),
    goto: (step) => fire('click', { '[data-wiz-goto]': { 'data-wiz-goto': step } }),
    flick: () => fire('click', { '[data-wiz-flick]': {} }),
    /**
     * Type into an embedded settings field (the Tomorrow.io key).
     * @param {string} key The field's data-k.
     * @param {string} value Its new text.
     * @returns {void}
     */
    type: (key, value) => fire('input', { 'input[type=text][data-k]': { value, getAttribute: (n) => (n === 'data-k' ? key : null) } }),
    /**
     * Tap the folded Tomorrow.io card's "Add a key" button.
     * @returns {{removed: boolean}} Whether the button took itself out.
     */
    openUpsell() {
      const button = { removed: false, getAttribute: () => null };
      button.parentNode = { removeChild: (node) => { node.removed = true; } };
      fire('click', { '[data-wiz-tio-open]': button });
      return button;
    },
    /**
     * A one-finger swipe that starts on a picker's preview.
     * @param {string} group The picker's group.
     * @param {number} dx Horizontal travel, px (negative = to the left).
     * @param {number} dy Vertical travel, px.
     * @returns {void}
     */
    swipe(group, dx, dy) {
      fire('touchstart', { '[data-wiz-preview]': { 'data-wiz-preview': group } },
        { touches: [{ clientX: 200, clientY: 300 }] });
      fire('touchend', {}, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    },
    /**
     * Walk forward to the step whose (first) picker is `group`.
     * @param {string} group A picker.
     * @returns {void}
     */
    walkTo(group) {
      for (let i = 0; i < 10 && (api.picker() || {}).group !== group; i += 1) { api.nav('next'); }
      if ((api.picker() || {}).group !== group) { throw new Error('no step with the ' + group + ' picker'); }
    },
    /** Walk forward to the last step, the summary. */
    walkToSummary() {
      for (let i = 0; i < 10 && !/data-wiz-nav="save"/.test(current().foot.innerHTML); i += 1) { api.nav('next'); }
      if (!/data-wiz-nav="save"/.test(current().foot.innerHTML)) { throw new Error('never reached the summary'); }
    },
    /**
     * A row of the summary, as shown.
     * @param {string} k The row's name.
     * @returns {?string} Its value, or undefined without the row.
     */
    summaryRow: (k) => (new RegExp('<span class="k">' + k + '</span><span class="v"[^>]*>([^<]*)</span>')
      .exec(current().body.innerHTML) || [])[1]
  };
  return api;
}

/**
 * Open setup through the real hooks, the way the settings page does: "Run setup again" on an
 * onboarded install, or (fresh) by itself on a new one. The suite must have loaded the engine,
 * blocks.js, reset-status-defaults.js and theme-convert.js (global.PConf) first.
 * @param {{platform: string, saved: Object, fresh: boolean, prepare: function(Object)}} [over] The
 *   watch, the stored settings, whether onboarding is still to do, and what to do to the hydrated
 *   ctx before setup opens (run a hook, finish an earlier setup).
 * @returns {{ctx: Object, dom: Object, calls: {save: number, render: number}}} The live state, the
 *   fake DOM and what setup asked the page to do.
 */
function openSetup(over) {
  const o = over || {};
  const engine = require('../../src/pkjs/config-ui/lib/engine.js');
  const schema = require('../../src/pkjs/page/settings/schema.js');
  const platform = require('../../src/pkjs/config-ui/lib/platform.js');
  const finish = require('../../src/pkjs/page/settings/wizard/wizard-finish.js');
  const dom = fakeWizardDom();
  const ENV = platform.computeEnv({ platform: o.platform || 'basalt' });
  const calls = { save: 0, render: 0 };
  const cfg = o.fresh ? {} : { onboardingDone: true };
  const ctx = {
    S: engine.hydrate(schema, Object.assign({}, cfg, o.saved), ENV),
    ENV,
    USERDATA: {},
    schema,
    cfg,
    set: (k, v) => { ctx.S[k] = v; },
    // The engine's setValue: S, then the item's onChange hooks (the key's last item, as its
    // findItem answers), as if the value had moved from optOldV.
    setValue(key, newV, optOldV) {
      const oldV = arguments.length > 2 ? optOldV : ctx.S[key];
      ctx.S[key] = newV;
      const item = finish.findItem(schema, key);
      [].concat((item && item.onChange) || []).forEach((id) => {
        const fn = global.PConf.onChange.get(id);
        if (typeof fn === 'function') { fn(ctx.S, oldV, newV, ENV, key); }
      });
    },
    save: () => { calls.save += 1; },
    render: () => { calls.render += 1; },
    openSheet: (key, onClose) => { onClose(); }
  };
  if (o.prepare) { o.prepare(ctx); }
  global.PConf.hooks.runReady(ctx);
  if (!o.fresh) { global.PConf.actions.startWizard(); }
  return { ctx, dom, calls };
}

module.exports = { fakeWizardDom, openSetup, elementsOf, matches };
