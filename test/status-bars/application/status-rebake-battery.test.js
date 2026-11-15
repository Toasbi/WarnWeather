'use strict';
// The phone battery's re-bake (status-rebake.js): the micro-send a battery trigger
// pushes, and the bake snapshot that outlives a PKJS restart. The triggers themselves are
// phone-battery.test.js'. phone-battery-host.js mocks localStorage before it loads the
// watch modules.
const {
  storage, clearStorage, boot, decodeLine, fakeManager, modernNavigator, phoneBattery, statusRebake, KEYS, catalog, SLOT_SETTINGS, bakePayload
} = require('../../helpers/phone-battery-host.js');
const test = require('node:test');
const assert = require('node:assert/strict');

// The module logs a line per reading; keep the runner's output about assertions.
const realLog = console.log;
test.before(() => { console.log = function () {}; });
test.after(() => { console.log = realLog; });

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
  const outbox = require('../../../src/pkjs/wire/adapter/outbox.js');
  assert.deepEqual(statusRebake.STATUS_KEYS,
    outbox.WEATHER_CATEGORIES.find((c) => c.name === 'status').keys);
  assert.ok(statusRebake.STATUS_KEYS.indexOf('STATUS_LEVELS_UINT8') !== -1);
  assert.ok(statusRebake.STATUS_KEYS.indexOf('ALERT_ENTRIES_UINT8') !== -1,
    'the weather alerts\' entries re-bake with the lines');
});

// Bars 4 to 6's lines (Pebble Time 2) ride only once made: a basalt bake writes the six
// other status keys.
const EXTRA_LINE_KEYS = ['STATUS_LINE_5_UINT8', 'STATUS_LINE_6_UINT8', 'STATUS_LINE_7_UINT8'];
const SIX_STATUS_KEYS = statusRebake.STATUS_KEYS.filter((k) => EXTRA_LINE_KEYS.indexOf(k) === -1);

test('the micro-send carries the six status keys and nothing else', () => {
  const mgr = fakeManager(0.62, false);
  const h = boot({ navigator: modernNavigator(mgr), settings: { temperatureUnits: 'c' } });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, TEMP_TREND_UINT8: [1, 2, 3], NUM_ENTRIES: 3,
      FORECAST_START: 1700000000, SUN_EVENTS: [1, 0, 0, 0, 0] },
    { platform: 'basalt' });

  mgr.setLevel(0.42);
  assert.equal(h.sends.length, 1);
  const sent = h.sends[0];
  assert.deepEqual(Object.keys(sent).sort(), SIX_STATUS_KEYS.slice().sort(),
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
  const settings = { temperatureUnits: 'c', axisTimeFormat: '24h',
                     statusForecastLeft: 'phoneBattery' };
  const h = boot({ navigator: modernNavigator(mgr), realBake: true, settings: settings });
  const payload = { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0],
                    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64] };
  statusRebake.rememberBakeInputs(payload, { platform: 'basalt' });
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
  // healthMode 'status' puts the Health bar on a screen, so the bake writes all four lines.
  const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                   settings: { temperatureUnits: 'c', axisTimeFormat: '24h', healthMode: 'status',
                               statusForecastLeft: 'phoneBattery' } });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] }, { platform: 'basalt' });

  mgr.setLevel(0.42);
  assert.deepEqual(Object.keys(h.sends[0]).sort(), SIX_STATUS_KEYS.slice().sort());
  let slot = decodeLine(h.sends[0].STATUS_LINE_1_UINT8)[0];
  assert.deepEqual(slot, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY, text: '42%' },
    'the send was triggered by the 40 bucket, but it carries 42%');

  // Charging swaps the icon id at bake time — no wire field, no watch logic.
  mgr.setCharging(true);
  assert.equal(h.sends.length, 2);
  slot = decodeLine(h.sends[1].STATUS_LINE_1_UINT8)[0];
  assert.deepEqual(slot, { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY_CHG, text: '42%' });
});

test('on a Pebble Time 2 the re-bake carries the line of a bar 4 to 6 a screen shows', () => {
  const mgr = fakeManager(0.62, false);
  // One screen: bar 4 above the Forecast bar. Bar 5 is made but on no screen.
  const h = boot({ navigator: modernNavigator(mgr), realBake: true,
                   settings: { temperatureUnits: 'c', axisTimeFormat: '24h',
                               layoutPreset: 'custom', viewCount: '1', viewTop0: 'none',
                               viewBody0: 'forecast', viewUpper0: 'bar4', viewLower0: 'weather',
                               statusBar4Made: true, statusBar4Left: 'phoneBattery',
                               statusBar5Made: true, statusBar5Left: 'phoneBattery' } });
  statusRebake.rememberBakeInputs(
    { CITY: 'Bonn', CURRENT_TEMP: 68, SUN_EVENTS: [1, 0, 0, 0, 0] }, { platform: 'emery' });

  mgr.setLevel(0.42);
  assert.deepEqual(Object.keys(h.sends[0]).sort(),
    ['STATUS_LINE_1_UINT8', 'STATUS_LINE_3_UINT8', 'STATUS_LINE_5_UINT8',
     'STATUS_LEVELS_UINT8', 'ALERT_ENTRIES_UINT8'].sort(),
    'the Forecast bar and bar 4 are on the screen and the Watch bar is always sent; '
    + 'bar 5 is on no screen, bar 6 is not made, and no screen shows the Radar or Health bar');
  assert.deepEqual(decodeLine(h.sends[0].STATUS_LINE_5_UINT8)[0],
    { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY, text: '42%' },
    'bar 4 carries the live reading');
});

// --- Surviving a PKJS restart ----------------------------------------------
// The reported bug: PKJS is torn down every time the user leaves the watchface,
// and the re-bake snapshot lived in memory only, so every charging event after a
// restart logged "no bake snapshot yet" and reached the watch not at all -- for
// up to a whole fetch interval (default 15 min, max 60), longer when fetches
// fail. The snapshot is now written to flash at every bake and restored in
// init(), before any battery event can fire.

test('a charging event after a PKJS restart still reaches the watch', () => {
  // The bug, end to end. Life one bakes; life two starts with an empty module
  // state and must re-bake from flash.
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });
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
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });
  mgr.setLevel(0.42);                       // a send from the LIVE snapshot
  const before = h.sends[h.sends.length - 1];

  const mgr2 = fakeManager(0.42, false);
  const h2 = boot({ navigator: modernNavigator(mgr2), realBake: true,
                    settings: SLOT_SETTINGS, keepStorage: true });
  mgr2.setCharging(true);                   // a send from the RESTORED snapshot
  const after = h2.sends[h2.sends.length - 1];

  ['STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8',
   'STATUS_LEVELS_UINT8', 'ALERT_ENTRIES_UINT8'].forEach((k) =>
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
  // (formatValue + directionSentinel) and status-wire.js (displayValue).
  boot({ navigator: modernNavigator(fakeManager(0.62, false)), settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });
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
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'aplite' });

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
  // Deliberate: settings are in neither snapshot. The live blob is what the next
  // fetch would bake with (the in-memory path pairs the same way, test below).
  const mgr = fakeManager(0.62, false);
  boot({ navigator: modernNavigator(mgr), realBake: true, settings: SLOT_SETTINGS });
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });

  const mgr2 = fakeManager(0.62, false);
  const h2 = boot({ navigator: modernNavigator(mgr2), realBake: true, keepStorage: true,
                    settings: { temperatureUnits: 'f', axisTimeFormat: '24h',
                                statusForecastLeft: 'temp' } });
  mgr2.setCharging(true);
  const slots = decodeLine(h2.sends[h2.sends.length - 1].STATUS_LINE_1_UINT8);
  assert.equal(slots[0].text, '68', 'the left slot follows the settings in force NOW');
});

test('after a save, a micro-send from the in-memory snapshot bakes the NEW settings', () => {
  // The in-memory snapshot used to keep the settings object of its own bake. A
  // save replaces the settings object (index.js reads a fresh one), and when the
  // forced fetch that save starts fails, the next battery event re-baked the
  // pre-save alerts: a UV alert the user had just switched off came back.
  const mgr = fakeManager(0.62, false);
  // UV placed with the Icon Look: its entry is the one header byte.
  const before = Object.assign({}, SLOT_SETTINGS,
    require('../../helpers/on-demand.js').placedOnly(['uv'], { alertUvDisplay: 'icon' }));
  const h = boot({ navigator: modernNavigator(mgr), realBake: true, settings: before });
  const payload = bakePayload();
  payload.UV_TREND_UINT8 = [90];   // UV 9: danger on the seed pair
  statusRebake.rememberBakeInputs(payload, { platform: 'basalt' });
  mgr.setLevel(0.42);
  assert.equal(h.sends[0].ALERT_ENTRIES_UINT8.length, 1, 'the UV alert is on the watch');

  h.settings = Object.assign({}, before, { statusTopOnDemandRightItems: '' });   // the save; no fetch lands
  mgr.setCharging(true);
  assert.equal(h.sends.length, 2);
  assert.deepEqual(h.sends[1].ALERT_ENTRIES_UINT8, [], 'the switched-off alert stays off');
  assert.equal(decodeLine(h.sends[1].STATUS_LINE_1_UINT8)[0].icon, catalog.ICONS.PHONE_BATTERY_CHG,
    'and the battery slot still follows the phone');
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
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });

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
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });
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
  statusRebake.rememberBakeInputs(stale, { platform: 'basalt' });
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });
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
    clearStorage();
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
  clearStorage();
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
  statusRebake.rememberBakeInputs(bakePayload(), { platform: 'basalt' });

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
