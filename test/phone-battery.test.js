'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// AGENTS.md: a module that touches storage needs `global.localStorage` mocked
// BEFORE the watch modules load (the pattern is test/change-detector.test.js).
// It matters twice over here: phone-battery.js persists the detector verdict and
// the cached reading, and the micro-send re-bake pulls in status-lines.js, which
// asks phone-battery whether this phone is supported on every single bake. Node
// 26 does expose an implicit global `localStorage`, but it is undefined on first
// access, so relying on it makes storage-touching tests non-deterministic.
let storage = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); },
  removeItem(k) { delete storage[k]; }
};

const phoneBattery = require('../src/pkjs/phone-battery.js');
const statusRebake = require('../src/pkjs/status-rebake.js');
const KEYS = require('../src/pkjs/storage-keys.js');
const catalog = require('../src/pkjs/status-line-catalog.js');

// The module logs a line per reading; keep the runner's output about assertions.
const realLog = console.log;
test.before(() => { console.log = function () {}; });
test.after(() => { console.log = realLog; });

/**
 * A stand-in for the Chromium BatteryManager: `level` (0..1) plus `charging`,
 * addEventListener, and helpers that mutate the reading and fire the matching
 * event exactly as the real object does (the handlers re-read the manager).
 * @param {number} level Charge fraction 0..1.
 * @param {boolean} charging Whether the phone is plugged in.
 * @returns {Object} The fake manager.
 */
function fakeManager(level, charging) {
  const listeners = {};
  return {
    level: level,
    charging: charging,
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn()); },
    setLevel(v) { this.level = v; this.fire('levelchange'); },
    setCharging(v) { this.charging = v; this.fire('chargingchange'); }
  };
}

/**
 * The modern API shape: navigator.getBattery() returning a HOST thenable. The
 * module must never construct a Promise (the aplite runtime has none), so this
 * deliberately is not one — just an object with .then(onOk, onErr).
 * @param {Object} mgr Manager to resolve with.
 * @returns {Object} A navigator-alike.
 */
function modernNavigator(mgr) {
  return { getBattery: function () { return { then: function (onOk) { onOk(mgr); } }; } };
}

/**
 * The legacy API shape: the manager hanging straight off navigator.battery.
 * @param {Object} mgr Manager to expose.
 * @returns {Object} A navigator-alike.
 */
function legacyNavigator(mgr) {
  return { battery: mgr };
}

/**
 * Boot the module against a clean store with every dependency injected.
 * init() resets all module state, so this is the whole per-test reset.
 * @param {Object} [opts] {navigator, devConfig, settings, clock, realBake, keepStorage}.
 * @returns {Object} Handle: mutable .clock/.settings, collected .sends/.bakes.
 */
function boot(opts) {
  opts = opts || {};
  // A restart keeps the store: that is the whole point of the flash backstop.
  if (!opts.keepStorage) { storage = {}; }
  const h = {
    // Midday: outside the default 0:00-07:00 Night battery saver window.
    clock: opts.clock || new Date(2026, 0, 1, 12, 0, 0),
    settings: opts.settings || {},
    sends: [],
    bakes: []
  };
  // The rebaker restores its flash backstop FIRST — phoneBattery.init's
  // subscribe can fire a micro-send synchronously (the shipped ready-handler
  // order; see status-rebake.js init).
  statusRebake.init({
    getSettings: function () { return h.settings; },
    sendWeather: function (p) { h.sends.push(p); },
    // undefined falls through to the real status-lines baker.
    buildStatusLines: opts.realBake ? undefined : function (payload, settings, watchInfo) {
      h.bakes.push({ payload: payload, settings: settings, watchInfo: watchInfo });
      payload.STATUS_LINE_1_UINT8 = [1];
      payload.STATUS_LINE_2_UINT8 = [2];
      payload.STATUS_LINE_3_UINT8 = [3];
      payload.STATUS_LINE_4_UINT8 = [4];
      payload.STATUS_LEVELS_UINT8 = [0];
      // A key the bake might legitimately add that is NOT the status category:
      // the micro-send must drop it rather than smuggle it onto the wire.
      payload.NOT_A_STATUS_KEY = 99;
      return payload;
    }
  });
  phoneBattery.init({
    navigator: opts.navigator,
    devConfig: opts.devConfig,
    getSettings: function () { return h.settings; },
    now: function () { return h.clock; }
  });
  return h;
}

/** The Night battery saver, on with its shipped 0:00-07:00 default window. */
const SAVER_ON = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };

/** Decode one packed status line back into its three {kind, icon, text} slots. */
function decodeLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const kind = bytes[off], icon = bytes[off + 1], len = bytes[off + 2];
    off += 3;
    slots.push({ kind, icon, text: Buffer.from(bytes.slice(off, off + len)).toString('utf8') });
    off += len;
  }
  assert.equal(off, bytes.length, 'no trailing bytes');
  return slots;
}

// --- Detection -------------------------------------------------------------
// The detector doubles as the Android/iOS discriminator: there is no PebbleKit
// JS battery API, and navigator.getBattery exists only because Android's
// companion app runs PKJS inside a Chromium WebView.

test('detects the modern navigator.getBattery API and seeds the cached reading', () => {
  const h = boot({ navigator: modernNavigator(fakeManager(0.62, false)) });
  assert.equal(phoneBattery.isSupported(), true);
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true', 'verdict is persisted for the config env');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62, charging: false },
    'the cached level is the EXACT percentage, not the 60 send-trigger bucket');
  assert.equal(h.sends.length, 0, 'seeding cannot send: no bake snapshot exists yet');
});

test('detects the legacy navigator.battery object', () => {
  boot({ navigator: legacyNavigator(fakeManager(0.41, true)) });
  assert.equal(phoneBattery.isSupported(), true);
  assert.deepEqual(phoneBattery.read(), { available: true, level: 41, charging: true });
});

test('the legacy object is still subscribed to, not just read once', () => {
  const mgr = fakeManager(0.41, false);
  const h = boot({ navigator: legacyNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  mgr.setLevel(0.34);
  assert.equal(h.sends.length, 1, 'levelchange on the legacy manager triggers a send');
  assert.equal(phoneBattery.read().level, 34);
});

test('no battery API at all: inert, unsupported, no reading, nothing thrown', () => {
  // iOS (JavaScriptCore builds navigator as {userAgent, geolocation, language})
  // and pypkjs (language + geolocation only) both land here, as does a host
  // with no navigator whatsoever.
  [null, undefined, {}, { userAgent: 'PKJS', geolocation: {}, language: 'de' },
   { getBattery: 'not a function' }, { battery: null }].forEach((nav) => {
    const h = boot({ navigator: nav });
    assert.equal(phoneBattery.isSupported(), false, 'navigator ' + JSON.stringify(nav));
    assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'false');
    assert.deepEqual(phoneBattery.read(), { available: false, level: null, charging: false });
    // Every downstream entry point stays callable on such a phone.
    assert.doesNotThrow(() => phoneBattery.onTick());
    assert.doesNotThrow(() => statusRebake.rememberBakeInputs({ CITY: 'X' }, {}, null));
    assert.doesNotThrow(() => phoneBattery.onTick());
    assert.equal(h.sends.length, 0);
  });
});

test('a rejected getBattery() marks the phone unsupported', () => {
  boot({ navigator: { getBattery: function () {
    return { then: function (onOk, onErr) { onErr(new Error('denied')); } };
  } } });
  assert.equal(phoneBattery.isSupported(), false);
  assert.equal(phoneBattery.read().available, false);
});

test('a throwing getBattery() is caught and marks the phone unsupported', () => {
  boot({ navigator: { getBattery: function () { throw new Error('boom'); } } });
  assert.equal(phoneBattery.isSupported(), false);
});

test('the dev-config fake supplies a reading with no navigator at all', () => {
  // pypkjs has no battery API of any kind, so this is the only way to see the
  // slot in the emulator or in a store screenshot.
  boot({ navigator: null, devConfig: { devPhoneBattery: { level: 62, charging: true } } });
  assert.equal(phoneBattery.isSupported(), true);
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62, charging: true });
});

// --- The verdict has to outlive the session that took it -------------------
// isSupported() is read by the config page -- which gates BOTH slot items on it
// -- and by every bake. detect() runs only from init(), i.e. only from 'ready',
// so by the time those readers ask, the stored verdict can be missing.

test('"Reset watchface" wipes the verdict, and the next read re-probes it', () => {
  // clay-settings.js resetAll() calls localStorage.clear(), which takes the
  // detector verdict with it. Nothing re-runs detect() until the next 'ready',
  // and 'showConfiguration' does not reliably follow one in the Core Devices
  // Android app -- so without the lazy probe the very next config open omits both
  // phone-battery items from all twelve dropdowns on a phone that plainly
  // supports them, which is the bug this test exists for.
  boot({ navigator: modernNavigator(fakeManager(0.62, false)) });
  assert.equal(phoneBattery.isSupported(), true);
  storage = {};                              // <- localStorage.clear()
  assert.equal(phoneBattery.isSupported(), true, 'the capability survived the wipe');
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true',
    're-probed AND re-persisted, so the baker and the config env agree');
});

test('the legacy navigator.battery shape is re-probed too', () => {
  boot({ navigator: legacyNavigator(fakeManager(0.41, false)) });
  storage = {};
  assert.equal(phoneBattery.isSupported(), true);
});

test('a phone with no battery API re-probes to a persisted false', () => {
  boot({ navigator: { userAgent: 'PKJS', geolocation: {}, language: 'de' } });
  storage = {};
  assert.equal(phoneBattery.isSupported(), false);
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'false',
    'written once, so the baker does not re-probe on every status-line build');
});

test('a stored false is a real verdict and is never re-probed', () => {
  // getBattery() EXISTS here but REJECTS, so detect() wrote false. The lazy probe
  // only tests for the method, so re-probing would flip that back to true and
  // offer a slot this phone cannot actually fill.
  boot({ navigator: { getBattery: function () {
    return { then: function (onOk, onErr) { onErr(new Error('denied')); } };
  } } });
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'false');
  assert.equal(phoneBattery.isSupported(), false, 'the rejection sticks');
  assert.equal(phoneBattery.isSupported(), false, 'and keeps sticking');
});

test('after a wipe the items are still offered in EVERY slot, not just top-right', () => {
  // The user-visible shape of the bug: needsPhoneBattery OMITS rather than
  // disables, so a false verdict strips both items from all twelve dropdowns and
  // leaves the top-right slot's Battery group -- made of the two WATCH items --
  // as the only trace, which reads as "the phone item only works top-right".
  boot({ navigator: modernNavigator(fakeManager(0.62, false)) });
  storage = {};
  const env = { color: true, round: false, platform: 'basalt', health: true,
                hr: false, phoneBattery: phoneBattery.isSupported() };
  catalog.LINES.forEach((line) => {
    line.slots.forEach((slotKey, i) => {
      const codes = catalog.slotOptions({}, env,
        { slotKey: slotKey, position: ['left', 'mid', 'right'][i] }).map((o) => o[1]);
      assert.ok(codes.includes('phoneBattery'), slotKey + ' offers Phone battery');
      assert.ok(codes.includes('phoneBatteryPlain'), slotKey + ' offers the no-icon variant');
    });
  });
});

test('"Reset watchface" wipes the cached reading; the next read re-seeds it from the live manager', () => {
  // The same localStorage.clear() also takes the cached level/charging pair the
  // baker renders -- while THIS module's subscription and its BatteryManager live
  // on (a reset does not restart PKJS). Saving a phone-battery slot right after a
  // reset forces a fetch, and without the heal that bake finds no reading and
  // shows '--' until the next battery EVENT or PKJS boot. The manager in hand
  // still knows the charge synchronously, so read() must re-seed from it.
  const h = boot({ navigator: modernNavigator(fakeManager(0.62, false)) });
  storage = {};                              // <- localStorage.clear()
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62, charging: false },
    'the post-reset bake shows the real charge, not --');
  assert.equal(storage[KEYS.PHONE_BATTERY_LEVEL], '62', 'the cache is rewritten');
  assert.equal(storage[KEYS.PHONE_BATTERY_CHARGING], 'false');
  assert.equal(h.sends.length, 0, 'healing is a seed, never a send');
});

test('a real battery event after the heal still sends normally', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  // The last pre-reset fetch left an in-memory bake snapshot; the wipe takes the
  // flash copy but not this one, exactly as on a real reset.
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  storage = {};
  phoneBattery.read();                       // heals (and re-baselines) silently
  mgr.setLevel(0.55);                        // 60 bucket -> 55 bucket
  assert.equal(h.sends.length, 1, 'the first event after the heal is news, not a seed');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 55, charging: false });
});

test('a wipe with no manager in hand still reads as unavailable, nothing thrown', () => {
  // getBattery() may not have resolved yet (boot race), or the phone has no
  // battery API at all -- there is nothing to heal from, and the pre-heal
  // behavior (bake '--', value arrives with the seed/next event) must survive.
  boot({ navigator: { userAgent: 'PKJS', geolocation: {}, language: 'de' } });
  storage = {};
  assert.deepEqual(phoneBattery.read(), { available: false, level: null, charging: false });
});

// --- Bucketing: the SEND TRIGGER only --------------------------------------
// The 5-point bucket decides WHEN a resend fires; it never decides what the
// watch displays. That is the exact percentage (levelPercent), cached on every
// reading. Keeping the two apart is the whole point: the send cadence is a
// deliberate BLE-wake-up budget, and the displayed number costs nothing to keep
// truthful.

test('levelBucket floors a 0..1 level to its 5-point bucket and clamps', () => {
  assert.equal(phoneBattery.levelBucket(0), 0);
  assert.equal(phoneBattery.levelBucket(1), 100);
  assert.equal(phoneBattery.levelBucket(0.62), 60);
  assert.equal(phoneBattery.levelBucket(0.83), 80);
  assert.equal(phoneBattery.levelBucket(0.77), 75);
  assert.equal(phoneBattery.levelBucket(0.05), 5);
  assert.equal(phoneBattery.levelBucket(0.049), 0);
  assert.equal(phoneBattery.levelBucket(-0.2), 0, 'clamped, never negative');
  assert.equal(phoneBattery.levelBucket(1.4), 100, 'clamped, never over 100');
  [null, undefined, 'half', NaN, {}].forEach((bad) =>
    assert.equal(phoneBattery.levelBucket(bad), null, 'unreadable level -> null'));
});

test('levelPercent rounds a 0..1 level to a whole percent and clamps', () => {
  assert.equal(phoneBattery.levelPercent(0), 0);
  assert.equal(phoneBattery.levelPercent(1), 100);
  assert.equal(phoneBattery.levelPercent(0.31), 31, 'the exact reading, not its 30 bucket');
  assert.equal(phoneBattery.levelPercent(0.62), 62);
  assert.equal(phoneBattery.levelPercent(0.874), 87);
  assert.equal(phoneBattery.levelPercent(0.875), 88, 'rounds, never floors');
  assert.equal(phoneBattery.levelPercent(-0.2), 0, 'clamped, never negative');
  assert.equal(phoneBattery.levelPercent(1.4), 100, 'clamped, never over 100');
  [null, undefined, 'half', NaN, {}].forEach((bad) =>
    assert.equal(phoneBattery.levelPercent(bad), null, 'unreadable level -> null'));
});

test('the two quantizers disagree on purpose: bucket floors by 5, percent is exact', () => {
  assert.equal(phoneBattery.levelBucket(0.31), 30, 'trigger baseline');
  assert.equal(phoneBattery.levelPercent(0.31), 31, 'what the slot says');
});

test('83% -> 77% skips the exact multiple 75 but crosses a bucket, so it MUST send', () => {
  // This is the case the reference implementation gets wrong: it tests
  // `level % 5 === 0` and so silently drops any step that jumps over an exact
  // multiple. Neither 83 nor 77 is a multiple of 5, yet the 5-point bucket
  // moves 80 -> 75 and the watch has to be told.
  const mgr = fakeManager(0.83, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  assert.equal(phoneBattery.read().level, 83);
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });

  mgr.setLevel(0.77);
  assert.equal(h.sends.length, 1, 'the bucket moved 80 -> 75: one micro-send');
  assert.equal(phoneBattery.read().level, 77, 'and it carries 77, not the 75 bucket');
  assert.notEqual(0.83 * 100 % 5, 0, 'neither reading is a multiple of 5...');
  assert.notEqual(Math.round(0.77 * 100) % 5, 0, '...which is exactly the trap');
});

test('a level move inside one bucket sends nothing but still updates the cache', () => {
  const mgr = fakeManager(0.83, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  [[0.82, 82], [0.81, 81], [0.80, 80]].forEach(([level, pct]) => {
    mgr.setLevel(level);
    // The send trigger is untouched by this change: no bucket move, no send.
    // But the reading is cached anyway, so the next weather fetch's bake -- which
    // runs buildStatusLines every time -- picks the true number up for free.
    assert.equal(phoneBattery.read().level, pct, 'cached exactly, between triggers');
  });
  assert.equal(h.sends.length, 0, '83/82/81/80 are all the 80 bucket');
  mgr.setLevel(0.79);
  assert.equal(h.sends.length, 1, 'crossing into the 75 bucket does send');
  assert.equal(phoneBattery.read().level, 79);
});

test('the cache stores the exact percentage, never the send-trigger bucket', () => {
  boot({ navigator: modernNavigator(fakeManager(0.87, false)) });
  assert.equal(storage[KEYS.PHONE_BATTERY_LEVEL], '87', 'not the 85 bucket');
  assert.equal(storage[KEYS.PHONE_BATTERY_CHARGING], 'false');
});

test('the trigger baseline is never persisted: only the three phone-battery keys exist', () => {
  // The bucket lives in module state alone. init() drops the cached reading and
  // re-takes the detector verdict on every boot, so a restart's first reading
  // counts as a move and re-sends the true state -- right when the phone was
  // plugged in while PKJS was down, and free otherwise, because the outbox drops
  // a status category whose bytes match the last send. Persisting the baseline
  // would buy that nothing and add one more thing that can go stale. (Nothing
  // has been baked here, so the snapshot key is absent too; the restart section
  // below covers the one key that IS written, and only once a bake has run.)
  boot({ navigator: modernNavigator(fakeManager(0.87, false)) });
  assert.deepEqual(Object.keys(storage).sort(), [
    KEYS.PHONE_BATTERY_CHARGING, KEYS.PHONE_BATTERY_LEVEL, KEYS.PHONE_BATTERY_SUPPORTED
  ].sort());
});

// --- Charging --------------------------------------------------------------

test('a charging flip sends immediately, without waiting for a bucket move', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });

  mgr.setCharging(true);
  assert.equal(h.sends.length, 1, 'plugging in is the event a user looks at the watch to confirm');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62, charging: true });

  mgr.setCharging(false);
  assert.equal(h.sends.length, 2, 'unplugging sends too');
  assert.equal(phoneBattery.read().charging, false);
});

test('a chargingchange that does not change the flag sends nothing', () => {
  const mgr = fakeManager(0.62, true);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  mgr.fire('chargingchange');
  mgr.fire('levelchange');
  assert.equal(h.sends.length, 0, 'no bucket move and no flip: nothing to say');
});

// --- The Night battery saver ----------------------------------------------
// Inside the window nothing is sent — level changes and charging transitions
// alike. Waking the BLE link for a battery readout is exactly what the setting
// exists to prevent, and the user opted in.

test('the saver window suppresses a level update but still caches it', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });

  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 0, 'no BLE wake-up for a battery readout overnight');
  assert.equal(phoneBattery.read().level, 42, 'but the cache tracks the truth');
});

test('the saver window suppresses a charging flip too', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });

  mgr.setCharging(true);
  assert.equal(h.sends.length, 0, 'plugging in at 03:00 waits for the window to close');
  assert.equal(phoneBattery.read().charging, true, 'still cached, for the morning push');
});

test('the saver is off unless the user enabled it', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: { sleepNightEnabled: false },
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 1, '03:00 with the saver off is an ordinary minute');
});

test('the first tick after the window closes pushes exactly once', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  mgr.setLevel(0.42);
  mgr.setCharging(true);
  assert.equal(h.sends.length, 0);

  h.clock = new Date(2026, 0, 1, 7, 0, 0);  // window is [0, 7)
  phoneBattery.onTick();
  assert.equal(h.sends.length, 1, 'one push carries the whole morning correction');

  phoneBattery.onTick();
  phoneBattery.onTick();
  assert.equal(h.sends.length, 1, 'the debt is paid off, not re-pushed every minute');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 42, charging: true },
    'and it carries both halves: the level AND the charging icon');
});

test('a tick inside the window pushes nothing', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  mgr.setLevel(0.42);
  h.clock = new Date(2026, 0, 1, 6, 59, 0);
  phoneBattery.onTick();
  assert.equal(h.sends.length, 0, 'still inside [0, 7)');
});

test('a tick owing nothing sends nothing', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  phoneBattery.onTick();
  phoneBattery.onTick();
  assert.equal(h.sends.length, 0, 'the per-minute hook is free when nothing was swallowed');
});

// --- No snapshot -----------------------------------------------------------

test('no bake snapshot yet: every trigger is a silent no-op', () => {
  // PKJS just started and no fetch has completed. There is nothing to re-bake,
  // and the next fetch carries the value anyway.
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  assert.doesNotThrow(() => mgr.setLevel(0.42));
  assert.doesNotThrow(() => mgr.setCharging(true));
  assert.doesNotThrow(() => phoneBattery.onTick());
  assert.equal(h.sends.length, 0, 'no send without bake inputs');
  assert.equal(phoneBattery.read().level, 42, 'the cache is still kept up to date');
});

test('rememberBakeInputs(null) is ignored rather than clobbering the snapshot', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, {}, { platform: 'basalt' });
  assert.doesNotThrow(() => statusRebake.rememberBakeInputs(null, {}, null));
  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 1, 'the earlier snapshot still stands');
});

// --- The micro-send --------------------------------------------------------
// A battery event re-bakes the stashed inputs and pushes ONLY the outbox's
// 'status' category. change-detector's categorySubset() returns null for a
// category whose keys are all absent and ChangeDetector skips those outright,
// so a partial payload sends the status category alone — no new outbox API, and
// no fetch, which is the point: an expired provider key still gets a live
// reading.

test('STATUS_KEYS is exactly the outbox status category', () => {
  // Near-tautological since STATUS_KEYS is now DERIVED from the category — the
  // real guard is the micro-send integration tests below; this pins only that
  // the derivation found the right category.
  const outbox = require('../src/pkjs/outbox.js');
  assert.deepEqual(statusRebake.STATUS_KEYS,
    outbox.WEATHER_CATEGORIES.find((c) => c.name === 'status').keys);
  assert.ok(statusRebake.STATUS_KEYS.indexOf('STATUS_LEVELS_UINT8') !== -1);
});

test('the micro-send carries the five status keys and nothing else', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, TEMP_TREND_UINT8: [1, 2, 3], NUM_ENTRIES: 3,
      FORECAST_START: 1700000000, SUN_EVENTS: [1, 0, 0, 0, 0] },
    { temperatureUnits: 'c' }, { platform: 'basalt' });

  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 1);
  const sent = h.sends[0];
  assert.deepEqual(Object.keys(sent).sort(), statusRebake.STATUS_KEYS.slice().sort(),
    'nothing outside the status category rides along');
  // Neither the snapshot's own weather keys nor a stray key the bake added.
  ['CITY', 'CURRENT_TEMP', 'TEMP_TREND_UINT8', 'NUM_ENTRIES', 'FORECAST_START',
   'SUN_EVENTS', 'NOT_A_STATUS_KEY'].forEach((k) =>
    assert.equal(k in sent, false, k + ' must not reach the wire on a battery event'));
});

test('the re-bake runs against a CLONE of the snapshot, not the pruned payload', () => {
  // forecast-series.js hands the inputs over immediately BEFORE the bake, then
  // deletes the transient keys a few lines later. Without the clone the re-bake
  // would see a stripped payload and quietly render '--' everywhere.
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true });
  const payload = { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0],
                    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64] };
  const settings = { temperatureUnits: 'c', axisTimeFormat: '24h',
                     statusForecastLeft: 'phoneBattery' };
  statusRebake.rememberBakeInputs(payload, settings, { platform: 'basalt' });
  // Exactly what applyForecastSeries does next.
  ['CITY', 'CURRENT_TEMP', 'WIND_TREND_UINT8', 'GUST_TREND_UINT8', 'UV_TREND_UINT8']
    .forEach((k) => { delete payload[k]; });

  mgr.setLevel(0.42);
  const slots = decodeLine(h.sends[0].STATUS_LINE_1_UINT8);
  assert.equal(slots[1].text, 'Bonn', 'the city survived the prune, via the clone');
  assert.equal('STATUS_LINE_1_UINT8' in payload, false,
    'and the caller-owned payload was never written back to');
});

test('the re-bake renders the live reading through the real status-line pipeline', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] },
    { temperatureUnits: 'c', axisTimeFormat: '24h', statusForecastLeft: 'phoneBattery' },
    { platform: 'basalt' });

  mgr.setLevel(0.42);
  assert.deepEqual(Object.keys(h.sends[0]).sort(), statusRebake.STATUS_KEYS.slice().sort());
  let slot = decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[0];
  assert.deepEqual(slot, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY, text: '42%' },
    'the send was triggered by the 40 bucket, but it carries 42%');

  // Charging swaps the icon id at bake time — no wire field, no watch logic.
  mgr.setCharging(true);
  assert.equal(h.sends.length, 2);
  slot = decodeLine(h.sends[1].STATUS_LINE_1_UINT8)[0];
  assert.deepEqual(slot, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY_CHG, text: '42%' });
});

// --- The reported bug: 31% displayed as 30% ---------------------------------
// On-device feedback, verbatim: "the watch only shows 5% steps. so it 31% on my
// phone but shows 30% when plugging in." The bucket was doing both jobs — the
// send trigger AND the displayed value — so every reading was rounded down to
// the trigger's name. The trigger is unchanged; the number is now exact.

test('31% and plugged in: the charging send carries 31%, not the 30 bucket', () => {
  const mgr = fakeManager(0.31, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] },
    { temperatureUnits: 'c', axisTimeFormat: '24h', statusForecastLeft: 'phoneBattery' },
    { platform: 'basalt' });
  assert.equal(phoneBattery.levelBucket(0.31), 30, 'the trigger still buckets to 30...');

  mgr.setCharging(true);  // the user plugs the phone in
  assert.equal(h.sends.length, 1, 'a charging flip still sends immediately');
  assert.deepEqual(decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[0],
    { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY_CHG, text: '31%' },
    '...but the watch shows the phone\'s real 31%');
});

test('a 31% -> 30% drop inside one bucket does not send, and the next bake shows 30%', () => {
  // Both halves of the split in one test: the trigger is untouched (no send for
  // a move within the 30 bucket), while the cached value the baker reads follows
  // the phone exactly, so whatever sends next — here the charging flip, in the
  // field usually just the next 15-minute weather fetch — carries the truth.
  const mgr = fakeManager(0.31, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] },
    { temperatureUnits: 'c', axisTimeFormat: '24h', statusForecastLeft: 'phoneBattery' },
    { platform: 'basalt' });

  mgr.setLevel(0.30);
  assert.equal(h.sends.length, 0, '31 -> 30 stays in the 30 bucket: no BLE wake-up');
  assert.equal(phoneBattery.read().level, 30, 'but the cache moved');

  mgr.setCharging(true);
  assert.equal(decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[0].text, '30%');
});

test('a stale cached reading does not survive a boot on an unsupported phone', () => {
  // The user was on Android, then switched to an iPhone. Anything left in the
  // store from the Android days must not be re-served as a live reading: the
  // slot has to fall back to '--' (and the dropdown item to disappear) rather
  // than showing the last percentage the old phone ever reported.
  storage = {};
  storage[KEYS.PHONE_BATTERY_SUPPORTED] = 'true';
  storage[KEYS.PHONE_BATTERY_LEVEL] = '85';
  storage[KEYS.PHONE_BATTERY_CHARGING] = 'true';
  const sends = [];
  phoneBattery.init({
    navigator: null,
    getSettings: function () { return {}; },
    now: function () { return new Date(2026, 0, 1, 12, 0, 0); },
    sendWeather: function (p) { sends.push(p); }
  });
  assert.equal(phoneBattery.isSupported(), false, 'the detector verdict is re-taken on every boot');
  assert.deepEqual(phoneBattery.read(), { available: false, level: null, charging: false });
  assert.equal(sends.length, 0);
});

// --- Surviving a PKJS restart ----------------------------------------------
// The reported bug: PKJS is torn down every time the user leaves the watchface,
// and the re-bake snapshot lived in memory only, so every charging event after a
// restart logged "no bake snapshot yet" and reached the watch not at all -- for
// up to a whole fetch interval (default 15 min, max 60), longer when fetches
// fail. The snapshot is now written to flash at every bake and restored in
// init(), before any battery event can fire.

/** The slot config these tests bake against: phone battery on the left. */
const SLOT_SETTINGS = { temperatureUnits: 'c', axisTimeFormat: '24h',
                        statusForecastLeft: 'phoneBattery' };

/** A payload shaped like the one applyForecastSeries hands over. */
function bakePayload() {
  return {
    CITY: 'Bonn', CURRENT_TEMP: 68, FEELS_CURRENT: 66,
    SUN_EVENTS: [1, 0, 0, 0, 0],
    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
    // Everything below is forecast-series payload the status bake never reads;
    // none of it belongs on flash.
    TEMP_TREND_UINT8: [1, 2, 3], TEMP_MIN: 50, TEMP_MAX: 70, NUM_ENTRIES: 24,
    FORECAST_START: 1700000000, RAIN_RADAR_TREND_UINT8: [0, 0, 0, 0, 0, 0]
  };
}

test('a charging event after a PKJS restart still reaches the watch', () => {
  // The bug, end to end. Life one bakes; life two starts with an empty module
  // state and must re-bake from flash.
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });
  assert.ok(storage[KEYS.PHONE_BATTERY_SNAPSHOT], 'the bake wrote the backstop');

  const mgr2 = fakeManager(0.62, false);
  const h2 = boot({ navigator: modernNavigator(mgr2), realBake: true,
                    settings: SLOT_SETTINGS, keepStorage: true });
  const seeded = h2.sends.length;   // the restart refresh; its own test below

  mgr2.setCharging(true);
  assert.equal(h2.sends.length, seeded + 1, 'the charging flip sends after a restart');
  const slots = decodeLine(h2.sends[h2.sends.length - 1].STATUS_LINE_1_UINT8);
  assert.deepEqual(slots[0], { kind: catalog.KINDS.TEXT,
    icon: catalog.ICONS.PHONE_BATTERY_CHG, text: '62%' },
    'the charging glyph and the live percentage, re-baked from flash');
  assert.equal(slots[1].text, 'Bonn', 'and the rest of the line came back with it');
});

test('the re-bake changes the battery slot and reproduces every other slot exactly', () => {
  // Why re-baking a RESTORED snapshot is safe: the watch's status lines came
  // from the send that carried this same bake, so every weather-derived slot
  // re-bakes byte-identically and only the battery one moves.
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });
  mgr.setLevel(0.42);                       // a send from the LIVE snapshot
  const before = h.sends[h.sends.length - 1];

  const mgr2 = fakeManager(0.42, false);
  const h2 = boot({ navigator: modernNavigator(mgr2), realBake: true,
                    settings: SLOT_SETTINGS, keepStorage: true });
  mgr2.setCharging(true);                   // a send from the RESTORED snapshot
  const after = h2.sends[h2.sends.length - 1];

  ['STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8',
   'STATUS_LEVELS_UINT8'].forEach((k) =>
    assert.deepEqual(after[k], before[k], k + ' is byte-identical across the restart'));
  const b = decodeLine(before.STATUS_LINE_1_UINT8);
  const a = decodeLine(after.STATUS_LINE_1_UINT8);
  assert.deepEqual([a[1], a[2]], [b[1], b[2]], 'the other two slots of line 1 too');
  assert.equal(a[0].text, b[0].text, '42% either way');
  assert.equal(b[0].icon, catalog.ICONS.PHONE_BATTERY);
  assert.equal(a[0].icon, catalog.ICONS.PHONE_BATTERY_CHG, 'only the battery slot moved');
});

test('the stored blob holds only the payload keys the bake reads', () => {
  // Bounded and modest: the forecast series, the radar series and the rest of
  // the payload have no business on flash. Enumerated from status-lines.js
  // (formatValue + directionSentinel) and status-thresholds.js (displayValue).
  boot({ navigator: modernNavigator(fakeManager(0.62, false)), settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });
  const blob = JSON.parse(storage[KEYS.PHONE_BATTERY_SNAPSHOT]);
  assert.deepEqual(Object.keys(blob).sort(), ['payload', 'v', 'watchInfo']);
  assert.deepEqual(Object.keys(blob.payload).sort(),
    ['CITY', 'CURRENT_TEMP', 'FEELS_CURRENT', 'GUST_TREND_UINT8', 'SUN_EVENTS',
     'UV_TREND_UINT8', 'WIND_TREND_UINT8'],
    'present bake keys only -- no TEMP_TREND_UINT8, no radar, no FORECAST_START');
  assert.deepEqual(blob.watchInfo, { platform: 'basalt' },
    'the platform env the bake derives from survives too');
});

test('the platform env survives the restart: aplite still gets its lean bake', () => {
  // watchInfo is persisted alongside the payload precisely so a restored bake
  // cannot silently switch platform -- an aplite watch re-baked as basalt would
  // get the LIVE_WEEK kind byte it has no code for, and a wind-direction
  // sentinel it would draw as a glyph box.
  const mgr = fakeManager(0.62, false);
  const settings = { temperatureUnits: 'c', axisTimeFormat: '24h',
                     statusForecastLeft: 'phoneBattery', statusForecastRight: 'week' };
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: settings });
  statusRebake.rememberBakeInputs(bakePayload(), settings, { platform: 'aplite' });

  const mgr2 = fakeManager(0.62, false);
  const h2 = boot({ navigator: modernNavigator(mgr2), realBake: true,
                    settings: settings, keepStorage: true });
  mgr2.setCharging(true);
  const slots = decodeLine(h2.sends[h2.sends.length - 1].STATUS_LINE_1_UINT8);
  assert.equal(slots[2].kind, catalog.KINDS.TEXT,
    'aplite bakes the ISO week as text, so the restored bake did run as aplite');
  assert.match(slots[2].text, /^W\d+$/);
});

test('the restored payload is paired with the LIVE settings, not stored ones', () => {
  // Deliberate: settings are not in the blob. A settings save forces a fetch, so
  // in the steady state the two agree; where they briefly do not, the live blob
  // is what the next fetch would bake with.
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });

  const mgr2 = fakeManager(0.62, false);
  const h2 = boot({ navigator: modernNavigator(mgr2), realBake: true, keepStorage: true,
                    settings: { temperatureUnits: 'f', axisTimeFormat: '24h',
                                statusForecastLeft: 'temp' } });
  mgr2.setCharging(true);
  const slots = decodeLine(h2.sends[h2.sends.length - 1].STATUS_LINE_1_UINT8);
  assert.equal(slots[0].text, '68', 'the left slot follows the settings in force NOW');
});

test('a restart does not turn its seed reading into a send', () => {
  // The restored snapshot makes a sending seed POSSIBLE; it stays deliberately
  // silent. PKJS is torn down whenever the user leaves the watchface, so a
  // sending seed would be a BLE wake-up on essentially every visit -- the charge
  // is almost always a percent or two off the last one -- which is precisely the
  // spend the 5-point bucket exists to prevent. The reading is cached instead
  // (the next fetch's bake carries it), and the first real event after it sends.
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });

  const mgr2 = fakeManager(0.55, false);  // drained while PKJS was down
  const h2 = boot({ navigator: modernNavigator(mgr2), realBake: true,
                    settings: SLOT_SETTINGS, keepStorage: true });
  assert.equal(h2.sends.length, 0, 'the seed baselines and caches, it does not send');
  assert.equal(phoneBattery.read().level, 55, 'but the baker sees the truth at once');

  mgr2.setCharging(true);
  assert.equal(h2.sends.length, 1, 'the first real event after the seed does send');
  assert.deepEqual(decodeLine(h2.sends[0].STATUS_LINE_1_UINT8)[0],
    { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY_CHG, text: '55%' });
});

test('re-baking a restored snapshot never writes back to the stored blob', () => {
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });
  const stored = storage[KEYS.PHONE_BATTERY_SNAPSHOT];

  const mgr2 = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr2), realBake: true,
         settings: SLOT_SETTINGS, keepStorage: true });
  mgr2.setCharging(true);
  assert.equal(storage[KEYS.PHONE_BATTERY_SNAPSHOT], stored,
    'the bake output (STATUS_LINE_*) must not accumulate in the snapshot');
});

test('a re-bake from the LIVE snapshot is preferred over the stored one', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  const stale = bakePayload();
  stale.CITY = 'Köln';
  statusRebake.rememberBakeInputs(stale, SLOT_SETTINGS, { platform: 'basalt' });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });
  mgr.setCharging(true);
  assert.equal(decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[1].text, 'Bonn',
    'the newest bake wins, in memory and on flash');
});

// --- A stored blob that cannot be trusted ----------------------------------
// Garbage, a truncated write, or a blob from an app version whose snapshot shape
// has since changed. Every one of these degrades to "no snapshot" -- the
// pre-existing skip-the-send path -- and never throws inside a battery handler.

test('a corrupt stored blob degrades to no snapshot instead of throwing', () => {
  ['{not json', '', 'null', '[]', '"a string"', '{"v":1}', '{"v":1,"payload":null}',
   '{"v":1,"payload":"nope"}'].forEach((bad) => {
    storage = {};
    storage[KEYS.PHONE_BATTERY_SNAPSHOT] = bad;
    const mgr = fakeManager(0.62, false);
    const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                     settings: SLOT_SETTINGS, keepStorage: true });
    assert.doesNotThrow(() => mgr.setCharging(true), 'blob ' + JSON.stringify(bad));
    assert.equal(h.sends.length, 0, 'nothing to re-bake: no send, no crash');
    if (bad !== '') {
      assert.equal(KEYS.PHONE_BATTERY_SNAPSHOT in storage, false,
        'and the unusable blob is dropped rather than re-parsed every boot');
    }
  });
});

test('a snapshot written by an older build is rejected on its version stamp', () => {
  // The upgrade case: SNAPSHOT_KEYS changed, so the old blob's payload is not
  // what this build's baker expects. Rejecting it costs one battery event; using
  // it would push text baked from keys that are no longer there.
  storage = {};
  storage[KEYS.PHONE_BATTERY_SNAPSHOT] =
    JSON.stringify({ v: 0, payload: { CITY: 'Bonn' }, watchInfo: { platform: 'basalt' } });
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                   settings: SLOT_SETTINGS, keepStorage: true });
  mgr.setCharging(true);
  assert.equal(h.sends.length, 0);
  assert.equal(KEYS.PHONE_BATTERY_SNAPSHOT in storage, false, 'dropped');
});

test('a restored snapshot with no settings supplier degrades to no snapshot', () => {
  // Nothing safe to bake against: re-baking against defaults would push text
  // matching neither the watch nor the user's config.
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), SLOT_SETTINGS, { platform: 'basalt' });

  const sends = [];
  const mgr2 = fakeManager(0.62, false);
  phoneBattery.init({
    navigator: modernNavigator(mgr2),
    now: function () { return new Date(2026, 0, 1, 12, 0, 0); },
    sendWeather: function (p) { sends.push(p); }
  });
  assert.doesNotThrow(() => mgr2.setCharging(true));
  assert.equal(sends.length, 0);
});
