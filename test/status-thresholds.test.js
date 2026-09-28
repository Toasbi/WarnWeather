'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const th = require('../src/pkjs/status-thresholds.js');
const statusLines = require('../src/pkjs/status-lines.js');
const { packedLevel, judged } = require('./helpers/weather-levels.js');

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
    assert.equal(blob.length, 38, mode + ': the duplicate must not widen the blob');
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
  assert.equal(blob.length, 38, 'byte 33 was already paid for — no widening');
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
    'On false: bit clear, the pair is kept for the levels and the hold');
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

test('shownDayMax: today\'s peak holds on the resolved warn, blind to the toggle', () => {
  // UV falling from an 8: now 7, the rest of today 7, tomorrow 9. Alert mode shows
  // the 7 while it is at or above warn, else tomorrow's »9.
  const p = { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [70, 90, 80] };
  const held = { now: null, peak: 7, nextDay: false };
  const rolled = { now: null, peak: 9, nextDay: true };
  const max = (extra) => th.shownDayMax('uv', p, Object.assign({ uvSlotDisplay: 'max' }, extra));
  assert.deepEqual(max({}), held, 'the seed warn 6');
  assert.deepEqual(max({ threshUvWarn: '7', threshUvDanger: '9' }), held, 'a stored warn 7');
  assert.deepEqual(max({ threshUvWarn: '8', threshUvDanger: '9' }), rolled, 'a stored warn 8');
  assert.deepEqual(max({ threshUvWarn: '7', threshUvDanger: '9', threshUvOn: false }), held,
    'the toggle does not touch the hold');
  assert.deepEqual(max({ threshUvWarn: '9', threshUvDanger: '4' }), held,
    'an inverted pair holds on the seed');
  // The warn is in the user's unit: 38 km/h is 21 kn, at the knots seed 20 and
  // below the kph seed 40.
  const w = { WIND_TREND_UINT8: [38], WIND_DAY_PEAKS: [38, 80, 50] };
  assert.equal(th.shownDayMax('wind', w, { windUnits: 'knots', windSlotDisplay: 'max' }).nextDay,
    false);
  assert.equal(th.shownDayMax('wind', w, { windUnits: 'kph', windSlotDisplay: 'max' }).nextDay,
    true);
  // Only the day-max kinds have a pick: pollen, goal, bold-only and unknown codes none.
  const all = Object.assign({ POLLEN_TODAY: '3' }, p);
  ['pollen', 'steps', 'sleep', 'temp', 'city', 'nope', undefined].forEach((code) =>
    assert.equal(th.shownDayMax(code, all, { threshStepsWarn: '1', threshStepsDanger: '2' }),
      null, String(code)));
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
  // Evening, today spent: "0/»9" is judged on today's 0, not tomorrow's 9.
  const evening = { UV_TREND_UINT8: [0], UV_DAY_PEAKS: [0, 90] };
  assert.deepEqual(th.packWeatherLevels(evening,
    Object.assign({ uvSlotDisplay: 'both' }, settings)), [0, 0]);
  assert.deepEqual(th.packWeatherLevels(evening,
    Object.assign({ uvSlotDisplay: 'max' }, settings)), [0, 0],
    'a lone "»9" is not highlighted');
  // Falling below warn with a higher tomorrow: "5/»8" is judged on today's 5,
  // and max mode's lone "»8" is tomorrow's, so it stays normal too.
  const falling = { UV_TREND_UINT8: [50], UV_DAY_PEAKS: [50, 80, 80] };
  assert.deepEqual(th.packWeatherLevels(falling,
    Object.assign({ uvSlotDisplay: 'both' }, settings)), [0, 0]);
  assert.deepEqual(th.packWeatherLevels(falling,
    Object.assign({ uvSlotDisplay: 'max' }, settings)), [0, 0]);
  // Next morning the same peak is TODAY's (unmarked) and counts: "2/9" is danger.
  const morning = { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [90, 60] };
  assert.deepEqual(th.packWeatherLevels(morning,
    Object.assign({ uvSlotDisplay: 'both' }, settings)), [0, 2]);
});

// Regression test for the silent-highlight bug: at a falling 7 (today's peak 8
// already behind us) with a milder tomorrow, the slot used to roll to "7/»5" —
// and max mode to a lone "»5", judged on nothing, so the highlight went SILENT
// while the UV on screen was still above warn. Today's 7 now holds while it is
// at or above warn: both modes print "7" and pack the warn level.
test('packWeatherLevels: a falling value still at warn holds and stays highlighted in every mode', () => {
  const settings = { threshUvWarn: '6', threshUvDanger: '8' };
  const atPeak = { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [70, 50, 80] };
  ['both', 'max'].forEach((mode) => {
    const s = Object.assign({ uvSlotDisplay: mode }, settings);
    assert.equal(statusLines.formatValue('uv', atPeak, s), '7', mode + ': today\'s 7 holds');
    assert.deepEqual(th.packWeatherLevels(atPeak, s), [0, 1], mode + ': judged on the 7 (warn)');
  });
  // The hold rides the SEED warn too (6 for UV) when no pair is stored.
  assert.deepEqual(th.packWeatherLevels(atPeak, { uvSlotDisplay: 'max' }), [0, 1]);
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
  assert.equal(blob.length, 38);
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
  // the alerts byte (0 = the rain alert's legacy text look), the placement byte:
  // top strip left (1), every other bar off — the pre-1.24 picture — then the two
  // warn-look bytes at the colour-watch defaults: aqi/pollen/wind/gust fill (0xAA),
  // steps/sleep/distance outline + uv fill (0x95).
  assert.deepEqual(blob.slice(17),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xAA, 0x95]);
});

// Bytes 36..37: the warn look per PAIRED kind, 2 bits each in KINDS order (0 none,
// 1 outline, 2 fill). An unset look takes the platform default — the packer is
// handed the watch's env for exactly that.
test('buildSettingsBlob: warn looks pack 2 bits per paired kind, defaults per platform', () => {
  const O = th.WARN_LOOK_OFFSET;
  assert.equal(O, 36);
  assert.deepEqual(th.buildSettingsBlob({}, { color: true }).slice(O), [0xAA, 0x95], 'colour');
  assert.deepEqual(th.buildSettingsBlob({}).slice(O), [0xAA, 0x95], 'no env = colour');
  assert.deepEqual(th.buildSettingsBlob({}, { color: false }).slice(O), [0x55, 0x55],
    'B&W: outline everywhere — a warn fill would be the danger fill');
  const picked = th.buildSettingsBlob({
    threshAqiWarnLook: 'none', threshPollenWarnLook: 'outline', threshWindWarnLook: 'fill',
    threshGustWarnLook: 'none', threshStepsWarnLook: 'fill', threshSleepWarnLook: 'none',
    threshDistanceWarnLook: 'outline', threshUvWarnLook: 'none'
  }, { color: false });
  assert.deepEqual(picked.slice(O), [0 | (1 << 2) | (2 << 4) | (0 << 6),
    2 | (0 << 2) | (1 << 4) | (0 << 6)], 'a stored look wins on any platform');
  // Unknown values fall back to the default; bold-only kinds own no look cell.
  assert.deepEqual(th.buildSettingsBlob({ threshAqiWarnLook: 'bogus',
    threshTempWarnLook: 'none' }).slice(O), [0xAA, 0x95]);
  // The look never touches the alert bytes before it.
  const busy = th.buildSettingsBlob({ threshAqiWarnLook: 'none', threshUvWarnLook: 'none' });
  assert.deepEqual([busy[th.ALERTS_OFFSET], busy[th.BAR_ALERTS_OFFSET]], [0, 1]);
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
  assert.equal(blob.length, 38);
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
  assert.equal(blob.length, 38);
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

// --- the Alerts row: the rain look byte and the phone-baked metric entries ---------

test('buildSettingsBlob: byte 34 carries the rain alert look in bits 0-1', () => {
  assert.equal(th.ALERTS_OFFSET, 34);
  assert.equal(th.buildSettingsBlob({})[34], 0, 'absent = text, the legacy look');
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'text' })[34], 0);
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'icon' })[34], 1);
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'minutes' })[34], 2);
  assert.equal(th.buildSettingsBlob({ rainAlertDisplay: 'bogus' })[34], 0, 'unknown = text');
  // Bits 2-7 are reserved: whatever else is configured, they stay 0.
  const busy = th.buildSettingsBlob({ rainAlertDisplay: 'minutes', statusBoldAll: 'all',
    alertUv: true, alertUvDisplay: 'value', threshUvOn: true });
  assert.equal(busy[34], 2);
  // Which metric alerts are on never rides the Clay blob.
  assert.deepEqual(th.buildSettingsBlob({ alertUv: true, alertWind: true }),
    th.buildSettingsBlob({}));
});

test('buildSettingsBlob: byte 35 packs each bar\'s Alerts placement, 2 bits per bar', () => {
  const B = th.BAR_ALERTS_OFFSET;
  assert.equal(B, 35);
  // Absent keys: the strip left (the rain takeover it always had), the rest off.
  assert.equal(th.buildSettingsBlob({})[B], 1);
  assert.equal(th.buildSettingsBlob(null)[B], 1, 'no settings at all: the same defaults');
  // Each bar's cell, alone.
  const cells = { statusTopAlerts: 0, statusForecastAlerts: 2, statusRadarAlerts: 4,
    statusHealthAlerts: 6 };
  Object.keys(cells).forEach((key) => {
    ['off', 'left', 'middle', 'right'].forEach((place, v) => {
      const settings = { statusTopAlerts: 'off' };
      settings[key] = place;
      assert.equal(th.buildSettingsBlob(settings)[B], v << cells[key], key + ' ' + place);
    });
  });
  // All four at once: top right, forecast middle, radar left, health right.
  assert.equal(th.buildSettingsBlob({ statusTopAlerts: 'right', statusForecastAlerts: 'middle',
    statusRadarAlerts: 'left', statusHealthAlerts: 'right' })[B],
    3 | (2 << 2) | (1 << 4) | (3 << 6));
  // An explicit Off on the strip is honoured; an unknown value takes the default.
  assert.equal(th.buildSettingsBlob({ statusTopAlerts: 'off' })[B], 0);
  assert.equal(th.buildSettingsBlob({ statusTopAlerts: 'bogus', statusRadarAlerts: 'up' })[B], 1);
  // The placement never touches the rain look next door, nor the look the placement.
  const both = th.buildSettingsBlob({ rainAlertDisplay: 'minutes', statusHealthAlerts: 'right' });
  assert.equal(both[th.ALERTS_OFFSET], 2);
  assert.equal(both[B], 1 | (3 << 6));
});

test('BAR_ALERT_KEYS names the four bars\' placement settings in cell order', () => {
  assert.deepEqual(th.BAR_ALERT_KEYS, [
    { bar: 'top', key: 'statusTopAlerts' },
    { bar: 'forecast', key: 'statusForecastAlerts' },
    { bar: 'radar', key: 'statusRadarAlerts' },
    { bar: 'health', key: 'statusHealthAlerts' }
  ]);
  assert.equal(th.barAlertPlace({}, 'top'), 'left');
  assert.equal(th.barAlertPlace({}, 'health'), 'off');
  assert.equal(th.barAlertPlace({ statusRadarAlerts: 'middle' }, 'radar'), 'middle');
  assert.equal(th.barAlertPlace({}, 'nope'), 'off');
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
  const e = decodeAlerts(th.bakeAlerts(payload, Object.assign({}, settings, {
    ['alert' + key]: true, ['alert' + key + 'Display']: 'value',
    ['thresh' + key + 'Warn']: '0', ['thresh' + key + 'Danger']: '1000000'
  })));
  return e.length ? e[0].value : null;
}

/**
 * The level of the entry bakeAlerts makes for `code` with its alert on.
 * @param {string} code An ALERT_KINDS code.
 * @param {Object} payload
 * @param {Object} settings
 * @returns {number} 1 warn / 2 danger; 0 when there is no entry
 */
function alertLevelOf(code, payload, settings) {
  const key = th.ALERT_KINDS.find((a) => a.code === code).key;
  const e = decodeAlerts(th.bakeAlerts(payload, Object.assign({ ['alert' + key]: true }, settings)));
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
  // Today's peak unknown while an Alert-mode slot shows tomorrow's »9: the alert
  // still judges the current 7, never the (unjudged) next-day peak.
  const noToday = { UV_TREND_UINT8: [70], UV_DAY_PEAKS: [null, 90, 0] };
  assert.equal(packedLevel('uv', noToday, { uvSlotDisplay: 'max' }), 0,
    'guard: the slot\'s lone »9, past the danger seed 8, is judged on nothing');
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
  assert.equal(alertLevelOf('uv', p, { threshUvWarn: '8', threshUvDanger: '9' }), 0,
    'below warn: no entry');
  // Highlight-agnostic: the switch only colours the slot.
  assert.equal(alertLevelOf('uv', p, { threshUvOn: false }), 1);
  assert.equal(alertLevelOf('pollen', { POLLEN_TODAY: '3' }, {}), 2, 'seed 2/3');
  assert.equal(alertLevelOf('wind', { WIND_TREND_UINT8: [30] }, { windUnits: 'mph' }), 0,
    '30 km/h = 19 mph vs the mph seed 25/40');
});

/**
 * Decode a bakeAlerts byte array into {kind, level, value} entries.
 * @param {number[]} bytes
 * @returns {Object[]}
 */
function decodeAlerts(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const h = bytes[i++];
    const n = h >> 5;
    out.push({ kind: h & 7, level: (h >> 3) & 3,
      value: String.fromCharCode.apply(null, bytes.slice(i, i + n)) });
    i += n;
  }
  assert.equal(i, bytes.length, 'the entries tile the bytes exactly');
  return out;
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
const ALL_ON = { alertUv: true, alertWind: true, alertGust: true, alertAqi: true, alertPollen: true };

test('bakeAlerts: the exact bytes for a UV-danger + wind-warn row', () => {
  const p = { UV_TREND_UINT8: [30], UV_DAY_PEAKS: [85, 50, 0],
    WIND_TREND_UINT8: [45], WIND_DAY_PEAKS: [45, 20, 0] };
  // Icons only: one header byte each. UV = kind 7, danger (2); wind = kind 2, warn (1).
  assert.deepEqual(th.bakeAlerts(p, { alertUv: true, alertWind: true }),
    [7 | (2 << 3), 2 | (1 << 3)]);
  assert.deepEqual(th.bakeAlerts(p, { alertUv: true, alertWind: true }), [0x17, 0x0A]);
  // UV with its value ("9" — 8.5 rounds like the slot prints it), wind icon-only.
  assert.deepEqual(th.bakeAlerts(p, { alertUv: true, alertUvDisplay: 'value', alertWind: true }),
    [7 | (2 << 3) | (1 << 5), 0x39, 2 | (1 << 3)]);
  // Both with values: wind in the user's unit, no unit label.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(p, { alertUv: true, alertUvDisplay: 'value',
    alertWind: true, alertWindDisplay: 'value', windUnits: 'mph' })),
  [{ kind: 7, level: 2, value: '9' }, { kind: 2, level: 1, value: '28' }],
  'mph: 45 km/h = 28 mph, at the mph seed warn 25');
});

test('bakeAlerts: fixed order UV, wind, gust, AQI, pollen; disabled and quiet kinds absent', () => {
  const all = decodeAlerts(th.bakeAlerts(ALL_ALERTING, Object.assign({ provider: 'dwd' }, ALL_ON)));
  assert.deepEqual(all.map(e => e.kind), [7, 2, 3, 0, 1], 'UV, wind, gust, AQI, pollen');
  assert.deepEqual(all.map(e => e.level), [2, 1, 2, 2, 1]);
  assert.deepEqual(all.map(e => e.value), ['', '', '', '', ''], 'icon Look: no values');
  // A disabled alert is absent even at danger; only === true switches one on.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING,
    { alertUv: false, alertGust: true, alertAqi: 'true' })).map(e => e.kind), [3]);
  // Level 0 (below warn) is absent.
  const calm = { UV_TREND_UINT8: [20], UV_DAY_PEAKS: [30, 20, 0], WIND_TREND_UINT8: [45] };
  assert.deepEqual(decodeAlerts(th.bakeAlerts(calm, { alertUv: true, alertWind: true }))
    .map(e => e.kind), [2], 'UV 3 stays quiet, wind 45 warns');
  // Nothing alerting, no settings, no payload: no bytes.
  assert.deepEqual(th.bakeAlerts(calm, { alertUv: true }), []);
  assert.deepEqual(th.bakeAlerts(ALL_ALERTING, null), []);
  assert.deepEqual(th.bakeAlerts(null, ALL_ON), []);
});

test('bakeAlerts: values only for the kinds whose Look is value, printed like the slot', () => {
  const s = Object.assign({}, ALL_ON, {
    alertUvDisplay: 'value', alertWindDisplay: 'icon', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value'
  });
  const e = decodeAlerts(th.bakeAlerts(ALL_ALERTING, s));
  assert.deepEqual(e.map(x => x.value), ['8', '', '90', '152', '2']);
  // Pollen prints its DWD band, as the pollen slot does.
  const half = decodeAlerts(th.bakeAlerts({ POLLEN_TODAY: '2-3' },
    { alertPollen: true, alertPollenDisplay: 'value' }));
  assert.deepEqual(half, [{ kind: 1, level: 1, value: '2-3' }]);
  // Every value byte is printable ASCII (the watch's walker rejects anything else).
  th.bakeAlerts(ALL_ALERTING, s).forEach((b, i, all) => {
    if (i > 0) { assert.ok(b < 0x80, 'byte ' + i + ' of ' + all); }
  });
});

test('bakeAlerts: tail-drops entries past the 20 B cap, pollen first', () => {
  const values = Object.assign({}, ALL_ON, {
    alertUvDisplay: 'value', alertWindDisplay: 'value', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value'
  });
  assert.equal(th.ALERT_ENTRIES_MAX_BYTES, 20);
  // All five with values: 5 headers + "8" "45" "90" "152" "2" = 14 B.
  const all = th.bakeAlerts(ALL_ALERTING, values);
  assert.equal(all.length, 14);
  assert.deepEqual(decodeAlerts(all).map(e => e.kind), [7, 2, 3, 0, 1]);
  // Only a value wider than any real one fills the tuple: a 7-digit AQI (the most an
  // entry prints) with pollen's '2-3' is 3 + 3 + 3 + 8 + 3 = 20 B — all five fit...
  const wide = Object.assign({}, ALL_ALERTING, { AQI_TREND: [1234567], POLLEN_TODAY: '2-3' });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(wide, values)).map(e => e.value),
    ['8', '45', '90', '1234567', '2-3']);
  // ...and a two-digit UV on top is 21 B: pollen, the tail, drops. (Only the last
  // entry can overflow with today's five kinds, so the watch's rule — a prefix of
  // the fixed order, never a later, shorter entry — has no case to show here.)
  const over = Object.assign({}, wide, { UV_TREND_UINT8: [120], UV_DAY_PEAKS: [120, 60, 0] });
  const dropped = th.bakeAlerts(over, values);
  assert.equal(dropped.length, 17);
  assert.deepEqual(decodeAlerts(dropped).map(e => e.kind), [7, 2, 3, 0]);
  // A value past ALERT_LEN_MAX bytes rides as the icon alone.
  const huge = Object.assign({}, ALL_ALERTING, { AQI_TREND: [12345678] });
  assert.deepEqual(decodeAlerts(th.bakeAlerts(huge, values)).map(e => e.value),
    ['8', '45', '90', '', '2']);
  // Icon-only: all five = 5 B.
  assert.equal(th.bakeAlerts(over, ALL_ON).length, 5);
});

test('alertKindCodes / alertValueKindCodes: enabled codes in the row order', () => {
  assert.deepEqual(th.alertKindCodes({}), []);
  assert.deepEqual(th.alertKindCodes(ALL_ON), ['uv', 'wind', 'gust', 'aqi', 'pollen']);
  assert.deepEqual(th.alertKindCodes({ alertAqi: true, alertUv: true, alertWind: false }),
    ['uv', 'aqi']);
  assert.deepEqual(th.alertValueKindCodes({ alertAqi: true, alertAqiDisplay: 'value',
    alertUv: true, alertUvDisplay: 'icon', alertWind: false, alertWindDisplay: 'value' }),
  ['aqi'], 'a disabled alert\'s Look does not count');
  assert.deepEqual(th.alertKindCodes(null), []);
});

test('alertOn / alertValueKindCodes: keyed by code, on only for a stored true, the value only while on', () => {
  th.ALERT_KINDS.forEach((a) => {
    const on = 'alert' + a.key;
    const look = on + 'Display';
    assert.deepEqual(th.alertValueKindCodes({ [on]: true }), [], a.code);
    assert.deepEqual(th.alertValueKindCodes({ [on]: true, [look]: 'value' }), [a.code],
      a.code + ' value');
    assert.deepEqual(th.alertValueKindCodes({ [on]: true, [look]: 'icon' }), [], a.code + ' icon');
    assert.deepEqual(th.alertValueKindCodes({ [look]: 'value' }), [],
      a.code + ': off shows no value, whatever its Look');
    assert.equal(th.alertOn({ [on]: 'true' }, a.code), false, a.code + ': a stored string is not the toggle');
    assert.equal(th.alertOn({ [on]: false }, a.code), false);
    assert.equal(th.alertOn({ [on]: true }, a.code), true);
  });
  assert.equal(th.alertOn(null, 'uv'), false);
  assert.equal(th.alertOn(undefined, 'uv'), false);
  // A code with no alert reads off, even when a key of that shape is stored.
  assert.equal(th.alertOn({ alertSteps: true }, 'steps'), false, 'goal kind');
  assert.equal(th.alertOn({ alertTemp: true }, 'temp'), false, 'bold-only kind');
  assert.equal(th.alertOn({ alertUv: true }, 'Uv'), false, 'keyed by code, not stem');
  assert.equal(th.alertOn({ alertUv: true }, undefined), false);
  // Per kind: one alert's switch never turns another's on.
  assert.equal(th.alertOn({ alertAqi: true }, 'gust'), false);
});

test('the switched-on alerts ride in row order, each entry under its wire kind id', () => {
  const s = { alertPollen: true, alertUv: true, alertUvDisplay: 'value',
    alertWind: false, alertGust: 'true', alertAqiDisplay: 'value' };
  assert.deepEqual(th.alertKindCodes(s), ['uv', 'pollen']);
  assert.deepEqual(th.alertValueKindCodes(s), ['uv']);
  // An entry's kind id is its code's KINDS index, in ALERT_KINDS order.
  assert.deepEqual(decodeAlerts(th.bakeAlerts(ALL_ALERTING, ALL_ON)).map((e) => th.KINDS[e.kind].code),
    th.ALERT_KINDS.map((a) => a.code));
});

test('rainAlert: owns the three rain defaults — on, the text look, a 60 min window', () => {
  const dflt = { on: true, look: 'text', horizonMin: 60 };
  assert.deepEqual(th.rainAlert({}), dflt);
  assert.deepEqual(th.rainAlert(null), dflt);
  assert.deepEqual(th.rainAlert(undefined), dflt);
  // The switch: only a stored false is off (absent = the countdown every install had).
  assert.equal(th.rainAlert({ alertRain: false }).on, false);
  assert.equal(th.rainAlert({ alertRain: true }).on, true);
  assert.equal(th.rainAlert({ alertRain: 'false' }).on, true, 'a string is not the toggle');
  // The STORED switch: radar mode 'off' is the Clay packer's fold, not the contract's.
  assert.equal(th.rainAlert({ radarMode: 'off' }).on, true);
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
