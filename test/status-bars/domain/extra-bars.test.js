'use strict';
// test/status-bars/domain/extra-bars.test.js — bars 4 to 6 on the phone (Pebble Time 2, 3.0.0's New status bar): the
// screens compile a row naming one only while it is made on a watch that has them, the bake
// sends its line while a screen shows it, the Clay message its On demand cells, and the
// change detector signs its slots. The C side's half of each contract: test/status-bars/domain/extra-bars-contract.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

// holiday-mask -> nager-source and phone-battery.js touch localStorage: install the mock
// before any watch module loads (see change-detector.test.js for the pattern).
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
const OD = require('../../../src/pkjs/status-bars/domain/on-demand.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const statusLines = require('../../../src/pkjs/status-bars/domain/status-lines.js');
const statusWire = require('../../../src/pkjs/alerts/domain/status-wire.js');
const screens = require('../../../src/pkjs/layout/domain/screens.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const { buildClayPayload } = require('../../../src/pkjs/settings/domain/clay-payload.js');
const { renderSignature } = require('../../../src/pkjs/settings/domain/render-signature.js');
const forecastSeries = require('../../../src/pkjs/weather/domain/forecast-series.js');
const { NOTHING_PLACED, placeOn } = require('../../helpers/on-demand.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');

const EMERY = platform.computeEnv({ platform: 'emery' });
const BASALT = platform.computeEnv({ platform: 'basalt' });
const UNKNOWN = platform.computeEnv(null);
const NOW = new Date('2026-06-26T00:00:00Z');

/**
 * One custom screen with a bar 4 to 6 (or any row value) in its upper row.
 * @param {string} upper the row's value (viewUpper0)
 * @param {Object} [over] settings laid over it
 * @returns {Object} settings
 */
function oneScreen(upper, over) {
  return Object.assign({ layoutPreset: 'custom', viewCount: '1', viewTop0: 'none', viewBody0: 'forecast',
    viewUpper0: upper, viewLower0: 'weather' }, over || {});
}

test('the env fact: bars 4 to 6 on the Pebble Time 2 alone; an unknown watch has three bars', () => {
  assert.equal(EMERY.extraBars, true);
  ['aplite', 'basalt', 'diorite', 'flint'].forEach((p) =>
    assert.equal(platform.computeEnv({ platform: p }).extraBars, false, p));
  assert.equal(UNKNOWN.extraBars, false, 'fail closed');
});

test('a bar 4 to 6 exists once made, on a watch that has them; an omitted env is capable', () => {
  const S = { statusBar5Made: true };
  assert.deepEqual(VC.EXTRA_BARS.map((b) => VC.barMade(S, b.bar)), [false, true, false]);
  assert.equal(VC.barMade({ statusBar5Made: 'true' }, 'bar5'), false, 'only a stored true makes one');
  assert.equal(VC.barMade(S, 'top'), false, 'the four built-in bars are never "made"');
  assert.equal(VC.extraBarOn(S, 'bar5', EMERY), true);
  assert.equal(VC.extraBarOn(S, 'bar5', BASALT), false);
  assert.equal(VC.extraBarOn(S, 'bar5', UNKNOWN), false);
  assert.equal(VC.extraBarOn(S, 'bar5'), true, 'omitted env: capable');
  assert.equal(VC.extraBarOn(S, 'bar4', EMERY), false, 'not made');
});

test('a row naming a bar 4 to 6 packs as the first three plus the ext bit, and unpacks back', () => {
  VC.EXTRA_BARS.forEach((b, i) => {
    const s = VC.spec(0, 0, VC.BODY_FC, b.src, b.src);
    const wire = VC.packWire(s);
    const low = wire & 0xFFFF, ext = wire >>> 16;
    assert.equal((low >> 2) & 3, i + 1, b.bar + ': the upper row\'s 2-bit field');
    assert.equal(low & 3, i + 1, b.bar + ': the lower row\'s');
    assert.equal(ext & VC.EXT_UPPER_BAR_HI, VC.EXT_UPPER_BAR_HI, b.bar + ': upper ext bit');
    assert.equal(ext & VC.EXT_LOWER_BAR_HI, VC.EXT_LOWER_BAR_HI, b.bar + ': lower ext bit');
    const back = VC.unpackWire(wire);
    assert.equal(back.statusUpper, b.src);
    assert.equal(back.statusLower, b.src);
    assert.equal(wire >>> 31, 0, 'bit 31 stays clear');
  });
  // One row a bar 4 to 6, the other a built-in bar: only its own bit.
  const mixed = VC.packWire(VC.spec(0, 0, VC.BODY_FC, VC.STATUS_SRC_BAR6, VC.STATUS_SRC_RADAR)) >>> 16;
  assert.equal(mixed & VC.EXT_UPPER_BAR_HI, VC.EXT_UPPER_BAR_HI);
  assert.equal(mixed & VC.EXT_LOWER_BAR_HI, 0);
  // An off row with the bit set stays off, as the watch reads it (layout.c apply_ext).
  const stray = VC.packWire(VC.spec(0, 0, VC.BODY_FC, VC.STATUS_SRC_NONE, VC.STATUS_SRC_FORECAST))
    | (VC.EXT_UPPER_BAR_HI << 16);
  assert.equal(VC.unpackWire(stray).statusUpper, VC.STATUS_SRC_NONE);
  assert.equal(VC.unpackWire(stray).statusLower, VC.STATUS_SRC_FORECAST);
  // A view of the four built-in bars sets neither bit: every pre-3.0 word packs as before.
  [VC.STATUS_SRC_NONE, VC.STATUS_SRC_FORECAST, VC.STATUS_SRC_RADAR, VC.STATUS_SRC_HEALTH].forEach((src) =>
    assert.equal((VC.packWire(VC.spec(0, 0, VC.BODY_FC, src, src)) >>> 16) & (VC.EXT_UPPER_BAR_HI | VC.EXT_LOWER_BAR_HI), 0));
});

test('the compiler keeps a bar 4 to 6 row only while the bar is on the watch', () => {
  const made = oneScreen('bar4', { statusBar4Made: true });
  assert.equal(VC.resolveViewCycle(made, EMERY)[0].statusUpper, VC.STATUS_SRC_BAR4, 'made, on emery');
  assert.equal(VC.resolveViewCycle(made, BASALT)[0].statusUpper, VC.STATUS_SRC_NONE, 'basalt folds it off');
  assert.equal(VC.resolveViewCycle(made, UNKNOWN)[0].statusUpper, VC.STATUS_SRC_NONE, 'an unknown watch too');
  assert.equal(VC.resolveViewCycle(oneScreen('bar4'), EMERY)[0].statusUpper, VC.STATUS_SRC_NONE,
    'not made: off');
  assert.equal(VC.rowSource({}, 'bogus', EMERY), VC.STATUS_SRC_NONE, 'an unknown value is off');
  // A flick view holding nothing but a made bar is a screen; unmade, it is a skipped slot.
  const flick = { layoutPreset: 'custom', viewCount: '2', viewTop0: 'cal2', viewBody0: 'forecast',
    viewUpper0: 'weather', viewLower0: 'off', viewTop1: 'none', viewBody1: 'none', viewUpper1: 'bar6',
    viewLower1: 'off', viewClockOff1: true, viewStripOff1: true };
  assert.notEqual(VC.resolveViewCycle(Object.assign({ statusBar6Made: true }, flick), EMERY)[1], null);
  assert.equal(VC.resolveViewCycle(flick, EMERY)[1], null);
  // specToKeys names the row back.
  const keys = VC.specToKeys(VC.resolveViewCycle(made, EMERY));
  assert.equal(keys.viewUpper0, 'bar4');
});

test('barsShown: a made bar 4 to 6 on a screen; the Clay view words carry its ext bit on emery alone', () => {
  const S = oneScreen('bar5', { statusBar5Made: true });
  assert.equal(VC.barsShown(S, EMERY).bar5, true);
  assert.equal(VC.barsShown(S, BASALT).bar5, false);
  assert.equal(VC.barsShown(Object.assign({}, S, { statusBar5Made: false }), EMERY).bar5, false);
  const emery = buildClayPayload(S, { platform: 'emery' }, NOW).CLAY_VIEW_0;
  const basalt = buildClayPayload(S, { platform: 'basalt' }, NOW).CLAY_VIEW_0;
  assert.equal(VC.unpackWire(emery).statusUpper, VC.STATUS_SRC_BAR5);
  assert.equal(VC.unpackWire(basalt).statusUpper, VC.STATUS_SRC_NONE);
});

test('the catalog: three extra lines, their wire keys and slots, empty until New status bar fills them', () => {
  assert.deepEqual(catalog.EXTRA_LINES.map((l) => l.id), ['bar4', 'bar5', 'bar6']);
  assert.deepEqual(catalog.EXTRA_LINES.map((l) => l.wireKey),
    ['STATUS_LINE_5_UINT8', 'STATUS_LINE_6_UINT8', 'STATUS_LINE_7_UINT8']);
  assert.deepEqual(catalog.EXTRA_LINES[0].slots, ['statusBar4Left', 'statusBar4Mid', 'statusBar4Right']);
  const extraSlots = [].concat(...catalog.EXTRA_LINES.map((l) => l.slots));
  assert.equal(extraSlots.length, 9);
  extraSlots.forEach((k) => assert.equal(catalog.slotDefault(k, EMERY), 'empty', k));
  assert.equal(catalog.lineById('bar5'), catalog.EXTRA_LINES[1]);
  assert.equal(catalog.lineById('forecast'), catalog.LINES.find((l) => l.id === 'forecast'));
  assert.equal(catalog.lineById('nope'), null);
  assert.equal(catalog.lineOf('statusBar6Right').id, 'bar6');
  assert.equal(catalog.allSlotKeys().length, 12, 'the twelve stay twelve (telemetry, the migration)');
  // The bake sends a bar 4 to 6's line while a screen shows it, which only a made bar on a
  // watch that has them can be.
  const extra = (s, env) => catalog.bakedLines(s, env).map((l) => l.id).filter((id) => /^bar/.test(id));
  const S = oneScreen('bar4', { viewLower0: 'bar6', statusBar4Made: true, statusBar6Made: true });
  assert.deepEqual(extra(S, EMERY), ['bar4', 'bar6']);
  assert.deepEqual(extra(S, BASALT), []);
  assert.deepEqual(extra(Object.assign({}, S, { viewLower0: 'off' }), EMERY), ['bar4'],
    'bar 6 is made but on no screen');
  assert.deepEqual(extra({ statusBar4Made: true, statusBar6Made: true }, EMERY), [], 'made, on no screen');
});

test('the bake sends the line of a bar 4 to 6 a screen shows, on a Pebble Time 2 alone', () => {
  const S = oneScreen('bar4', { statusBar4Made: true, statusBar5Made: true,
    statusBar4Left: 'city', statusBar4Mid: 'empty', statusBar4Right: 'city',
    statusTopLeft: 'city', statusTopMid: 'empty', statusTopRight: 'city' });
  const bake = (settings, p) => {
    const payload = { CITY: 'Bonn', CURRENT_TEMP: 20, SUN_EVENTS: [1, 0, 0, 0, 0] };
    statusLines.buildStatusLines(payload, settings, { platform: p }, NOW);
    return payload;
  };
  const emery = bake(S, 'emery');
  assert.ok(emery.STATUS_LINE_5_UINT8, 'bar 4\'s line');
  assert.equal('STATUS_LINE_6_UINT8' in emery, false, 'bar 5 is made but on no screen');
  assert.equal('STATUS_LINE_7_UINT8' in emery, false, 'bar 6 is not made');
  assert.equal('STATUS_LINE_2_UINT8' in emery, false, 'no screen shows the Radar bar');
  assert.equal('STATUS_LINE_4_UINT8' in emery, false, 'nor the Health bar');
  assert.ok(emery.STATUS_LINE_1_UINT8 && emery.STATUS_LINE_3_UINT8, 'the Forecast bar\'s, and the Watch bar\'s always');
  assert.deepEqual(decodeLine(emery.STATUS_LINE_5_UINT8).map((s) => s.text), ['Bonn', '', 'Bonn']);
  ['basalt', 'aplite'].forEach((p) => {
    const other = bake(S, p);
    assert.equal(Object.keys(other).some((k) => /^STATUS_LINE_[567]_/.test(k)), false, p);
  });
  // The fetch gates read the slots of a bar a screen shows: a pollen slot there asks for
  // pollen (no default slot of the twelve shows it).
  assert.ok(catalog.selectedCodes(oneScreen('bar4', { statusBar4Made: true, statusBar4Left: 'pollen' }))
    .indexOf('pollen') !== -1);
  assert.equal(catalog.selectedCodes(oneScreen('bar4', { statusBar4Left: 'pollen' })).indexOf('pollen'), -1,
    'not made: on no screen');
  assert.equal(catalog.selectedCodes({ statusBar4Made: true, statusBar4Left: 'pollen' }).indexOf('pollen'), -1,
    'made, on no screen: not read');
  // Only where the watch draws the bar: the same settings on another watch fetch nothing for it.
  const made = oneScreen('bar4', { provider: 'dwd', statusBar4Made: true, statusBar4Left: 'pollen' });
  assert.ok(catalog.selectedCodes(made, EMERY).indexOf('pollen') !== -1, 'a Pebble Time 2 draws bar 4');
  assert.equal(catalog.selectedCodes(made, BASALT).indexOf('pollen'), -1, 'basalt is never sent its line');
  assert.equal(forecastSeries.needsPollen(made, { platform: 'emery' }), true);
  assert.equal(forecastSeries.needsPollen(made, { platform: 'basalt' }), false);
});

test('New status bar makes the next free bar empty, called "Status bar <n>" unless another bar has that name', () => {
  // Stale values a hand-edited blob could hold: New status bar clears them all.
  const S = { statusBar4Left: 'uv', statusBar4MidCountdown: '2026-12-24', statusBar4OnDemandLeftItems: 'bt' };
  assert.equal(screens.makeBar(S, EMERY), 'bar4');
  assert.equal(S.statusBar4Made, true);
  assert.equal(S.statusBar4Name, '', 'its own name');
  assert.equal(screens.barName(S, 'bar4'), 'Status bar 4');
  assert.deepEqual([S.statusBar4Left, S.statusBar4Mid, S.statusBar4Right], ['empty', 'empty', 'empty'], 'empty');
  assert.equal(S.statusBar4MidCountdown, undefined, 'no countdown date');
  assert.equal(S.statusBar4OnDemandLeftItems, '', 'no alerts');
  assert.ok(screens.screensOf(S, EMERY).every((l) => screens.idxOf(l, 'bar4') === -1), 'on no screen');
  // Another bar called "Status bar 5": the next one takes a number.
  S.statusForecastName = 'Status bar 5';
  assert.equal(screens.makeBar(S, EMERY), 'bar5');
  assert.equal(S.statusBar5Name, 'Status bar 5 2');
  assert.equal(screens.makeBar(S, EMERY), 'bar6');
  assert.equal(screens.makeBar(S, EMERY), null, 'six bars: none left');
  assert.equal(screens.makeBar({}, BASALT), null, 'a watch without bars 4 to 6');
});

test('each bar\'s dialog has a sheet id that names it, and back', () => {
  OD.PAGE_BARS.forEach((b) => {
    assert.equal(screens.barOfSheet(screens.barSheet(b.bar)), b.bar, b.bar);
  });
  assert.equal(screens.barSheet('forecast'), 'bar-forecast');
  ['', null, 'bar-', 'bar-nope', 'forecast', 'threshUv'].forEach((id) => assert.equal(screens.barOfSheet(id), null, String(id)));
});

test('Delete status bar stores a screen as the editor\'s Remove does: the bar below moves up, the dates go, Undo puts all back', () => {
  const list = [{ k: 'strip' }, { k: 'cal', rows: '2' }, { k: 'bar4' }, { k: 'clock' }, { k: 'fcbar' },
    { k: 'fc', size: 'fill' }];
  const S = Object.assign({ layoutPreset: 'custom', viewCount: '1', statusBar4Made: true, statusBar4Name: 'Wind',
    statusBar4Left: 'countdown', statusBar4LeftCountdown: '2026-12-24' }, screens.compileKeys(list, 0));
  const before = Object.assign({}, S);
  const was = screens.unmakeBar(S, 'bar4', EMERY);
  const without = screens.remove(list, 2);
  Object.entries(screens.compileKeys(without, 0)).forEach(([key, v]) => assert.equal(S[key], v, key));
  assert.equal(S.viewUpper0, 'weather', 'the Forecast bar moves up to the upper row');
  assert.deepEqual(screens.screensOf(S, EMERY)[0].map((b) => b.k), without.map((b) => b.k));
  assert.equal(S.statusBar4LeftCountdown, undefined, 'the countdown date goes, so a new bar starts on today');
  Object.assign(S, was);
  Object.keys(before).forEach((key) => assert.deepEqual(S[key], before[key], key + ' back after Undo'));
});

test('bars 4 to 6\'s On demand cells: CLAY_OD_EXTRA_UINT8 on a known emery alone, effective values only', () => {
  // Bluetooth on bar 4's left and Quiet time on bar 6's right; bar 4 shows on a screen.
  const S = placeOn(placeOn(Object.assign({}, NOTHING_PLACED, oneScreen('bar4', { viewLower0: 'bar6' }), {
    statusBar4Made: true, statusBar6Made: true }), 'bar4', 'left', ['bt']), 'bar6', 'right', ['qt']);
  const cells = buildClayPayload(S, { platform: 'emery' }, NOW).CLAY_OD_EXTRA_UINT8;
  assert.equal(cells.length, OD.ITEMS.length);
  const at = (code) => cells[OD.ITEMS.findIndex((i) => i.code === code)];
  assert.equal(at('bt'), 1, 'bar 4 (bits 0-1): left');
  assert.equal(at('qt'), 2 << 4, 'bar 6 (bits 4-5): right');
  assert.equal(cells.filter(Boolean).length, 2, 'nothing else');
  assert.deepEqual(statusWire.buildExtraCells(S, EMERY), cells);
  // Bar 6 unmade: its cell clears; no screen shows bar 4: its cell clears.
  assert.equal(statusWire.buildExtraCells(Object.assign({}, S, { statusBar6Made: false }), EMERY)
    [OD.ITEMS.findIndex((i) => i.code === 'qt')], 0);
  assert.equal(statusWire.buildExtraCells(Object.assign({}, S, { viewUpper0: 'weather', viewLower0: 'off' }), EMERY)
    .filter(Boolean).length, 0);
  // Sent on every known emery, zeros while no made bar shows; never on another watch.
  assert.deepEqual(buildClayPayload({}, { platform: 'emery' }, NOW).CLAY_OD_EXTRA_UINT8,
    new Array(OD.ITEMS.length).fill(0));
  ['basalt', 'diorite', 'flint', 'aplite'].forEach((p) =>
    assert.equal('CLAY_OD_EXTRA_UINT8' in buildClayPayload(S, { platform: p }, NOW), false, p));
  assert.equal('CLAY_OD_EXTRA_UINT8' in buildClayPayload(S, null, NOW), false, 'an unknown watch');
  // The blob's own cells never carry bars 4 to 6 (their bits would land on the first four's).
  const blob = statusWire.buildSettingsBlob(S, EMERY);
  assert.equal(blob.slice(statusWire.ON_DEMAND_OFFSET).filter(Boolean).length, 0);
});

test('on-demand.js: a bar 4 to 6 exists where a screen shows it, so an item placed there alone is placed', () => {
  const S = placeOn(Object.assign({}, NOTHING_PLACED, oneScreen('bar4'), { statusBar4Made: true }),
    'bar4', 'right', ['uv']);
  assert.equal(OD.barExists(S, 'bar4', EMERY), true);
  assert.equal(OD.barExists(S, 'bar4', BASALT), false);
  assert.equal(OD.barExists(S, 'bar5', EMERY), false, 'not made, not shown');
  assert.equal(OD.placedAnywhere(S, 'uv', EMERY), true);
  assert.equal(OD.placedAnywhere(S, 'uv', BASALT), false);
  assert.equal(OD.telemetryCode(S, EMERY).length, 40, 'telemetry keeps the four bars');
  assert.deepEqual(OD.BLOB_BARS.map((b) => b.bar), ['top', 'forecast', 'radar', 'health']);
  assert.deepEqual(OD.PAGE_BARS.map((b) => b.name),
    ['Watch bar', 'Forecast bar', 'Health bar', 'Radar bar', 'Status bar 4', 'Status bar 5', 'Status bar 6']);
});

test('the render signature signs the slots of a bar 4 to 6 a screen shows, on a Pebble Time 2', () => {
  const S = oneScreen('bar4', { statusBar4Made: true, statusBar4Left: 'uv' });
  const emery = (s) => renderSignature(s, { platform: 'emery' });
  assert.notEqual(emery(S), emery(Object.assign({}, S, { statusBar4Left: 'wind' })), 'a slot edit re-bakes');
  assert.equal(emery(oneScreen('bar4', { statusBar4Left: 'uv' })), emery(oneScreen('bar4', { statusBar4Left: 'wind' })),
    'not made: nothing to bake');
  assert.equal(emery({ statusBar4Made: true, statusBar4Left: 'uv' }),
    emery({ statusBar4Made: true, statusBar4Left: 'wind' }), 'made, on no screen: nothing to bake');
  assert.notEqual(emery(S), emery(Object.assign({}, S, { viewUpper0: 'weather' })),
    'taking it off the screen re-signs');
  assert.equal(emery({}), emery({ statusBar4Left: 'uv' }), 'and an unmade bar signs as before 3.0');
  assert.equal(renderSignature(S, { platform: 'basalt' }),
    renderSignature(Object.assign({}, S, { statusBar4Left: 'wind' }), { platform: 'basalt' }), 'basalt');
  // A countdown signs its date while it is the slot's item.
  const cd = oneScreen('bar4', { statusBar4Made: true, statusBar4Right: 'countdown',
    statusBar4RightCountdown: '2026-12-24' });
  assert.notEqual(emery(cd), emery(Object.assign({}, cd, { statusBar4RightCountdown: '2026-12-31' })));
});

test('screens.js: a bar 4 to 6 is offered once made, on a watch that has them', () => {
  const S = { statusBar4Made: true };
  assert.equal(screens.capable('bar4', EMERY), true);
  assert.equal(screens.capable('bar4', BASALT), false);
  assert.equal(screens.offered('bar4', S, EMERY), true);
  assert.equal(screens.offered('bar5', S, EMERY), false, 'not made');
  assert.equal(screens.offered('bar4', S, BASALT), false);
  const blank = [];
  assert.ok(screens.addable(blank, EMERY, S).indexOf('bar4') !== -1);
  assert.equal(screens.addable(blank, EMERY, {}).indexOf('bar4'), -1);
  assert.equal(screens.addable(blank, EMERY).indexOf('bar4'), -1, 'no settings: none made');
  // On a screen it compiles to its row value and back.
  const list = screens.add(blank, 'bar4');
  const keys = screens.compileKeys(list, 0);
  assert.equal([keys.viewUpper0, keys.viewLower0].indexOf('bar4') !== -1, true, JSON.stringify(keys));
});
