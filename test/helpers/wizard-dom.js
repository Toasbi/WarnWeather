'use strict';
// A minimal fake DOM for the onboarding wizard (src/pkjs/settings/wizard.js): just the surface its
// controller touches. The overlay's four containers keep the HTML the controller writes into them,
// and the current step's picker is parsed back out of the body, so a test can read which option is
// shown as selected. Events go through the overlay's own listeners, with a target whose closest()
// answers the selectors the test names (an element there is a plain object with getAttribute).

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
 * Install the fake document and return handles on the wizard's overlay.
 * @returns {Object} {overlay, top, body, foot, title, picker(), fire(), nav(), pick(), key(), swipe(), goto()}.
 */
function fakeWizardDom() {
  const listeners = {};
  const top = { innerHTML: '' };
  const body = { innerHTML: '' };
  const foot = { innerHTML: '' };
  const title = { focused: 0, focus() { this.focused += 1; } };
  const containers = {
    '[data-wiz-top]': top, '[data-wiz-body]': body, '[data-wiz-foot]': foot, '[data-wiz-title]': title
  };
  const overlay = {
    id: '',
    innerHTML: '',
    parentNode: null,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    querySelector: (sel) => containers[sel] || null,
    querySelectorAll: () => []
  };
  global.document = {
    getElementById: () => null,
    createElement: (tag) => (tag === 'div' ? overlay : { id: '', textContent: '' }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {} }
  };

  /**
   * Dispatch an event through the overlay's listeners.
   * @param {string} ev Event type.
   * @param {Object} closest Selector -> element (or attribute map) the target's closest() returns.
   * @param {Object} [extra] More event fields (key, touches, changedTouches).
   * @returns {void}
   */
  const fire = (ev, closest, extra) => {
    const target = {
      closest: (sel) => (Object.prototype.hasOwnProperty.call(closest, sel) ? element(closest[sel]) : null)
    };
    (listeners[ev] || []).forEach((fn) => fn(Object.assign({ target, preventDefault: () => {} }, extra)));
  };

  return {
    overlay, top, body, foot, title, fire,
    /**
     * The current step's picker, parsed from the body: its group, options and the selected one.
     * @returns {?{group: string, options: string[], selected: ?string}} Null on a step without one.
     */
    picker() {
      const html = body.innerHTML;
      const group = (/data-wiz-pick="([^"]+)"/.exec(html) || [])[1];
      if (!group) { return null; }
      const options = [];
      let selected = null;
      const re = /aria-checked="(true|false)"[^>]*data-wiz-opt="([^"]+)"/g;
      let m;
      while ((m = re.exec(html))) {
        options.push(m[2]);
        if (m[1] === 'true') { selected = m[2]; }
      }
      return { group, options, selected };
    },
    nav: (name) => fire('click', { '[data-wiz-nav]': { 'data-wiz-nav': name } }),
    pick: (group, val) => fire('click', { '[data-wiz-opt]': { 'data-wiz-group': group, 'data-wiz-opt': val } }),
    key: (group, val, key) => fire('keydown', { '[data-wiz-opt]': { 'data-wiz-group': group, 'data-wiz-opt': val } }, { key }),
    goto: (step) => fire('click', { '[data-wiz-goto]': { 'data-wiz-goto': step } }),
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
