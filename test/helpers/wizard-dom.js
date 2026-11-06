'use strict';
// A small fake DOM for the onboarding wizard (src/pkjs/settings/wizard.js): just the surface its
// controller touches, so its real event handlers can run in Node.
//
// Every overlay the controller creates is its own object with its own listeners (so a second
// "Run setup again" can be told apart from the first). Whatever HTML the controller writes into an
// overlay's body is parsed back into element stubs for the selectors the controller queries (the
// picker's segments, its description and watch, the Tomorrow.io card, the summary's Weather line,
// the flick demo), so in-place updates are observable: picker() reads the segments' live
// aria-checked, not the HTML of the last render. Events go to the current overlay's listeners, with
// a target whose closest() answers the selectors a test names (a plain object with getAttribute).

/**
 * An element stand-in: `spec` is either one already (it has getAttribute) or a map of attributes.
 * @param {Object} spec Element or attributes.
 * @returns {Object} Element with getAttribute.
 */
function element(spec) {
  if (typeof spec.getAttribute === 'function') { return spec; }
  return { getAttribute: (name) => (Object.prototype.hasOwnProperty.call(spec, name) ? spec[name] : null) };
}

/**
 * A focusable stub with attributes.
 * @param {Object} doc The fake document (records activeElement).
 * @param {Object} [attrs] Initial attributes.
 * @param {Object} [props] More properties.
 * @returns {Object} Stub.
 */
function stub(doc, attrs, props) {
  const el = Object.assign({
    attrs: Object.assign({}, attrs),
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    focus() { doc.activeElement = this; }
  }, props);
  return el;
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
   * Parse a body's HTML into the stubs the controller looks up.
   * @param {string} html Body HTML.
   * @returns {Object} {one: selector -> stub, all: selector -> stubs}.
   */
  function parse(html) {
    const one = {};
    const all = { '[data-wiz-opt]': [], '.wiz-flick-shot': [] };
    let m;
    const optRe = /<button type="button" class="(wiz-opt(?: on)?)" role="radio" aria-checked="(true|false)" tabindex="(-?\d)" data-wiz-group="([^"]+)" data-wiz-opt="([^"]+)">([^<]*)<\/button>/g;
    while ((m = optRe.exec(html))) {
      all['[data-wiz-opt]'].push(stub(doc, {
        'aria-checked': m[2], tabindex: m[3], 'data-wiz-group': m[4], 'data-wiz-opt': m[5]
      }, { className: m[1], label: m[6] }));
    }
    if ((m = /<p class="wiz-desc" data-wiz-desc aria-live="polite">([^<]*)<\/p>/.exec(html))) {
      one['[data-wiz-desc]'] = { textContent: m[1] };
    }
    if ((m = /<img class="wiz-shot" data-wiz-shot src="([^"]*)" alt="([^"]*)">/.exec(html))) {
      one['[data-wiz-shot]'] = stub(doc, {}, {
        src: m[1], alt: m[2], className: 'wiz-shot',
        getAttribute(name) { return name === 'src' ? this.src : null; }
      });
    }
    if ((m = /data-wiz-tio-field( hidden)?>/.exec(html))) {
      const label = stub(doc, {});
      const input = stub(doc, { type: 'text' });
      const field = stub(doc, m[1] ? { hidden: '' } : {}, {
        querySelector: (sel) => ({ '.lbl': label, 'input[type=text]': input })[sel] || null,
        label,
        input
      });
      // A live view of the attribute (Object.assign would have frozen a getter's first value).
      Object.defineProperty(field, 'hidden', {
        get() { return Object.prototype.hasOwnProperty.call(this.attrs, 'hidden'); }
      });
      one['[data-wiz-tio-field]'] = field;
    }
    if ((m = /data-wiz-sum-weather>([^<]*)</.exec(html))) {
      one['[data-wiz-sum-weather]'] = { textContent: m[1] };
    }
    const shotRe = /<img class="(wiz-shot wiz-flick-shot(?: on)?)" src="([^"]*)" alt="">/g;
    while ((m = shotRe.exec(html))) {
      all['.wiz-flick-shot'].push({ className: m[1], src: m[2] });
    }
    if (html.indexOf('data-wiz-flick-watch') !== -1) {
      one['[data-wiz-flick-watch]'] = { className: 'wiz-flick-watch', offsetWidth: 0 };
      one['[data-wiz-flick-dots]'] = { innerHTML: (/<span data-wiz-flick-dots>(.*?)<\/span><span class="wiz-flick-label"/.exec(html) || [])[1] || '' };
      one['[data-wiz-flick-label]'] = { textContent: (/data-wiz-flick-label>([^<]*)</.exec(html) || [])[1] || '' };
      one['[data-wiz-flick-cap]'] = { innerHTML: (/data-wiz-flick-cap aria-live="polite">(.*?)<\/p>/.exec(html) || [])[1] || '' };
    }
    const selRe = /data-select="([^"]+)"/g;
    while ((m = selRe.exec(html))) { one['[data-select="' + m[1] + '"]'] = stub(doc, { 'data-select': m[1] }); }
    if (html.indexOf('data-wiz-title') !== -1) {
      one['[data-wiz-title]'] = stub(doc, {}, { focus() { doc.activeElement = this; doc.titleFocus += 1; } });
    }
    return { one, all };
  }

  /**
   * A new overlay, as document.createElement('div') returns one.
   * @returns {Object} Overlay stub.
   */
  function makeOverlay() {
    const listeners = {};
    const top = { innerHTML: '' };
    const foot = { innerHTML: '' };
    let html = '';
    let parsed = parse('');
    const body = {};
    Object.defineProperty(body, 'innerHTML', {
      get: () => html,
      set: (h) => { html = h; parsed = parse(h); }
    });
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
      querySelector(sel) {
        if (sel === '[data-wiz-top]') { return top; }
        if (sel === '[data-wiz-body]') { return body; }
        if (sel === '[data-wiz-foot]') { return foot; }
        return parsed.one[sel] || null;
      },
      querySelectorAll: (sel) => parsed.all[sel] || []
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
    const target = {
      closest: (sel) => (Object.prototype.hasOwnProperty.call(closest, sel) ? element(closest[sel]) : null)
    };
    (current().listeners[ev] || []).forEach((fn) => fn(Object.assign({ target, preventDefault: () => {} }, extra)));
  };

  return {
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
     * The current step's picker, read from its live segments.
     * @returns {?{group: string, options: string[], selected: ?string}} Null on a step without one.
     */
    picker() {
      const segs = current().querySelectorAll('[data-wiz-opt]');
      if (!segs.length) { return null; }
      const on = segs.filter((s) => s.getAttribute('aria-checked') === 'true');
      return {
        group: segs[0].getAttribute('data-wiz-group'),
        options: segs.map((s) => s.getAttribute('data-wiz-opt')),
        selected: on.length === 1 ? on[0].getAttribute('data-wiz-opt') : null
      };
    },
    nav: (name) => fire('click', { '[data-wiz-nav]': { 'data-wiz-nav': name } }),
    pick: (group, val) => fire('click', { '[data-wiz-opt]': { 'data-wiz-group': group, 'data-wiz-opt': val } }),
    key: (group, val, key) => fire('keydown', { '[data-wiz-opt]': { 'data-wiz-group': group, 'data-wiz-opt': val } }, { key }),
    goto: (step) => fire('click', { '[data-wiz-goto]': { 'data-wiz-goto': step } }),
    flick: () => fire('click', { '[data-wiz-flick]': {} }),
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
     * A one-finger swipe that starts on the picker's watch.
     * @param {string} group The picker's group.
     * @param {number} dx Horizontal travel, px (negative = to the left).
     * @param {number} dy Vertical travel, px.
     * @returns {void}
     */
    swipe(group, dx, dy) {
      fire('touchstart', { '[data-wiz-preview]': { 'data-wiz-preview': group } },
        { touches: [{ clientX: 200, clientY: 300 }] });
      fire('touchend', {}, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    }
  };
}

module.exports = { fakeWizardDom };
