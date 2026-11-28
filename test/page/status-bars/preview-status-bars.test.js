const test = require('node:test');
const assert = require('node:assert/strict');

// The Status bars tab's pinned preview prints each slot's SAMPLE reading the way the
// watch prints a real one: through slot-text.js / status-pair.js (the bake's own
// formatters), date-format.js (the watch's date formats) and the slot's byte cap.
const preview = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
const dateFormat = require('../../../src/pkjs/calendar/domain/date-format.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');

const EDGE = catalog.CAPS.EDGE_TEXT_MAX;
const MID = catalog.CAPS.MID_TEXT_MAX;
const DEG = '°';
const SEP_7_2026 = new Date(2026, 8, 7, 15, 0);
const sample = (code, S, ctx) => preview.sample(code, S, Object.assign({ now: SEP_7_2026 }, ctx));

test('the date slot prints month + year beside a calendar, in its picker\'s format', () => {
  assert.equal(sample('date', {}, { fullDate: false }), 'Sep 2026');
  assert.equal(sample('date', { dateSlotMonthFormat: 'name' }, { fullDate: false }), 'September 2026');
  assert.equal(sample('date', { dateSlotMonthFormat: 'iso' }, { fullDate: false }), '2026-09');
  assert.equal(sample('date', { dateSlotMonthFormat: 'dotsyy' }, { fullDate: false }), '09.26');
  assert.equal(sample('date', { dateSlotMonthFormat: 'noyear' }, { fullDate: false }), 'Sep');
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

// The date slot brings its short form, the shorter format its format falls back to
// (date_format.h), which the watch draws where the slot cannot show the date whole, and it
// gives way only where its own text is cut (`own`). None on aplite, whose lean twin cuts it.
test('the date slot brings its shorter format as its short form, in the region\'s order', () => {
  const basalt = { platform: 'basalt' };
  const date = (S, fullDate, env) => {
    const slot = preview.barSlots(Object.assign({ statusForecastMid: 'date' }, S), env || basalt, 'forecast',
      fullDate, SEP_7_2026)[1];
    return [slot.text, slot.alt, slot.own];
  };
  assert.deepEqual(date({}, false), ['Sep 2026', 'Sep', true]);
  assert.deepEqual(date({ dateSlotMonthFormat: 'iso' }, false), ['2026-09', '09.26', true]);
  assert.deepEqual(date({ dateSlotMonthFormat: 'noyear' }, false), ['Sep', '', true], 'none shorter');
  assert.deepEqual(date({ holidayCountry: 'DE', dateSlotFullFormat: 'long' }, true), ['07.09.2026', '7.9.', true]);
  assert.deepEqual(date({ holidayCountry: 'US', dateSlotFullFormat: 'long' }, true), ['09.07.2026', '9.7.', true]);
  assert.deepEqual(date({ holidayCountry: 'US', dateSlotFullFormat: 'textyear' }, true),
    ['Sep 7, 2026', 'Sep 7', true]);
  assert.deepEqual(date({ holidayCountry: 'DE', dateSlotFullFormat: 'text' }, true), ['7 Sep', '', true]);
  assert.deepEqual(date({ holidayCountry: 'DE' }, true, { platform: 'aplite' }), ['07.09.26', '', true],
    'aplite: none');
  // Another slot brings what its text carries, and gives way as before.
  const city = preview.barSlots({ statusForecastMid: 'city' }, basalt, 'forecast', false, SEP_7_2026)[1];
  assert.deepEqual([city.alt, city.own], ['', false]);
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
  assert.equal(preview.arrowDue('wind', { windSlotDirection: true }, {}), true);
  assert.equal(preview.arrowDue('wind', { windSlotDirection: false }, {}), false);
  assert.equal(preview.arrowDue('wind', { windSlotDirection: true, windSlotDisplay: 'max' }, {}), false,
    'Day max alone prints the peak, not the wind the arrow points');
  assert.equal(preview.arrowDue('wind', { windSlotDirection: true, windSlotDisplay: 'both' }, {}), true);
  assert.equal(preview.arrowDue('wind', { windSlotDirection: true }, { platform: 'aplite' }), false);
  assert.equal(preview.arrowDue('uv', { uvSlotDirection: true }, {}), false);
});

test('the arrow needs a free byte after the text, as packLine appends it', () => {
  // A spaced two-letter custom separator fills an edge slot: '12 ab 30' is 8 bytes.
  const S = { windSlotDirection: true, windSlotDisplay: 'both', windSlotSeparator: 'custom',
    windSlotSeparatorCustom: 'ab', windSlotSeparatorSpaced: true };
  const text = sample('wind', S, { cap: EDGE });
  assert.equal(text, '12 ab 30');
  assert.equal(preview.arrowShown('wind', text, S, {}, EDGE), false);
  assert.equal(preview.arrowShown('wind', '12/30', S, {}, EDGE), true);
});

test('aplite keeps the wind unit where the arrow would have stood', () => {
  const S = { windSlotDisplay: 'both', windSlotUnit: true, windSlotDirection: true };
  assert.equal(sample('wind', S, { cap: EDGE, env: { platform: 'aplite' } }), '12/30kph');
  assert.equal(sample('wind', S, { cap: EDGE, env: {} }), '12/30');
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

test('the sun and moon slots print their samples as the phone prints the real ones', () => {
  // The dusk after the Sunrise/sunset sample's sunset, in the user's clock format.
  assert.equal(sample('twilight', {}), '19:52');
  assert.equal(sample('twilight', { axisTimeFormat: '12h', timeShowAmPm: true }), '7:52p');
  assert.equal(sample('dayLength', {}), '12h38');
  // A waning gibbous moon, 89 % lit, the next full moon 26 days on: 3 Oct from 7 Sep.
  assert.equal(sample('moon', {}, { cap: EDGE }), 'Wan gib', 'the short name, the default');
  assert.equal(sample('moon', { moonSlotName: 'full' }, { cap: MID }), 'Waning gibbous', 'Full in the middle slot');
  assert.equal(sample('moon', { moonSlotName: 'full' }, { cap: EDGE }), 'Wan gib', 'a side slot keeps the short name');
  assert.equal(sample('moon', { moonSlotShows: 'lit' }, { cap: EDGE }), '89%');
  assert.equal(sample('moon', { moonSlotShows: 'lit', moonSlotLook: 'text' }, { cap: EDGE }), '89% lit');
  assert.equal(sample('moon', { moonSlotShows: 'full' }, { cap: EDGE }), '3 Oct', 'beside the full moon\'s picture');
  assert.equal(sample('moon', { moonSlotShows: 'full' }, { cap: MID }), 'Full 3 Oct', 'the middle slot says what it is');
  assert.equal(sample('moon', { moonSlotLook: 'icon' }, { cap: EDGE }), '', 'the Icon look: the moon alone');
});

test('the watch-rendered kinds print in the watch\'s own shapes', () => {
  assert.equal(sample('steps', {}), '6.2k');
  assert.equal(sample('sleep', {}), '7h12');
  assert.equal(sample('distance', {}), '4.2km');
  assert.equal(sample('distance', { distanceUnits: 'imperial' }), '2.6mi');
  assert.equal(sample('battery', {}), '', 'the watch battery is its glyph alone');
  assert.equal(sample('battery', {}, { env: { platform: 'aplite' } }), '80%',
    'aplite\'s lean twin prints the charge instead');
  // Its text looks print the charge: alone (Text), or after the glyph (Icon + text).
  assert.equal(sample('battery', { batterySlotLook: 'text' }), '80%');
  assert.equal(sample('battery', { batterySlotLook: 'both' }), '80%');
  assert.deepEqual(['icon', 'text', 'both'].map((look) => preview.drawsBatteryGlyph('battery', {}, { batterySlotLook: look })),
    [true, false, true], 'the glyph the watch draws: alone, none, before the text');
  assert.equal(preview.drawsBatteryGlyph('battery', { platform: 'aplite' }, { batterySlotLook: 'both' }), false,
    'aplite\'s lean twin prints the charge');
  assert.equal(preview.drawsBatteryGlyph('phoneBattery', {}, { batterySlotLook: 'both' }), false,
    'the watch battery\'s alone');
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
  assert.ok(html.indexOf('<span class="sbp-v sbp-left">18|16</span>') !== -1, html);
  assert.ok(html.indexOf('<span class="sbp-v sbp-mid">18' + DEG + '|16' + DEG + '</span>') !== -1, html);
});

test('a calendar shows only for a calendar top with rows', () => {
  const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_FULL }), true);
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_COMPACT }), true);
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_NONE }), false);
  assert.equal(preview.calendarShown({ top: VC.TOP_GRAPH, tier: VC.TIER_NONE }), false);
  assert.equal(preview.calendarShown({ top: VC.TOP_RADAR, tier: VC.TIER_FULL }), false);
  assert.equal(preview.calendarShown(null), false);
});

test('a bar no view of the layout seats is left out', () => {
  // Weather only without health: no view shows the top strip, so no Watch bar.
  const S = { layoutPreset: 'weatherOnly', healthMode: 'off', radarMode: 'graph' };
  const html = preview.statusBarsPreview(S, {});
  assert.equal(html.indexOf('>Watch<'), -1, html);
  assert.ok(html.indexOf('>Forecast<') !== -1);
  assert.ok(preview.statusBarsPreview({ layoutPreset: 'compactCal' }, {}).indexOf('>Watch<') !== -1);
});

test('the Radar and Health bars show while a screen shows them', () => {
  const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
  const env = { platform: 'basalt', health: true, radar: true };
  // A preset's screens follow its modes (view-cycle.js barsShown); the bars follow the screens.
  const presets = ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly'];
  presets.forEach((layoutPreset) => {
    ['off', 'slot', 'status', 'all'].forEach((healthMode) => {
      ['off', 'countdown', 'status', 'graph'].forEach((radarMode) => {
        const S = { layoutPreset, healthMode, radarMode };
        const html = preview.statusBarsPreview(S, env);
        const shown = VC.barsShown(S, env);
        const label = layoutPreset + '/' + healthMode + '/' + radarMode;
        assert.equal(html.indexOf('>Radar<') !== -1, shown.radar, label + ': ' + html);
        assert.equal(html.indexOf('>Health<') !== -1, shown.health, label + ': ' + html);
      });
    });
  });
  // Weather only with the radar graph draws the radar on top and no Radar bar.
  const wo = preview.statusBarsPreview({ layoutPreset: 'weatherOnly', healthMode: 'all', radarMode: 'graph' }, env);
  assert.equal(wo.indexOf('>Radar<'), -1, wo);
  assert.ok(wo.indexOf('>Health<') !== -1, wo);
  // A custom layout lists the bars its screens hold, whatever the stored modes say: the
  // Radar bar without radar data too.
  const custom = Object.assign({ layoutPreset: 'custom', healthMode: 'all', radarMode: 'graph' },
    VC.specToKeys(VC.buildViewCycle('weatherOnly', 'all', 'graph', false)));
  const none = preview.statusBarsPreview(custom, env);
  assert.equal(none.indexOf('>Radar<'), -1, 'no screen holds the Radar bar: ' + none);
  const seated = Object.assign({}, custom, { viewUpper0: 'radar', viewLower0: 'health', radarMode: 'off',
    healthMode: 'off' });
  const html = preview.statusBarsPreview(seated, env);
  assert.ok(html.indexOf('>Radar<') !== -1, html);
  assert.ok(html.indexOf('>Health<') !== -1, html);
});

test('the Radar and Health bars stay out while no screen shows them', () => {
  const env = { platform: 'basalt', health: true, radar: true };
  const off = preview.statusBarsPreview({ layoutPreset: 'compactCal', healthMode: 'slot', radarMode: 'countdown' }, env);
  assert.equal(off.indexOf('>Radar<'), -1, off);
  assert.equal(off.indexOf('>Health<'), -1, off);
  // A watch without the radar or health (aplite) never lists them.
  const aplite = preview.statusBarsPreview({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph' },
    { platform: 'aplite', health: false, radar: false });
  assert.equal(aplite.indexOf('>Radar<'), -1, aplite);
  assert.equal(aplite.indexOf('>Health<'), -1, aplite);
});

test('two-value temperature pairs keep the user\'s separator when the degree cannot fit', () => {
  const S = { tempSlotDisplay: 'both', tempSlotUnit: true, tempSlotSeparator: 'dot',
    tempSlotSeparatorSpaced: true };
  assert.equal(sample('temp', S, { cap: EDGE }), '18 · 16', 'bare, never a narrowed 18°·16°');
});

// The owner's, 2026-11-14: no slot takes a tap of its own (a tap on a slot hid that a bar has
// more settings); a tap on a bar's row opens its dialog (screens-page.js barsCard).
test('the bars are pictures alone, on the tab and above a slot\'s dialog: nothing to tap', () => {
  const S = { statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'battery',
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi',
    layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' };
  [undefined, { dialog: true }].forEach((opts) => {
    const html = preview.statusBarsPreview(S, {}, {}, opts);
    const where = opts ? 'above a dialog' : 'on the tab';
    assert.match(html, /^<span class="sbp" role="img" aria-label="Status bars preview"/, where);
    assert.equal(html.indexOf('<button'), -1, where + ': no buttons');
    assert.equal(html.indexOf('data-select'), -1, where + ': no picker to open');
    assert.equal(html.indexOf('sbp-hole'), -1, where + ': an empty slot is blank, as on the watch');
    assert.equal(html.indexOf('sbp-tip'), -1, where + ': and no tip to tap');
    assert.equal(html.indexOf('<div'), -1, where + ': spans alone, so a picture fits inside a button');
    assert.ok(html.indexOf('<span class="sbp-v sbp-left"></span>') !== -1, where + ': the empty slot');
    assert.ok(html.indexOf('<span class="sbp-v sbp-mid">Berlin</span>') !== -1, html);
  });
  const one = preview.barPicture(S, {}, 'forecast', { dim: true });
  assert.match(one, /^<span class="sbp one dim" role="img" aria-label="Forecast bar"/, 'one bar, dimmed');
  assert.equal(one.indexOf('<button'), -1, 'one bar: no buttons');
  assert.equal(one.indexOf('<div'), -1, 'one bar: spans alone');
});

test('barCodes reads each bar\'s slots as barSlots does, without the sample text', () => {
  const basalt = require('../../../src/pkjs/config-ui/lib/platform.js').computeEnv({ platform: 'basalt' });
  // Heart rate on a basalt reads as Empty, as the picture draws it.
  const S = { statusHealthLeft: 'empty', statusHealthRight: 'hr', statusForecastMid: 'city' };
  catalog.LINES.forEach((line) => {
    const codes = preview.barCodes(S, basalt, line.id);
    assert.deepEqual(codes.map((c) => c.key), line.slots, line.id);
    assert.deepEqual(codes.map((c) => c.pos), catalog.SLOT_POSITIONS, line.id);
    assert.deepEqual(codes, preview.barSlots(S, basalt, line.id).map((c) => ({ pos: c.pos, key: c.key, code: c.code })),
      line.id);
  });
  assert.equal(preview.barCodes(S, basalt, 'health')[2].code, 'empty');
  assert.deepEqual(preview.barCodes(S, basalt, 'unknown'), []);
});

// How much room a line has left for an edge's wide weather condition is counted in the bytes
// the bake packs. An item the watch draws from its own readings carries none, whatever its
// sample prints, so the picture gives the edges the room the bake does.
test('a slot the watch draws itself costs the line no text bytes, as in the bake', () => {
  const statusLines = require('../../../src/pkjs/status-bars/domain/status-lines.js');
  const { decodeLine } = require('../../helpers/status-line-bytes.js');
  const basalt = { platform: 'basalt' };
  // Two wide conditions (22 bytes each) fill the 48 beside a middle of 3. The date's sample
  // is nine characters: counted, the right edge would be left its short form.
  const S = { statusForecastLeft: 'condition', statusForecastMid: 'date', statusForecastRight: 'condition' };
  const drawn = preview.barSlots(S, basalt, 'forecast', false, SEP_7_2026);
  assert.equal(drawn[1].text, 'Sep 2026', 'the middle shows the watch\'s own date');
  assert.deepEqual([drawn[0].text, drawn[0].alt], ['Partly cloudy', 'PCLDY']);
  assert.deepEqual([drawn[2].text, drawn[2].alt], ['Partly cloudy', 'PCLDY']);
  // The bake, for the same line and a partly cloudy afternoon.
  const noon = Math.floor(SEP_7_2026.getTime() / 1000);
  const payload = statusLines.buildStatusLines({ CITY: 'Bonn', CURRENT_CONDITION: 'partly',
    SUN_EVENTS: [1, noon + 3600, 0, 0, 0] }, S, basalt, SEP_7_2026);
  const baked = decodeLine(payload.STATUS_LINE_1_UINT8);
  const forms = 'Partly cloudy' + catalog.ALT_SEP + 'PCLDY';
  assert.deepEqual([baked[0].text, baked[1].text, baked[2].text], [forms, '', forms]);
});

// The weather condition slot's picture prints the sample partly cloudy afternoon as the bake
// does (slot-text.js conditionText): the name with its short form where the slot has the
// bytes, split into the text and the form the watch picture swaps in where the row would cut
// the name; the short form alone in an edge slot and on aplite. The Look decides the glyph
// in one place, slotIcon.
test('the condition slot: the bake\'s forms, split, and one place for the glyph', () => {
  const basalt = { platform: 'basalt' };
  const aplite = { platform: 'aplite' };
  assert.equal(sample('condition', {}, { cap: MID, env: basalt }), 'Partly cloudy' + catalog.ALT_SEP + 'PCLDY');
  assert.equal(sample('condition', {}, { cap: EDGE, env: basalt }), 'PCLDY');
  assert.equal(sample('condition', { conditionSlotLook: 'icon' }, { cap: MID, env: basalt }), '');
  assert.equal(sample('condition', { conditionSlotLook: 'icon' }, { cap: MID, env: aplite }), 'PCLDY',
    'aplite prints the text whatever the Look');
  const S = { statusForecastLeft: 'condition', statusForecastMid: 'condition', statusForecastRight: 'empty' };
  const [left, mid] = preview.barSlots(S, basalt, 'forecast');
  assert.deepEqual([mid.text, mid.alt], ['Partly cloudy', 'PCLDY']);
  assert.deepEqual([left.text, left.alt], ['Partly cloudy', 'PCLDY'], 'the line has the room: as the bake gives it');
  // A full line leaves an edge one form, as the bake does (status-line-catalog.js widenEdges).
  const full = preview.barSlots(Object.assign({}, S, { statusForecastRight: 'condition' }), basalt, 'forecast');
  assert.deepEqual([full[0].text, full[0].alt, full[2].text], ['PCLDY', '', 'PCLDY']);
  assert.deepEqual([preview.barSlots(S, aplite, 'forecast')[0].text, preview.barSlots(S, aplite, 'forecast')[0].alt],
    ['PCLDY', ''], 'aplite: one form');
  assert.equal(preview.slotIcon('condition', basalt, { conditionSlotLook: 'text' }), null, 'the Text look: no glyph');
  assert.equal(preview.slotIcon('condition', aplite, {}), null, 'aplite draws none');
  // The city draws the current weather's icon before its name unless switched off.
  assert.equal(preview.slotIcon('city', basalt, {}), preview.slotIcon('condition', basalt, {}),
    'the city: the weather icon, on by default');
  assert.equal(preview.slotIcon('city', basalt, { citySlotIcon: false }), null, 'switched off: none');
  assert.equal(preview.slotIcon('city', aplite, {}), null, 'aplite draws none');
  assert.equal(preview.barSlots(Object.assign({ conditionSlotLook: 'text' }, S), basalt, 'forecast')[1].icon, null);
});
