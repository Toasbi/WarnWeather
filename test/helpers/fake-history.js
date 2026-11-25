'use strict';
// test/helpers/fake-history.js — the settings page's history as the Pebble app's WebView keeps it
// (Chromium, a data: page), and the phone's Back over it, for the page harness (page-harness.js
// `history`). The settings page keeps one entry per layer it has open
// (src/pkjs/config-ui/lib/back-steps.js). As Chromium does: pushState adds an entry above the one
// shown (the ones above it go); history.go() lands only when the test says (land()), each step from
// where the step before it left the page, and moves nowhere past either end. The config-ui
// library's own suite keeps a copy of this (src/pkjs/config-ui/test/back-steps.test.js), since the
// library ships without the repo's test helpers.

/**
 * Give a window a history and the phone's Back over it.
 * @param {Object} win The window (the page harness's sandbox): history, addEventListener and
 *   navigator.userActivation are set on it.
 * @returns {Object} The phone's side (see the returned object).
 */
function installHistory(win) {
  const listeners = [];
  const entries = [{ state: null }];
  const steps = [];
  const calls = { go: [], push: 0 };
  let index = 0;
  let left = false;
  const fire = () => listeners.slice().forEach((fn) => fn({ state: entries[index].state }));
  win.navigator = Object.assign(win.navigator || {}, { userActivation: { isActive: true } });
  const others = {};
  win.addEventListener = function (type, fn) {
    if (type === 'popstate') { listeners.push(fn); return; }
    (others[type] = others[type] || []).push(fn);
  };
  win.history = {
    scrollRestoration: 'auto',
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, title, url) {
      if (url !== undefined) { throw new Error('SecurityError: a data: page cannot pushState a URL'); }
      calls.push += 1;
      entries.splice(index + 1);
      entries.push({ state: JSON.parse(JSON.stringify(state)) });
      index += 1;
    },
    go(delta) {
      calls.go.push(delta);
      if (delta === 0) { left = 'reloaded'; return; }
      steps.push((steps.length ? steps[steps.length - 1] : index) + delta);
    },
    back() { this.go(-1); }
  };
  return {
    calls,
    /** Whether the settings screen closed (Back with no entry below), or the page reloaded. */
    get left() { return left; },
    /** How many layers the entry shown stands for. */
    get layers() { return (entries[index].state && entries[index].state.pconfLayers) || 0; },
    /** How many entries the page has above its first. */
    get depth() { return index; },
    /** Whether a history.go() the page asked for has not landed yet. */
    get travelling() { return steps.length > 0; },
    /** The page's history.go() steps land, in order, with any they lead to. */
    land() {
      while (steps.length) {
        const to = steps.shift();
        if (to >= 0 && to < entries.length && to !== index) { index = to; fire(); }
      }
    },
    /** The phone's Back: an entry back, or on the first one the settings screen closes. */
    back() {
      if (index === 0) { left = true; return; }
      index -= 1;
      fire();
    },
    /** The page's taps count as user activations (true) or not (false). */
    activation(on) { win.navigator.userActivation.isActive = Boolean(on); }
  };
}

module.exports = { installHistory };
