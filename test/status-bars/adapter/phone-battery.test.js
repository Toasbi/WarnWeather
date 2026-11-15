'use strict';
// The phone battery: detection, the cached reading, the send triggers and the shown
// reading a bake reads. Its re-bake (the micro-send, the snapshot that outlives a
// restart) is status-rebake-battery.test.js'. phone-battery-host.js mocks localStorage
// before it loads the watch modules.
const {
  storage, clearStorage, boot, SAVER_ON, decodeLine, SLOT_SETTINGS, bakePayload, fakeManager, modernNavigator, legacyNavigator, phoneBattery, statusRebake, KEYS, catalog
} = require('../../helpers/phone-battery-host.js');
const test = require('node:test');
const assert = require('node:assert/strict');

// The module logs a line per reading; keep the runner's output about assertions.
const realLog = console.log;
test.before(() => { console.log = function () {}; });
test.after(() => { console.log = realLog; });

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
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
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
    assert.doesNotThrow(() => statusRebake.rememberBakeInputs({ CITY: 'X' }, null));
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
  clearStorage();                              // <- localStorage.clear()
  assert.equal(phoneBattery.isSupported(), true, 'the capability survived the wipe');
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true',
    're-probed AND re-persisted, so the baker and the config env agree');
});

test('the legacy navigator.battery shape is re-probed too', () => {
  boot({ navigator: legacyNavigator(fakeManager(0.41, false)) });
  clearStorage();
  assert.equal(phoneBattery.isSupported(), true);
});

test('a phone with no battery API re-probes to a persisted false', () => {
  boot({ navigator: { userAgent: 'PKJS', geolocation: {}, language: 'de' } });
  clearStorage();
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
  clearStorage();
  const env = { color: true, platform: 'basalt', health: true,
                hr: false, phoneBattery: phoneBattery.isSupported() };
  catalog.LINES.forEach((line) => {
    line.slots.forEach((slotKey, i) => {
      const codes = catalog.slotOptions({}, env,
        { slotKey: slotKey, position: catalog.SLOT_POSITIONS[i] }).map((o) => o[1]);
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
  clearStorage();                              // <- localStorage.clear()
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
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  clearStorage();
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
  clearStorage();
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
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });

  mgr.setLevel(0.77);
  assert.equal(h.sends.length, 1, 'the bucket moved 80 -> 75: one micro-send');
  assert.equal(phoneBattery.read().level, 77, 'and it carries 77, not the 75 bucket');
  assert.notEqual(0.83 * 100 % 5, 0, 'neither reading is a multiple of 5...');
  assert.notEqual(Math.round(0.77 * 100) % 5, 0, '...which is exactly the trap');
});

test('a level move inside one bucket sends nothing but still updates the cache', () => {
  const mgr = fakeManager(0.83, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
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

test('the trigger baseline is never persisted: the reading, the verdict and the shown reading are', () => {
  // The bucket lives in module state alone. init() drops the cached reading and
  // re-takes the detector verdict on every boot; the shown reading (what the watch
  // was last sent) survives, so a restart keeps baking what the watch shows, and the
  // first reading replaces it only from another bucket (the shown-reading section
  // below). Persisting the baseline would add one more thing that can go stale.
  // (Nothing has been baked here, so the snapshot key is absent too; the restart
  // section below covers it, written only once a bake has run.)
  boot({ navigator: modernNavigator(fakeManager(0.87, false)) });
  assert.deepEqual(Object.keys(storage).sort(), [
    KEYS.PHONE_BATTERY_CHARGING, KEYS.PHONE_BATTERY_LEVEL, KEYS.PHONE_BATTERY_SHOWN,
    KEYS.PHONE_BATTERY_SUPPORTED
  ].sort());
  assert.deepEqual(JSON.parse(storage[KEYS.PHONE_BATTERY_SHOWN]), { level: 87, charging: false });
});

// --- Charging --------------------------------------------------------------

test('a charging flip sends immediately, without waiting for a bucket move', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });

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
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
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
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });

  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 0, 'no BLE wake-up for a battery readout overnight');
  assert.equal(phoneBattery.read().level, 42, 'but the cache tracks the truth');
});

test('the saver window suppresses a charging flip too', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });

  mgr.setCharging(true);
  assert.equal(h.sends.length, 0, 'plugging in at 03:00 waits for the window to close');
  assert.equal(phoneBattery.read().charging, true, 'still cached, for the morning push');
});

test('the saver is off unless the user enabled it', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: { sleepNightEnabled: false },
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 1, '03:00 with the saver off is an ordinary minute');
});

test('the first tick after the window closes pushes exactly once', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
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

test('the post-window push waits out a fetch in flight, whose message carries the battery', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.42);
  h.clock = new Date(2026, 0, 1, 7, 0, 0);
  phoneBattery.onTick(true);   // the window's first fetch started this minute
  assert.equal(h.sends.length, 0, 'no push beside the fetch');
  phoneBattery.onTick(false);  // the fetch's message did not take it along: still owed
  assert.equal(h.sends.length, 1, 'pushed on the next tick');
  phoneBattery.onTick(false);
  assert.equal(h.sends.length, 1, 'once');
});

test('a tick inside the window pushes nothing', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.42);
  h.clock = new Date(2026, 0, 1, 6, 59, 0);
  phoneBattery.onTick();
  assert.equal(h.sends.length, 0, 'still inside [0, 7)');
});

test('a tick owing nothing sends nothing', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
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
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  assert.doesNotThrow(() => statusRebake.rememberBakeInputs(null, null));
  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 1, 'the earlier snapshot still stands');
});

// --- The reported bug: 31% displayed as 30% ---------------------------------
// On-device feedback, verbatim: "the watch only shows 5% steps. so it 31% on my
// phone but shows 30% when plugging in." The bucket was doing both jobs — the
// send trigger AND the displayed value — so every reading was rounded down to
// the trigger's name. The trigger is unchanged; the number is now exact.

test('31% and plugged in: the charging send carries 31%, not the 30 bucket', () => {
  const mgr = fakeManager(0.31, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                   settings: { temperatureUnits: 'c', axisTimeFormat: '24h',
                               statusForecastLeft: 'phoneBattery' } });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] }, { platform: 'basalt' });
  assert.equal(phoneBattery.levelBucket(0.31), 30, 'the trigger still buckets to 30...');

  mgr.setCharging(true);  // the user plugs the phone in
  assert.equal(h.sends.length, 1, 'a charging flip still sends immediately');
  assert.deepEqual(decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[0],
    { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY_CHG, text: '31%' },
    '...but the watch shows the phone\'s real 31%');
});

test('a 31% -> 30% drop inside one bucket does not send, and the next trigger shows 30%', () => {
  // Both halves of the split in one test: the trigger is untouched (no send for
  // a move within the 30 bucket), while the cached value follows the phone
  // exactly, so whatever carries the battery next — here the charging flip, in
  // the field as often a weather message going out anyway (the ride-along) —
  // carries the truth.
  const mgr = fakeManager(0.31, false);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                   settings: { temperatureUnits: 'c', axisTimeFormat: '24h',
                               statusForecastLeft: 'phoneBattery' } });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] }, { platform: 'basalt' });

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
  clearStorage();
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

// --- The reading a weather message bakes -------------------------------------
// A fetch's bake reads the SHOWN reading: the one the watch was last sent. It moves only at a
// trigger (a bucket move, a charging flip), at the first reading of a PKJS life that lands in
// another bucket than it, and when a weather message that goes out anyway takes the exact
// reading along (statusRideAlong, the outbox's ride-along). So the charge drifting inside its
// bucket never changes the status by itself, and costs no wake-up.

test('a fetch bakes the reading the watch was last sent: drift inside a bucket leaves it', () => {
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr) });
  assert.equal(phoneBattery.bakeFacts().reading().level, 62, 'the first reading is the shown one');
  mgr.setLevel(0.61);
  assert.equal(phoneBattery.read().level, 61, 'the cache follows the phone');
  assert.equal(phoneBattery.bakeFacts().reading().level, 62, 'a bake still reads what the watch shows');
});

test('a trigger shows the exact reading of its moment, level and charging alike', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.61);
  mgr.setLevel(0.59);   // 60 -> 55: a bucket move
  assert.equal(h.sends.length, 1);
  assert.equal(phoneBattery.bakeFacts().reading().level, 59);
  mgr.setCharging(true);
  assert.equal(h.sends.length, 2);
  assert.deepEqual([phoneBattery.bakeFacts().reading().level, phoneBattery.bakeFacts().reading().charging],
    [59, true]);
});

test('the ride-along brings the exact reading once it differs, and the watch shows it from then', () => {
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });
  assert.equal(phoneBattery.statusRideAlong(), null, 'nothing new to bring');
  mgr.setLevel(0.61);
  const extra = phoneBattery.statusRideAlong();
  assert.deepEqual(Object.keys(extra).sort(), statusRebake.STATUS_KEYS.filter((k) => k in extra).sort(),
    'only status keys');
  assert.equal(decodeLine(extra.STATUS_LINE_1_UINT8)[0].text, '61%');
  assert.equal(phoneBattery.bakeFacts().reading().level, 61, 'the exact reading is the shown one now');
  assert.equal(phoneBattery.statusRideAlong(), null, 'and there is nothing new to bring again');
});

test('with nothing to re-bake, the ride-along brings nothing and the shown reading stays', () => {
  // No fetch has baked yet: the message going out carries its own bake, of the shown reading.
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  mgr.setLevel(0.61);
  assert.equal(phoneBattery.statusRideAlong(), null);
  assert.equal(phoneBattery.bakeFacts().reading().level, 62, 'the watch still shows 62%');
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });
  assert.equal(decodeLine(phoneBattery.statusRideAlong().STATUS_LINE_1_UINT8)[0].text, '61%',
    'the first message with a bake to re-bake takes it along');
});

test('a phone without a battery API, or with no reading yet, brings nothing to ride along', () => {
  boot({ navigator: {} });
  assert.equal(phoneBattery.statusRideAlong(), null);
  boot({ navigator: { getBattery: function () { return { then: function () {} }; } } });
  assert.equal(phoneBattery.statusRideAlong(), null, 'getBattery has not answered yet');
});

test('a restart keeps the shown reading while its bucket holds; a first reading elsewhere replaces it', () => {
  boot({ navigator: modernNavigator(fakeManager(0.62, false)) });
  boot({ navigator: modernNavigator(fakeManager(0.61, false)), keepStorage: true });
  assert.equal(phoneBattery.bakeFacts().reading().level, 62, 'the watch still shows 62%: a bake keeps it');
  boot({ navigator: modernNavigator(fakeManager(0.58, false)), keepStorage: true });
  assert.equal(phoneBattery.bakeFacts().reading().level, 58, 'another bucket: the next message carries 58%');
  boot({ navigator: modernNavigator(fakeManager(0.58, true)), keepStorage: true });
  assert.equal(phoneBattery.bakeFacts().reading().charging, true, 'plugged in while PKJS was down');
});
