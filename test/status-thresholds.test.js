'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const th = require('../src/pkjs/status-thresholds.js');
const statusLines = require('../src/pkjs/status-lines.js');

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
    assert.equal(blob.length, 34, mode + ': the duplicate must not widen the blob');
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
  // The duplicate key must not confuse the key-keyed helpers either — both
  // return on the first match, and 'PhoneBattery' is neither downward nor a goal.
  assert.equal(th.belowIsWorse('PhoneBattery'), false);
  assert.equal(th.isGoalKind('PhoneBattery'), false);
});

test('the phone-battery cells share byte 33 with battery % and dew without bleeding', () => {
  const blob = th.buildSettingsBlob({
    threshBatteryPctBoldMode: 'always',   // kind 16 -> bits 0-1
    threshDewBoldMode: 'off',             // kind 17 -> bits 2-3
    threshPhoneBatteryBoldMode: 'off'     // kinds 18 AND 19 -> bits 4-5, 6-7
  });
  assert.equal(blob.length, 34, 'byte 33 was already paid for — no widening');
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
  assert.equal(th.computeLevel(99, 100, 200, false), 0);
  assert.equal(th.computeLevel(100, 100, 200, false), 1);
  assert.equal(th.computeLevel(199, 100, 200, false), 1);
  assert.equal(th.computeLevel(200, 100, 200, false), 2);
});

test('computeLevel: below-is-worse boundaries are inclusive', () => {
  assert.equal(th.computeLevel(9000, 8000, 4000, true), 0);
  assert.equal(th.computeLevel(8000, 8000, 4000, true), 1);
  assert.equal(th.computeLevel(4000, 8000, 4000, true), 2);
  assert.equal(th.computeLevel(0, 8000, 4000, true), 2);
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

test('a kind is enabled only when both thresholds are set AND ordered', () => {
  assert.equal(th.kindConfig({}, 0).enabled, false);
  assert.equal(th.kindConfig({ threshAqiWarn: '100' }, 0).enabled, false);
  assert.equal(th.kindConfig({ threshAqiWarn: '100', threshAqiDanger: '200' }, 0).enabled, true);
  assert.equal(th.kindConfig({ threshAqiWarn: '200', threshAqiDanger: '100' }, 0).enabled, false);
  // Goal kinds order upward since the celebration rework: close (warn slot) <= goal.
  assert.equal(th.kindConfig({ threshStepsWarn: '8000', threshStepsDanger: '4000' }, 4).enabled, false);
  assert.equal(th.kindConfig({ threshStepsWarn: '4000', threshStepsDanger: '8000' }, 4).enabled, true);
  // Equal thresholds are a valid pair in either direction.
  assert.equal(th.kindConfig({ threshAqiWarn: '100', threshAqiDanger: '100' }, 0).enabled, true);
});

test('displayValue mirrors the numbers status-lines.js displays', () => {
  const payload = { AQI_TREND: [153.4], WIND_TREND_UINT8: [50], GUST_TREND_UINT8: [90], POLLEN_TODAY: '2-3' };
  assert.equal(th.displayValue('aqi', payload, {}), 153);
  // POLLEN_TODAY is a DWD band STRING, not a number; '2-3' maps to 2.5.
  assert.equal(th.displayValue('pollen', payload, {}), 2.5);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: '1' }, {}), 1);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: '0-1' }, {}), 0.5);
  assert.equal(th.displayValue('wind', payload, { windUnits: 'kph' }), 50);
  assert.equal(th.displayValue('wind', payload, { windUnits: 'mph' }), 31);   // round(50/1.60934)
  assert.equal(th.displayValue('gust', payload, { windUnits: 'knots' }), 49); // round(90/1.852)
  assert.equal(th.displayValue('aqi', {}, {}), null);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: null }, {}), null);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: 'n/a' }, {}), null); // unknown band
});

// Binding test for the feature's central correctness requirement: a threshold compares
// against the number the user SEES. status-thresholds.js duplicates formatWind()'s
// divisors (1.60934 / 1.852) from status-lines.js, and the assertions above pin only the
// literals 31/49 — so a change to the formatter's rounding (or a new unit) would silently
// desync the highlight from the on-screen number with every test still green. Pin
// displayValue to the FORMATTER'S OUTPUT instead. formatValue appends the unit label
// ("31mph" / "27kn" / "50kph"), so the displayed number is its leading integer.
test('displayValue is pinned to what status-lines actually displays (wind, gust, aqi)', () => {
  const payload = { WIND_TREND_UINT8: [50], GUST_TREND_UINT8: [90], AQI_TREND: [153.4] };
  ['kph', 'mph', 'knots'].forEach(unit => {
    ['wind', 'gust'].forEach(code => {
      const shown = statusLines.formatValue(code, payload, { windUnits: unit });
      assert.match(shown, /^\d+(kph|mph|kn)$/,
        code + ' in ' + unit + ' must format as <integer><unit>, got "' + shown + '"');
      assert.equal(th.displayValue(code, payload, { windUnits: unit }), parseInt(shown, 10),
        code + ' threshold must compare against the displayed number (' + unit + ': "' + shown + '")');
    });
  });
  const aqiShown = statusLines.formatValue('aqi', payload, {});
  assert.equal(th.displayValue('aqi', payload, {}), parseInt(aqiShown, 10),
    'AQI threshold must compare against the displayed number ("' + aqiShown + '")');
  // Pollen is deliberately NOT bindable this way: formatValue shows the DWD band string
  // ('2-3'), while displayValue maps it to the numeric level 2.5 the threshold is entered
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

test('packWeatherLevels: missing data or disabled kinds emit normal', () => {
  assert.deepEqual(th.packWeatherLevels({}, { threshAqiWarn: '1', threshAqiDanger: '2' }), [0, 0]);
  assert.deepEqual(th.packWeatherLevels({ AQI_TREND: [500] }, {}), [0, 0]);
});

test('buildSettingsBlob: enabled mask, GColor8 colors, LE uint16 health thresholds', () => {
  // Goal pairs order upward since the celebration rework (close <= goal).
  const blob = th.buildSettingsBlob({
    threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00, threshAqiDangerColor: 0xFF0000,
    threshStepsWarn: '4000', threshStepsDanger: '8000',
    threshSleepWarn: '5', threshSleepDanger: '7.5',
    threshDistanceWarn: '2', threshDistanceDanger: '5'
  });
  assert.equal(blob.length, 34);
  assert.equal(blob[0], (1 << 0) | (1 << 4) | (1 << 5) | (1 << 6));
  assert.equal(blob[1], 0xF8);   // rgbToGColor8(0xFFAA00)
  assert.equal(blob[2], 0xF0);   // rgbToGColor8(0xFF0000)
  // Goal kinds with UNSET colors pack DEFAULT_GOAL_COLOR (0x55FF00 -> GColor8 0xDC)
  // for both slots — the green celebration default, not the warn-none sentinel.
  assert.equal(blob[1 + 2 * 4], 0xDC, 'steps close color defaults green');
  assert.equal(blob[2 + 2 * 4], 0xDC, 'steps goal color defaults green');
  assert.deepEqual(blob.slice(17, 21), [0xA0, 0x0F, 0x40, 0x1F]); // steps 4000/8000 LE
  assert.deepEqual(blob.slice(21, 25), [300 & 0xFF, 300 >> 8, 450 & 0xFF, 450 >> 8]); // sleep h -> min
  assert.deepEqual(blob.slice(25, 29), [20, 0, 50, 0]);           // km -> 100 m units
});

test('buildSettingsBlob: imperial distance thresholds convert mi -> 100 m units', () => {
  const blob = th.buildSettingsBlob({
    distanceUnits: 'imperial',
    threshDistanceWarn: '1', threshDistanceDanger: '3'
  });
  assert.deepEqual(blob.slice(25, 29), [16, 0, 48, 0]); // round(1*16.0934)=16, round(3*16.0934)=48
  assert.equal(blob[0], 1 << 6);
});

test('buildSettingsBlob: nothing configured -> all disabled, zeroed thresholds', () => {
  const blob = th.buildSettingsBlob({});
  assert.equal(blob[0], 0);
  // 12 health-threshold bytes, then the five bold bytes (0 = the default warn mode).
  assert.deepEqual(blob.slice(17),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

// "0 and negative thresholds are legitimate; unset must stay distinguishable from zero" —
// asserted through the real enable + pack path, not just parseThreshold() in isolation.
test('a 0 threshold is SET (enables the kind) and packs as zero, unlike unset', () => {
  // Weather kind: 0/0 is an ordered pair, so AQI is enabled and every reading >= 0 is danger.
  const zeroAqi = { threshAqiWarn: '0', threshAqiDanger: '0' };
  assert.equal(th.kindConfig(zeroAqi, 0).enabled, true, '0/0 must enable the kind');
  assert.equal(th.kindConfig(zeroAqi, 0).warn, 0, 'warn is the number 0, not null');
  assert.deepEqual(th.packWeatherLevels({ AQI_TREND: [0] }, zeroAqi), [2, 0], 'AQI 0 >= danger 0');
  // A half-set pair with the OTHER field 0 stays disabled: 0 does not stand in for unset.
  assert.equal(th.kindConfig({ threshAqiWarn: '0' }, 0).enabled, false);
  assert.equal(th.kindConfig({ threshAqiDanger: '0' }, 0).enabled, false);
  // Goal kind through the blob: steps 0/100 is ordered (close <= goal since the
  // celebration rework) -> bit 4 set, and the close uint16 is a real zero —
  // indistinguishable in the bytes from "unset", which is exactly why the enabled
  // MASK is the only signal the watch may trust.
  const blob = th.buildSettingsBlob({ threshStepsWarn: '0', threshStepsDanger: '100' });
  assert.equal(blob[0] & (1 << 4), 1 << 4, 'steps enabled with a 0 close threshold');
  assert.deepEqual(blob.slice(17, 21), [0, 0, 100, 0], 'close 0 / goal 100, LE uint16');
  // Sleep 0/0 likewise enables and packs zeroes...
  const sleepBlob = th.buildSettingsBlob({ threshSleepWarn: '0', threshSleepDanger: '0' });
  assert.equal(sleepBlob[0] & (1 << 5), 1 << 5, 'sleep 0/0 enables the kind');
  assert.deepEqual(sleepBlob.slice(21, 25), [0, 0, 0, 0]);
  // ...while leaving it unset does NOT set the bit, with the same zero bytes.
  const unsetBlob = th.buildSettingsBlob({});
  assert.equal(unsetBlob[0] & (1 << 5), 0, 'unset sleep must stay disabled');
  assert.deepEqual(unsetBlob.slice(21, 25), [0, 0, 0, 0]);
});

// thresh<Kind>BoldMode: 2 bits per kind in the two bold bytes. 'warn' packs to 0
// so a never-configured kind reproduces the shipped bold-from-warn behaviour.
test('buildSettingsBlob: unset bold modes pack as warn (all-zero bold bytes)', () => {
  const blob = th.buildSettingsBlob({});
  assert.equal(blob.length, 34);
  assert.deepEqual(blob.slice(th.BOLD_OFFSET), [0, 0, 0, 0, 0]);
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
  assert.deepEqual(blob.slice(th.BOLD_OFFSET), expected);
  // The bold area itself must not shrink, or the assertion above goes vacuous.
  assert.equal(th.SETTINGS_BYTES - th.BOLD_OFFSET, 5, 'bold area is bytes 29..33');
});

test('statusBoldAll "all" leaves everything below the bold area byte-identical', () => {
  const settings = {
    threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00,
    threshStepsWarn: '4000', threshStepsDanger: '8000'
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
  assert.deepEqual(th.buildSettingsBlob(mixed).slice(th.BOLD_OFFSET), expected);
  assert.deepEqual(
    th.buildSettingsBlob(Object.assign({ statusBoldAll: 'perSlot' }, mixed)).slice(th.BOLD_OFFSET),
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
  assert.equal(blob.length, 34);
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

test('belowIsWorse by settings-key stem — no shipped kind warns downward anymore', () => {
  assert.equal(th.belowIsWorse('Aqi'), false);
  assert.equal(th.belowIsWorse('Gust'), false);
  assert.equal(th.belowIsWorse('Steps'), false);
  assert.equal(th.belowIsWorse('Distance'), false);
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
