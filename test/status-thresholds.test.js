'use strict';
const test = require('node:test');
const { NOTHING_PLACED, placeOn, placedOnly } = require('./helpers/on-demand.js');
const assert = require('node:assert/strict');
const th = require('../src/pkjs/status-thresholds.js');
const statusLines = require('../src/pkjs/status-lines.js');
const { packedLevel, judged } = require('./helpers/weather-levels.js');
const { decodeAlerts: decodeEntries } = require('./helpers/alert-entries.js');

test('kind order is the wire order (index = ThreshKind)', () => {
  assert.deepEqual(th.KINDS.map(k => k.code),
    ['aqi', 'pollen', 'wind', 'gust', 'steps', 'sleep', 'distance', 'uv',
     'temp', 'pressure', 'sun', 'date', 'week', 'city', 'countdown', 'hr',
     'batteryPct', 'dew', 'phoneBattery', 'phoneBatteryPlain']);
  // Two kinds, ONE settings key. The sheet resolver maps a catalog code to
  // 'thresh' + KINDS[i].key, so both phone-battery codes land on the single
  // threshPhoneBattery* sheet — one Bold row covering the iconed and the no-icon
  // variant. The duplicate is deliberate; see the packer test below.
  assert.deepEqual(th.KINDS.map(k => k.key),
    ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance', 'Uv',
     'Temp', 'Pressure', 'Sun', 'Date', 'Week', 'City', 'Countdown', 'Hr',
     'BatteryPct', 'Dew', 'PhoneBattery', 'PhoneBattery']);
  // The bold-only flag covers exactly the appended kinds 8..19 (the GLYPH
  // battery is deliberately absent: a drawn glyph with no text run has nothing
  // to bold; the battery-% TEXT slot is kind 16, dew point kind 17, and the two
  // phone-battery TEXT slots are kinds 18/19).
  assert.deepEqual(th.KINDS.map(k => Boolean(k.boldOnly)),
    [false, false, false, false, false, false, false, false,
     true, true, true, true, true, true, true, true, true, true, true, true]);
});

// 'PhoneBattery' is the ONLY duplicated settings key in the table. buildSettingsBlob
// walks KINDS by index and looks up settings['thresh' + k.key + 'BoldMode'] per
// entry, so a shared key is a plain double lookup — but nothing in the module says
// so, and a future "keys are unique" assumption (a key -> index map, say) would
// silently drop one of the two cells. Pin the behaviour end to end.
test('the duplicated PhoneBattery key writes ONE bold mode into BOTH cells', () => {
  // kind 18 -> byte 29 + (18 >> 2) = 33, bits 2 * (18 & 3) = 4-5
  // kind 19 -> byte 33, bits 2 * (19 & 3) = 6-7
  Object.keys(th.BOLD_MODES).forEach((mode) => {
    const blob = th.buildSettingsBlob({ threshPhoneBatteryBoldMode: mode });
    assert.equal(blob.length, 48, mode + ': the duplicate must not widen the blob');
    assert.equal((blob[33] >> 4) & 3, th.BOLD_MODES[mode], mode + ': phoneBattery cell (kind 18)');
    assert.equal((blob[33] >> 6) & 3, th.BOLD_MODES[mode], mode + ': phoneBatteryPlain cell (kind 19)');
    // The byte-mates (battery % and dew) keep the warn default.
    assert.equal(blob[33] & 0x0F, 0, mode + ': kinds 16/17 untouched');
  });
  // 'always' is the only mode that visibly changes anything on a level-less kind.
  assert.equal(th.buildSettingsBlob({ threshPhoneBatteryBoldMode: 'always' })[33], 0xA0);
  // There is no per-variant setting: a plain-only key is not a thing the schema
  // emits, and writing one must change nothing.
  assert.equal(th.buildSettingsBlob({ threshPhoneBatteryPlainBoldMode: 'always' })[33], 0);
  // The duplicate key must not confuse the key-keyed helpers either — they
  // return on the first match, and 'PhoneBattery' is not a goal kind.
  assert.equal(th.isGoalKind('PhoneBattery'), false);
});

test('the phone-battery cells share byte 33 with battery % and dew without bleeding', () => {
  const blob = th.buildSettingsBlob({
    threshBatteryPctBoldMode: 'always',   // kind 16 -> bits 0-1
    threshDewBoldMode: 'off',             // kind 17 -> bits 2-3
    threshPhoneBatteryBoldMode: 'off'     // kinds 18 AND 19 -> bits 4-5, 6-7
  });
  assert.equal(blob.length, 48, 'byte 33 was already paid for — no widening');
  assert.equal(blob[33], (2 << 0) | (1 << 2) | (1 << 4) | (1 << 6));
  assert.deepEqual(blob.slice(th.BOLD_OFFSET, 33), [0, 0, 0, 0],
    'the earlier bold bytes stay at the warn default');
});

// The regression the design calls out: a no-icon TEXT slot that has no kind of
// its own falls through to City on the watch, so its Bold row silently drives
// City's. Its JS twin is the packed cell — pin that the phone-battery modes and
// City's land in different cells.
test('the phone-battery bold cells are not City\'s (the pressure-slot bug, JS side)', () => {
  const phone = th.buildSettingsBlob({ threshPhoneBatteryBoldMode: 'always' });
  const city = th.buildSettingsBlob({ threshCityBoldMode: 'always' });
  assert.notDeepEqual(phone, city, 'phone battery and city must pack into different cells');
  assert.equal(phone[32], 0, 'phone battery writes nothing into city\'s byte');
  assert.equal(city[33], 0, 'city writes nothing into byte 33');
  // ...and neither shares a cell with the other no-icon TEXT items in byte 33.
  const dew = th.buildSettingsBlob({ threshDewBoldMode: 'always' });
  assert.notDeepEqual(phone, dew);
});

test('computeLevel: above-is-worse boundaries are inclusive', () => {
  assert.equal(th.computeLevel(99, 100, 200), 0);
  assert.equal(th.computeLevel(100, 100, 200), 1);
  assert.equal(th.computeLevel(199, 100, 200), 1);
  assert.equal(th.computeLevel(200, 100, 200), 2);
});

test('parseThreshold: blank/junk are null; comma decimals, 0 and negatives parse', () => {
  assert.equal(th.parseThreshold(''), null);
  assert.equal(th.parseThreshold('  '), null);
  assert.equal(th.parseThreshold(undefined), null);
  assert.equal(th.parseThreshold(null), null);
  assert.equal(th.parseThreshold('abc'), null);
  assert.equal(th.parseThreshold('7.5'), 7.5);
  assert.equal(th.parseThreshold('7,5'), 7.5);
  assert.equal(th.parseThreshold(0), 0);
  assert.equal(th.parseThreshold('-2'), -2);
});

test('a kind is enabled only when its stored toggle is on AND its pair is ordered', () => {
  // The stored thresh<Kind>On owns the enable bit: an ordered pair alone no
  // longer enables (it did while the page derived On from the pair).
  const pair = { threshAqiWarn: '100', threshAqiDanger: '200' };
  assert.equal(th.kindConfig({}, 0).enabled, false);
  assert.equal(th.kindConfig(pair, 0).enabled, false, 'On absent: bit clear');
  assert.equal(th.kindConfig(Object.assign({ threshAqiOn: false }, pair), 0).enabled, false,
    'On false: bit clear, the pair is kept for the levels');
  assert.equal(th.kindConfig(Object.assign({ threshAqiOn: true }, pair), 0).enabled, true);
  // Only a real boolean true counts — a stringly 'true' is not the toggle.
  assert.equal(th.kindConfig(Object.assign({ threshAqiOn: 'true' }, pair), 0).enabled, false);
  // On + a blank pair enables on the SEED pair (a blank pair means the seed).
  const seeded = th.kindConfig({ threshAqiOn: true, threshAqiWarn: '', threshAqiDanger: '' }, 0);
  assert.deepEqual([seeded.enabled, seeded.warn, seeded.danger], [true, 100, 150]);
  // A half or inverted pair resolves to the seed as a whole — never a mix.
  const half = th.kindConfig({ threshAqiOn: true, threshAqiWarn: '120' }, 0);
  assert.deepEqual([half.enabled, half.warn, half.danger], [true, 100, 150]);
  const inverted = th.kindConfig(
    { threshAqiOn: true, threshAqiWarn: '200', threshAqiDanger: '100' }, 0);
  assert.deepEqual([inverted.enabled, inverted.warn, inverted.danger], [true, 100, 150]);
  // Goal kinds order upward since the celebration rework: close (warn slot) <= goal.
  const steps = th.kindConfig(
    { threshStepsOn: true, threshStepsWarn: '4000', threshStepsDanger: '8000' }, 4);
  assert.deepEqual([steps.enabled, steps.warn, steps.danger], [true, 4000, 8000]);
  assert.equal(th.kindConfig({ threshStepsWarn: '4000', threshStepsDanger: '8000' }, 4).enabled,
    false);
  // Equal thresholds are a valid pair.
  const equal = th.kindConfig(
    { threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '100' }, 0);
  assert.deepEqual([equal.enabled, equal.warn, equal.danger], [true, 100, 100]);
});

test('seedPair: the per-kind seeds, in display units, following the unit pickers', () => {
  assert.deepEqual(th.seedPair('Uv', {}), { warn: 6, danger: 8 });
  assert.deepEqual(th.seedPair('Pollen', {}), { warn: 2, danger: 3 });
  assert.deepEqual(th.seedPair('Wind', {}), { warn: 40, danger: 60 }, 'kph by default');
  assert.deepEqual(th.seedPair('Wind', { windUnits: 'kph' }), { warn: 40, danger: 60 });
  assert.deepEqual(th.seedPair('Wind', { windUnits: 'mph' }), { warn: 25, danger: 40 });
  assert.deepEqual(th.seedPair('Wind', { windUnits: 'knots' }), { warn: 20, danger: 30 });
  assert.deepEqual(th.seedPair('Gust', { windUnits: 'kph' }), { warn: 60, danger: 90 });
  assert.deepEqual(th.seedPair('Gust', { windUnits: 'mph' }), { warn: 40, danger: 55 });
  assert.deepEqual(th.seedPair('Gust', { windUnits: 'knots' }), { warn: 30, danger: 50 });
  // AQI: the European scale only for Open-Meteo with a non-US scale picked;
  // WAQI and auto report US-style AQI whatever the picker says.
  assert.deepEqual(th.seedPair('Aqi', {}), { warn: 100, danger: 150 });
  assert.deepEqual(th.seedPair('Aqi', { aqiSource: 'openmeteo' }), { warn: 60, danger: 80 });
  assert.deepEqual(th.seedPair('Aqi', { aqiSource: 'openmeteo', aqiScale: 'european' }),
    { warn: 60, danger: 80 });
  assert.deepEqual(th.seedPair('Aqi', { aqiSource: 'openmeteo', aqiScale: 'us' }),
    { warn: 100, danger: 150 });
  assert.deepEqual(th.seedPair('Aqi', { aqiSource: 'waqi', aqiScale: 'european' }),
    { warn: 100, danger: 150 });
  assert.deepEqual(th.seedPair('Aqi', { aqiSource: 'auto', aqiScale: 'european' }),
    { warn: 100, danger: 150 });
  assert.deepEqual(th.seedPair('Steps', {}), { warn: 8000, danger: 10000 });
  assert.deepEqual(th.seedPair('Sleep', {}), { warn: 6.5, danger: 7.5 });
  assert.deepEqual(th.seedPair('Distance', {}), { warn: 4, danger: 5 });
  assert.deepEqual(th.seedPair('Distance', { distanceUnits: 'imperial' }),
    { warn: 2.5, danger: 3 });
  // No seed for a bold-only or unknown stem; absent settings are tolerated.
  assert.deepEqual(th.seedPair('Temp', {}), { warn: null, danger: null });
  assert.deepEqual(th.seedPair('Nope', {}), { warn: null, danger: null });
  assert.deepEqual(th.seedPair('Wind', undefined), { warn: 40, danger: 60 });
  // Every paired kind has an ordered seed — which is what makes the ungated
  // level packing and the On-plus-blank enable rule well-defined.
  th.KINDS.filter(k => !k.boldOnly).forEach((k) => {
    const seed = th.seedPair(k.key, {});
    assert.ok(th.pairOrdered(seed.warn, seed.danger), k.key + ' seed must be ordered');
  });
});

test('scaleVariant: the one key the seeds and the slider geometry are tabled under', () => {
  const v = th.scaleVariant;
  ['Wind', 'Gust'].forEach((stem) => {
    assert.equal(v(stem, {}), 'kph', stem + ': kph by default');
    assert.equal(v(stem, { windUnits: 'kph' }), 'kph');
    assert.equal(v(stem, { windUnits: 'mph' }), 'mph');
    assert.equal(v(stem, { windUnits: 'knots' }), 'kn');
  });
  // AQI: European only for Open-Meteo with a non-US scale picked.
  assert.equal(v('Aqi', {}), 'us');
  assert.equal(v('Aqi', { aqiSource: 'openmeteo' }), 'eu');
  assert.equal(v('Aqi', { aqiSource: 'openmeteo', aqiScale: 'european' }), 'eu');
  assert.equal(v('Aqi', { aqiSource: 'openmeteo', aqiScale: 'us' }), 'us');
  assert.equal(v('Aqi', { aqiSource: 'waqi', aqiScale: 'european' }), 'us');
  assert.equal(v('Aqi', { aqiSource: 'auto', aqiScale: 'european' }), 'us');
  assert.equal(v('Distance', {}), 'km');
  assert.equal(v('Distance', { distanceUnits: 'imperial' }), 'mi');
  ['Uv', 'Pollen', 'Steps', 'Sleep', 'Temp'].forEach((stem) => assert.equal(v(stem, {}), '', stem));
  assert.equal(v('Wind', undefined), 'kph', 'absent settings are tolerated');
  // Every variant a paired kind can take has a seed — the table is plain data keyed
  // by it, so a variant without a row would be a crash, not a wrong number.
  const pickers = [];
  [undefined, 'kph', 'mph', 'knots'].forEach((windUnits) =>
    [undefined, 'metric', 'imperial'].forEach((distanceUnits) =>
      [undefined, 'waqi', 'auto', 'openmeteo'].forEach((aqiSource) =>
        [undefined, 'european', 'us'].forEach((aqiScale) =>
          pickers.push({ windUnits, distanceUnits, aqiSource, aqiScale })))));
  th.KINDS.filter((k) => !k.boldOnly).forEach((k) => pickers.forEach((s) => {
    const seed = th.seedPair(k.key, s);
    assert.ok(typeof seed.warn === 'number' && typeof seed.danger === 'number',
      k.key + ' has a seed for ' + v(k.key, s));
  }));
});

test('resolvedPair: a stored ordered pair wins; blank, half or inverted resolves to the seed', () => {
  assert.deepEqual(th.resolvedPair('Uv', { threshUvWarn: '7', threshUvDanger: '9' }),
    { warn: 7, danger: 9, stored: true });
  assert.deepEqual(th.resolvedPair('Uv', { threshUvWarn: '3,5', threshUvDanger: '3.5' }),
    { warn: 3.5, danger: 3.5, stored: true }, 'comma decimals, equal pair');
  assert.deepEqual(th.resolvedPair('Uv', { threshUvWarn: '0', threshUvDanger: '0' }),
    { warn: 0, danger: 0, stored: true }, '0 is a set value, not unset');
  const seed = { warn: 6, danger: 8, stored: false };
  assert.deepEqual(th.resolvedPair('Uv', {}), seed, 'absent');
  assert.deepEqual(th.resolvedPair('Uv', { threshUvWarn: '', threshUvDanger: '' }), seed,
    'blank');
  assert.deepEqual(th.resolvedPair('Uv', { threshUvWarn: '7' }), seed, 'half (warn only)');
  assert.deepEqual(th.resolvedPair('Uv', { threshUvDanger: '0' }), seed, 'half (danger 0 only)');
  assert.deepEqual(th.resolvedPair('Uv', { threshUvWarn: '9', threshUvDanger: '7' }), seed,
    'inverted');
  assert.deepEqual(th.resolvedPair('Uv', { threshUvWarn: 'x', threshUvDanger: '8' }), seed,
    'junk');
  // The seed follows the unit pickers live: a blank wind pair tracks windUnits.
  assert.deepEqual(th.resolvedPair('Wind', { windUnits: 'mph' }),
    { warn: 25, danger: 40, stored: false });
  assert.deepEqual(th.resolvedPair('Wind', null), { warn: 40, danger: 60, stored: false });
});

test('the contract no longer carries a day-max pick of its own: the slot reads wire-units', () => {
  // The warn-level hold is gone (decision A): the slot text, its arrow and the
  // highlight all read wire-units' dayMaxShown directly, so no pair or toggle can
  // move which peak a slot shows.
  assert.equal(th.shownDayMax, undefined);
  const p = { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [70, 90, 80] };
  ['6', '7', '8'].forEach((warn) => {
    assert.equal(statusLines.formatValue('uv', p, { uvSlotDisplay: 'max', threshUvWarn: warn,
      threshUvDanger: '9', threshUvOn: true }), '»9', 'warn ' + warn + ': tomorrow\'s peak');
  });
});

test('packWeatherLevels: each kind\'s shown value against its resolved pair, whatever the toggle says', () => {
  const payload = { UV_TREND_UINT8: [70], AQI_TREND: [120], POLLEN_TODAY: '3' };
  assert.equal(packedLevel('uv', payload, {}), 1, 'UV 7 against the seed 6/8');
  assert.equal(packedLevel('uv', payload, { threshUvOn: false }), 1, 'toggle off: same level');
  assert.equal(packedLevel('uv', payload, { threshUvWarn: '7', threshUvDanger: '7' }), 2,
    'stored pair');
  assert.equal(packedLevel('uv', { UV_TREND_UINT8: [40] }, {}), 0);
  assert.equal(packedLevel('aqi', payload, {}), 1, 'AQI 120 against the US seed 100/150');
  assert.equal(packedLevel('aqi', payload, { aqiSource: 'openmeteo' }), 2,
    'the same 120 is danger against the EU seed 60/80');
  assert.equal(packedLevel('pollen', payload, {}), 2, 'band 3 against the seed 2/3');
  // No displayed number: no level, not even under a pair every number crosses.
  const zero = { threshUvWarn: '0', threshUvDanger: '0', threshWindWarn: '0', threshWindDanger: '0' };
  assert.equal(packedLevel('uv', {}, zero), 0);
  assert.equal(packedLevel('wind', {}, zero), 0);
  // Goal and bold-only kinds never level phone-side: only the weather kinds' bits move.
  assert.deepEqual(th.packWeatherLevels({ TEMP_TREND_UINT8: [250] },
    { threshStepsWarn: '0', threshStepsDanger: '0', threshTempWarn: '0', threshTempDanger: '0' }),
  [0, 0]);
});

test('the highlight judges the numbers status-lines.js displays', () => {
  const payload = { AQI_TREND: [153.4], WIND_TREND_UINT8: [50], GUST_TREND_UINT8: [90], POLLEN_TODAY: '2-3' };
  assert.equal(judged('aqi', payload, {}), 153);
  // POLLEN_TODAY is a DWD band STRING, not a number; '2-3' maps to 2.5.
  assert.equal(judged('pollen', payload, {}), 2.5);
  assert.equal(judged('pollen', { POLLEN_TODAY: '1' }, {}), 1);
  assert.equal(judged('pollen', { POLLEN_TODAY: '0-1' }, {}), 0.5);
  assert.equal(judged('wind', payload, { windUnits: 'kph' }), 50);
  assert.equal(judged('wind', payload, { windUnits: 'mph' }), 31);   // round(50/1.60934)
  assert.equal(judged('gust', payload, { windUnits: 'knots' }), 49); // round(90/1.852)
  assert.equal(judged('aqi', {}, {}), null);
  assert.equal(judged('pollen', { POLLEN_TODAY: null }, {}), null);
  assert.equal(judged('pollen', { POLLEN_TODAY: 'n/a' }, {}), null); // unknown band
});

// Binding test for the feature's central correctness requirement: a threshold compares
// against the number the user SEES. status-thresholds.js duplicates formatWind()'s
// divisors (1.60934 / 1.852) from status-lines.js, and the assertions above pin only the
// literals 31/49 — so a change to the formatter's rounding (or a new unit) would silently
// desync the highlight from the on-screen number with every test still green. Pin
// the judged number to the FORMATTER'S OUTPUT instead. formatValue appends the unit label
// ("31mph" / "27kn" / "50kph"), so the displayed number is its leading integer.
test('the judged number is pinned to what status-lines actually displays (wind, gust, aqi)', () => {
  const payload = { WIND_TREND_UINT8: [50], GUST_TREND_UINT8: [90], AQI_TREND: [153.4] };
  ['kph', 'mph', 'knots'].forEach(unit => {
    ['wind', 'gust'].forEach(code => {
      const shown = statusLines.formatValue(code, payload, { windUnits: unit });
      assert.match(shown, /^\d+(kph|mph|kn)$/,
        code + ' in ' + unit + ' must format as <integer><unit>, got "' + shown + '"');
      assert.equal(judged(code, payload, { windUnits: unit }), parseInt(shown, 10),
        code + ' threshold must compare against the displayed number (' + unit + ': "' + shown + '")');
    });
  });
  const aqiShown = statusLines.formatValue('aqi', payload, {});
  assert.equal(judged('aqi', payload, {}), parseInt(aqiShown, 10),
    'AQI threshold must compare against the displayed number ("' + aqiShown + '")');
  // Pollen is deliberately NOT bindable this way: formatValue shows the DWD band string
  // ('2-3'), while the highlight judges its numeric level 2.5 the threshold is entered
  // on — parseInt('2-3') would be 2. The band -> level mapping is covered above.
});

test('packWeatherLevels packs 2 bits per kind in wire order', () => {
  const payload = { AQI_TREND: [150], POLLEN_TODAY: '3', WIND_TREND_UINT8: [10], GUST_TREND_UINT8: [80] };
  const settings = {
    threshAqiWarn: '100', threshAqiDanger: '200',   // 150 -> warn (01)
    threshPollenWarn: '2', threshPollenDanger: '3', // 3 -> danger (10)
    threshWindWarn: '40', threshWindDanger: '60',   // 10 -> normal (00)
    threshGustWarn: '70', threshGustDanger: '100',  // 80 -> warn (01)
    windUnits: 'kph'
  };
  assert.deepEqual(th.packWeatherLevels(payload, settings), [0x49, 0]);   // 2 wire bytes since UV
});

test('packWeatherLevels: UV rides byte 1 bits 0-1 (kind 7 -> shift 8)', () => {
  const settings = { threshUvWarn: '6', threshUvDanger: '8' };
  assert.deepEqual(th.packWeatherLevels({ UV_TREND_UINT8: [70] }, settings), [0, 1],
    'UV 7 crosses warn 6');
  assert.deepEqual(th.packWeatherLevels({ UV_TREND_UINT8: [85] }, settings), [0, 2],
    'UV 8.5 -> displayed 9 crosses danger 8');
});

test('packWeatherLevels: a UV slot showing a peak is judged on the highest value it shows', () => {
  const settings = { threshUvWarn: '6', threshUvDanger: '8' };
  // Now 2, today's peak 8 still ahead.
  const payload = { UV_TREND_UINT8: [20, 45, 70, 80], UV_DAY_PEAKS: [80, 100] };
  assert.deepEqual(th.packWeatherLevels(payload, settings), [0, 0],
    'current mode (absent): the 2 on screen is below warn');
  assert.deepEqual(th.packWeatherLevels(payload,
    Object.assign({ uvSlotDisplay: 'max' }, settings)), [0, 2], 'max: the 8 on screen is danger');
  assert.deepEqual(th.packWeatherLevels(payload,
    Object.assign({ uvSlotDisplay: 'both' }, settings)), [0, 2], 'both: "2/8" is highlighted for its 8');
  const noPeaks = { UV_TREND_UINT8: payload.UV_TREND_UINT8 };
  assert.deepEqual(th.packWeatherLevels(noPeaks,
    Object.assign({ uvSlotDisplay: 'both' }, settings)), [0, 0],
    'no day peaks: the slot falls back to the current value, and so does its level');
});

test('packWeatherLevels: tomorrow\'s marked peak never counts until it is today\'s', () => {
  const settings = { threshUvWarn: '6', threshUvDanger: '8' };
  const both = Object.assign({ uvSlotDisplay: 'both' }, settings);
  const max = Object.assign({ uvSlotDisplay: 'max' }, settings);
  // Evening, today spent: "0/»9" is judged on today's 0, not tomorrow's 9.
  const evening = { UV_TREND_UINT8: [0], UV_DAY_PEAKS: [0, 90] };
  assert.equal(statusLines.formatValue('uv', evening, both), '0/»9');
  assert.deepEqual(th.packWeatherLevels(evening, both), [0, 0], '"0/»9" judged on its 0');
  assert.equal(statusLines.formatValue('uv', evening, max), '»9');
  assert.deepEqual(th.packWeatherLevels(evening, max), [0, 0], 'a lone "»9" is not highlighted');
  // Falling below warn with a higher tomorrow: "5/»7" is judged on its 5, and max
  // mode's lone "»7" not at all. The UV alert icon judges tomorrow on its own: its
  // tomorrow entry carries the 7 at warn.
  const falling = { UV_TREND_UINT8: [50], UV_DAY_PEAKS: [50, 70, 80] };
  assert.equal(statusLines.formatValue('uv', falling, both), '5/»7');
  assert.deepEqual(th.packWeatherLevels(falling, both), [0, 0]);
  assert.deepEqual(th.packWeatherLevels(falling, max), [0, 0]);
  const alertTomorrow = placedOnly(['uv'], { alertUvDays: 'tomorrow' });
  assert.equal(decodeAlerts(th.bakeAlerts(falling, Object.assign({}, max, alertTomorrow)))[0].level, 1,
    'the alert icon still warns about tomorrow\'s 7');
  // Next morning the same peak is TODAY's (unmarked) and counts: "2/9" is danger.
  const morning = { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [90, 60] };
  assert.deepEqual(th.packWeatherLevels(morning, both), [0, 2]);
});

test('packWeatherLevels: a falling 7 rolls on, judged on its 7 in Both and not at all alone', () => {
  // UV 7 falling from an 8 (behind us), tomorrow 5: the slot shows "7/»5", judged on
  // the 7 (warn), and Day max's lone "»5" is judged on nothing.
  const settings = { threshUvWarn: '6', threshUvDanger: '8' };
  const falling = { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [70, 50, 80] };
  const both = Object.assign({ uvSlotDisplay: 'both' }, settings);
  const max = Object.assign({ uvSlotDisplay: 'max' }, settings);
  assert.equal(statusLines.formatValue('uv', falling, both), '7/»5');
  assert.deepEqual(th.packWeatherLevels(falling, both), [0, 1], '"7/»5": warn on the 7');
  assert.equal(statusLines.formatValue('uv', falling, max), '»5');
  assert.deepEqual(th.packWeatherLevels(falling, max), [0, 0], '"»5": nothing');
  // Today's peak unknown: "7/»9" is still judged on its 7, never on tomorrow's 9.
  const higher = { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [null, 90, 0] };
  assert.equal(statusLines.formatValue('uv', higher, both), '7/»9');
  assert.deepEqual(th.packWeatherLevels(higher, both), [0, 1], '"7/»9": warn on the 7');
  // The seed pair (6/8) when none is stored: the same levels.
  assert.deepEqual(th.packWeatherLevels(falling, { uvSlotDisplay: 'both' }), [0, 1]);
  assert.deepEqual(th.packWeatherLevels(falling, { uvSlotDisplay: 'max' }), [0, 0]);
});

test('packWeatherLevels: only missing data emits normal — levels pack whatever the toggle', () => {
  assert.deepEqual(th.packWeatherLevels({}, { threshAqiWarn: '1', threshAqiDanger: '2' }), [0, 0]);
  // No stored pair: the seed (US 100/150) levels AQI 500 as danger...
  assert.deepEqual(th.packWeatherLevels({ AQI_TREND: [500] }, {}), [2, 0]);
  // ...and the highlight toggle does not gate the level: the watch gates the
  // slot on the Clay blob's enable bit first, so an off kind still renders plain.
  const pair = { threshAqiWarn: '100', threshAqiDanger: '200' };
  [undefined, false, true].forEach((on) => {
    assert.deepEqual(th.packWeatherLevels({ AQI_TREND: [150] },
      Object.assign({ threshAqiOn: on }, pair)), [1, 0], 'threshAqiOn ' + on);
  });
});

test('packWeatherLevels: UV thresholds with no UV series emit normal in every display mode', () => {
  // Bright Sky, a failed UV fetch or no UV slot: wireUnits.dayMaxShown answers null, and
  // the level must stay Normal rather than throw on its peak. Warn '0' also catches a
  // missing value read as 0 (0 >= 0 would be warn).
  const payloads = [{}, { UV_TREND_UINT8: [] }, { UV_TREND_UINT8: [], UV_DAY_PEAKS: [90, 90] }];
  [undefined, 'current', 'max', 'both'].forEach((uvSlotDisplay) => {
    const settings = { threshUvWarn: '0', threshUvDanger: '8', uvSlotDisplay: uvSlotDisplay };
    payloads.forEach((payload) => {
      assert.deepEqual(th.packWeatherLevels(payload, settings), [0, 0],
        String(uvSlotDisplay) + ' ' + JSON.stringify(payload));
    });
  });
});

test('buildSettingsBlob: enabled mask, GColor8 colors, LE uint16 health thresholds', () => {
  // Goal pairs order upward since the celebration rework (close <= goal).
  const blob = th.buildSettingsBlob({
    threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00, threshAqiDangerColor: 0xFF0000,
    threshStepsOn: true, threshStepsWarn: '4000', threshStepsDanger: '8000',
    threshSleepOn: true, threshSleepWarn: '5', threshSleepDanger: '7.5',
    threshDistanceOn: true, threshDistanceWarn: '2', threshDistanceDanger: '5',
    // An ordered pair with the toggle off sets no bit (wind, kind 2).
    threshWindOn: false, threshWindWarn: '30', threshWindDanger: '50'
  });
  assert.equal(blob.length, 48);
  assert.equal(blob[0], (1 << 0) | (1 << 4) | (1 << 5) | (1 << 6));
  assert.equal(blob[1], 0xF8);   // rgbToGColor8(0xFFAA00)
  assert.equal(blob[2], 0xF0);   // rgbToGColor8(0xFF0000)
  // Goal kinds with UNSET colors pack the goal green (0x55FF00 -> GColor8 0xDC)
  // for both slots — the green celebration default, not the warn-none sentinel.
  assert.equal(blob[1 + 2 * 4], 0xDC, 'steps close color defaults green');
  assert.equal(blob[2 + 2 * 4], 0xDC, 'steps goal color defaults green');
  assert.deepEqual(blob.slice(17, 21), [0xA0, 0x0F, 0x40, 0x1F]); // steps 4000/8000 LE
  assert.deepEqual(blob.slice(21, 25), [300 & 0xFF, 300 >> 8, 450 & 0xFF, 450 >> 8]); // sleep h -> min
  assert.deepEqual(blob.slice(25, 29), [20, 0, 50, 0]);           // km -> 100 m units
});

// The settings page stores an "auto" highlight colour as the theme's concrete text
// colour (black or white) and re-derives it on every open. 1.11-1.19 never converted it
// when Theme changed, so a blob saved light-then-dark and never re-saved holds BLACK
// under a dark theme -- packed verbatim, that is a black outline and a black fill on
// the black face. The packer resolves black/white for the theme it packs for.
const AQI_ON = { threshAqiWarn: '100', threshAqiDanger: '200' };
const aqiBytes = (settings) => {
  const blob = th.buildSettingsBlob(Object.assign({}, AQI_ON, settings));
  return [blob[1], blob[2]];   // Aqi warn, danger (kind 0)
};

test('buildSettingsBlob: a stale black auto colour under a dark theme packs white', () => {
  for (const theme of ['dark', 'bw', undefined]) {
    assert.deepEqual(aqiBytes({ theme, threshAqiWarnColor: 0, threshAqiDangerColor: 0 }),
      [0xFF, 0xFF], String(theme) + ': int 0 (the phone\'s stored encoding)');
    assert.deepEqual(aqiBytes({ theme, threshAqiWarnColor: '#000000',
      threshAqiDangerColor: '#000000' }), [0xFF, 0xFF], String(theme) + ': the page\'s hex');
  }
});

test('buildSettingsBlob: a stale white auto colour under a light theme packs black', () => {
  for (const theme of ['light', 'bw-light']) {
    assert.deepEqual(aqiBytes({ theme, threshAqiWarnColor: 0xFFFFFF,
      threshAqiDangerColor: 0xFFFFFF }), [0xC0, 0xC0], theme);
    assert.deepEqual(aqiBytes({ theme, threshAqiWarnColor: '#ffffff',
      threshAqiDangerColor: '#FFFFFF' }), [0xC0, 0xC0], theme + ': any hex case');
  }
});

test('buildSettingsBlob: consistent auto colours, picks and the no-outline marker are unchanged', () => {
  assert.deepEqual(aqiBytes({ theme: 'light', threshAqiWarnColor: 0, threshAqiDangerColor: 0 }),
    [0xC0, 0xC0], 'black on light stays black');
  assert.deepEqual(aqiBytes({ theme: 'dark', threshAqiWarnColor: 0xFFFFFF,
    threshAqiDangerColor: 0xFFFFFF }), [0xFF, 0xFF], 'white on dark stays white');
  for (const theme of ['dark', 'light']) {
    assert.deepEqual(aqiBytes({ theme, threshAqiWarnColor: 0xFFAA00,
      threshAqiDangerColor: 0xFF0000 }), [0xF8, 0xF0], theme + ': picks are never touched');
    // A blank warn colour is AUTO now — the theme's text colour — and the no-box
    // marker 0x00 is the warn look 'none' alone.
    assert.equal(aqiBytes({ theme, threshAqiWarnColor: '', threshAqiDangerColor: 0 })[0],
      theme === 'light' ? 0xC0 : 0xFF, theme + ': a blank warn is the theme fg');
    assert.equal(aqiBytes({ theme, threshAqiWarnColor: 0xFFAA00, threshAqiWarnLook: 'none' })[0],
      0x00, theme + ': look none is the no-box marker, whatever the colour');
  }
  // Absent danger on a weather kind is still the contract's red fallback.
  assert.equal(aqiBytes({ theme: 'dark' })[1], 0xF0);
});

test('buildSettingsBlob: the night copy resolves the auto colour for the night theme', () => {
  const themeSchedule = require('../src/pkjs/theme-schedule.js');
  // B&W by day hides a stale black (the watch paints theme_fg on bw); bw -> dark is no
  // polarity flip, so theme-flip leaves the 0 alone and only the packer can fix it.
  const stored = Object.assign({ theme: 'bw', themeAuto: true, themeNight: 'dark',
    threshAqiWarnColor: 0, threshAqiDangerColor: 0 }, AQI_ON);
  const night = themeSchedule.effectiveSettings(stored, true);
  assert.equal(night.theme, 'dark');
  const blob = th.buildSettingsBlob(night);
  assert.deepEqual([blob[1], blob[2]], [0xFF, 0xFF]);
});

test('buildSettingsBlob: goal kinds resolve a stale black/white to the goal green, as the page does', () => {
  const goalBytes = (settings) => {
    const blob = th.buildSettingsBlob(Object.assign({
      threshStepsWarn: '4000', threshStepsDanger: '8000' }, settings));
    return [blob[1 + 2 * 4], blob[2 + 2 * 4]];
  };
  for (const theme of ['dark', 'light']) {
    for (const c of [0, 0xFFFFFF]) {
      assert.deepEqual(goalBytes({ theme, threshStepsWarnColor: c, threshStepsDangerColor: c }),
        [0xDC, 0xDC], theme + ' ' + c.toString(16));
    }
    assert.deepEqual(goalBytes({ theme, threshStepsWarnColor: 0xFFAA00,
      threshStepsDangerColor: 0xFF0000 }), [0xF8, 0xF0], theme + ': goal picks are kept');
  }
});

test('thresholdColor: THE colour rule — auto per theme and kind, a pick as is, look-blind', () => {
  const c = (settings, stem, which) => th.thresholdColor(settings, stem, which);
  // Unset: warn is the text colour (weather) or green (goal); danger red or green.
  assert.equal(c({}, 'Uv', 'Warn'), 0xFFFFFF);
  assert.equal(c({ theme: 'light' }, 'Uv', 'Warn'), 0x000000);
  assert.equal(c({ theme: 'bw-light' }, 'Uv', 'Warn'), 0x000000, 'polarity, not colour-ness');
  assert.equal(c({ theme: 'light' }, 'Uv', 'Danger'), 0xFF0000);
  const GOAL_GREEN = 0x55FF00;   // GColorBrightGreen
  assert.equal(c({}, 'Steps', 'Warn'), GOAL_GREEN);
  assert.equal(c({}, 'Steps', 'Danger'), GOAL_GREEN);
  // Black or white, in either encoding: the text colour for weather, green for goals.
  ['#000000', '#ffffff', 0x000000, 0xFFFFFF].forEach((v) => {
    assert.equal(c({ theme: 'dark', threshWindDangerColor: v }, 'Wind', 'Danger'), 0xFFFFFF, String(v));
    assert.equal(c({ theme: 'light', threshWindWarnColor: v }, 'Wind', 'Warn'), 0x000000, String(v));
    assert.equal(c({ threshSleepDangerColor: v }, 'Sleep', 'Danger'), GOAL_GREEN, String(v));
  });
  // A pick is kept; garbage takes the unset fallback.
  assert.equal(c({ threshAqiWarnColor: '#00aaff' }, 'Aqi', 'Warn'), 0x00AAFF);
  assert.equal(c({ threshAqiDangerColor: 0x5500FF }, 'Aqi', 'Danger'), 0x5500FF);
  assert.equal(c({ threshAqiDangerColor: 'garbage' }, 'Aqi', 'Danger'), 0xFF0000);
  // Independent of the warn look: 'none' still has a colour a later box would paint.
  assert.equal(c({ threshUvWarnLook: 'none', threshUvWarnColor: '#FFAA00' }, 'Uv', 'Warn'), 0xFFAA00);
  // kindConfig is thresholdColor, with a null warn for the none look.
  const s = { theme: 'light', threshUvWarnColor: '', threshUvDangerColor: '#FFFFFF' };
  const uv = th.KINDS.findIndex((k) => k.key === 'Uv');
  assert.equal(th.kindConfig(s, uv).warnColor, c(s, 'Uv', 'Warn'));
  assert.equal(th.kindConfig(s, uv).dangerColor, c(s, 'Uv', 'Danger'));
  assert.equal(th.kindConfig(Object.assign({ threshUvWarnLook: 'none' }, s), uv).warnColor, null);
});

test('isAutoColor: unset, unparseable, black or white — in either encoding', () => {
  [undefined, null, '', 'garbage', 0, 0xFFFFFF, '#000000', '#ffffff', '#FFFFFF', 'FFFFFF']
    .forEach((v) => assert.equal(th.isAutoColor(v), true, JSON.stringify(v)));
  [0xFF0000, '#FF0000', '#00aaff', 0x55FF00, '#555555']
    .forEach((v) => assert.equal(th.isAutoColor(v), false, JSON.stringify(v)));
});

test('buildSettingsBlob: imperial distance thresholds convert mi -> 100 m units', () => {
  const blob = th.buildSettingsBlob({
    distanceUnits: 'imperial',
    threshDistanceOn: true, threshDistanceWarn: '1', threshDistanceDanger: '3'
  });
  assert.deepEqual(blob.slice(25, 29), [16, 0, 48, 0]); // round(1*16.0934)=16, round(3*16.0934)=48
  assert.equal(blob[0], 1 << 6);
});

test('buildSettingsBlob: nothing configured -> all disabled, zeroed thresholds', () => {
  const blob = th.buildSettingsBlob({});
  assert.equal(blob[0], 0);
  // 12 health-threshold bytes, the five bold bytes (0 = the default warn mode),
  // the alerts byte (0 = the rain alert's legacy text look), the Battery byte (the
  // default warn level 10, Icon), the two warn-look bytes at the colour-watch
  // defaults: aqi/pollen/wind/gust fill (0xAA), steps/sleep/distance outline + uv fill
  // (0x95), then the On demand cells at their defaults: the Watch Status Bar's
  // Battery right (2), Bluetooth, Quiet time and Sleep left (1), Rain, Wind gusts,
  // UV index and Air quality right, Pollen nowhere, Wind speed right.
  assert.deepEqual(blob.slice(17),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0xAA, 0x95,
      2, 1, 1, 1, 2, 2, 2, 2, 0, 2]);
});

// Bytes 36..37: the warn look per PAIRED kind, 2 bits each in KINDS order (0 none,
// 1 outline, 2 fill). An unset look takes the platform default — the packer is
// handed the watch's env for exactly that.
test('buildSettingsBlob: warn looks pack 2 bits per paired kind, defaults per platform', () => {
  const O = th.WARN_LOOK_OFFSET;
  assert.equal(O, 36);
  const looks = (blob) => blob.slice(O, O + 2);
  assert.deepEqual(looks(th.buildSettingsBlob({}, { color: true })), [0xAA, 0x95], 'colour');
  assert.deepEqual(looks(th.buildSettingsBlob({})), [0xAA, 0x95], 'no env = colour');
  assert.deepEqual(looks(th.buildSettingsBlob({}, { color: false })), [0x55, 0x55],
    'B&W: outline everywhere — a warn fill would be the danger fill');
  const picked = th.buildSettingsBlob({
    threshAqiWarnLook: 'none', threshPollenWarnLook: 'outline', threshWindWarnLook: 'fill',
    threshGustWarnLook: 'none', threshStepsWarnLook: 'fill', threshSleepWarnLook: 'none',
    threshDistanceWarnLook: 'outline', threshUvWarnLook: 'none'
  }, { color: false });
  assert.deepEqual(looks(picked), [0 | (1 << 2) | (2 << 4) | (0 << 6),
    2 | (0 << 2) | (1 << 4) | (0 << 6)], 'a stored look wins on any platform');
  // Unknown values fall back to the default; bold-only kinds own no look cell.
  assert.deepEqual(looks(th.buildSettingsBlob({ threshAqiWarnLook: 'bogus',
    threshTempWarnLook: 'none' })), [0xAA, 0x95]);
  // The look never touches the rain-look and Battery bytes before it.
  const busy = th.buildSettingsBlob({ threshAqiWarnLook: 'none', threshUvWarnLook: 'none' });
  assert.deepEqual([busy[th.ALERTS_OFFSET], busy[th.BATTERY_OFFSET]], [0, 10]);
});

// The warn colour byte keeps a real colour whenever there IS a box, so a watch
// without the look bytes (it reads 0x00 as "no outline") still draws one; 0x00 is
// the 'none' look alone. Unset is auto: theme fg for weather, goal green for goals.
test('buildSettingsBlob: the warn colour byte is 0x00 exactly for the none look', () => {
  const warnByte = (settings, k, env) => th.buildSettingsBlob(settings, env)[1 + 2 * k];
  ['outline', 'fill'].forEach((look) => {
    assert.equal(warnByte({ theme: 'dark', threshWindWarnLook: look }, 2), 0xFF,
      look + ': unset warn on dark = white');
    assert.equal(warnByte({ theme: 'light', threshWindWarnLook: look }, 2), 0xC0,
      look + ': unset warn on light = black');
    assert.equal(warnByte({ theme: 'dark', threshWindWarnLook: look, threshWindWarnColor: null }, 2),
      0xFF, look + ': the old null is auto too');
    assert.equal(warnByte({ threshStepsWarnLook: look }, 4), 0xDC, look + ': goal unset = green');
    assert.equal(warnByte({ threshStepsWarnLook: look, threshStepsWarnColor: '' }, 4), 0xDC,
      look + ': a goal blank is auto green now, not "off"');
  });
  assert.equal(warnByte({ theme: 'dark' }, 2, { color: false }), 0xFF, 'B&W default outline: fg');
  assert.equal(warnByte({ threshWindWarnLook: 'none', threshWindWarnColor: 0xFFAA00 }, 2), 0x00);
  assert.equal(warnByte({ threshStepsWarnLook: 'none' }, 4), 0x00, 'goal none: 0x00');
  assert.equal(th.kindConfig({ threshWindWarnLook: 'none' }, 2).warnColor, null);
  assert.equal(th.kindConfig({}, 2, false).warnLook, 'outline');
  assert.equal(th.kindConfig({}, 2).warnLook, 'fill');
  assert.equal(th.kindConfig({}, 8).warnLook, null, 'bold-only kinds have no look');
});

// "0 and negative thresholds are legitimate; unset must stay distinguishable from zero" —
// asserted through the real enable + pack path, not just parseThreshold() in isolation.
test('a 0 threshold is SET (a real pair) and packs as zero, unlike unset', () => {
  // Weather kind: 0/0 is an ordered pair, so AQI enables on it and every reading >= 0 is danger.
  const zeroAqi = { threshAqiOn: true, threshAqiWarn: '0', threshAqiDanger: '0' };
  assert.equal(th.kindConfig(zeroAqi, 0).enabled, true, '0/0 must enable the kind');
  assert.equal(th.kindConfig(zeroAqi, 0).warn, 0, 'warn is the number 0, not null');
  assert.deepEqual(th.packWeatherLevels({ AQI_TREND: [0] }, zeroAqi), [2, 0], 'AQI 0 >= danger 0');
  // A half-set pair with the OTHER field 0 is not a pair: 0 does not stand in for
  // unset, the whole pair resolves to the seed (US 100/150) instead.
  const halfWarn = th.kindConfig({ threshAqiOn: true, threshAqiWarn: '0' }, 0);
  assert.deepEqual([halfWarn.warn, halfWarn.danger], [100, 150]);
  const halfDanger = th.kindConfig({ threshAqiOn: true, threshAqiDanger: '0' }, 0);
  assert.deepEqual([halfDanger.warn, halfDanger.danger], [100, 150]);
  // Goal kind through the blob: steps 0/100 is ordered (close <= goal since the
  // celebration rework) -> bit 4 set, and the close uint16 is a real zero —
  // indistinguishable in the bytes from "unset", which is exactly why the enabled
  // MASK is the only signal the watch may trust.
  const blob = th.buildSettingsBlob(
    { threshStepsOn: true, threshStepsWarn: '0', threshStepsDanger: '100' });
  assert.equal(blob[0] & (1 << 4), 1 << 4, 'steps enabled with a 0 close threshold');
  assert.deepEqual(blob.slice(17, 21), [0, 0, 100, 0], 'close 0 / goal 100, LE uint16');
  // Sleep 0/0 likewise enables and packs zeroes...
  const sleepBlob = th.buildSettingsBlob(
    { threshSleepOn: true, threshSleepWarn: '0', threshSleepDanger: '0' });
  assert.equal(sleepBlob[0] & (1 << 5), 1 << 5, 'sleep 0/0 enables the kind');
  assert.deepEqual(sleepBlob.slice(21, 25), [0, 0, 0, 0]);
  // ...while leaving it off does NOT set the bit, with the same zero bytes.
  const unsetBlob = th.buildSettingsBlob({});
  assert.equal(unsetBlob[0] & (1 << 5), 0, 'unset sleep must stay disabled');
  assert.deepEqual(unsetBlob.slice(21, 25), [0, 0, 0, 0]);
});

test('buildSettingsBlob: goal u16s carry the SEED when the toggle is on over a blank pair', () => {
  const blob = th.buildSettingsBlob({
    threshStepsOn: true, threshStepsWarn: '', threshStepsDanger: '',
    threshSleepOn: true,
    threshDistanceOn: true, distanceUnits: 'imperial'
  });
  assert.equal(blob[0], (1 << 4) | (1 << 5) | (1 << 6));
  assert.deepEqual(blob.slice(17, 21), [8000 & 0xFF, 8000 >> 8, 10000 & 0xFF, 10000 >> 8],
    'steps seed 8000/10000');
  assert.deepEqual(blob.slice(21, 25), [390 & 0xFF, 390 >> 8, 450 & 0xFF, 450 >> 8],
    'sleep seed 6.5/7.5 h -> minutes');
  assert.deepEqual(blob.slice(25, 29), [40, 0, 48, 0], 'distance seed 2.5/3 mi -> 100 m units');
  // Toggle off: no bit and zeroed u16s even with an ordered pair stored (the watch
  // ignores them without the bit; zero keeps the bytes honest).
  const off = th.buildSettingsBlob(
    { threshStepsOn: false, threshStepsWarn: '4000', threshStepsDanger: '8000' });
  assert.equal(off[0], 0);
  assert.deepEqual(off.slice(17, 21), [0, 0, 0, 0]);
});

// thresh<Kind>BoldMode: 2 bits per kind in the two bold bytes. 'warn' packs to 0
// so a never-configured kind reproduces the shipped bold-from-warn behaviour.
test('buildSettingsBlob: unset bold modes pack as warn (all-zero bold bytes)', () => {
  const blob = th.buildSettingsBlob({});
  assert.equal(blob.length, 48);
  assert.deepEqual(blob.slice(th.BOLD_OFFSET, th.ALERTS_OFFSET), [0, 0, 0, 0, 0]);
});

test('buildSettingsBlob: bold modes pack 2 bits per kind, kinds 0-3 then 4-7', () => {
  const blob = th.buildSettingsBlob({
    threshAqiBoldMode: 'always',      // kind 0 -> byte 29 bits 0-1
    threshGustBoldMode: 'off',        // kind 3 -> byte 29 bits 6-7
    threshStepsBoldMode: 'off',       // kind 4 -> byte 30 bits 0-1
    threshUvBoldMode: 'always'        // kind 7 -> byte 30 bits 6-7
  });
  assert.equal(blob[th.BOLD_OFFSET], (2 << 0) | (1 << 6), 'aqi always, gust off');
  assert.equal(blob[th.BOLD_OFFSET + 1], (1 << 0) | (2 << 6), 'steps off, uv always');
});

test('buildSettingsBlob: bold mode is independent of the enabled bitmask', () => {
  // "Always" must bold a slot whose kind has no thresholds configured at all —
  // the bold row is live even while the sheet's threshold switch is off.
  const blob = th.buildSettingsBlob({ threshWindBoldMode: 'always' });
  assert.equal(blob[0], 0, 'no kind is enabled');
  assert.equal(blob[th.BOLD_OFFSET], 2 << (2 * 2), 'wind still packs always');
});

test('buildSettingsBlob: an unknown bold mode falls back to warn', () => {
  const blob = th.buildSettingsBlob({ threshWindBoldMode: 'bogus' });
  assert.equal(blob[th.BOLD_OFFSET], 0);
});

// statusBoldAll master row: 'all' overrides the PACKED bold cells only — every
// kind packs 'always' regardless of its stored mode, and nothing outside the
// bold area is the master's business.
test('buildSettingsBlob: statusBoldAll "all" packs always into every bold cell', () => {
  const blob = th.buildSettingsBlob({
    statusBoldAll: 'all',
    // Stored modes that would otherwise pack off (1) / warn (0) lanes.
    threshAqiBoldMode: 'off', threshStepsBoldMode: 'warn', threshHrBoldMode: 'off'
  });
  // 2 ('always') in every 2-bit lane of a byte = 0b10101010 = 0xAA. The LAST
  // bold byte is partial — byte 33 holds four cells (kinds 16..19) and only the
  // ones a kind actually claims get packed — so derive it from KINDS rather than
  // hard-coding it: appending a kind into a byte the blob already pays for is a
  // free, wire-neutral change and should not read here as a regression. The
  // kind COUNT itself is pinned by status-thresholds-contract.test.js.
  const cellsPerByte = 4;
  const fullBytes = Math.floor(th.KINDS.length / cellsPerByte);
  const tailCells = th.KINDS.length % cellsPerByte;
  const expected = new Array(fullBytes).fill(0xAA);
  if (tailCells) {
    let tail = 0;
    for (let c = 0; c < tailCells; c += 1) { tail |= th.BOLD_MODES.always << (2 * c); }
    expected.push(tail);
  }
  assert.deepEqual(blob.slice(th.BOLD_OFFSET, th.ALERTS_OFFSET), expected);
  // The bold area itself must not shrink, or the assertion above goes vacuous.
  assert.equal(th.ALERTS_OFFSET - th.BOLD_OFFSET, 5, 'bold area is bytes 29..33');
  // ...and the master never reaches past it into the alerts byte.
  assert.equal(blob[th.ALERTS_OFFSET], 0, 'the rain look is not a bold cell');
});

test('statusBoldAll "all" leaves everything below the bold area byte-identical', () => {
  const settings = {
    threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00,
    threshStepsOn: true, threshStepsWarn: '4000', threshStepsDanger: '8000'
  };
  const base = th.buildSettingsBlob(settings);
  const overridden = th.buildSettingsBlob(Object.assign({ statusBoldAll: 'all' }, settings));
  assert.deepEqual(overridden.slice(0, th.BOLD_OFFSET), base.slice(0, th.BOLD_OFFSET),
    'enable bits, colors, and health u16s are untouched by the master');
});

test('statusBoldAll "perSlot" (and absent) defer to the stored per-kind modes', () => {
  const mixed = {
    threshAqiBoldMode: 'always',   // kind 0  -> byte 29 bits 0-1
    threshGustBoldMode: 'off',     // kind 3  -> byte 29 bits 6-7
    threshUvBoldMode: 'always',    // kind 7  -> byte 30 bits 6-7
    threshTempBoldMode: 'off',     // kind 8  -> byte 31 bits 0-1
    threshHrBoldMode: 'always'     // kind 15 -> byte 32 bits 6-7
  };
  const expected = [(2 << 0) | (1 << 6), 2 << 6, 1 << 0, 2 << 6, 0];
  assert.deepEqual(th.buildSettingsBlob(mixed).slice(th.BOLD_OFFSET, th.ALERTS_OFFSET), expected);
  assert.deepEqual(
    th.buildSettingsBlob(Object.assign({ statusBoldAll: 'perSlot' }, mixed))
      .slice(th.BOLD_OFFSET, th.ALERTS_OFFSET),
    expected);
});

test('packing with statusBoldAll "all" does not mutate the stored per-kind modes', () => {
  const settings = {
    statusBoldAll: 'all',
    threshWindBoldMode: 'off', threshCityBoldMode: 'warn'
  };
  th.buildSettingsBlob(settings);
  assert.equal(settings.threshWindBoldMode, 'off');
  assert.equal(settings.threshCityBoldMode, 'warn');
  // Flipping back to 'perSlot' therefore re-packs the stored modes as-is.
  settings.statusBoldAll = 'perSlot';
  const blob = th.buildSettingsBlob(settings);
  assert.equal(blob[th.BOLD_OFFSET], 1 << (2 * 2), 'wind off restored');
  assert.equal(blob[32], 0, 'city warn restored (packs 0)');
});

// The bold-only kinds (wire ids 8..15) live in the third and fourth bold bytes
// (blob bytes 31/32), byte 29 + (k >> 2) at bits 2 * (k & 3).
test('buildSettingsBlob: battery % (kind 16) packs its bold cell into byte 33', () => {
  const blob = th.buildSettingsBlob({ threshBatteryPctBoldMode: 'always' });
  assert.equal(blob.length, 48);
  assert.equal(blob[33], 2 << 0, 'batteryPct always in byte 33 bits 0-1');
  assert.deepEqual(blob.slice(th.BOLD_OFFSET, 33), [0, 0, 0, 0],
    'the other bold bytes stay at the warn default');
});

test('buildSettingsBlob: bold-only kinds pack their cells in bytes 31/32', () => {
  const blob = th.buildSettingsBlob({
    threshTempBoldMode: 'always',       // kind 8  -> byte 31 bits 0-1
    threshDateBoldMode: 'off',          // kind 11 -> byte 31 bits 6-7
    threshWeekBoldMode: 'off',          // kind 12 -> byte 32 bits 0-1
    threshHrBoldMode: 'always'          // kind 15 -> byte 32 bits 6-7
  });
  assert.equal(blob[31], (2 << 0) | (1 << 6), 'temp always, date off');
  assert.equal(blob[32], (1 << 0) | (2 << 6), 'week off, hr always');
});

test('bold-only kinds contribute no enable bit, colors, or health bytes', () => {
  const blob = th.buildSettingsBlob({
    threshPressureBoldMode: 'always', threshCityBoldMode: 'always',
    threshSunBoldMode: 'always', threshCountdownBoldMode: 'always',
    // Threshold-shaped settings for a bold-only kind must be inert: no kind 9
    // enable bit exists (byte 0 covers kinds 0..7 only) and no color pair may
    // be written — kind 9's would collide with the health u16 area.
    threshPressureWarn: '990', threshPressureDanger: '1040',
    threshPressureWarnColor: 0xFFAA00, threshPressureDangerColor: 0xFF0000
  });
  assert.equal(blob[0], 0, 'no enable bit for any bold-only kind');
  // Everything before the bold area must be byte-identical to an unconfigured
  // blob (the paired kinds' default danger colors and zeroed u16s): a bold-only
  // kind writes nothing there.
  const base = th.buildSettingsBlob({});
  assert.deepEqual(blob.slice(0, th.BOLD_OFFSET), base.slice(0, th.BOLD_OFFSET));
  assert.equal(blob[31], (2 << 2) | (2 << 4), 'pressure + sun bold cells');
  assert.equal(blob[32], (2 << 2) | (2 << 4), 'city + countdown bold cells');
});

test('kindConfig for a bold-only kind: only boldMode is meaningful', () => {
  const pressure = th.KINDS.findIndex(k => k.code === 'pressure');
  assert.equal(th.kindConfig({}, pressure).boldMode, 'warn',
    'unset falls back to the default (packs 0, renders non-bold on a level-less kind)');
  assert.equal(th.kindConfig({ threshPressureBoldMode: 'always' }, pressure).boldMode, 'always');
  const cfg = th.kindConfig({ threshPressureWarn: '990', threshPressureDanger: '1040' }, pressure);
  assert.equal(cfg.enabled, false, 'never enabled — there is no pair to enable');
  assert.equal(cfg.warn, null);
  assert.equal(cfg.danger, null);
  assert.equal(cfg.warnColor, null);
  assert.equal(cfg.dangerColor, null);
});

test('packWeatherLevels ignores bold-only kinds entirely', () => {
  // Threshold-shaped settings for temp (bold-only kind 8) must not disturb the
  // packed levels word — only the paired weather kinds (0..3, 7) may level.
  const packed = th.packWeatherLevels(
    { TEMP_TREND_UINT8: [250] },
    { threshTempWarn: '10', threshTempDanger: '20', threshTempBoldMode: 'always' });
  assert.deepEqual(packed, [0, 0]);
});

test('kindConfig exposes the kind bold mode, defaulting to warn', () => {
  assert.equal(th.kindConfig({}, 2).boldMode, 'warn');
  assert.equal(th.kindConfig({ threshWindBoldMode: 'always' }, 2).boldMode, 'always');
  assert.equal(th.kindConfig({ threshWindBoldMode: 'off' }, 2).boldMode, 'off');
  assert.equal(th.kindConfig({ threshWindBoldMode: 'nonsense' }, 2).boldMode, 'warn');
});

test('pairOrdered: THE enable rule — both set and danger at or above warn', () => {
  assert.equal(th.pairOrdered(10, 20), true);
  assert.equal(th.pairOrdered(10, 10), true, 'equal pair is ordered (inclusive)');
  assert.equal(th.pairOrdered(20, 10), false, 'reversed pair never enables');
  assert.equal(th.pairOrdered(null, 20), false);
  assert.equal(th.pairOrdered(10, null), false);
  // The direction axis is retired: no per-kind belowIsWorse field or export —
  // every value rises toward its pair, matching the C stub's unconditional false.
  assert.equal(typeof th.belowIsWorse, 'undefined');
  th.KINDS.forEach((k) => assert.ok(!('belowIsWorse' in k), k.code));
});

test('isGoalKind flags the celebratory health trio', () => {
  assert.equal(th.isGoalKind('Steps'), true);
  assert.equal(th.isGoalKind('Sleep'), true);
  assert.equal(th.isGoalKind('Distance'), true);
  assert.equal(th.isGoalKind('Aqi'), false);
  assert.equal(th.isGoalKind('Wind'), false);
});

test('buildStatusLines bakes STATUS_LEVELS_UINT8 into the weather payload', () => {
  const payload = { AQI_TREND: [150] };
  statusLines.buildStatusLines(payload,
    { threshAqiWarn: '100', threshAqiDanger: '200' }, { platform: 'basalt' });
  assert.deepEqual(payload.STATUS_LEVELS_UINT8, [1, 0]);   // AQI warn in bits 0-1
});

test('buildStatusLines omits STATUS_LEVELS_UINT8 on aplite (highlight compiled out)', () => {
  // aplite has no WW_THRESHOLD_HIGHLIGHT, so its inbox handler for this tuple is
  // gone: sending the byte would cost 8 B of its inbox bundle for nothing. The four
  // status-line blobs (the 'status' dedupe category's other keys) still go out.
  const payload = { AQI_TREND: [150] };
  statusLines.buildStatusLines(payload,
    { threshAqiWarn: '100', threshAqiDanger: '200' }, { platform: 'aplite' });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'STATUS_LEVELS_UINT8'), false);
  assert.ok(Array.isArray(payload.STATUS_LINE_1_UINT8), 'status lines still packed');
});

test('buildStatusLines keeps STATUS_LEVELS_UINT8 for an unknown watchInfo', () => {
  const payload = { AQI_TREND: [150] };
  statusLines.buildStatusLines(payload,
    { threshAqiWarn: '100', threshAqiDanger: '200' }, null);
  assert.deepEqual(payload.STATUS_LEVELS_UINT8, [1, 0]);
});

// --- the weather alerts: the rain look byte and the phone-baked metric entries -----

test('buildSettingsBlob: byte 34 carries the rain alert look in bits 0-1', () => {
  assert.equal(th.ALERTS_OFFSET, 34);
  assert.equal(th.buildSettingsBlob({})[34], 0, 'absent = text, the legacy look');
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'text' })[34], 0);
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'icon' })[34], 1);
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'minutes' })[34], 2);
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'bogus' })[34], 0, 'unknown = text');
  // Bits 2-7 are reserved: whatever else is configured, they stay 0.
  const busy = th.buildSettingsBlob(placedOnly(['uv'], { rainAlertDisplay: 'minutes', statusBoldAll: 'all',
    alertUvDisplay: 'value', threshUvOn: true }));
  assert.equal(busy[34], 2);
  // Which metric alerts are ACTIVE never rides the Clay blob: their entries do.
  assert.deepEqual(th.buildSettingsBlob({ alertUvDisplay: 'value', alertWindDays: 'today' }),
    th.buildSettingsBlob({}));
});

test('buildSettingsBlob: byte 35 packs the Battery item — its warn level on the watch\'s step and its Look', () => {
  const B = th.BATTERY_OFFSET;
  assert.equal(B, 35);
  assert.equal(th.buildSettingsBlob({})[B], 10, 'absent: 10 %, Icon');
  assert.equal(th.buildSettingsBlob(null)[B], 10, 'no settings at all: the same default');
  const emery = { color: true, fineBattery: true };
  const basalt = { color: true, fineBattery: false };
  // A stored '15' sends 20 to a 10 % watch and 15 to emery (on-demand.js batteryLevel).
  assert.equal(th.buildSettingsBlob({ batteryLowLevel: '15' }, basalt)[B], 20);
  assert.equal(th.buildSettingsBlob({ batteryLowLevel: '15' }, emery)[B], 15);
  assert.equal(th.buildSettingsBlob({ batteryLowLevel: '15' })[B], 20, 'no env: 10 % steps');
  assert.equal(th.buildSettingsBlob({ batteryLowLevel: '31' }, emery)[B], 10, 'out of range: the default');
  assert.equal(th.buildSettingsBlob({ batteryLowDisplay: 'value' })[B], 10 | th.BATTERY_VALUE_BIT);
  assert.equal(th.buildSettingsBlob({ batteryLowLevel: '30', batteryLowDisplay: 'value' }, emery)[B], 30 | 0x40);
  // It never touches the rain look next door, nor the look the level.
  const both = th.buildSettingsBlob({ rainAlertDisplay: 'minutes', batteryLowLevel: '20' });
  assert.equal(both[th.ALERTS_OFFSET], 2);
  assert.equal(both[B], 20);
});

test('buildSettingsBlob: bytes 38-47 carry the On demand cells, effective values only', () => {
  const O = th.ON_DEMAND_OFFSET;
  assert.equal(O, 38);
  const OD = require('../src/pkjs/on-demand.js');
  assert.deepEqual(th.buildSettingsBlob({}).slice(O), OD.cells({}), 'the defaults');
  const S = placeOn(placeOn(Object.assign({ radarMode: 'status' }, NOTHING_PLACED), 'forecast', 'left', 'uv,bt'),
    'radar', 'right', 'uv');
  const cells = th.buildSettingsBlob(S).slice(O);
  assert.equal(cells[OD.itemIndex('uv')], (1 << 2) | (2 << 4), 'forecast left, radar right');
  assert.equal(cells[OD.itemIndex('bt')], 1 << 2);
  assert.equal(cells[OD.itemIndex('battery')], 0);
  // A watch without On demand gets zeros (it never gets the blob, but the packer agrees).
  assert.deepEqual(th.buildSettingsBlob(S, { onDemand: false }).slice(O), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // A Disabled side is zeros.
  S.statusForecastOnDemandLeft = 'off';
  assert.equal(th.buildSettingsBlob(S).slice(O)[OD.itemIndex('uv')], 2 << 4);
});

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
  const e = decodeAlerts(th.bakeAlerts(payload, Object.assign({}, settings, placedOnly([code]), {
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
  const e = decodeAlerts(th.bakeAlerts(payload, Object.assign(placedOnly([code]), settings)));
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
  assert.deepEqual(th.bakeAlerts({ CURRENT_TEMP: 70 }, { alertTemp: true, alertSteps: true }), []);
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
// All five metric alerts placed (the Watch Status Bar's right side), nothing else.
const ALL_ON = placedOnly(['uv', 'wind', 'gust', 'aqi', 'pollen']);
/**
 * Exactly these alerts placed, with more settings.
 * @param {string[]} codes Alert codes.
 * @param {Object} [extra] Settings merged over.
 * @returns {Object} The blob.
 */
function on(codes, extra) { return placedOnly(codes, extra); }

test('bakeAlerts: the exact bytes for a UV-danger + wind-warn row', () => {
  const p = { UV_TREND_UINT8: [30], UV_DAY_PEAKS: [85, 50, 0],
    WIND_TREND_UINT8: [45], WIND_DAY_PEAKS: [45, 20, 0] };
  // Icons only: one header byte each (bit 7). UV = kind 7, danger (bit 3); wind =
  // kind 2, warn (bit 3 clear); both today's (day bits 4-6 zero).
  assert.deepEqual(th.bakeAlerts(p, on(['uv', 'wind'])),
    [0x80 | 7 | 0x08, 0x80 | 2]);
  assert.deepEqual(th.bakeAlerts(p, on(['uv', 'wind'])), [0x8F, 0x82]);
  // UV with its value ("9" — 8.5 rounds like the slot prints it), wind icon-only:
  // the value needs no length, it runs to the next header.
  assert.deepEqual(th.bakeAlerts(p, on(['uv', 'wind'], { alertUvDisplay: 'value' })),
    [0x8F, 0x39, 0x82]);
  // Both with values: wind in the user's unit, no unit label.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(p, on(['uv', 'wind'], { alertUvDisplay: 'value',
    alertWindDisplay: 'value', windUnits: 'mph' }))),
  [{ kind: 7, level: 2, value: '9' }, { kind: 2, level: 1, value: '28' }],
  'mph: 45 km/h = 28 mph, at the mph seed warn 25');
});

test('bakeAlerts: the On demand order gust, UV, AQI, pollen, wind; unplaced and quiet kinds absent', () => {
  const all = decodeAlerts(th.bakeAlerts(ALL_ALERTING, Object.assign({ provider: 'dwd' }, ALL_ON)));
  assert.deepEqual(all.map(e => e.kind), [3, 7, 0, 1, 2], 'gust, UV, AQI, pollen, wind');
  assert.deepEqual(all.map(e => e.level), [2, 2, 2, 1, 1]);
  assert.deepEqual(all.map(e => e.value), ['', '', '', '', ''], 'icon Look: no values');
  // An unplaced alert is absent even at danger: ticked on a Disabled side, or on a
  // bar that does not exist, it shows nowhere.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING, on(['gust']))).map(e => e.kind), [3]);
  const disabled = placeOn(on(['gust']), 'forecast', 'left', 'uv,aqi');
  disabled.statusForecastOnDemandLeft = 'off';
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING, disabled)).map(e => e.kind), [3]);
  const noRadarBar = placeOn(on(['gust'], { radarMode: 'off' }), 'radar', 'right', 'uv');
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING, noRadarBar)).map(e => e.kind), [3]);
  // Placed on any bar counts, the Watch Status Bar or not.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING,
    placeOn(on([]), 'forecast', 'right', 'aqi'))).map(e => e.kind), [0]);
  // Level 0 (below warn) is absent.
  const calm = { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [30, 20, 0], WIND_TREND_UINT8: [45] };
  assert.deepEqual(decodeAlerts(th.bakeAlerts(calm, on(['uv', 'wind'])))
    .map(e => e.kind), [2], 'UV 3 stays quiet, wind 45 warns');
  // A partial blob reads the default ticks: gust, UV, AQI and wind.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING, { provider: 'dwd' })).map(e => e.kind), [3, 7, 0, 2]);
  // Nothing alerting, no settings, no payload: no bytes.
  assert.deepEqual(th.bakeAlerts(calm, on(['uv'])), []);
  assert.deepEqual(th.bakeAlerts(ALL_ALERTING, null), []);
  assert.deepEqual(th.bakeAlerts(null, ALL_ON), []);
});

test('bakeAlerts: values only for the kinds whose Look is value, printed like the slot', () => {
  const s = Object.assign({}, ALL_ON, {
    alertUvDisplay: 'value', alertWindDisplay: 'icon', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value'
  });
  const e = decodeAlerts(th.bakeAlerts(ALL_ALERTING, s));
  assert.deepEqual(e.map(x => x.value), ['90', '8', '152', '2', '']);
  // Pollen prints its DWD band, as the pollen slot does.
  const half = decodeAlerts(th.bakeAlerts({ POLLEN_TODAY: '2-3' },
    on(['pollen'], { alertPollenDisplay: 'value' })));
  assert.deepEqual(half, [{ kind: 1, level: 1, value: '2-3' }]);
  // Every value byte is printable ASCII (the watch's walker rejects anything else,
  // and a byte with bit 7 would read as a header): decodeEntries asserts both.
  assert.equal(decodeEntries(th.bakeAlerts(ALL_ALERTING, s)).length, 5);
});

test('bakeAlerts: tail-drops entries past the 20 B cap, wind first', () => {
  const values = Object.assign({}, ALL_ON, {
    alertUvDisplay: 'value', alertWindDisplay: 'value', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value'
  });
  assert.equal(th.ALERT_ENTRIES_MAX_BYTES, 20);
  // All five with values: 5 headers + "90" "8" "152" "2" "45" = 14 B.
  const all = th.bakeAlerts(ALL_ALERTING, values);
  assert.equal(all.length, 14);
  assert.deepEqual(decodeAlerts(all).map(e => e.kind), [3, 7, 0, 1, 2]);
  // Only a value wider than any real one fills the tuple: a 7-digit AQI (the most an
  // entry prints) with pollen's '2-3' is 3 + 2 + 8 + 4 + 3 = 20 B — all five fit...
  const wide = Object.assign({}, ALL_ALERTING, { AQI_TREND: [1234567], POLLEN_TODAY: '2-3' });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(wide, values)).map(e => e.value),
    ['90', '8', '1234567', '2-3', '45']);
  // ...and a two-digit UV on top is 21 B: wind, the tail (the lowest priority), drops.
  const over = Object.assign({}, wide, { UV_TREND_UINT8: [120], UV_DAY_PEAKS: [120, 60, 0] });
  const dropped = th.bakeAlerts(over, values);
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
  const stopped = th.bakeAlerts(prefix, Object.assign({}, values, { alertWindDisplay: 'icon' }));
  assert.equal(stopped.length, 19);
  assert.deepEqual(decodeAlerts(stopped).map(e => e.kind), [3, 7, 0], 'pollen ends the row; wind is not taken');
  // A value past ALERT_LEN_MAX bytes rides as the icon alone.
  const huge = Object.assign({}, ALL_ALERTING, { AQI_TREND: [12345678] });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(huge, values)).map(e => e.value),
    ['90', '8', '', '2', '45']);
  // Icon-only: all five = 5 B.
  assert.equal(th.bakeAlerts(over, ALL_ON).length, 5);
});

test('alertKindCodes / alertValueKindCodes: the placed codes in the On demand order', () => {
  assert.deepEqual(th.alertKindCodes(NOTHING_PLACED), []);
  assert.deepEqual(th.alertKindCodes({}), ['gust', 'uv', 'aqi', 'wind'], 'the default ticks');
  assert.deepEqual(th.alertKindCodes(null), ['gust', 'uv', 'aqi', 'wind'], 'no settings: the defaults too');
  assert.deepEqual(th.alertKindCodes(ALL_ON), ['gust', 'uv', 'aqi', 'pollen', 'wind']);
  assert.deepEqual(th.alertKindCodes(on(['aqi', 'uv'])), ['uv', 'aqi']);
  assert.deepEqual(th.alertValueKindCodes(on(['aqi', 'uv'], { alertAqiDisplay: 'value',
    alertUvDisplay: 'icon', alertWindDisplay: 'value' })),
  ['aqi'], 'an unplaced alert\'s Look does not count');
});

test('alertOn / alertValueKindCodes: keyed by code, on while placed on any bar, the value only while on', () => {
  th.ALERT_KINDS.forEach((a) => {
    const look = 'alert' + a.key + 'Display';
    assert.deepEqual(th.alertValueKindCodes(on([a.code])), [], a.code);
    assert.deepEqual(th.alertValueKindCodes(on([a.code], { [look]: 'value' })), [a.code], a.code + ' value');
    assert.deepEqual(th.alertValueKindCodes(on([a.code], { [look]: 'icon' })), [], a.code + ' icon');
    assert.deepEqual(th.alertValueKindCodes(on([], { [look]: 'value' })), [],
      a.code + ': unplaced shows no value, whatever its Look');
    assert.equal(th.alertOn(on([a.code]), a.code), true);
    assert.equal(th.alertOn(on([]), a.code), false);
    assert.equal(th.alertOn(on([a.code], { statusTopOnDemandRight: 'off' }), a.code), false, a.code + ': a Disabled side');
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

test('the placed alerts ride in the On demand order, each entry under its wire kind id', () => {
  const s = on(['pollen', 'uv'], { alertUvDisplay: 'value', alertAqiDisplay: 'value' });
  assert.deepEqual(th.alertKindCodes(s), ['uv', 'pollen']);
  assert.deepEqual(th.alertValueKindCodes(s), ['uv']);
  // An entry's kind id is its code's KINDS index, in ALERT_KINDS order.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING, ALL_ON)).map((e) => th.KINDS[e.kind].code),
    th.ALERT_KINDS.map((a) => a.code));
});

// ── Looking ahead: an alert's Days (today / today + tomorrow) ─────────────────
//
// The rule (status-thresholds alertPick): today's highest value left at warn or
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
    assert.deepEqual(decodeAlerts(th.bakeAlerts(p, todayOnly)), today, name + ' — Today');
    assert.deepEqual(decodeAlerts(th.bakeAlerts(p, both)), ahead, name + ' — Today + tomorrow');
    assert.deepEqual(decodeAlerts(th.bakeAlerts(p, Object.assign({ alertUvDays: 'tomorrow' }, both))),
      ahead, name + ' — stored Today + tomorrow reads as the default');
  });
});

test('look-ahead: wind in km/h (warn 40 / danger 60), and the building storm', () => {
  const s = on(['wind'], { alertWindDisplay: 'value' });
  const wind = (now, rest, tomorrow) => ({ WIND_TREND_UINT8: [now], WIND_DAY_PEAKS: [rest, tomorrow, 0] });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(wind(45, 45, 70), s)),
    [{ kind: 2, level: 1, value: '45' }], 'still 45 at 23:00: today\'s warn');
  assert.deepEqual(decodeAlerts(th.bakeAlerts(wind(30, 30, 70), s)),
    [{ kind: 2, level: 2, value: '70', mark: 'raquo' }], 'dropped to 30, tomorrow 70: »70 danger');
  // Monday 10:00: 15 now, 35 at 23:00, 80 tomorrow — nothing left today warns, so
  // the gale is announced all Monday, not first at Tuesday's midnight fetch.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(wind(15, 35, 80), s)),
    [{ kind: 2, level: 2, value: '80', mark: 'raquo' }], 'the building storm');
  // Tomorrow in the user's unit, on that unit's pair: 70 km/h = 43 mph, danger on 25/40.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(wind(30, 30, 70), Object.assign({ windUnits: 'mph' }, s))),
    [{ kind: 2, level: 2, value: '43', mark: 'raquo' }]);
  // Gusts read their own peaks.
  assert.deepEqual(decodeAlerts(th.bakeAlerts({ GUST_TREND_UINT8: [20], GUST_DAY_PEAKS: [30, 65, 0] },
    on(['gust']))), [{ kind: 3, level: 1, value: '', mark: 'raquo' }], 'gust 65 vs 60/90, icon only');
});

test('look-ahead: tomorrow must be known and above 0 — never a »0', () => {
  const s = on(['uv'], { alertUvDisplay: 'value', threshUvWarn: '0', threshUvDanger: '0' });
  // No current reading and no today's peak, so nothing today: tomorrow 0.4 prints 0.
  assert.deepEqual(th.bakeAlerts({ UV_DAY_PEAKS: [null, 4, 0] }, s), [], 'a 0 tomorrow on warn 0');
  assert.deepEqual(th.bakeAlerts({ UV_DAY_PEAKS: [null, 0, 0] }, s), []);
  assert.deepEqual(decodeAlerts(th.bakeAlerts({ UV_DAY_PEAKS: [null, 5, 0] }, s)),
    [{ kind: 7, level: 2, value: '1', mark: 'raquo' }], 'guard: 0.5 prints 1, which counts');
  // Unknown tomorrow: absent, null, or no day peaks at all.
  const uvOn = on(['uv']);
  assert.deepEqual(th.bakeAlerts({ UV_TREND_UINT8: [20] }, uvOn), [], 'peaks not fetched');
  assert.deepEqual(th.bakeAlerts({ UV_TREND_UINT8: [20], UV_DAY_PEAKS: [20, null, 0] }, uvOn), []);
  assert.deepEqual(th.bakeAlerts({ UV_TREND_UINT8: [20], UV_DAY_PEAKS: [20] }, uvOn), []);
});

test('look-ahead: AQI needs day peaks — Open-Meteo looks ahead, WAQI judges the reading', () => {
  const s = on(['aqi'], { alertAqiDisplay: 'value' });
  // WAQI (and Auto with a station) carries the current reading alone.
  assert.deepEqual(th.bakeAlerts({ AQI_TREND: [40] }, Object.assign({ aqiSource: 'waqi' }, s)), [],
    'WAQI: nothing to look ahead to');
  assert.deepEqual(decodeAlerts(th.bakeAlerts({ AQI_TREND: [152] }, Object.assign({ aqiSource: 'waqi' }, s))),
    [{ kind: 0, level: 2, value: '152' }], 'WAQI: today\'s reading still alerts');
  // Open-Meteo's forecast has tomorrow's peak: US scale 100/150, European 60/80.
  const om = { AQI_TREND: [40], AQI_DAY_PEAKS: [50, 120, 0] };
  assert.deepEqual(decodeAlerts(th.bakeAlerts(om, Object.assign({ aqiSource: 'openmeteo', aqiScale: 'us' }, s))),
    [{ kind: 0, level: 1, value: '120', mark: 'raquo' }]);
  assert.deepEqual(decodeAlerts(th.bakeAlerts(om, Object.assign({ aqiSource: 'openmeteo' }, s))),
    [{ kind: 0, level: 2, value: '120', mark: 'raquo' }], 'European scale: 120 is past danger 80');
});

test('look-ahead: pollen judges tomorrow\'s DWD band (POLLEN_TOMORROW)', () => {
  const s = on(['pollen'], { alertPollenDisplay: 'value' });
  const pollen = (today, tomorrow) => ({ POLLEN_TODAY: today, POLLEN_TOMORROW: tomorrow });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(pollen('1', '2-3'), s)),
    [{ kind: 1, level: 1, value: '2-3', mark: 'raquo' }], '2.5 on the seed 2/3: warn');
  assert.deepEqual(decodeAlerts(th.bakeAlerts(pollen('1', '3'), s)),
    [{ kind: 1, level: 2, value: '3', mark: 'raquo' }]);
  assert.deepEqual(decodeAlerts(th.bakeAlerts(pollen('2', '3'), s)),
    [{ kind: 1, level: 1, value: '2' }], 'today wins');
  assert.deepEqual(th.bakeAlerts(pollen('1', '1-2'), s), [], 'tomorrow below warn');
  assert.deepEqual(th.bakeAlerts(pollen('1', null), s), [], 'DWD has not issued tomorrow');
  assert.deepEqual(th.bakeAlerts(pollen(null, 'n/a'), s), [], 'no known band');
  assert.deepEqual(decodeAlerts(th.bakeAlerts(pollen('1', '0'), Object.assign({
    threshPollenWarn: '0', threshPollenDanger: '0' }, s))), [{ kind: 1, level: 2, value: '1' }],
  'guard: on 0/0 today\'s 1 alerts, and today wins');
  assert.deepEqual(th.bakeAlerts({ POLLEN_TOMORROW: '0' }, Object.assign({
    threshPollenWarn: '0', threshPollenDanger: '0' }, s)), [], 'a 0 tomorrow never alerts');
  assert.deepEqual(th.bakeAlerts(pollen('1', '3'), Object.assign({ alertPollenDays: 'today' }, s)), [],
    'Today only');
});

test('look-ahead: Days today, an alert that is not placed, and unknown Days', () => {
  const p = uvDay(5, 5, 9, 8);
  assert.deepEqual(th.bakeAlerts(p, on(['uv'], { alertUvDays: 'today' })), []);
  assert.deepEqual(th.bakeAlerts(p, on([])), [], 'unplaced: no entry, whatever tomorrow');
  assert.deepEqual(th.bakeAlerts(p, on([], { alertUvDays: 'tomorrow' })), [], 'Days alone places nothing');
  ['bogus', '', null, 1, 'constructor'].forEach((v) =>
    assert.equal(decodeAlerts(th.bakeAlerts(p, on(['uv'], { alertUvDays: v }))).length, 1,
      String(v) + ' reads as the default, Today + tomorrow'));
  // Per alert: one alert's Days never reaches another.
  const pair = Object.assign({}, p, { WIND_TREND_UINT8: [30], WIND_DAY_PEAKS: [30, 70, 0] });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(pair, on(['uv', 'wind'], { alertUvDays: 'today' })))
    .map((e) => e.kind), [2]);
});

test('look-ahead: the tomorrow mark rides the header, per alert; today\'s entries carry none', () => {
  const p = uvDay(5, 5, 9, 8);
  th.ALERT_NEXT_DAY_MARKS.forEach((mark, i) => {
    const bytes = th.bakeAlerts(p, on(['uv'], { alertUvNextDayMark: mark }));
    assert.equal(bytes.length, 1, mark + ': no extra byte for the mark');
    assert.equal((bytes[0] >> th.ALERT_DAY_SHIFT) & 7, i + 1, mark);
    assert.equal(decodeAlerts(bytes)[0].mark, mark);
  });
  [undefined, 'bogus', '»', 'toString', 3].forEach((v) =>
    assert.equal(decodeAlerts(th.bakeAlerts(p, on(['uv'], { alertUvNextDayMark: v })))[0].mark,
      'raquo', String(v) + ' reads as the default »'));
  // Today's entry is unmarked whatever the mark setting says.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(uvDay(2, 8, 9, 0),
    on(['uv'], { alertUvNextDayMark: 'star' }))), [{ kind: 7, level: 2, value: '' }]);
  // Each alert its own mark; the icon look carries the mark too.
  const both = Object.assign({}, p, { WIND_TREND_UINT8: [30], WIND_DAY_PEAKS: [30, 70, 0] });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(both, on(['uv', 'wind'], { alertUvNextDayMark: 'none',
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
  const bytes = th.bakeAlerts(p, s);
  assert.equal(bytes.length, 19, '5 headers + "255" "11" "500" "2-3" "255"');
  assert.ok(bytes.length <= th.ALERT_ENTRIES_MAX_BYTES);
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
  assert.deepEqual(decodeAlerts(th.bakeAlerts(wide, s)).map((e) => e.kind), [3, 7, 0, 1]);
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

test('alertTomorrowKindCodes / alertNextDayMarks: the look-ahead alerts while placed, and their marks', () => {
  assert.deepEqual(th.alertTomorrowKindCodes(NOTHING_PLACED), []);
  assert.deepEqual(th.alertNextDayMarks(NOTHING_PLACED), []);
  assert.deepEqual(th.alertTomorrowKindCodes(ALL_ON), ['gust', 'uv', 'aqi', 'pollen', 'wind'],
    'Today + tomorrow is the default');
  assert.deepEqual(th.alertNextDayMarks(ALL_ON), ['raquo', 'raquo', 'raquo', 'raquo', 'raquo']);
  const s = on(['uv', 'wind', 'aqi', 'pollen'], { alertWindDays: 'today', alertWindNextDayMark: 'gt',
    alertGustNextDayMark: 'plus', alertAqiNextDayMark: 'star', alertUvDays: 'tomorrow' });
  assert.deepEqual(th.alertTomorrowKindCodes(s), ['uv', 'aqi', 'pollen'],
    'a Today alert and an unplaced alert do not look ahead');
  assert.deepEqual(th.alertNextDayMarks(s), ['raquo', 'star', 'raquo'],
    'the mark only where the bake reads it');
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

test('isWeatherKind: exactly the kinds the phone levels (neither goal nor bold-only)', () => {
  assert.deepEqual(th.KINDS.filter(th.isWeatherKind).map(k => k.code),
    ['aqi', 'pollen', 'wind', 'gust', 'uv']);
  assert.equal(th.isWeatherKind(null), false);
  assert.equal(th.isWeatherKind(undefined), false);
  // Every metric alert is one.
  th.ALERT_KINDS.forEach((a) =>
    assert.ok(th.isWeatherKind(th.KINDS.find(k => k.code === a.code)), a.code));
});
