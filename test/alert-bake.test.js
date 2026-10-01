'use strict';
// The weather alerts and the On demand bytes the phone sends: the settings blob's
// rain-look, Battery and cell bytes (status-wire.js buildSettingsBlob), which alerts
// are on and how each reads (status-thresholds.js enabledAlerts and friends), and the
// alerts' metric entries (ALERT_ENTRIES_UINT8, status-wire.js bakeAlerts): what each
// alert judges (the day, not the slot), the entry bytes and their order and cap, and
// looking ahead to tomorrow.
const test = require('node:test');
const { NOTHING_PLACED, placeOn, placedOnly } = require('./helpers/on-demand.js');
const assert = require('node:assert/strict');
const th = require('../src/pkjs/status-thresholds.js');
const wire = require('../src/pkjs/status-wire.js');
const statusLines = require('../src/pkjs/status-lines.js');
const { packedLevel } = require('./helpers/weather-levels.js');
const { decodeAlerts: decodeEntries } = require('./helpers/alert-entries.js');

// --- the settings blob's alert, Battery and On demand bytes --------------------

test('buildSettingsBlob: byte 34 carries the rain alert look in bits 0-1', () => {
  assert.equal(wire.ALERTS_OFFSET, 34);
  assert.equal(wire.buildSettingsBlob({})[34], 0, 'absent = text, the legacy look');
  assert.equal(wire.buildSettingsBlob({ rainAlertDisplay: 'text' })[34], 0);
  assert.equal(wire.buildSettingsBlob({ rainAlertDisplay: 'icon' })[34], 1);
  assert.equal(wire.buildSettingsBlob({ rainAlertDisplay: 'minutes' })[34], 2);
  assert.equal(wire.buildSettingsBlob({ rainAlertDisplay: 'bogus' })[34], 0, 'unknown = text');
  // Bits 2-7 are reserved: whatever else is configured, they stay 0.
  const busy = wire.buildSettingsBlob(placedOnly(['uv'], { rainAlertDisplay: 'minutes', statusBoldAll: 'all',
    alertUvDisplay: 'value', threshUvOn: true }));
  assert.equal(busy[34], 2);
  // Which metric alerts are ACTIVE never rides the Clay blob: their entries do.
  assert.deepEqual(wire.buildSettingsBlob({ alertUvDisplay: 'value', alertWindDays: 'today' }),
    wire.buildSettingsBlob({}));
});

test('buildSettingsBlob: byte 35 packs the Battery item — its warn level on the watch\'s step and its Look', () => {
  const B = wire.BATTERY_OFFSET;
  assert.equal(B, 35);
  assert.equal(wire.buildSettingsBlob({})[B], 10, 'absent: 10 %, Icon');
  assert.equal(wire.buildSettingsBlob(null)[B], 10, 'no settings at all: the same default');
  const emery = { color: true, fineBattery: true };
  const basalt = { color: true, fineBattery: false };
  // A stored '15' sends 20 to a 10 % watch and 15 to emery (on-demand.js batteryLevel).
  assert.equal(wire.buildSettingsBlob({ batteryLowLevel: '15' }, basalt)[B], 20);
  assert.equal(wire.buildSettingsBlob({ batteryLowLevel: '15' }, emery)[B], 15);
  assert.equal(wire.buildSettingsBlob({ batteryLowLevel: '15' })[B], 20, 'no env: 10 % steps');
  assert.equal(wire.buildSettingsBlob({ batteryLowLevel: '31' }, emery)[B], 10, 'out of range: the default');
  assert.equal(wire.buildSettingsBlob({ batteryLowDisplay: 'value' })[B], 10 | wire.BATTERY_VALUE_BIT);
  assert.equal(wire.buildSettingsBlob({ batteryLowLevel: '30', batteryLowDisplay: 'value' }, emery)[B], 30 | 0x40);
  // It never touches the rain look next door, nor the look the level.
  const both = wire.buildSettingsBlob({ rainAlertDisplay: 'minutes', batteryLowLevel: '20' });
  assert.equal(both[wire.ALERTS_OFFSET], 2);
  assert.equal(both[B], 20);
});

test('buildSettingsBlob: bytes 38-47 carry the On demand cells, effective values only', () => {
  const O = wire.ON_DEMAND_OFFSET;
  assert.equal(O, 38);
  const OD = require('../src/pkjs/on-demand.js');
  // One byte per item, 2 bits per bar (1 left, 2 right). The defaults: the Watch Status
  // Bar only — Bluetooth, Quiet time and Sleep on its left, the rest but Pollen right.
  assert.deepEqual(wire.buildSettingsBlob({}).slice(O), [2, 1, 1, 1, 2, 2, 2, 2, 0, 2], 'the defaults');
  const S = placeOn(placeOn(Object.assign({ radarMode: 'status' }, NOTHING_PLACED), 'forecast', 'left', 'uv,bt'),
    'radar', 'right', 'uv');
  const cells = wire.buildSettingsBlob(S).slice(O);
  assert.equal(cells[OD.itemIndex('uv')], (1 << 2) | (2 << 4), 'forecast left, radar right');
  assert.equal(cells[OD.itemIndex('bt')], 1 << 2);
  assert.equal(cells[OD.itemIndex('battery')], 0);
  // A watch without On demand gets zeros (it never gets the blob, but the packer agrees).
  assert.deepEqual(wire.buildSettingsBlob(S, { onDemand: false }).slice(O), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const platform = require('../src/pkjs/config-ui/lib/platform.js');
  assert.deepEqual(wire.buildSettingsBlob({}, platform.computeEnv({ platform: 'aplite' })).slice(O),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'aplite');
  // A side that ticks nothing is zeros, on a bar that exists (health) as on one already
  // placed.
  const health = placeOn(Object.assign({ healthMode: 'all' }, S), 'health', 'left', '');
  assert.equal(wire.buildSettingsBlob(health).slice(O)[OD.itemIndex('uv')], (1 << 2) | (2 << 4),
    'the empty health side is 0');
  placeOn(S, 'forecast', 'left', 'bt');
  assert.equal(wire.buildSettingsBlob(S).slice(O)[OD.itemIndex('uv')], 2 << 4);
  // A bar the modes remove is zeros too.
  S.radarMode = 'off';
  assert.equal(wire.buildSettingsBlob(S).slice(O)[OD.itemIndex('uv')], 0, 'no radar bar');
});

// --- the weather alerts: which are on, and how each reads -----------------------

// All five metric alerts placed (the Watch Status Bar's right side), nothing else.
const ALL_ON = placedOnly(['uv', 'wind', 'gust', 'aqi', 'pollen']);
/**
 * Exactly these alerts placed, with more settings.
 * @param {string[]} codes Alert codes.
 * @param {Object} [extra] Settings merged over.
 * @returns {Object} The blob.
 */
function on(codes, extra) { return placedOnly(codes, extra); }
/**
 * @param {Object} settings Clay settings blob.
 * @param {Object} [env] Platform env.
 * @returns {string[]} the codes enabledAlerts lists
 */
const codesOf = (settings, env) => th.enabledAlerts(settings, env).map((a) => a.code);
/**
 * @param {Object} settings Clay settings blob.
 * @returns {string[]} the codes enabledAlerts lists with a Look that shows the value
 */
const valueCodes = (settings) => th.enabledAlerts(settings).filter((a) => a.showValue).map((a) => a.code);

test('enabledAlerts: the placed alerts in the On demand order, with how each reads', () => {
  assert.deepEqual(th.enabledAlerts(NOTHING_PLACED), []);
  assert.deepEqual(codesOf({}), ['gust', 'uv', 'aqi', 'wind'], 'the default ticks');
  assert.deepEqual(codesOf(null), ['gust', 'uv', 'aqi', 'wind'], 'no settings: the defaults too');
  assert.deepEqual(codesOf(ALL_ON), ['gust', 'uv', 'aqi', 'pollen', 'wind']);
  assert.deepEqual(codesOf(on(['aqi', 'uv'])), ['uv', 'aqi']);
  // Each entry: its wire kind id (the KINDS index), its Look, its Days and its mark,
  // each read the one way (alertDays, alertNextDayMark).
  assert.deepEqual(th.enabledAlerts(on(['aqi', 'uv'], {
    alertAqiDisplay: 'value', alertUvDisplay: 'icon', alertWindDisplay: 'value',
    alertUvDays: 'today', alertUvNextDayMark: 'gt', alertAqiNextDayMark: 'bogus' })), [
    { code: 'uv', kindId: 7, showValue: false, days: 'today', mark: 'gt' },
    { code: 'aqi', kindId: 0, showValue: true, days: 'tomorrow', mark: 'raquo' }
  ], 'an unplaced alert\'s Look does not count');
  th.enabledAlerts(ALL_ON).forEach((a) => {
    assert.equal(th.KINDS[a.kindId].code, a.code, a.code + ': the kind id is its KINDS index');
    assert.equal(a.days, 'tomorrow', a.code + ': Today + tomorrow is the default');
    assert.equal(a.mark, 'raquo', a.code + ': the » is the default');
  });
  // The env reaches alertOn: omitted is a watch that draws On demand; a watch without
  // it, or without the bar an alert is placed on, lists nothing for it.
  assert.deepEqual(th.enabledAlerts(ALL_ON, { onDemand: false }), []);
  const onRadar = placeOn(on([], { radarMode: 'status' }), 'radar', 'left', ['uv']);
  assert.deepEqual(codesOf(onRadar), ['uv']);
  assert.deepEqual(codesOf(onRadar, { radar: false }), []);
});

test('alertOn / enabledAlerts: keyed by code, on while placed on any bar, the value only while on', () => {
  th.ALERT_KINDS.forEach((a) => {
    const look = 'alert' + a.key + 'Display';
    assert.deepEqual(valueCodes(on([a.code])), [], a.code);
    assert.deepEqual(valueCodes(on([a.code], { [look]: 'value' })), [a.code], a.code + ' value');
    assert.deepEqual(valueCodes(on([a.code], { [look]: 'icon' })), [], a.code + ' icon');
    assert.deepEqual(valueCodes(on([], { [look]: 'value' })), [],
      a.code + ': unplaced shows no value, whatever its Look');
    assert.equal(th.alertOn(on([a.code]), a.code), true);
    assert.equal(th.alertOn(on([]), a.code), false);
    assert.equal(th.alertOn(on([a.code]), a.code, { onDemand: false }), false, a.code + ': a watch without On demand');
    assert.equal(th.alertOn(placeOn(on([]), 'health', 'left', [a.code]), a.code, { health: true }), false,
      a.code + ': a bar the modes remove');
    assert.equal(th.alertOn(placeOn(on([], { healthMode: 'status' }), 'health', 'left', [a.code]), a.code), true,
      a.code + ': a health bar that exists');
  });
  assert.equal(th.alertOn(null, 'uv'), true, 'no settings read the default ticks');
  assert.equal(th.alertOn(null, 'pollen'), false, 'Pollen is not a default tick');
  // A code with no alert reads off, even when an item of that name is ticked.
  assert.equal(th.alertOn(on(['battery', 'rain']), 'battery'), false, 'a system item is no metric alert');
  assert.equal(th.alertOn(on(['rain']), 'rain'), false, 'rain is watch-resolved, not a metric alert');
  assert.equal(th.alertOn({}, 'steps'), false, 'goal kind');
  assert.equal(th.alertOn({}, 'temp'), false, 'bold-only kind');
  assert.equal(th.alertOn(on(['uv']), 'Uv'), false, 'keyed by code, not stem');
  assert.equal(th.alertOn(on(['uv']), undefined), false);
  // Per kind: one alert's tick never turns another's on.
  assert.equal(th.alertOn(on(['aqi']), 'gust'), false);
});

test('alertDays / alertNextDayMark: one reading each, with the defaults', () => {
  assert.equal(th.ALERT_DAYS_DEFAULT, 'tomorrow');
  assert.equal(th.ALERT_NEXT_DAY_MARK_DEFAULT, 'raquo');
  th.ALERT_KINDS.forEach((a) => {
    const days = 'alert' + a.key + 'Days';
    const mark = 'alert' + a.key + 'NextDayMark';
    assert.equal(th.alertDays({}, a.code), 'tomorrow', a.code + ' absent');
    assert.equal(th.alertDays({ [days]: 'today' }, a.code), 'today', a.code);
    assert.equal(th.alertDays({ [days]: 'tomorrow' }, a.code), 'tomorrow', a.code);
    assert.equal(th.alertDays({ [days]: 'Today' }, a.code), 'tomorrow', a.code + ' unknown');
    assert.equal(th.alertNextDayMark({}, a.code), 'raquo', a.code + ' absent');
    th.ALERT_NEXT_DAY_MARKS.forEach((m) => assert.equal(th.alertNextDayMark({ [mark]: m }, a.code), m));
    assert.equal(th.alertNextDayMark({ [mark]: 'hasOwnProperty' }, a.code), 'raquo');
  });
  assert.equal(th.alertDays(null, 'uv'), 'tomorrow');
  assert.equal(th.alertNextDayMark(undefined, 'uv'), 'raquo');
  // Keyed by code: another alert's setting never answers.
  assert.equal(th.alertDays({ alertWindDays: 'today' }, 'uv'), 'tomorrow');
  assert.equal(th.alertNextDayMark({ alertWindNextDayMark: 'gt' }, 'uv'), 'raquo');
});

test('rainAlert: owns the two rain defaults — the text look, a 60 min window', () => {
  const dflt = { look: 'text', horizonMin: 60 };
  assert.deepEqual(th.rainAlert({}), dflt);
  assert.deepEqual(th.rainAlert(null), dflt);
  assert.deepEqual(th.rainAlert(undefined), dflt);
  // Whether it shows is the Rain item's tick (on-demand.js), not part of the contract:
  // a stored alertRain (a retired dev key) reads nothing.
  assert.deepEqual(th.rainAlert({ alertRain: false }), dflt);
  // The look: a RAIN_DISPLAY key, else text.
  ['text', 'icon', 'minutes'].forEach(v => assert.equal(th.rainAlert({ rainAlertDisplay: v }).look, v));
  ['bogus', 3, null, 'toString'].forEach(v =>
    assert.equal(th.rainAlert({ rainAlertDisplay: v }).look, 'text', String(v)));
  // The window: the stored minutes as an int (string or number), else 60. A stored
  // '0' (the retired Off) stays 0 — the migration moves it, the contract does not.
  assert.equal(th.rainAlert({ rainCountdownHorizon: '120' }).horizonMin, 120);
  assert.equal(th.rainAlert({ rainCountdownHorizon: 30 }).horizonMin, 30);
  assert.equal(th.rainAlert({ rainCountdownHorizon: '0' }).horizonMin, 0);
  ['', 'x', null].forEach(v =>
    assert.equal(th.rainAlert({ rainCountdownHorizon: v }).horizonMin, 60, String(v)));
});

// --- the metric entries (ALERT_ENTRIES_UINT8, status-wire.js bakeAlerts) ---------

/**
 * The value text of the one entry bakeAlerts makes for `code` with its alert on,
 * its Look 'value' and a pair every reading crosses (warn 0) — so the entry is
 * there exactly when the alert has a reading, and prints it.
 * @param {string} code An ALERT_KINDS code.
 * @param {Object} payload
 * @param {Object} settings
 * @returns {?string} the printed reading; null without one
 */
function alertText(code, payload, settings) {
  const key = th.ALERT_KINDS.find((a) => a.code === code).key;
  const e = decodeAlerts(wire.bakeAlerts(payload, Object.assign({}, settings, placedOnly([code]), {
    ['alert' + key + 'Display']: 'value',
    ['thresh' + key + 'Warn']: '0', ['thresh' + key + 'Danger']: '1000000'
  })));
  return e.length ? e[0].value : null;
}

/**
 * The level of the entry bakeAlerts makes for `code` with its alert placed (and no
 * other).
 * @param {string} code An ALERT_KINDS code.
 * @param {Object} payload
 * @param {Object} settings
 * @returns {number} 1 warn / 2 danger; 0 when there is no entry
 */
function alertLevelOf(code, payload, settings) {
  const key = th.ALERT_KINDS.find((a) => a.code === code).key;
  assert.ok(key, code + ' is an alert');
  const e = decodeAlerts(wire.bakeAlerts(payload, Object.assign(placedOnly([code]), settings)));
  return e.length ? e[0].level : 0;
}

// UV payload units are tenths; wind/gust km/h; *_DAY_PEAKS = [today's rest, tomorrow,
// today's earlier hours] in payload units.
test('an alert judges the DAY: the highest value left today, whatever the slot shows', () => {
  const morning = { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [80, 80, 0] };
  assert.equal(alertText('uv', morning, {}), '8', 'Now-mode slot, no slot at all: still 8');
  assert.equal(alertText('uv', morning, { uvSlotDisplay: 'current' }), '8');
  assert.equal(statusLines.formatValue('uv', morning, { uvSlotDisplay: 'current' }), '2',
    'guard: the slot itself shows the current 2');
  // Falling below warn, tomorrow higher: the slot rolls to »8, the alert judges today's 5.
  const evening = { UV_TREND_UINT8: [50], UV_DAY_PEAKS: [50, 80, 80] };
  assert.equal(alertText('uv', evening, { uvSlotDisplay: 'max' }), '5');
  // Wind in the user's unit.
  const wind = { WIND_TREND_UINT8: [20], WIND_DAY_PEAKS: [64, 30, 0] };
  assert.equal(alertText('wind', wind, {}), '64');
  assert.equal(alertText('wind', wind, { windUnits: 'mph' }), '40');
  // Never below the current reading, even if the feed disagrees with itself.
  assert.equal(alertText('gust', { GUST_TREND_UINT8: [70], GUST_DAY_PEAKS: [60, 0, 0] }, {}), '70');
});

test('an alert falls back to the current reading: no peaks, WAQI AQI, pollen', () => {
  // No *_DAY_PEAKS (not fetched, or WAQI's current-only AQI): the reading itself.
  assert.equal(alertText('uv', { UV_TREND_UINT8: [70] }, {}), '7');
  // Today's peak unknown while a Day max slot shows tomorrow's »9: the alert
  // still judges the current 7 (today wins), never the slot's next-day peak.
  const noToday = { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [null, 90, 0] };
  assert.equal(statusLines.formatValue('uv', noToday, { uvSlotDisplay: 'max' }), '»9',
    'guard: the slot shows tomorrow\'s »9');
  assert.equal(packedLevel('uv', noToday, { uvSlotDisplay: 'max' }), 0,
    'guard: the slot\'s lone »9 is never highlighted');
  assert.equal(alertText('uv', noToday, { uvSlotDisplay: 'max' }), '7');
  assert.equal(alertText('wind', { WIND_TREND_UINT8: [64] },
    { windUnits: 'knots', windSlotDisplay: 'max' }), '35', 'the reading in the user\'s unit');
  assert.equal(alertText('aqi', { AQI_TREND: [152.4] }, { aqiSource: 'waqi' }), '152');
  assert.equal(alertText('aqi', { AQI_TREND: [40], AQI_DAY_PEAKS: [90, 50, 0] }, {}), '90');
  // Pollen is a daily band: printed as the band, judged on its level on the 0..3
  // half-step scale ('2-3' is 2.5).
  assert.equal(alertText('pollen', { POLLEN_TODAY: '2-3' }, {}), '2-3');
  assert.equal(alertLevelOf('pollen', { POLLEN_TODAY: '2-3' },
    { threshPollenWarn: '2.5', threshPollenDanger: '3' }), 1);
  assert.equal(alertLevelOf('pollen', { POLLEN_TODAY: '2-3' },
    { threshPollenWarn: '2', threshPollenDanger: '2.5' }), 2);
  assert.equal(alertText('pollen', {}, {}), null);
  assert.equal(alertText('pollen', { POLLEN_TODAY: 'n/a' }, {}), null, 'no known band');
  // No reading: no entry. And no alert for a kind outside ALERT_KINDS.
  assert.equal(alertText('uv', {}, {}), null);
  assert.deepEqual(wire.bakeAlerts({ CURRENT_TEMP: 70 }, { alertTemp: true, alertSteps: true }), []);
});

test('an alert levels its reading on the resolved pair (seeds when blank)', () => {
  const p = { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [70, 80, 0] };
  assert.equal(alertLevelOf('uv', p, {}), 1, '7 vs seed 6/8: warn');
  assert.equal(alertLevelOf('uv', p, { threshUvWarn: '3', threshUvDanger: '7' }), 2);
  assert.equal(alertLevelOf('uv', p, { threshUvWarn: '8', threshUvDanger: '9',
    alertUvDays: 'today' }), 0, 'below warn today, and Today only: no entry');
  assert.equal(alertLevelOf('uv', p, { threshUvWarn: '8', threshUvDanger: '9' }), 1,
    'Today + tomorrow (the default): tomorrow\'s 8 warns, on the same pair');
  // Highlight-agnostic: the switch only colours the slot.
  assert.equal(alertLevelOf('uv', p, { threshUvOn: false }), 1);
  assert.equal(alertLevelOf('pollen', { POLLEN_TODAY: '3' }, {}), 2, 'seed 2/3');
  assert.equal(alertLevelOf('wind', { WIND_TREND_UINT8: [30] }, { windUnits: 'mph' }), 0,
    '30 km/h = 19 mph vs the mph seed 25/40');
});

/**
 * Decode a bakeAlerts byte array into {kind, level, value} entries, plus `mark`
 * (its ALERT_NEXT_DAY_MARKS key) on a tomorrow entry only — so a today entry
 * reads exactly {kind, level, value}.
 * @param {number[]} bytes
 * @returns {Object[]}
 */
function decodeAlerts(bytes) {
  return decodeEntries(bytes).map((e) => {
    const out = { kind: e.kind, level: e.level, value: e.value };
    if (e.mark !== null) { out.mark = e.mark; }
    return out;
  });
}

// Everything alerting: UV 8 (danger), wind 45 (warn), gust 90 (danger), AQI 152
// (danger), pollen 2 (warn), on the seed pairs.
const ALL_ALERTING = {
  UV_TREND_UINT8: [80], UV_DAY_PEAKS: [80, 60, 0],
  WIND_TREND_UINT8: [45], WIND_DAY_PEAKS: [45, 20, 0],
  GUST_TREND_UINT8: [90], GUST_DAY_PEAKS: [90, 20, 0],
  AQI_TREND: [152],
  POLLEN_TODAY: '2'
};

test('bakeAlerts: the exact bytes for a UV-danger + wind-warn row', () => {
  const p = { UV_TREND_UINT8: [30], UV_DAY_PEAKS: [85, 50, 0],
    WIND_TREND_UINT8: [45], WIND_DAY_PEAKS: [45, 20, 0] };
  // Icons only: one header byte each (bit 7). UV = kind 7, danger (bit 3); wind =
  // kind 2, warn (bit 3 clear); both today's (day bits 4-6 zero).
  assert.deepEqual(wire.bakeAlerts(p, on(['uv', 'wind'])),
    [0x80 | 7 | 0x08, 0x80 | 2]);
  assert.deepEqual(wire.bakeAlerts(p, on(['uv', 'wind'])), [0x8F, 0x82]);
  // UV with its value ("9" — 8.5 rounds like the slot prints it), wind icon-only:
  // the value needs no length, it runs to the next header.
  assert.deepEqual(wire.bakeAlerts(p, on(['uv', 'wind'], { alertUvDisplay: 'value' })),
    [0x8F, 0x39, 0x82]);
  // Both with values: wind in the user's unit, no unit label.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(p, on(['uv', 'wind'], { alertUvDisplay: 'value',
    alertWindDisplay: 'value', windUnits: 'mph' }))),
  [{ kind: 7, level: 2, value: '9' }, { kind: 2, level: 1, value: '28' }],
  'mph: 45 km/h = 28 mph, at the mph seed warn 25');
});

test('bakeAlerts: the On demand order gust, UV, AQI, pollen, wind; unplaced and quiet kinds absent', () => {
  const all = decodeAlerts(wire.bakeAlerts(ALL_ALERTING, Object.assign({ provider: 'dwd' }, ALL_ON)));
  assert.deepEqual(all.map(e => e.kind), [3, 7, 0, 1, 2], 'gust, UV, AQI, pollen, wind');
  assert.deepEqual(all.map(e => e.level), [2, 2, 2, 1, 1]);
  assert.deepEqual(all.map(e => e.value), ['', '', '', '', ''], 'icon Look: no values');
  // An unplaced alert is absent even at danger: ticked on no side, or on a bar that
  // does not exist, it shows nowhere.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(ALL_ALERTING, on(['gust']))).map(e => e.kind), [3]);
  const noRadarBar = placeOn(on(['gust'], { radarMode: 'off' }), 'radar', 'right', 'uv');
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(ALL_ALERTING, noRadarBar)).map(e => e.kind), [3]);
  // Placed on any bar counts, the Watch Status Bar or not.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(ALL_ALERTING,
    placeOn(on([]), 'forecast', 'right', 'aqi'))).map(e => e.kind), [0]);
  // Level 0 (below warn) is absent.
  const calm = { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [30, 20, 0], WIND_TREND_UINT8: [45] };
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(calm, on(['uv', 'wind'])))
    .map(e => e.kind), [2], 'UV 3 stays quiet, wind 45 warns');
  // A partial blob reads the default ticks: gust, UV, AQI and wind.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(ALL_ALERTING, { provider: 'dwd' })).map(e => e.kind), [3, 7, 0, 2]);
  // Nothing alerting, no settings, no payload: no bytes.
  assert.deepEqual(wire.bakeAlerts(calm, on(['uv'])), []);
  assert.deepEqual(wire.bakeAlerts(ALL_ALERTING, null), []);
  assert.deepEqual(wire.bakeAlerts(null, ALL_ON), []);
});

test('bakeAlerts: values only for the kinds whose Look is value, printed like the slot', () => {
  const s = Object.assign({}, ALL_ON, {
    alertUvDisplay: 'value', alertWindDisplay: 'icon', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value'
  });
  const e = decodeAlerts(wire.bakeAlerts(ALL_ALERTING, s));
  assert.deepEqual(e.map(x => x.value), ['90', '8', '152', '2', '']);
  // Pollen prints its DWD band, as the pollen slot does.
  const half = decodeAlerts(wire.bakeAlerts({ POLLEN_TODAY: '2-3' },
    on(['pollen'], { alertPollenDisplay: 'value' })));
  assert.deepEqual(half, [{ kind: 1, level: 1, value: '2-3' }]);
  // Every value byte is printable ASCII (the watch's walker rejects anything else,
  // and a byte with bit 7 would read as a header): decodeEntries asserts both.
  assert.equal(decodeEntries(wire.bakeAlerts(ALL_ALERTING, s)).length, 5);
});

test('bakeAlerts: tail-drops entries past the 20 B cap, wind first', () => {
  const values = Object.assign({}, ALL_ON, {
    alertUvDisplay: 'value', alertWindDisplay: 'value', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value'
  });
  assert.equal(wire.ALERT_ENTRIES_MAX_BYTES, 20);
  // All five with values: 5 headers + "90" "8" "152" "2" "45" = 14 B.
  const all = wire.bakeAlerts(ALL_ALERTING, values);
  assert.equal(all.length, 14);
  assert.deepEqual(decodeAlerts(all).map(e => e.kind), [3, 7, 0, 1, 2]);
  // Only a value wider than any real one fills the tuple: a 7-digit AQI (the most an
  // entry prints) with pollen's '2-3' is 3 + 2 + 8 + 4 + 3 = 20 B — all five fit...
  const wide = Object.assign({}, ALL_ALERTING, { AQI_TREND: [1234567], POLLEN_TODAY: '2-3' });
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(wide, values)).map(e => e.value),
    ['90', '8', '1234567', '2-3', '45']);
  // ...and a two-digit UV on top is 21 B: wind, the tail (the lowest priority), drops.
  const over = Object.assign({}, wide, { UV_TREND_UINT8: [120], UV_DAY_PEAKS: [120, 60, 0] });
  const dropped = wire.bakeAlerts(over, values);
  assert.equal(dropped.length, 18);
  assert.deepEqual(decodeAlerts(dropped).map(e => e.kind), [3, 7, 0, 1]);
  // The row stays a prefix of the order: the first entry that does not fit ends it,
  // even when a later, shorter one would. A 7-digit UV and AQI: gust + UV + AQI =
  // 3 + 8 + 8 = 19 B, pollen's '2-3' (4 B) would make 23 — pollen drops, and wind's
  // icon-only 1 B (20 in all) is NOT taken in its place. On the watch a crowded On
  // demand side drops from its tail too, lowest priority first (appendix/on_demand.c),
  // never a middle item.
  const prefix = Object.assign({}, ALL_ALERTING, {
    UV_TREND_UINT8: [12345670], UV_DAY_PEAKS: [12345670, 0, 0], AQI_TREND: [1234567], POLLEN_TODAY: '2-3'
  });
  const stopped = wire.bakeAlerts(prefix, Object.assign({}, values, { alertWindDisplay: 'icon' }));
  assert.equal(stopped.length, 19);
  assert.deepEqual(decodeAlerts(stopped).map(e => e.kind), [3, 7, 0], 'pollen ends the row; wind is not taken');
  // A value past ALERT_LEN_MAX bytes rides as the icon alone.
  const huge = Object.assign({}, ALL_ALERTING, { AQI_TREND: [12345678] });
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(huge, values)).map(e => e.value),
    ['90', '8', '', '2', '45']);
  // Icon-only: all five = 5 B.
  assert.equal(wire.bakeAlerts(over, ALL_ON).length, 5);
});

test('the placed alerts ride in the On demand order, each entry under its wire kind id', () => {
  // An entry's kind id is its code's KINDS index, in ALERT_KINDS order.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(ALL_ALERTING, ALL_ON)).map((e) => th.KINDS[e.kind].code),
    th.ALERT_KINDS.map((a) => a.code));
  // Only the placed ones, still in that order, and a value only where the Look asks.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(ALL_ALERTING,
    on(['pollen', 'uv'], { alertUvDisplay: 'value', alertAqiDisplay: 'value' }))),
  [{ kind: 7, level: 2, value: '8' }, { kind: 1, level: 1, value: '' }]);
});

// ── Looking ahead: an alert's Days (today / today + tomorrow) ─────────────────
//
// The rule (status-wire alertPick): today's highest value left at warn or
// higher makes a today entry, and today always wins; otherwise, with Days
// 'tomorrow' (the default), tomorrow's peak — known, above 0 — at warn or higher
// makes a tomorrow entry at ITS level, carrying the alert's mark.

/**
 * A UV payload from the design's timeline columns, in whole UV: the current
 * reading, the highest left today, tomorrow's peak (null: unknown) and today's
 * earlier hours.
 * @returns {Object} UV_TREND_UINT8 + UV_DAY_PEAKS in tenths
 */
function uvDay(now, rest, tomorrow, earlier) {
  return { UV_TREND_UINT8: [now * 10],
    UV_DAY_PEAKS: [rest * 10, tomorrow === null ? null : tomorrow * 10, earlier * 10] };
}

test('look-ahead: the design timeline, UV on warn 6 / danger 8 with the value', () => {
  const both = on(['uv'], { alertUvDisplay: 'value' });
  const todayOnly = Object.assign({ alertUvDays: 'today' }, both);
  const uv = (level, value, mark) => {
    const e = { kind: 7, level: level, value: value };
    if (mark) { e.mark = mark; }
    return [e];
  };
  const rows = [
    // [situation, payload, Today only, Today + tomorrow]
    ['09:00, peak 8 ahead', uvDay(2, 8, 9, 0), uv(2, '8'), uv(2, '8')],
    ['14:00, falling, still at warn', uvDay(7, 7, 9, 8), uv(1, '7'), uv(1, '7')],
    ['09:00, today warn, tomorrow danger: today first', uvDay(2, 7, 9, 0), uv(1, '7'), uv(1, '7')],
    ['16:00, below warn, tomorrow 9', uvDay(5, 5, 9, 8), [], uv(2, '9', 'raquo')],
    ['16:00, below warn, tomorrow 7', uvDay(5, 5, 7, 8), [], uv(1, '7', 'raquo')],
    ['16:00, tomorrow 3', uvDay(5, 5, 3, 8), [], []],
    ['16:00, tomorrow unknown', uvDay(5, 5, null, 8), [], []],
    ['09:00, low day (4 ahead), tomorrow 9', uvDay(1, 4, 9, 0), [], uv(2, '9', 'raquo')],
    ['14:00, low day at its peak', uvDay(4, 4, 9, 3), [], uv(2, '9', 'raquo')],
    ['21:00, evening', uvDay(0, 0, 9, 8), [], uv(2, '9', 'raquo')],
    ['00:10, first fetch of the new day', uvDay(0, 9, 3, 0), uv(2, '9'), uv(2, '9')]
  ];
  rows.forEach(([name, p, today, ahead]) => {
    assert.deepEqual(decodeAlerts(wire.bakeAlerts(p, todayOnly)), today, name + ' — Today');
    assert.deepEqual(decodeAlerts(wire.bakeAlerts(p, both)), ahead, name + ' — Today + tomorrow');
    assert.deepEqual(decodeAlerts(wire.bakeAlerts(p, Object.assign({ alertUvDays: 'tomorrow' }, both))),
      ahead, name + ' — stored Today + tomorrow reads as the default');
  });
});

test('look-ahead: wind in km/h (warn 40 / danger 60), and the building storm', () => {
  const s = on(['wind'], { alertWindDisplay: 'value' });
  const wind = (now, rest, tomorrow) => ({ WIND_TREND_UINT8: [now], WIND_DAY_PEAKS: [rest, tomorrow, 0] });
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(wind(45, 45, 70), s)),
    [{ kind: 2, level: 1, value: '45' }], 'still 45 at 23:00: today\'s warn');
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(wind(30, 30, 70), s)),
    [{ kind: 2, level: 2, value: '70', mark: 'raquo' }], 'dropped to 30, tomorrow 70: »70 danger');
  // Monday 10:00: 15 now, 35 at 23:00, 80 tomorrow — nothing left today warns, so
  // the gale is announced all Monday, not first at Tuesday's midnight fetch.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(wind(15, 35, 80), s)),
    [{ kind: 2, level: 2, value: '80', mark: 'raquo' }], 'the building storm');
  // Tomorrow in the user's unit, on that unit's pair: 70 km/h = 43 mph, danger on 25/40.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(wind(30, 30, 70), Object.assign({ windUnits: 'mph' }, s))),
    [{ kind: 2, level: 2, value: '43', mark: 'raquo' }]);
  // Gusts read their own peaks.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts({ GUST_TREND_UINT8: [20], GUST_DAY_PEAKS: [30, 65, 0] },
    on(['gust']))), [{ kind: 3, level: 1, value: '', mark: 'raquo' }], 'gust 65 vs 60/90, icon only');
});

test('look-ahead: tomorrow must be known and above 0 — never a »0', () => {
  const s = on(['uv'], { alertUvDisplay: 'value', threshUvWarn: '0', threshUvDanger: '0' });
  // No current reading and no today's peak, so nothing today: tomorrow 0.4 prints 0.
  assert.deepEqual(wire.bakeAlerts({ UV_DAY_PEAKS: [null, 4, 0] }, s), [], 'a 0 tomorrow on warn 0');
  assert.deepEqual(wire.bakeAlerts({ UV_DAY_PEAKS: [null, 0, 0] }, s), []);
  assert.deepEqual(decodeAlerts(wire.bakeAlerts({ UV_DAY_PEAKS: [null, 5, 0] }, s)),
    [{ kind: 7, level: 2, value: '1', mark: 'raquo' }], 'guard: 0.5 prints 1, which counts');
  // Unknown tomorrow: absent, null, or no day peaks at all.
  const uvOn = on(['uv']);
  assert.deepEqual(wire.bakeAlerts({ UV_TREND_UINT8: [20] }, uvOn), [], 'peaks not fetched');
  assert.deepEqual(wire.bakeAlerts({ UV_TREND_UINT8: [20], UV_DAY_PEAKS: [20, null, 0] }, uvOn), []);
  assert.deepEqual(wire.bakeAlerts({ UV_TREND_UINT8: [20], UV_DAY_PEAKS: [20] }, uvOn), []);
});

test('look-ahead: AQI needs day peaks — Open-Meteo looks ahead, WAQI judges the reading', () => {
  const s = on(['aqi'], { alertAqiDisplay: 'value' });
  // WAQI (and Auto with a station) carries the current reading alone.
  assert.deepEqual(wire.bakeAlerts({ AQI_TREND: [40] }, Object.assign({ aqiSource: 'waqi' }, s)), [],
    'WAQI: nothing to look ahead to');
  assert.deepEqual(decodeAlerts(wire.bakeAlerts({ AQI_TREND: [152] }, Object.assign({ aqiSource: 'waqi' }, s))),
    [{ kind: 0, level: 2, value: '152' }], 'WAQI: today\'s reading still alerts');
  // Open-Meteo's forecast has tomorrow's peak: US scale 100/150, European 60/80.
  const om = { AQI_TREND: [40], AQI_DAY_PEAKS: [50, 120, 0] };
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(om, Object.assign({ aqiSource: 'openmeteo', aqiScale: 'us' }, s))),
    [{ kind: 0, level: 1, value: '120', mark: 'raquo' }]);
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(om, Object.assign({ aqiSource: 'openmeteo' }, s))),
    [{ kind: 0, level: 2, value: '120', mark: 'raquo' }], 'European scale: 120 is past danger 80');
});

test('look-ahead: pollen judges tomorrow\'s DWD band (POLLEN_TOMORROW)', () => {
  const s = on(['pollen'], { alertPollenDisplay: 'value' });
  const pollen = (today, tomorrow) => ({ POLLEN_TODAY: today, POLLEN_TOMORROW: tomorrow });
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(pollen('1', '2-3'), s)),
    [{ kind: 1, level: 1, value: '2-3', mark: 'raquo' }], '2.5 on the seed 2/3: warn');
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(pollen('1', '3'), s)),
    [{ kind: 1, level: 2, value: '3', mark: 'raquo' }]);
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(pollen('2', '3'), s)),
    [{ kind: 1, level: 1, value: '2' }], 'today wins');
  assert.deepEqual(wire.bakeAlerts(pollen('1', '1-2'), s), [], 'tomorrow below warn');
  assert.deepEqual(wire.bakeAlerts(pollen('1', null), s), [], 'DWD has not issued tomorrow');
  assert.deepEqual(wire.bakeAlerts(pollen(null, 'n/a'), s), [], 'no known band');
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(pollen('1', '0'), Object.assign({
    threshPollenWarn: '0', threshPollenDanger: '0' }, s))), [{ kind: 1, level: 2, value: '1' }],
  'guard: on 0/0 today\'s 1 alerts, and today wins');
  assert.deepEqual(wire.bakeAlerts({ POLLEN_TOMORROW: '0' }, Object.assign({
    threshPollenWarn: '0', threshPollenDanger: '0' }, s)), [], 'a 0 tomorrow never alerts');
  assert.deepEqual(wire.bakeAlerts(pollen('1', '3'), Object.assign({ alertPollenDays: 'today' }, s)), [],
    'Today only');
});

test('look-ahead: Days today, an alert that is not placed, and unknown Days', () => {
  const p = uvDay(5, 5, 9, 8);
  assert.deepEqual(wire.bakeAlerts(p, on(['uv'], { alertUvDays: 'today' })), []);
  assert.deepEqual(wire.bakeAlerts(p, on([])), [], 'unplaced: no entry, whatever tomorrow');
  assert.deepEqual(wire.bakeAlerts(p, on([], { alertUvDays: 'tomorrow' })), [], 'Days alone places nothing');
  ['bogus', '', null, 1, 'constructor'].forEach((v) =>
    assert.equal(decodeAlerts(wire.bakeAlerts(p, on(['uv'], { alertUvDays: v }))).length, 1,
      String(v) + ' reads as the default, Today + tomorrow'));
  // Per alert: one alert's Days never reaches another.
  const pair = Object.assign({}, p, { WIND_TREND_UINT8: [30], WIND_DAY_PEAKS: [30, 70, 0] });
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(pair, on(['uv', 'wind'], { alertUvDays: 'today' })))
    .map((e) => e.kind), [2]);
});

test('look-ahead: the tomorrow mark rides the header, per alert; today\'s entries carry none', () => {
  const p = uvDay(5, 5, 9, 8);
  th.ALERT_NEXT_DAY_MARKS.forEach((mark, i) => {
    const bytes = wire.bakeAlerts(p, on(['uv'], { alertUvNextDayMark: mark }));
    assert.equal(bytes.length, 1, mark + ': no extra byte for the mark');
    assert.equal((bytes[0] >> wire.ALERT_DAY_SHIFT) & 7, i + 1, mark);
    assert.equal(decodeAlerts(bytes)[0].mark, mark);
  });
  [undefined, 'bogus', '»', 'toString', 3].forEach((v) =>
    assert.equal(decodeAlerts(wire.bakeAlerts(p, on(['uv'], { alertUvNextDayMark: v })))[0].mark,
      'raquo', String(v) + ' reads as the default »'));
  // Today's entry is unmarked whatever the mark setting says.
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(uvDay(2, 8, 9, 0),
    on(['uv'], { alertUvNextDayMark: 'star' }))), [{ kind: 7, level: 2, value: '' }]);
  // Each alert its own mark; the icon look carries the mark too.
  const both = Object.assign({}, p, { WIND_TREND_UINT8: [30], WIND_DAY_PEAKS: [30, 70, 0] });
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(both, on(['uv', 'wind'], { alertUvNextDayMark: 'none',
    alertWindNextDayMark: 'star', alertWindDisplay: 'value' }))),
  [{ kind: 7, level: 2, value: '', mark: 'none' }, { kind: 2, level: 2, value: '70', mark: 'star' }]);
});

test('look-ahead: all five tomorrow with their widest values still fit the 20 B cap', () => {
  const p = {
    UV_TREND_UINT8: [0], UV_DAY_PEAKS: [0, 110, 0],
    WIND_TREND_UINT8: [0], WIND_DAY_PEAKS: [0, 255, 0],
    GUST_TREND_UINT8: [0], GUST_DAY_PEAKS: [0, 255, 0],
    AQI_TREND: [0], AQI_DAY_PEAKS: [0, 500, 0],
    POLLEN_TODAY: '0', POLLEN_TOMORROW: '2-3'
  };
  const s = Object.assign({}, ALL_ON, {
    alertUvDisplay: 'value', alertWindDisplay: 'value', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value', aqiSource: 'openmeteo', aqiScale: 'us',
    alertUvNextDayMark: 'star', alertAqiNextDayMark: 'none' });
  const bytes = wire.bakeAlerts(p, s);
  assert.equal(bytes.length, 19, '5 headers + "255" "11" "500" "2-3" "255"');
  assert.ok(bytes.length <= wire.ALERT_ENTRIES_MAX_BYTES);
  assert.deepEqual(decodeAlerts(bytes), [
    { kind: 3, level: 2, value: '255', mark: 'raquo' },
    { kind: 7, level: 2, value: '11', mark: 'star' },
    { kind: 0, level: 2, value: '500', mark: 'none' },
    { kind: 1, level: 1, value: '2-3', mark: 'raquo' },
    { kind: 2, level: 2, value: '255', mark: 'raquo' }
  ]);
  // Mixed days tail-drop by the same byte rule: a 7-digit AQI today pushes the
  // tail — wind's tomorrow entry — out, never a middle one.
  const wide = Object.assign({}, p, { AQI_TREND: [1234567], AQI_DAY_PEAKS: [1234567, 500, 0] });
  assert.deepEqual(decodeAlerts(wire.bakeAlerts(wide, s)).map((e) => e.kind), [3, 7, 0, 1]);
});
