// src/pkjs/config-ui/test/fake-history.js — the settings page's history as the Pebble app's
// WebView keeps it (Chromium, a data: page), and the phone's Back over it: for lib/back-steps.js'
// suite here and for the repo's page harness (test/helpers/page-harness.js), which takes it from
// the library rather than the other way round. As Chromium does: pushState adds an entry above the
// one shown (the ones above it go); history.go() lands only when the test says (land()), each step
// from where the step before it left the page, and moves nowhere past either end.
'use strict';

/**
 * Give a window a history, and the phone's Back over it.
 * @param {Object} win The window: its history and addEventListener are set, and with
 *   opts.activation its navigator.userActivation.
 * @param {{activation: (boolean|undefined), pushThrows: (boolean|undefined)}} [opts] activation:
 *   whether a tap is being handled (navigator.userActivation.isActive; left out, a WebView without
 *   userActivation); pushThrows: a WebView that refuses pushState.
 * @returns {Object} The phone's side (see the returned object).
 */
function installHistory(win, opts) {
  const o = opts || {};
  const listeners = [];
  const entries = [{ state: null }];
  const steps = [];
  const calls = { go: [], push: 0 };
  const ua = { isActive: Boolean(o.activation) };
  let index = 0;
  let left = false;
  const fire = () => listeners.slice().forEach((fn) => fn({ state: entries[index].state }));
  if (o.activation !== undefined) { win.navigator = Object.assign(win.navigator || {}, { userActivation: ua }); }
  win.addEventListener = (type, fn) => { if (type === 'popstate') { listeners.push(fn); } };
  win.history = {
    scrollRestoration: 'auto',
    get state() { return entries[index].state; },
    // A data: document may change no more than its fragment: no URL.
    pushState(state, title, url) {
      if (o.pushThrows || url !== undefined) { throw new Error('SecurityError'); }
      calls.push += 1;
      entries.splice(index + 1);
      entries.push({ state: JSON.parse(JSON.stringify(state)) });
      index += 1;
    },
    go(delta) {
      calls.go.push(delta);
      if (delta === 0) { left = 'reloaded'; return; }
      steps.push((steps.length ? steps[steps.length - 1] : index) + delta);
    }
  };
  return {
    calls,
    /** navigator.userActivation, where opts.activation gave the window one. */
    ua,
    /** Whether the settings screen closed (Back on the first entry), or the page reloaded. */
    get left() { return left; },
    /** How many layers the entry shown stands for. */
    get layers() { return (entries[index].state && entries[index].state.pconfLayers) || 0; },
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
    /** The iPhone's forward swipe. */
    forward() {
      if (index < entries.length - 1) { index += 1; fire(); }
    }
  };
}

/**
 * The next tap: a task of its own (the page adds no more than one entry per tap).
 * @returns {Promise<void>}
 */
function nextTap() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = { installHistory, nextTap };
