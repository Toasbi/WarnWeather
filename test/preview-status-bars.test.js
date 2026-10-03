const test = require('node:test');
const assert = require('node:assert/strict');

// The Status bars tab's pinned preview prints each slot's SAMPLE reading the way the
// watch prints a real one: through slot-text.js / status-pair.js (the bake's own
// formatters), date-format.js (the watch's date formats) and the slot's byte cap.
const preview = require('../src/pkjs/settings/preview-status-bars.js');
const dateFormat = require('../src/pkjs/date-format.js');
const catalog = require('../src/pkjs/status-line-catalog.js');

const EDGE = catalog.CAPS.EDGE_TEXT_MAX;
const MID = catalog.CAPS.MID_TEXT_MAX;
const DEG = '°';
const SEP_7_2026 = new Date(2026, 8, 7, 15, 0);
const sample = (code, S, ctx) => preview.sample(code, S, Object.assign({ now: SEP_7_2026 }, ctx));

test('the date slot prints month + year beside a calendar, in its picker\'s format', () => {
  assert.equal(sample('date', {}, { fullDate: false }), 'Sep 2026');
  assert.equal(sample('date', { dateSlotMonthFormat: 'name' }, { fullDate: false }), 'September 2026');
  assert.equal(sample('date', { dateSlotMonthFormat: 'iso' }, { fullDate: false }), '2026-09');
});

test('the date slot prints the full date without a calendar, in the region\'s order', () => {
  assert.equal(sample('date', { holidayCountry: 'DE' }, { fullDate: true }), '07.09.26');
  assert.equal(sample('date', { holidayCountry: 'US' }, { fullDate: true }), '09.07.26');
  assert.equal(sample('date', {}, { fullDate: true }), '09.07.26', 'an absent region reads as the US');
  assert.equal(sample('date', { holidayCountry: 'DE', dateSlotFullFormat: 'textyear' },
    { fullDate: true }), '7. Sep 2026');
  assert.equal(sample('date', { holidayCountry: 'US', dateSlotFullFormat: 'text' },
    { fullDate: true }), 'Sep 7');
  // Never a weekday: the old sample's 'Thu 2' was no format the watch has.
  assert.doesNotMatch(sample('date', { holidayCountry: 'DE' }, { fullDate: true }), /[A-Z][a-z]{2} \d$/);
});

test('aplite\'s date slot keeps the two original formats whatever is picked', () => {
  const S = { holidayCountry: 'DE', dateSlotMonthFormat: 'iso', dateSlotFullFormat: 'textyear' };
  const env = { platform: 'aplite' };
  assert.equal(sample('date', S, { fullDate: false, env }), 'Sep 2026');
  assert.equal(sample('date', S, { fullDate: true, env }), '07.09.26');
});

test('the date and week follow today, not a fixed sample', () => {
  const now = new Date();
  assert.equal(preview.sample('date', { dateSlotMonthFormat: 'dots' }, { fullDate: false }),
    dateFormat.formatMonthYear(now, 'dots'));
  assert.equal(sample('week', {}), 'W37', '7 Sep 2026 is in ISO week 37');
});

test('temperature: Show unit answers in every Value selection, a pair\'s on both readings', () => {
  assert.equal(sample('temp', {}), '18');
  assert.equal(sample('temp', { tempSlotUnit: true }), '18' + DEG);
  assert.equal(sample('temp', { tempSlotDisplay: 'feels', tempSlotUnit: true }), '16' + DEG);
  assert.equal(sample('temp', { tempSlotDisplay: 'both' }, { cap: MID }), '18|16');
  assert.equal(sample('temp', { tempSlotDisplay: 'both', tempSlotUnit: true }, { cap: MID }),
    '18' + DEG + '|16' + DEG);
  // '18°|16°' is 9 bytes: a left or right slot prints the pair bare, as the watch does.
  assert.equal(sample('temp', { tempSlotDisplay: 'both', tempSlotUnit: true }, { cap: EDGE }), '18|16');
  assert.equal(sample('temp', { temperatureUnits: 'f' }), '64');
});

test('temperature pairs take the slot\'s order, separator and spacing', () => {
  const S = { tempSlotDisplay: 'both', tempSlotUnit: true, tempSlotOrder: 'feels',
    tempSlotSeparator: 'brackets', tempSlotSeparatorSpaced: true };
  assert.equal(sample('temp', S, { cap: MID }), '16' + DEG + ' (18' + DEG + ')');
  assert.equal(sample('temp', Object.assign({}, S, { tempSlotUnit: false }), { cap: EDGE }), '16 (18)');
  assert.equal(sample('temp', { tempSlotDisplay: 'both', tempSlotSeparator: 'custom',
    tempSlotSeparatorCustom: '~' }, { cap: MID }), '18~16');
});

test('the day-max kinds print Now, Day max and Both as the watch does', () => {
  assert.equal(sample('uv', {}), '3');
  assert.equal(sample('uv', { uvSlotDisplay: 'max' }), '7');
  assert.equal(sample('uv', { uvSlotDisplay: 'both' }), '3/7');
  assert.equal(sample('uv', { uvSlotDisplay: 'both', uvSlotOrder: 'max' }), '7/3');
  assert.equal(sample('aqi', { aqiSlotDisplay: 'both', aqiSlotSeparator: 'dot',
    aqiSlotSeparatorSpaced: true }, { cap: MID }), '42 · 58');
  // A spaced pair keeps its spaces where they fit an edge slot.
  assert.equal(sample('gust', { gustSlotDisplay: 'both', gustSlotSeparatorSpaced: true,
    gustSlotUnit: false }, { cap: EDGE }), '20 / 45');
});

test('wind units sit tight, drop when they do not fit, and give way to the arrow', () => {
  const both = { windSlotDisplay: 'both', windSlotUnit: true };
  assert.equal(sample('wind', both, { cap: MID }), '12/30kph');
  assert.equal(sample('wind', Object.assign({ windSlotDirection: false }, both), { cap: EDGE }),
    '12/30kph', '8 bytes fit an edge slot without the arrow');
  assert.equal(sample('wind', Object.assign({ windSlotDirection: true }, both), { cap: EDGE }),
    '12/30', 'the arrow takes the unit\'s last byte');
  assert.equal(sample('wind', Object.assign({ windSlotDirection: true }, both), { cap: MID }),
    '12/30kph');
  assert.equal(sample('wind', { windSlotUnit: false }), '12');
  assert.equal(sample('wind', { windUnits: 'mph' }), '7mph');
  assert.equal(sample('gust', { windUnits: 'knots', gustSlotDisplay: 'max' }), '24kn');
});

test('the arrow follows the watch: on, the current reading shown, not aplite', () => {
  assert.equal(preview.arrowShown('wind', { windSlotDirection: true }, {}), true);
  assert.equal(preview.arrowShown('wind', { windSlotDirection: false }, {}), false);
  assert.equal(preview.arrowShown('wind', { windSlotDirection: true, windSlotDisplay: 'max' }, {}), false,
    'Day max alone prints the peak, not the wind the arrow points');
  assert.equal(preview.arrowShown('wind', { windSlotDirection: true, windSlotDisplay: 'both' }, {}), true);
  assert.equal(preview.arrowShown('wind', { windSlotDirection: true }, { platform: 'aplite' }), false);
  assert.equal(preview.arrowShown('uv', { uvSlotDirection: true }, {}), false);
});

test('the other phone-baked kinds print their units by their own toggles', () => {
  assert.equal(sample('pressure', {}), '1013hPa');
  assert.equal(sample('pressure', { pressureSlotUnit: false }), '1013');
  assert.equal(sample('dew', {}), '9');
  assert.equal(sample('dew', { dewSlotUnit: true }), '9' + DEG);
  assert.equal(sample('countdown', { statusTopLeftCountdown: '2026-09-12' }, { slotKey: 'statusTopLeft' }), '5d');
  assert.equal(sample('countdown', { statusTopLeftCountdown: '2026-09-12', countdownSlotUnit: false },
    { slotKey: 'statusTopLeft' }), '5');
  assert.equal(sample('countdown', {}, { slotKey: 'statusTopLeft' }), 'now', 'no date set: today');
  assert.equal(sample('sun', {}), '19:14');
  assert.equal(sample('sun', { axisTimeFormat: '12h', timeShowAmPm: true }), '7:14p');
});

test('the watch-rendered kinds print in the watch\'s own shapes', () => {
  assert.equal(sample('steps', {}), '6.2k');
  assert.equal(sample('sleep', {}), '7h12');
  assert.equal(sample('distance', {}), '4.2km');
  assert.equal(sample('distance', { distanceUnits: 'imperial' }), '2.6mi');
  assert.equal(sample('battery', {}), '', 'the watch battery is its glyph alone');
});

test('the block prints the date by whether the bar\'s view shows a calendar', () => {
  const now = new Date();
  const S = { statusTopLeft: 'date', holidayCountry: 'DE', dateSlotMonthFormat: 'iso',
    dateSlotFullFormat: 'long' };
  const withCal = preview.statusBarsPreview(Object.assign({ layoutPreset: 'compactCal' }, S), {});
  assert.ok(withCal.indexOf('>' + dateFormat.formatMonthYear(now, 'iso') + '<') !== -1, withCal);
  const noCal = preview.statusBarsPreview(Object.assign({ layoutPreset: 'noCal' }, S), {});
  assert.ok(noCal.indexOf('>' + dateFormat.formatFullDate(now, 'long', false) + '<') !== -1, noCal);
});

test('the block sizes each slot by its position: the middle slot has room for the degrees', () => {
  const S = { statusForecastLeft: 'temp', statusForecastMid: 'temp', statusForecastRight: 'empty',
    tempSlotDisplay: 'both', tempSlotUnit: true };
  const html = preview.statusBarsPreview(S, {});
  assert.ok(html.indexOf('sbp-left">18|16<') !== -1, html);
  assert.ok(html.indexOf('sbp-mid">18' + DEG + '|16' + DEG + '<') !== -1, html);
});

test('a calendar shows only for a calendar top with rows', () => {
  const VC = require('../src/pkjs/view-cycle.js');
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_FULL }), true);
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_COMPACT }), true);
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_NONE }), false);
  assert.equal(preview.calendarShown({ top: VC.TOP_GRAPH, tier: VC.TIER_NONE }), false);
  assert.equal(preview.calendarShown({ top: VC.TOP_RADAR, tier: VC.TIER_FULL }), false);
  assert.equal(preview.calendarShown(null), false);
});
