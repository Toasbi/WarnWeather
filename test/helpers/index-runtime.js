// test/helpers/index-runtime.js — boots the REAL src/pkjs/index.js under a mocked
// PebbleKit JS runtime: a fixed, advanceable clock; a manual timer queue; a
// localStorage with key()/length (nager-source's cache prune walks it); an XHR stub
// whose requests the test answers by hand; and a Pebble.sendAppMessage whose ACK or
// NACK the test decides. index.js registers its listeners at require time and
// exports nothing, so a fresh require per boot (every src/pkjs module purged) is
// the only way to model a watchface relaunch — the store survives it, like the
// phone's localStorage does.
'use strict';
const path = require('path');

const SRC = path.resolve(__dirname, '../../src/pkjs') + path.sep;

/**
 * Install the mocked runtime. Call restore() when done (t.after).
 *
 * @param {{now: number, watchInfo: (Object|undefined), quiet: (boolean|undefined)}} opts
 *   now: the fake clock's epoch ms; watchInfo: getActiveWatchInfo's answer (basalt
 *   by default); quiet: silence index.js's console.log chatter (default true).
 * @returns {Object} The harness.
 */
function installIndexRuntime(opts) {
  const saved = {
    Date: global.Date, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout,
    localStorage: global.localStorage, Pebble: global.Pebble,
    XMLHttpRequest: global.XMLHttpRequest, log: console.log
  };
  const RealDate = saved.Date;
  const clock = { now: opts.now };
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) { super(clock.now); } else { super(...a); } }
    static now() { return clock.now; }
  }
  global.Date = FakeDate;

  let timers = [];
  let timerSeq = 0;
  global.setTimeout = function (fn, ms) {
    timers.push({ fn: fn, at: clock.now + (ms || 0), id: ++timerSeq });
    return timerSeq;
  };
  global.clearTimeout = function (id) { timers = timers.filter((x) => x.id !== id); };

  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
    key: (i) => { const ks = Object.keys(store); return i >= 0 && i < ks.length ? ks[i] : null; },
    get length() { return Object.keys(store).length; }
  };

  const xhrs = [];
  global.XMLHttpRequest = function () {
    const self = this;
    this.open = (method, url) => { self.url = url; };
    this.setRequestHeader = () => {};
    this.send = () => { xhrs.push(self); };
  };

  // Every AppMessage the phone pushes, in order. policy(dict) answers 'ack', 'nack'
  // (both synchronous) or 'hold' (the test settles it later via ack()/nack()).
  const sent = [];
  const h = {
    store: store,
    sent: sent,
    xhrs: xhrs,
    listeners: {},
    policy: function () { return 'ack'; },
    watchInfo: opts.watchInfo || { platform: 'basalt', model: 'qemu_platform_basalt', language: 'en' }
  };
  global.Pebble = {
    addEventListener: (name, fn) => { h.listeners[name] = fn; },
    getActiveWatchInfo: () => h.watchInfo,
    getAccountToken: () => 'test-token',
    getWatchToken: () => 'test-watch',
    showSimpleNotificationOnPebble: () => {},
    openURL: () => {},
    sendAppMessage: (dict, ack, nack) => {
      const msg = { dict: dict, ack: ack, nack: nack, outcome: 'held' };
      sent.push(msg);
      const verdict = h.policy(dict);
      if (verdict === 'ack') { h.ack(msg); } else if (verdict === 'nack') { h.nack(msg); }
    }
  };
  if (opts.quiet !== false) { console.log = () => {}; }

  h.ack = function (msg) {
    msg.outcome = 'ack';
    if (msg.ack) { msg.ack({}); }
  };
  h.nack = function (msg) {
    msg.outcome = 'nack';
    if (msg.nack) { msg.nack({ error: 'test nack' }); }
  };
  /** Clay sends (they always carry the HOLIDAYS tuple) since index `from`. */
  h.claySends = function (from) {
    return sent.slice(from || 0).filter((m) => Object.prototype.hasOwnProperty.call(m.dict, 'HOLIDAYS'));
  };
  /** Advance the clock by ms, running every timer that falls due, in order. */
  h.advance = function (ms) {
    const until = clock.now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > until) { break; }
      timers.shift();
      clock.now = Math.max(clock.now, next.at);
      next.fn();
    }
    clock.now = until;
  };
  h.setNow = function (ms) { clock.now = ms; };
  h.now = function () { return clock.now; };
  /** Answer the first pending XHR whose URL contains `needle`. */
  h.answer = function (needle, status, body) {
    const x = xhrs.find((r) => !r.answered && String(r.url).indexOf(needle) !== -1);
    if (!x) { throw new Error('no pending XHR matching ' + needle); }
    x.answered = true;
    x.status = status;
    x.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    x.onload();
  };
  /** Fresh-require index.js (a watchface relaunch); returns the listeners. */
  h.boot = function () {
    Object.keys(require.cache).forEach((k) => { if (k.indexOf(SRC) === 0) { delete require.cache[k]; } });
    timers = [];
    try {
      const devConfigPath = require.resolve(SRC + 'dev-config.js');
      require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
    } catch (e) { /* absent: getDevConfig() already falls back to {} */ }
    const fixturePath = require.resolve(SRC + 'active-fixture.generated.js');
    require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };
    h.listeners = {};
    require(SRC + 'index.js');
    return h.listeners;
  };
  /** A module from the CURRENT boot's module graph (same instances index.js holds). */
  h.mod = function (name) { return require(SRC + name); };
  /**
   * Close the settings page with the stored blob plus `changes`, the way the page
   * answers: colour keys travel as '#rrggbb' strings.
   */
  h.closeSettings = function (changes) {
    const cfg = h.mod('settings');
    const blob = h.mod('clay-settings.js').read();
    Object.assign(blob, changes);
    const out = {};
    Object.keys(blob).forEach((k) => {
      out[k] = (cfg.isColorKey(k) && typeof blob[k] === 'number')
        ? '#' + ('000000' + blob[k].toString(16)).slice(-6) : blob[k];
    });
    h.listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(out)) });
  };
  /**
   * Pre-boot state that keeps the first ticks off the network: a fetch-success
   * marker an hour ahead (no weather fetch) and a fresh update-check stamp.
   */
  h.quietNetwork = function () {
    store.lastFetchSuccess = JSON.stringify({ time: new RealDate(clock.now + 3600e3).toISOString() });
    store.last_update_check = String(clock.now);
  };
  h.restore = function () {
    Object.keys(require.cache).forEach((k) => { if (k.indexOf(SRC) === 0) { delete require.cache[k]; } });
    global.Date = saved.Date;
    global.setTimeout = saved.setTimeout;
    global.clearTimeout = saved.clearTimeout;
    global.localStorage = saved.localStorage;
    global.Pebble = saved.Pebble;
    global.XMLHttpRequest = saved.XMLHttpRequest;
    console.log = saved.log;
  };
  return h;
}

/**
 * Decode the HOLIDAYS tuple's anchor (serial day) and 28-bit mask.
 *
 * @param {number[]} bytes The 8-byte HOLIDAYS value.
 * @returns {{anchor: number, mask: number}} Decoded window.
 */
function decodeHolidays(bytes) {
  return {
    anchor: bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24),
    mask: (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0
  };
}

module.exports = { installIndexRuntime, decodeHolidays, SRC };
