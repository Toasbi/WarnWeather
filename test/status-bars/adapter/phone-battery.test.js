'use strict';
// The phone battery: detection, the cached reading, the send triggers and the shown
// reading a bake reads. Its re-bake (the micro-send, the snapshot that outlives a
// restart) is status-rebake-battery.test.js'. phone-battery-host.js mocks localStorage
// before it loads the watch modules.
const {
  storage, clearStorage, boot, SAVER_ON, decodeLine, SLOT_SETTINGS, bakePayload, fakeManager, modernNavigator, legacyNavigator, fakePluginPebble, pluginEnvelope, fakeTimers,
  phoneBattery, statusRebake, KEYS, catalog
} = require('../../helpers/phone-battery-host.js');
const test = require('node:test');
const assert = require('node:assert/strict');

// The module logs a line per reading; keep the runner's output about assertions.
const realLog = console.log;
test.before(() => { console.log = function () {}; });
test.after(() => { console.log = realLog; });

// --- Detection -------------------------------------------------------------
// Two sources: the Pebble app's Phone plugin (the section below) and, for a Pebble app
// without plugins, the WebView's battery API: navigator.getBattery exists only because
// Android's companion app runs PKJS inside a Chromium WebView. The tests of this section
// run on a host with no plugins (boot() hands no Pebble object), i.e. the WebView alone.
// The slot shows the charge only: neither source is asked whether the phone charges.

test('detects the modern navigator.getBattery API and seeds the cached reading', () => {
  const h = boot({ navigator: modernNavigator(fakeManager(0.62)) });
  assert.equal(phoneBattery.isSupported(), true);
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true', 'verdict is persisted for the config env');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62 },
    'the cached level is the EXACT percentage, not the 60 send-trigger bucket');
  assert.equal(h.sends.length, 0, 'seeding cannot send: no bake snapshot exists yet');
});

test('detects the legacy navigator.battery object', () => {
  boot({ navigator: legacyNavigator(fakeManager(0.41)) });
  assert.equal(phoneBattery.isSupported(), true);
  assert.deepEqual(phoneBattery.read(), { available: true, level: 41 });
});

test('the legacy object is still subscribed to, not just read once', () => {
  const mgr = fakeManager(0.41);
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
    assert.deepEqual(phoneBattery.read(), { available: false, level: null });
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
  // slot in the emulator or in a store screenshot. A `charging` in the fake (left in
  // an older dev-config) is ignored: the reading has no such field.
  boot({ navigator: null, devConfig: { devPhoneBattery: { level: 62, charging: true } } });
  assert.equal(phoneBattery.isSupported(), true);
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62 });
  assert.equal('charging' in JSON.parse(storage[KEYS.PHONE_BATTERY_SHOWN]), false,
    'nor does the shown reading carry one');
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
  boot({ navigator: modernNavigator(fakeManager(0.62)) });
  assert.equal(phoneBattery.isSupported(), true);
  clearStorage();                              // <- localStorage.clear()
  assert.equal(phoneBattery.isSupported(), true, 'the capability survived the wipe');
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true',
    're-probed AND re-persisted, so the baker and the config env agree');
});

test('the legacy navigator.battery shape is re-probed too', () => {
  boot({ navigator: legacyNavigator(fakeManager(0.41)) });
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
  boot({ navigator: modernNavigator(fakeManager(0.62)) });
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
  // The same localStorage.clear() also takes the cached level the
  // baker renders -- while THIS module's subscription and its BatteryManager live
  // on (a reset does not restart PKJS). Saving a phone-battery slot right after a
  // reset forces a fetch, and without the heal that bake finds no reading and
  // shows '--' until the next battery EVENT or PKJS boot. The manager in hand
  // still knows the charge synchronously, so read() must re-seed from it.
  const h = boot({ navigator: modernNavigator(fakeManager(0.62)) });
  clearStorage();                              // <- localStorage.clear()
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62 },
    'the post-reset bake shows the real charge, not --');
  assert.equal(storage[KEYS.PHONE_BATTERY_LEVEL], '62', 'the cache is rewritten');
  assert.equal(h.sends.length, 0, 'healing is a seed, never a send');
});

test('a real battery event after the heal still sends normally', () => {
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr) });
  // The last pre-reset fetch left an in-memory bake snapshot; the wipe takes the
  // flash copy but not this one, exactly as on a real reset.
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  clearStorage();
  phoneBattery.read();                       // heals (and re-baselines) silently
  mgr.setLevel(0.55);                        // 60 bucket -> 55 bucket
  assert.equal(h.sends.length, 1, 'the first event after the heal is news, not a seed');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 55 });
});

test('a wipe with no manager in hand still reads as unavailable, nothing thrown', () => {
  // getBattery() may not have resolved yet (boot race), or the phone has no
  // battery API at all -- there is nothing to heal from, and the pre-heal
  // behavior (bake '--', value arrives with the seed/next event) must survive.
  boot({ navigator: { userAgent: 'PKJS', geolocation: {}, language: 'de' } });
  clearStorage();
  assert.deepEqual(phoneBattery.read(), { available: false, level: null });
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
  const mgr = fakeManager(0.83);
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
  const mgr = fakeManager(0.83);
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
  boot({ navigator: modernNavigator(fakeManager(0.87)) });
  assert.equal(storage[KEYS.PHONE_BATTERY_LEVEL], '87', 'not the 85 bucket');
});

test('the trigger baseline is never persisted: the reading, the verdict and the shown reading are', () => {
  // The bucket lives in module state alone. init() drops the cached reading and
  // re-takes the detector verdict on every boot; the shown reading (what the watch
  // was last sent) survives, so a restart keeps baking what the watch shows, and the
  // first reading replaces it only from another bucket (the shown-reading section
  // below). Persisting the baseline would add one more thing that can go stale.
  // (Nothing has been baked here, so the snapshot key is absent too; the restart
  // section below covers it, written only once a bake has run.)
  boot({ navigator: modernNavigator(fakeManager(0.87)) });
  assert.deepEqual(Object.keys(storage).sort(), [
    KEYS.PHONE_BATTERY_LEVEL, KEYS.PHONE_BATTERY_SHOWN, KEYS.PHONE_BATTERY_SUPPORTED
  ].sort());
  assert.deepEqual(JSON.parse(storage[KEYS.PHONE_BATTERY_SHOWN]), { level: 87 });
});

// --- No charging state -------------------------------------------------------

test('a chargingchange is not listened to: it sends nothing, whatever the manager says', () => {
  // The slot used to follow the phone being plugged in; neither source serves it now, so
  // a manager's chargingchange (and its `charging` flag) is nobody's business.
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.charging = true;
  mgr.fire('chargingchange');
  mgr.fire('levelchange');
  assert.equal(h.sends.length, 0, 'no bucket move: nothing to say');
  mgr.charging = false;
  mgr.fire('chargingchange');
  assert.equal(h.sends.length, 0, 'unplugging is silent too');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62 }, 'and the reading has no such field');
});

test('a bucket move sends and carries the exact reading, with no charging field', () => {
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.57);   // 60 -> 55
  assert.equal(h.sends.length, 1, 'the bucket moved');
  assert.deepEqual(phoneBattery.bakeFacts().reading(), { available: true, level: 57 });
});

// --- The Night battery saver ----------------------------------------------
// Inside the window nothing is sent, however far the charge moves. Waking the BLE link for a battery readout is exactly what the setting
// exists to prevent, and the user opted in.

test('the saver window suppresses a level update but still caches it', () => {
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });

  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 0, 'no BLE wake-up for a battery readout overnight');
  assert.equal(phoneBattery.read().level, 42, 'but the cache tracks the truth');
});

test('the saver window suppresses every further bucket move too', () => {
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });

  mgr.setLevel(0.55);
  mgr.setLevel(0.49);
  mgr.setLevel(0.44);
  assert.equal(h.sends.length, 0, 'three bucket moves at 03:00 wait for the window to close');
  assert.equal(phoneBattery.read().level, 44, 'still cached, for the morning push');
});

test('the saver is off unless the user enabled it', () => {
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr), settings: { sleepNightEnabled: false },
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 1, '03:00 with the saver off is an ordinary minute');
});

test('the first tick after the window closes pushes exactly once', () => {
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.42);
  mgr.setLevel(0.37);
  assert.equal(h.sends.length, 0);

  h.clock = new Date(2026, 0, 1, 7, 0, 0);  // window is [0, 7)
  phoneBattery.onTick();
  assert.equal(h.sends.length, 1, 'one push carries the whole morning correction');

  phoneBattery.onTick();
  phoneBattery.onTick();
  assert.equal(h.sends.length, 1, 'the debt is paid off, not re-pushed every minute');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 37 });
  assert.equal(phoneBattery.bakeFacts().reading().level, 37, 'and it carries the latest reading');
});

test('the post-window push waits out a fetch in flight, whose message carries the battery', () => {
  const mgr = fakeManager(0.62);
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
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr), settings: SAVER_ON,
                   clock: new Date(2026, 0, 1, 3, 0, 0) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.42);
  h.clock = new Date(2026, 0, 1, 6, 59, 0);
  phoneBattery.onTick();
  assert.equal(h.sends.length, 0, 'still inside [0, 7)');
});

test('a tick owing nothing sends nothing', () => {
  const mgr = fakeManager(0.62);
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
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr) });
  assert.doesNotThrow(() => mgr.setLevel(0.42));
  assert.doesNotThrow(() => phoneBattery.onTick());
  assert.equal(h.sends.length, 0, 'no send without bake inputs');
  assert.equal(phoneBattery.read().level, 42, 'the cache is still kept up to date');
});

test('rememberBakeInputs(null) is ignored rather than clobbering the snapshot', () => {
  const mgr = fakeManager(0.62);
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

test('a send into the 30 bucket at 31% carries 31%, not the 30 bucket', () => {
  const mgr = fakeManager(0.36);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                   settings: { temperatureUnits: 'c', axisTimeFormat: '24h',
                               statusForecastLeft: 'phoneBattery' } });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] }, { platform: 'basalt' });
  assert.equal(phoneBattery.levelBucket(0.31), 30, 'the trigger still buckets to 30...');

  mgr.setLevel(0.31);  // the 35 bucket -> the 30 bucket
  assert.equal(h.sends.length, 1, 'a bucket move still sends immediately');
  assert.deepEqual(decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[0],
    { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY, text: '31%' },
    '...but the watch shows the phone\'s real 31%, with the one battery icon');
});

test('a 31% -> 30% drop inside one bucket does not send, and the next trigger shows its own exact reading', () => {
  // Both halves of the split in one test: the trigger is untouched (no send for
  // a move within the 30 bucket), while the cached value follows the phone
  // exactly, so whatever carries the battery next (here the next bucket move, in
  // the field as often a weather message going out anyway: the ride-along)
  // carries the truth.
  const mgr = fakeManager(0.31);
  const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                   settings: { temperatureUnits: 'c', axisTimeFormat: '24h',
                               statusForecastLeft: 'phoneBattery' } });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] }, { platform: 'basalt' });

  mgr.setLevel(0.30);
  assert.equal(h.sends.length, 0, '31 -> 30 stays in the 30 bucket: no BLE wake-up');
  assert.equal(phoneBattery.read().level, 30, 'but the cache moved');

  mgr.setLevel(0.29);  // 30 -> 25 bucket
  assert.equal(decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[0].text, '29%');
});

test('a stale cached reading does not survive a boot on an unsupported phone', () => {
  // The user was on Android, then switched to an iPhone. Anything left in the
  // store from the Android days must not be re-served as a live reading: the
  // slot has to fall back to '--' (and the dropdown item to disappear) rather
  // than showing the last percentage the old phone ever reported.
  clearStorage();
  storage[KEYS.PHONE_BATTERY_SUPPORTED] = 'true';
  storage[KEYS.PHONE_BATTERY_LEVEL] = '85';
  storage.phoneBatteryCharging = 'true';
  const sends = [];
  phoneBattery.init({
    navigator: null,
    getSettings: function () { return {}; },
    now: function () { return new Date(2026, 0, 1, 12, 0, 0); },
    sendWeather: function (p) { sends.push(p); }
  });
  assert.equal(phoneBattery.isSupported(), false, 'the detector verdict is re-taken on every boot');
  assert.deepEqual(phoneBattery.read(), { available: false, level: null });
  assert.equal(sends.length, 0);
});

// --- The reading a weather message bakes -------------------------------------
// A fetch's bake reads the SHOWN reading: the one the watch was last sent. It moves only at a
// trigger (a bucket move), at the first reading of a PKJS life that lands in
// another bucket than it, and when a weather message that goes out anyway takes the exact
// reading along (statusRideAlong, the outbox's ride-along). So the charge drifting inside its
// bucket never changes the status by itself, and costs no wake-up.

test('a fetch bakes the reading the watch was last sent: drift inside a bucket leaves it', () => {
  const mgr = fakeManager(0.62);
  boot({ navigator: modernNavigator(mgr) });
  assert.equal(phoneBattery.bakeFacts().reading().level, 62, 'the first reading is the shown one');
  mgr.setLevel(0.61);
  assert.equal(phoneBattery.read().level, 61, 'the cache follows the phone');
  assert.equal(phoneBattery.bakeFacts().reading().level, 62, 'a bake still reads what the watch shows');
});

test('a trigger shows the exact reading of its moment', () => {
  const mgr = fakeManager(0.62);
  const h = boot({ navigator: modernNavigator(mgr) });
  statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' });
  mgr.setLevel(0.61);
  mgr.setLevel(0.59);   // 60 -> 55: a bucket move
  assert.equal(h.sends.length, 1);
  assert.equal(phoneBattery.bakeFacts().reading().level, 59);
  mgr.setLevel(0.54);   // 55 -> 50: the next one
  assert.equal(h.sends.length, 2);
  assert.deepEqual(phoneBattery.bakeFacts().reading(), { available: true, level: 54 });
});

test('the ride-along brings the exact reading once it differs, and the watch shows it from then', () => {
  const mgr = fakeManager(0.62);
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
  const mgr = fakeManager(0.62);
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
  boot({ navigator: modernNavigator(fakeManager(0.62)) });
  boot({ navigator: modernNavigator(fakeManager(0.61)), keepStorage: true });
  assert.equal(phoneBattery.bakeFacts().reading().level, 62, 'the watch still shows 62%: a bake keeps it');
  boot({ navigator: modernNavigator(fakeManager(0.58)), keepStorage: true });
  assert.equal(phoneBattery.bakeFacts().reading().level, 58, 'another bucket: the next message carries 58%');
});

test('a shown reading stored by a build that also kept the charging flag still reads, as a level', () => {
  boot({ navigator: modernNavigator(fakeManager(0.62)) });
  storage[KEYS.PHONE_BATTERY_SHOWN] = JSON.stringify({ level: 62, charging: true });
  assert.deepEqual(phoneBattery.bakeFacts().reading(), { available: true, level: 62 },
    'the old flag is not carried');
});

// --- The Pebble app's Phone plugin: the first source -------------------------
// Where the Pebble app has plugins (Pebble.subscribeToSource), the phone's charge is read
// from its built-in Phone plugin: a percentage (0..100) pushed on change, on Android and
// iOS alike. The WebView's battery API is the fallback, for a Pebble app without plugins
// or a plugin that does not answer. One source at a time.

/** A WebView with a battery API that counts how often it was asked and listened to. */
function spyWebView(level) {
  const mgr = fakeManager(level);
  const spy = { mgr: mgr, asked: 0, listened: 0 };
  const add = mgr.addEventListener;
  mgr.addEventListener = function (type, fn) { spy.listened++; add.call(mgr, type, fn); };
  spy.navigator = { getBattery() { spy.asked++; return { then(onOk) { onOk(mgr); } }; } };
  return spy;
}

/** A navigator as iOS's JavaScriptCore builds it: no battery API. */
const IOS_NAVIGATOR = { userAgent: 'PKJS', geolocation: {}, language: 'de' };

/** Boot against a Phone plugin with fake timers; the bake snapshot is remembered. */
function bootPlugin(opts) {
  opts = opts || {};
  const plugin = fakePluginPebble(opts.pluginOpts);
  const timers = fakeTimers();
  const h = boot(Object.assign({ pebble: plugin.pebble, navigator: IOS_NAVIGATOR,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }, opts.boot || {}));
  if (!opts.noSnapshot) { statusRebake.rememberBakeInputs({ CITY: 'Bonn' }, { platform: 'basalt' }); }
  return { h: h, plugin: plugin, timers: timers };
}

test('the storage keys: the verdict has a key of its own, the old two are retired', () => {
  assert.equal(KEYS.PHONE_BATTERY_SUPPORTED, 'phoneBatteryReadable');
  assert.deepEqual(KEYS.PHONE_BATTERY_RETIRED_KEYS, ['phoneBatterySupported', 'phoneBatteryCharging']);
  assert.equal(KEYS.PHONE_BATTERY_CHARGING, undefined, 'the charging key is gone');
});

test('with a plugin-capable Pebble: supported at once, subscribed to the Phone plugin, timer armed', () => {
  const { plugin, timers } = bootPlugin();
  assert.equal(phoneBattery.isSupported(), true, 'the verdict does not wait for the first answer');
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true');
  assert.equal(plugin.requests.length, 1);
  assert.equal(plugin.requests[0].category, 'phone');
  assert.equal(plugin.requests[0].item, 'phone_state');
  assert.deepEqual(plugin.requests[0].properties, ['battery_level']);
  assert.equal(timers.live().length, 1, 'one wait for the first answer');
  assert.equal(timers.live()[0].ms, 10000, 'ten seconds');
  assert.deepEqual(phoneBattery.read(), { available: false, level: null }, 'no reading before an answer');
});

test('the wait for the first answer uses the host timers when none are injected', () => {
  const plugin = fakePluginPebble();
  boot({ pebble: plugin.pebble, navigator: IOS_NAVIGATOR });
  assert.equal(phoneBattery.isSupported(), true);
  // A real (unref'd) timer is pending; re-init clears it through the host's clearTimeout.
  assert.doesNotThrow(() => boot({ pebble: plugin.pebble, navigator: IOS_NAVIGATOR }));
  assert.equal(plugin.unsubscribed, 1, 're-init ended the first subscription');
});

test('the first answer is the seed: cached and shown, never a send', () => {
  const { h, plugin, timers } = bootPlugin();
  plugin.push(pluginEnvelope(84));
  assert.deepEqual(phoneBattery.read(), { available: true, level: 84 }, 'the exact percentage');
  assert.equal(storage[KEYS.PHONE_BATTERY_LEVEL], '84');
  assert.equal(h.sends.length, 0, 'a seed baselines, even with a bake snapshot in hand');
  assert.equal(phoneBattery.bakeFacts().reading().level, 84, 'and it is the shown reading');
  assert.equal(timers.live().length, 0, 'the wait for the first answer is over');
  assert.equal(plugin.unsubscribed, 0, 'the subscription stays');
});

test('a later answer in another 5-point bucket sends, and carries the exact reading', () => {
  const { h, plugin } = bootPlugin();
  plugin.push(pluginEnvelope(84));      // the seed, bucket 80
  plugin.push(pluginEnvelope(83));
  plugin.push(pluginEnvelope(81));
  assert.equal(h.sends.length, 0, 'inside the 80 bucket nothing is sent');
  assert.equal(phoneBattery.read().level, 81, 'but the cache follows');
  assert.equal(phoneBattery.bakeFacts().reading().level, 84, 'the watch still shows what it was sent');
  plugin.push(pluginEnvelope(79));      // bucket 75
  assert.equal(h.sends.length, 1, 'the bucket moved');
  assert.equal(phoneBattery.bakeFacts().reading().level, 79, 'and the send carries 79, not 75');
});

test('readings in steps of 5 (iOS) trigger on every bucket move and cache the exact value', () => {
  const { h, plugin } = bootPlugin();
  plugin.push(pluginEnvelope(85));
  [[85, 0], [80, 1], [80, 1], [75, 2], [70, 3], [75, 4], [100, 5], [0, 6]].forEach(([pct, sends]) => {
    plugin.push(pluginEnvelope(pct));
    assert.equal(phoneBattery.read().level, pct, 'cached exactly at ' + pct);
    assert.equal(h.sends.length, sends, 'sends after ' + pct);
  });
});

test('a percentage outside 0..100 is clamped, as the WebView\'s level is', () => {
  const { plugin } = bootPlugin();
  plugin.push(pluginEnvelope(130));
  assert.equal(phoneBattery.read().level, 100);
  plugin.push(pluginEnvelope(-4));
  assert.equal(phoneBattery.read().level, 0);
});

test('an update without battery_level is ignored: before the first answer and after it', () => {
  const { h, plugin, timers } = bootPlugin();
  const networkOnly = { instances: [{ properties: { network_type: { stringValue: { value: 'wifi' } } } }] };
  plugin.push(networkOnly);
  plugin.push({});
  plugin.push({ instances: [] });
  assert.equal(phoneBattery.read().available, false, 'still no reading');
  assert.equal(timers.live().length, 1, 'and still waiting for the first answer');
  plugin.push(pluginEnvelope(60));
  plugin.push(networkOnly);
  assert.equal(phoneBattery.read().level, 60, 'the reading stays');
  assert.equal(h.sends.length, 0);
});

test('the plugin\'s updates honour the Night battery saver, and the tick pays the debt', () => {
  const { h, plugin } = bootPlugin({ boot: { settings: SAVER_ON, clock: new Date(2026, 0, 1, 3, 0, 0) } });
  plugin.push(pluginEnvelope(62));
  plugin.push(pluginEnvelope(40));
  assert.equal(h.sends.length, 0, 'no wake-up overnight');
  assert.equal(phoneBattery.read().level, 40);
  h.clock = new Date(2026, 0, 1, 7, 0, 0);
  phoneBattery.onTick();
  assert.equal(h.sends.length, 1, 'one morning push');
  assert.equal(phoneBattery.bakeFacts().reading().level, 40);
});

test('an answer that comes before subscribeToSource returns still seeds, with no timer left armed', () => {
  const { h, plugin, timers } = bootPlugin({ pluginOpts: { sync: (r) => r.onData(pluginEnvelope(71)) } });
  assert.deepEqual(phoneBattery.read(), { available: true, level: 71 });
  assert.equal(timers.armed.length, 0, 'nothing to wait for');
  assert.equal(plugin.unsubscribed, 0, 'and the subscription is kept');
  assert.equal(h.sends.length, 0);
  plugin.push(pluginEnvelope(64));
  assert.equal(h.sends.length, 1, 'it is live: the next bucket move sends');
});

// --- Failures before any answer ----------------------------------------------

['PLUGIN_UNAVAILABLE', 'PERMISSION_DENIED', 'INVALID_REQUEST'].forEach((code) => {
  test(code + ' before an answer hands over to the WebView at once', () => {
    const web = spyWebView(0.62);
    const { h, plugin, timers } = bootPlugin({ boot: { navigator: web.navigator } });
    plugin.fail(code);
    assert.equal(web.asked, 1, 'the WebView\'s battery API was asked');
    assert.equal(plugin.unsubscribed, 1, 'the plugin subscription is ended');
    assert.equal(timers.live().length, 0, 'and its timer cleared');
    assert.deepEqual(phoneBattery.read(), { available: true, level: 62 }, 'the reading is the WebView\'s');
    assert.equal(phoneBattery.isSupported(), true);
    web.mgr.setLevel(0.57);
    assert.equal(h.sends.length, 1, 'and the WebView\'s events trigger as before');
  });

  test(code + ' before an answer, with no WebView API either: the verdict becomes false', () => {
    const { plugin, timers } = bootPlugin({ boot: { navigator: IOS_NAVIGATOR } });
    assert.equal(phoneBattery.isSupported(), true, 'true while the plugin is asked');
    plugin.fail(code);
    assert.equal(phoneBattery.isSupported(), false);
    assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'false');
    assert.equal(plugin.unsubscribed, 1);
    assert.equal(timers.live().length, 0);
    assert.equal(phoneBattery.read().available, false);
  });
});

test('another failure code before an answer hands over only where the WebView has a battery API', () => {
  ['TIMEOUT', 'UNKNOWN', 'SOMETHING_NEW'].forEach((code) => {
    const web = spyWebView(0.62);
    const a = bootPlugin({ boot: { navigator: web.navigator } });
    a.plugin.fail(code);
    assert.equal(web.asked, 1, code + ': the WebView takes over');
    assert.equal(a.plugin.unsubscribed, 1);
    assert.equal(phoneBattery.read().level, 62);

    const b = bootPlugin({ boot: { navigator: IOS_NAVIGATOR } });
    b.plugin.fail(code);
    assert.equal(phoneBattery.isSupported(), true, code + ': no WebView API, the verdict stays true');
    assert.equal(b.plugin.unsubscribed, 0, 'the plugin subscription stays');
    assert.equal(b.timers.live().length, 1, 'and so does the wait');
    b.plugin.push(pluginEnvelope(55));
    assert.equal(phoneBattery.read().level, 55, 'a later answer is served as the plugin\'s');
  });
});

test('a failure reported inside subscribeToSource hands over, and the subscription that comes back is ended', () => {
  const web = spyWebView(0.62);
  const { plugin, timers } = bootPlugin({ boot: { navigator: web.navigator },
    pluginOpts: { sync: (r) => r.onError({ code: 'PLUGIN_UNAVAILABLE' }) } });
  assert.equal(web.asked, 1);
  assert.equal(plugin.unsubscribed, 1, 'the late handle is unsubscribed');
  assert.equal(timers.armed.length, 0, 'no timer armed for a plugin that already failed');
  assert.equal(phoneBattery.read().level, 62);
});

test('a throwing subscribeToSource is a failure: the WebView takes over, or the phone waits', () => {
  const web = spyWebView(0.62);
  const throwing = { subscribeToSource() { throw new Error('boom'); } };
  boot({ pebble: throwing, navigator: web.navigator, setTimeout: fakeTimers().setTimeout });
  assert.equal(web.asked, 1);
  assert.equal(phoneBattery.read().level, 62);

  boot({ pebble: throwing, navigator: IOS_NAVIGATOR, setTimeout: fakeTimers().setTimeout });
  assert.equal(phoneBattery.isSupported(), true, 'no WebView API: the verdict stays');
  assert.equal(phoneBattery.read().available, false);
});

// --- Failures after an answer ------------------------------------------------

test('a failure after an answer keeps the reading and the subscription', () => {
  const web = spyWebView(0.10);
  const { h, plugin } = bootPlugin({ boot: { navigator: web.navigator } });
  plugin.push(pluginEnvelope(84));
  ['PLUGIN_UNAVAILABLE', 'PERMISSION_DENIED', 'INVALID_REQUEST', 'TIMEOUT'].forEach((code) => plugin.fail(code));
  assert.equal(phoneBattery.read().level, 84, 'the reading stays');
  assert.equal(plugin.unsubscribed, 0, 'the subscription stays');
  assert.equal(web.asked, 0, 'and the WebView is not asked');
  assert.equal(phoneBattery.isSupported(), true);
  plugin.push(pluginEnvelope(79));
  assert.equal(h.sends.length, 1, 'the next answer is served');
});

// --- Silence -----------------------------------------------------------------

test('silence: the WebView takes over when it has a battery API, and the plugin is unsubscribed', () => {
  const web = spyWebView(0.62);
  const { h, plugin, timers } = bootPlugin({ boot: { navigator: web.navigator } });
  assert.equal(web.asked, 0, 'not asked while the plugin may still answer');
  timers.fire();
  assert.equal(web.asked, 1);
  assert.equal(plugin.unsubscribed, 1);
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62 });
  web.mgr.setLevel(0.57);
  assert.equal(h.sends.length, 1, 'the WebView source is live');
});

test('silence with no WebView API (iOS): nothing changes, the verdict stays, a late answer works', () => {
  const { h, plugin, timers } = bootPlugin({ boot: { navigator: IOS_NAVIGATOR } });
  timers.fire();
  assert.equal(phoneBattery.isSupported(), true);
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true');
  assert.equal(plugin.unsubscribed, 0, 'still subscribed');
  assert.equal(phoneBattery.read().available, false);
  plugin.push(pluginEnvelope(66));
  assert.deepEqual(phoneBattery.read(), { available: true, level: 66 }, 'the late answer is the seed');
  assert.equal(h.sends.length, 0);
  plugin.push(pluginEnvelope(61));
  assert.equal(h.sends.length, 1, 'and it goes on as the plugin source');
});

test('a timer that fires after the answer changes nothing', () => {
  const web = spyWebView(0.10);
  const { plugin, timers } = bootPlugin({ boot: { navigator: web.navigator } });
  plugin.push(pluginEnvelope(84));
  timers.fireCleared();
  assert.equal(web.asked, 0, 'the WebView is not taken over to');
  assert.equal(plugin.unsubscribed, 0);
  assert.equal(phoneBattery.read().level, 84);
});

test('once the WebView has taken over, a late plugin answer is ignored', () => {
  const web = spyWebView(0.62);
  const { h, plugin, timers } = bootPlugin({ boot: { navigator: web.navigator } });
  timers.fire();                       // silence: the WebView's reading is the source
  plugin.push(pluginEnvelope(10));     // the plugin answers after all (a host that kept delivering)
  plugin.push(pluginEnvelope(5));
  assert.equal(phoneBattery.read().level, 62, 'one source at a time');
  assert.equal(h.sends.length, 0, 'and the late answers trigger nothing');
  web.mgr.setLevel(0.57);
  assert.equal(h.sends.length, 1);
  assert.equal(phoneBattery.read().level, 57);
});

test('a late plugin answer after a failure handover is ignored too', () => {
  const web = spyWebView(0.62);
  const { plugin } = bootPlugin({ boot: { navigator: web.navigator } });
  plugin.fail('PERMISSION_DENIED');
  plugin.push(pluginEnvelope(10));
  assert.equal(phoneBattery.read().level, 62);
});

// --- Both sources present, iOS, and the heal ---------------------------------

test('with both a plugin and a WebView API the plugin wins and the WebView is never subscribed', () => {
  const web = spyWebView(0.30);
  const { plugin } = bootPlugin({ boot: { navigator: web.navigator } });
  plugin.push(pluginEnvelope(84));
  assert.equal(phoneBattery.read().level, 84, 'the plugin\'s charge, not the WebView\'s 30');
  assert.equal(web.asked, 0, 'getBattery() was never called');
  assert.equal(web.listened, 0, 'and nothing listens to the manager');
  web.mgr.setLevel(0.10);
  assert.equal(phoneBattery.read().level, 84, 'a WebView event is nobody\'s business');

  const legacy = fakeManager(0.30);
  let legacyListened = 0;
  const add = legacy.addEventListener;
  legacy.addEventListener = function (t, f) { legacyListened++; add.call(legacy, t, f); };
  const b = bootPlugin({ boot: { navigator: legacyNavigator(legacy) } });
  b.plugin.push(pluginEnvelope(84));
  assert.equal(legacyListened, 0, 'the legacy object is not subscribed to either');
});

test('an iOS-like host (plugin only, no battery API in the navigator) gets a reading', () => {
  const { h, plugin } = bootPlugin({ boot: { navigator: IOS_NAVIGATOR } });
  assert.equal(phoneBattery.isSupported(), true);
  assert.equal(phoneBattery.bakeFacts().supported, true);
  plugin.push(pluginEnvelope(85));
  assert.deepEqual(phoneBattery.read(), { available: true, level: 85 });
  assert.equal(h.sends.length, 0);
});

test('an iOS-like host with no navigator at all works the same', () => {
  const { plugin } = bootPlugin({ boot: { navigator: null } });
  plugin.push(pluginEnvelope(40));
  assert.equal(phoneBattery.isSupported(), true);
  assert.equal(phoneBattery.read().level, 40);
});

test('"Reset watchface" self-heals from the plugin source: the next read re-seeds, no send', () => {
  const { h, plugin } = bootPlugin({ boot: { navigator: IOS_NAVIGATOR } });
  plugin.push(pluginEnvelope(84));
  clearStorage();
  assert.deepEqual(phoneBattery.read(), { available: true, level: 84 }, 'the post-reset bake shows the charge');
  assert.equal(storage[KEYS.PHONE_BATTERY_LEVEL], '84', 'the cache is rewritten');
  assert.equal(h.sends.length, 0, 'healing is a seed, never a send');
  plugin.push(pluginEnvelope(79));
  assert.equal(h.sends.length, 1, 'the first real answer after the heal is news');
});

test('after a wipe, the verdict re-probes true on a plugin-capable host, with or without a WebView API', () => {
  bootPlugin({ boot: { navigator: IOS_NAVIGATOR } });
  clearStorage();
  assert.equal(phoneBattery.isSupported(), true, 'the plugin alone is a source');
  assert.equal(storage[KEYS.PHONE_BATTERY_SUPPORTED], 'true', 're-persisted');
});

test('with no stored verdict, isSupported probes plugin OR WebView API', () => {
  const probe = (opts) => {
    boot(opts);
    clearStorage();
    return phoneBattery.isSupported();
  };
  assert.equal(probe({ pebble: fakePluginPebble().pebble, navigator: IOS_NAVIGATOR }), true, 'plugin only');
  assert.equal(probe({ pebble: undefined, navigator: modernNavigator(fakeManager(0.5)) }), true, 'WebView only');
  assert.equal(probe({ pebble: {}, navigator: IOS_NAVIGATOR }), false, 'a Pebble without plugins, no WebView API');
  assert.equal(probe({ pebble: null, navigator: null }), false, 'neither');
});

test('a stored false verdict stays a verdict on a plugin-capable host', () => {
  bootPlugin({ boot: { navigator: IOS_NAVIGATOR } });
  storage[KEYS.PHONE_BATTERY_SUPPORTED] = 'false';
  assert.equal(phoneBattery.isSupported(), false, 'never re-probed');
});

test('the dev-config fake skips the plugin altogether', () => {
  const plugin = fakePluginPebble();
  boot({ pebble: plugin.pebble, navigator: null, setTimeout: fakeTimers().setTimeout,
         devConfig: { devPhoneBattery: { level: 62 } } });
  assert.equal(plugin.requests.length, 0, 'nothing was subscribed to');
  assert.deepEqual(phoneBattery.read(), { available: true, level: 62 });
});

// --- What an older build left behind -----------------------------------------

test('the retired keys are dropped at init and do not make isSupported false on a plugin host', () => {
  clearStorage();
  storage.phoneBatterySupported = 'false';   // the verdict of a build from before the plugin
  storage.phoneBatteryCharging = 'true';
  const { plugin } = bootPlugin({ boot: { keepStorage: true, navigator: IOS_NAVIGATOR } });
  assert.equal('phoneBatterySupported' in storage, false, 'the old verdict is gone');
  assert.equal('phoneBatteryCharging' in storage, false, 'the charging flag is gone');
  assert.equal(phoneBattery.isSupported(), true, 'this phone judges again, and the plugin is a source');
  plugin.push(pluginEnvelope(70));
  assert.equal(phoneBattery.read().level, 70);
});

test('the retired keys are dropped on a host with no source too, and the old verdict does not survive', () => {
  clearStorage();
  storage.phoneBatterySupported = 'true';
  storage.phoneBatteryCharging = 'false';
  boot({ navigator: IOS_NAVIGATOR, keepStorage: true });
  assert.equal('phoneBatterySupported' in storage, false);
  assert.equal('phoneBatteryCharging' in storage, false);
  assert.equal(phoneBattery.isSupported(), false, 'the verdict is taken afresh');
});

// --- Re-init -----------------------------------------------------------------

test('re-init unsubscribes the previous subscription and clears its timer', () => {
  const first = bootPlugin();
  assert.equal(first.timers.live().length, 1);
  const second = bootPlugin();
  assert.equal(first.plugin.unsubscribed, 1, 'the previous life\'s subscription is ended');
  assert.equal(first.timers.live().length, 0, 'and its wait cleared, with its own timers');
  assert.equal(second.plugin.unsubscribed, 0, 'the new life\'s is live');
  assert.equal(second.plugin.requests.length, 1);
});

test('re-init after an answer unsubscribes too, and starts again with no reading', () => {
  const first = bootPlugin();
  first.plugin.push(pluginEnvelope(84));
  const second = bootPlugin();
  assert.equal(first.plugin.unsubscribed, 1);
  assert.deepEqual(phoneBattery.read(), { available: false, level: null }, 'a new life asks again');
  second.plugin.push(pluginEnvelope(40));
  assert.equal(phoneBattery.read().level, 40);
  assert.equal(second.h.sends.length, 0, 'and its first answer is a seed again');
});

test('re-init from a plugin host to a WebView-only one leaves no plugin behind', () => {
  const first = bootPlugin();
  const web = spyWebView(0.62);
  boot({ navigator: web.navigator });
  assert.equal(first.plugin.unsubscribed, 1);
  assert.equal(phoneBattery.read().level, 62, 'the WebView is the source there');
});
