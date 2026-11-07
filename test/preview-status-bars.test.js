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

test('the watch-rendered kinds print in the watch\'s own shapes', () => {
  assert.equal(sample('steps', {}), '6.2k');
  assert.equal(sample('sleep', {}), '7h12');
  assert.equal(sample('distance', {}), '4.2km');
  assert.equal(sample('distance', { distanceUnits: 'imperial' }), '2.6mi');
  assert.equal(sample('battery', {}), '', 'the watch battery is its glyph alone');
  assert.equal(sample('battery', {}, { env: { platform: 'aplite' } }), '80%',
    'aplite\'s lean twin prints the charge instead');
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
  assert.match(html, /sbp-left" data-select="statusForecastLeft"[^>]*>18\|16</);
  assert.ok(new RegExp('sbp-mid" data-select="statusForecastMid"[^>]*>18' + DEG + '\\|16' + DEG + '<').test(html), html);
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

test('a bar no view of the layout seats is left out', () => {
  // Weather only without health: no view shows the top strip, so no Watch bar.
  const S = { layoutPreset: 'weatherOnly', healthMode: 'off', radarMode: 'graph' };
  const html = preview.statusBarsPreview(S, {});
  assert.equal(html.indexOf('>Watch<'), -1, html);
  assert.ok(html.indexOf('>Forecast<') !== -1);
  assert.ok(preview.statusBarsPreview({ layoutPreset: 'compactCal' }, {}).indexOf('>Watch<') !== -1);
});

test('the Radar and Health bars show while a screen shows them', () => {
  const VC = require('../src/pkjs/view-cycle.js');
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

test('on the tab each slot is a button that opens its picker, named by bar, slot and item', () => {
  const S = { statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'battery',
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi',
    layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' };
  const html = preview.statusBarsPreview(S, {});
  assert.match(html, /^<div class="sbp tap" role="group" aria-label="Status bars"/);
  const slots = html.match(/<button type="button" class="sbp-v [^"]*" data-select="[^"]*" aria-label="[^"]*">/g) || [];
  assert.deepEqual(slots.map((b) => /data-select="([^"]*)"/.exec(b)[1]),
    ['statusTopLeft', 'statusTopMid', 'statusTopRight', 'statusForecastLeft', 'statusForecastMid', 'statusForecastRight'],
    'every slot of every shown bar, by its own key');
  assert.ok(html.indexOf('data-select="statusTopLeft" aria-label="Watch bar, left slot: Empty">'
    + '<span class="sbp-hole" aria-hidden="true"></span></button>') !== -1, 'an empty slot shows a hole to tap');
  assert.ok(html.indexOf('aria-label="Forecast bar, middle slot: City">Berlin</button>') !== -1, html);
  assert.ok(html.indexOf('class="sbp-v sbp-left sbp-empty"') !== -1, 'the empty one is marked');
  // The bars say a tap changes a slot (the owner, 2026-11-06: it was not obvious), once,
  // under the last bar, for sighted users only: each button carries its own name.
  assert.equal(html.match(/<div class="sbp-tip" aria-hidden="true">Tap a slot to change it<\/div>/g).length, 1);
  assert.ok(/<\/div><div class="sbp-tip"[^>]*>[^<]*<\/div><\/div>$/.test(html), 'the tip closes the bars');
});

test('above a slot\'s dialog the bars are the picture alone: nothing to tap', () => {
  const S = { statusTopLeft: 'empty', statusForecastMid: 'city', layoutPreset: 'compactCal',
    healthMode: 'off', radarMode: 'off' };
  const html = preview.statusBarsPreview(S, {}, {}, { dialog: true });
  assert.match(html, /^<div class="sbp" role="img" aria-label="Status bars preview"/);
  assert.equal(html.indexOf('<button'), -1, 'no buttons');
  assert.equal(html.indexOf('data-select'), -1, 'no picker to open');
  assert.equal(html.indexOf('sbp-hole'), -1, 'an empty slot is blank, as on the watch');
  assert.equal(html.indexOf('sbp-tip'), -1, 'and no tip to tap');
  assert.ok(html.indexOf('<span class="sbp-v sbp-mid">Berlin</span>') !== -1, html);
});

test('barCodes reads each bar\'s slots as barSlots does, without the sample text', () => {
  const basalt = require('../src/pkjs/config-ui/lib/platform.js').computeEnv({ platform: 'basalt' });
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
