// test/config-schema.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
// The settings instance clay-settings.js seeds a fresh install from (getDefaults).
const settings = require('../src/pkjs/settings');
// Pulled in so PConf.optionsResolvers is populated (blocks.js registers layoutPresetOptions
// et al.) — needed to resolve layoutPreset's optionsFrom.resolver end-to-end below.
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');

function allItems(s) { const out = []; s.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((it) => out.push(it)))); return out; }
const items = allItems(schema);
const byKey = (k) => items.filter((i) => i.messageKey === k)[0];
// The forecast lines' rows: each line's own dialog (Graphs › Forecast › Lines opens them),
// in line order — the rows the old Forecast tab stacked under each metric picker.
const LINE_SHEETS = ['lineMain', 'lineSecond', 'lineThird', 'lineFourth'];
const graphsTab = (s) => (s || schema).tabs.find((t) => t.id === 'graphs');
const { graphDialog, dialogCards, dialogCard } = require('./helpers/graph-dialog.js');
const lineSheetById = (id, s) => graphsTab(s).sections.find((sec) => sec.sheetId === id);
function forecastItems(s) { return LINE_SHEETS.reduce((acc, id) => acc.concat(lineSheetById(id, s).items), []); }

// Threshold highlighting adds six keys per kind (7 kinds: the toggle, the pair, the
// scale max, two colors), generated the same way schema.js's sheet builders
// generate them — listing 42 literals would just invite drift. THRESH_COLOR_KEYS is
// reused by the color-defaults assertion below.
const THRESH_STEMS = ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance', 'Uv'];
// The kinds with an Alert settings card row and an alert<Stem> sheet (their Look, Days and
// levels), in the card's row order (the goal kinds are not alerts).
const ALERT_STEMS = ['Gust', 'Uv', 'Aqi', 'Pollen', 'Wind'];
const threshKeys = (suffixes) => THRESH_STEMS.reduce((acc, stem) =>
  acc.concat(suffixes.map((suffix) => 'thresh' + stem + suffix)), []);
const THRESH_COLOR_KEYS = threshKeys(['WarnColor', 'DangerColor']);
// The bold-only slot kinds (wire ids 8..19 in status-thresholds.js) add ONE key
// each: a Bold row is their whole sheet (Temp additionally carries the
// tempSlotDisplay row and the rows shaping its Both pair — listed with the plain
// keys below). The battery GLYPH item
// is deliberately absent — its slot draws a glyph, not text, so it has no sheet
// and no key; the battery PERCENTAGE kind (BatteryPct) renders text and has both.
// PhoneBattery is ONE stem for TWO wire kinds (18 phoneBattery, 19 phoneBatteryPlain):
// both KINDS entries share key 'PhoneBattery', so they share one sheet and one key.
const BOLD_ONLY_STEMS = ['Temp', 'Pressure', 'Sun', 'Date', 'Week', 'City', 'Countdown', 'Hr', 'BatteryPct', 'Dew',
  'PhoneBattery'];
const BOLD_ONLY_KEYS = BOLD_ONLY_STEMS.map((stem) => 'thresh' + stem + 'BoldMode');
const THRESH_KEYS = threshKeys(['On', 'BoldMode', 'WarnLook', 'Warn', 'Danger', 'Max'])
  .concat(THRESH_COLOR_KEYS)
  .concat(BOLD_ONLY_KEYS)
  // Per-kind display rows that ride a threshold sheet: the wind/gust direction arrows,
  // their "Show unit" toggles, the UV slot's display mode with the rows shaping its
  // Both pair and its tomorrow mark (Temp's tempSlotDisplay and pair rows are listed
  // with the plain keys below, next to the other three "Show unit" keys on bold-only
  // sheets).
  .concat(['windSlotDirection', 'gustSlotDirection', 'windSlotUnit', 'gustSlotUnit',
    'uvSlotDisplay', 'uvSlotSeparator', 'uvSlotSeparatorCustom', 'uvSlotSeparatorSpaced',
    'uvSlotOrder', 'uvSlotNextDayMark']
    // ...and the same day-max rows on the wind, gust and AQI sheets.
    .concat(['wind', 'gust', 'aqi'].reduce((all, k) => all.concat(['Display', 'Separator',
      'SeparatorCustom', 'SeparatorSpaced', 'Order', 'NextDayMark'].map((f) => k + 'Slot' + f)), [])));
// The "Show unit" toggles on the BOLD-ONLY sheets. Six kinds have one — the six whose
// slot text the phone bakes; the watch-formatted kinds (distance, heart rate, sleep,
// battery %) would need the flag on the wire and are deliberately absent.
const UNIT_KEYS = ['tempSlotUnit', 'pressureSlotUnit', 'countdownSlotUnit', 'dewSlotUnit'];
// The weather alerts' own keys: each alert kind's Look, Days and tomorrow mark and the
// rain alert's look and Replaces the slot — and On demand's: each bar's two sides with their ticked items (the
// side lists every alert sheet's Shows on grid writes, on the Alerts tab) and the Battery
// item's warn level and Look (on-demand.js DEFAULTS, the one list of them).
const ALERT_KEYS = ALERT_STEMS.reduce((acc, stem) => acc.concat(['alert' + stem + 'Display',
  'alert' + stem + 'Days', 'alert' + stem + 'NextDayMark']),
  ['rainAlertDisplay', 'rainAlertReplacesSlot']).concat(Object.keys(require('../src/pkjs/on-demand.js').DEFAULTS));
// The Graph-colors rows: every metric colour, with one picker per theme polarity so a
// Dark and a Light pick never overwrite one another (the colorUSFederal idiom). The list
// comes from line-style.js because the schema builds its rows from the same call — this
// file asserts the card matches the RENDERER's key list, not that both match a third
// copy kept here.
const lineStyle = require('../src/pkjs/line-style.js');
const GRAPH_COLOR_KEYS = lineStyle.graphColorKeys();

const EXPECTED_KEYS = [
  'theme','themeAuto','themeNight','themeAutoMode','themeAutoStartHour','themeAutoEndHour',
  'graphsProvider','graphsLocation','savedLocation1','savedLocation2','savedLocation3','weatherTabSeenAt',
  'timeLeadingZero','timeShowAmPm','axisTimeFormat','timeFont','colorTime',
  'weekStartDay','firstWeek','colorToday','colorSunday','colorSaturday','holidaysEnabled','colorUSFederal',
  'holidayCountry','holidayRegion',
  // sleepStartHour/sleepEndHour are the battery saver's own From/To pair, as they have
  // always been. Every Nighttime feature keeps its hours in its own keys — there is no
  // shared window and no mode key selecting between one, so sleepNightMode /
  // sleepNightStartHour / sleepNightEndHour / backlightDimMode are gone.
  'fetchIntervalMin','gpsCacheMin','sleepNightEnabled','sleepStartHour','sleepEndHour','fetch','fetchNoticeAck','locationMode','location',
  'backlightDim','backlightDimStartHour','backlightDimEndHour','backlightDimColor',
  'temperatureUnits','aqiSource','aqiScale','windUnits','distanceUnits','feelsFormula','dayNightShading','healthMode','hrScale','secondaryLine','secondaryLineFill','secondaryLineStyle','windScale','pressureScale','thirdLine','thirdLineStyle','fourthLine','fourthLineStyle','fifthLine','fifthLineStyle','tempSlotDisplay',
  'windLineShow','gustLineShow','uvLineShow',
  'precipLineFrom','cloudLineFrom','windLineFrom','uvLineFrom','rainBarFrom','radarBarFrom',
  'tempSlotSeparator','tempSlotSeparatorCustom','tempSlotSeparatorSpaced','tempSlotOrder',
  'dateSlotMonthFormat','dateSlotFullFormat',
  // The weather condition slot's Look (Icon + text / Text / Icon).
  'conditionSlotLook',
  'barSource','rainBarColor','provider','owmApiKey','yandexApiKey','tomorrowioApiKey','tomorrowioFitBudget','rainbowApiKey','rainbowFitBudget','radarMode','radarProvider','radarColor','radarSky','radarNoRainText','rainCountdownHorizon',
  'layoutPreset','largeGraphFont','forecastHours',
  'forecastAxisNumbers','forecastAxisScale','doubleFlick','viewResetMin','swapClockStatus','configTheme','showQt','vibe','btIcons','telemetryEnabled','onboardingDone','startOnWeatherTab',
  // Setup › Misc › Hide info text: page-only like startOnWeatherTab (rides the saved blob,
  // never read watch-side), but a stored key all the same.
  'hideInfoText','devStatsEnabled','devStatsClear','reset',
  // Custom-layout storage (sheetOnly section; see customViewItems in custom-layout-schema.js).
  'viewCount','customLayoutSeeded',
  // The rain radar's Off, apart from its source (2.6; hidden until Setup's Data sources).
  'radarEnabled',
  'viewTop0','viewBody0','viewUpper0','viewLower0','viewOrder0','viewStripOff0',
  'viewTop1','viewBody1','viewUpper1','viewLower1','viewOrder1','viewClockOff1','viewStripOff1',
  'viewTop2','viewBody2','viewUpper2','viewLower2','viewOrder2','viewClockOff2','viewStripOff2',
  'viewTopSize0','viewBodySize0','viewAlign0',
  'viewTopSize1','viewBodySize1','viewAlign1',
  'viewTopSize2','viewBodySize2','viewAlign2',
  // Graph styles (Pebble Time 2): each screen's style and the extra styles' blob.
  'viewStyle0','viewStyle1','viewStyle2','graphStyles',
  // The screens' names (3.0): page-only, never compiled or sent (screens.js nameOf).
  'viewName0','viewName1','viewName2',
  // The status bars' names (3.0): page-only too (screens.js barName).
  'statusForecastName','statusRadarName','statusHealthName',
  // Bars 4 to 6 (Pebble Time 2, New status bar): each one's made flag, name, slots and their
  // countdown dates (its side lists are on-demand.js DEFAULTS', ALERT_KEYS).
  ...['statusBar4', 'statusBar5', 'statusBar6'].reduce((all, p) => all.concat([p + 'Made', p + 'Name',
    p + 'Left', p + 'LeftCountdown', p + 'Mid', p + 'MidCountdown', p + 'Right', p + 'RightCountdown']), []),
  'statusBoldAll',
  'statusForecastLeft','statusForecastLeftCountdown','statusForecastMid','statusForecastMidCountdown','statusForecastRight','statusForecastRightCountdown',
  'statusRadarLeft','statusRadarLeftCountdown','statusRadarMid','statusRadarMidCountdown','statusRadarRight','statusRadarRightCountdown',
  'statusTopLeft','statusTopLeftCountdown','statusTopMid','statusTopMidCountdown','statusTopRight','statusTopRightCountdown',
  'batteryLowOnly','statusHealthLeft','statusHealthLeftCountdown','statusHealthMid','statusHealthMidCountdown','statusHealthRight','statusHealthRightCountdown'
].concat(THRESH_KEYS).concat(UNIT_KEYS).concat(GRAPH_COLOR_KEYS).concat(ALERT_KEYS);

test('every Clay messageKey present; theme/windScale/colorUSFederal are the only duplicates (contextual slots)', () => {
  EXPECTED_KEYS.forEach((k) => assert.ok(byKey(k), 'missing messageKey: ' + k));
  // uiOnly items (the shared Night hours' pickers and its Separate hours toggle) are
  // page-only: never stored, never sent, so they are not Clay keys at all.
  const seen = items.filter((i) => i.messageKey && !i.uiOnly).map((i) => i.messageKey);
  const counts = {};
  seen.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  const dups = Object.keys(counts).filter((k) => counts[k] > 1);
  // windScale: one slot per metric picker (main / second / third / fourth metric) and wind
  // unit. pressureScale: one per metric picker. theme: color-env (4 options) vs. B&W-env
  // (2 options) — two slots, not four: the 'Day theme' pair is gone and the Theme
  // row is never renamed. themeNight is the same color/B&W split. colorUSFederal:
  // dark-exclude-white vs. light-exclude-black.
  // tomorrowioApiKey/tomorrowioFitBudget: the Setup tab's Tomorrow.io key sheet (weather
  // provider) vs. the Graphs tab's radar one (radar-only) — mutually-exclusive showWhen,
  // so only one instance ever renders.
  // The five alert kinds' levels live in ONE place, their alert sheet (the slot
  // sheet only points there), so each of their keys appears exactly once.
  // batteryLowLevel: the Battery sheet's 5 % (emery) and 10 % (every other watch)
  // sliders, gated apart. vibe/btIcons: the Bluetooth sheet vs aplite's Watch Status
  // Bar rows, gated apart. themeAutoMode: the Night theme's Hours row in the shared Night
  // hours mode vs. with Separate hours (same stored values, relabelled options), gated
  // apart. rainCountdownHorizon is NOT here: the Rain sheet's Time window is its one row
  // (the Radar tab's copy went, the owner's of 2026-10-02).
  // windLineShow/gustLineShow/uvLineShow: one per metric picker, like
  // pressureScale — the row follows its metric to whichever picker shows it. The four
  // Draw from keys the same way (rainBarFrom/radarBarFrom are one row each).
  assert.deepEqual(dups.sort(),
    ['batteryLowLevel', 'btIcons', 'cloudLineFrom', 'colorUSFederal', 'gustLineShow',
      'precipLineFrom', 'pressureScale', 'theme', 'themeAutoMode', 'themeNight',
      'tomorrowioApiKey', 'tomorrowioFitBudget', 'uvLineFrom', 'uvLineShow', 'vibe',
      'windLineFrom', 'windLineShow', 'windScale'],
    'unexpected duplicates: ' + dups.join(','));
  ['windLineShow', 'gustLineShow', 'uvLineShow',
    'precipLineFrom', 'cloudLineFrom', 'windLineFrom', 'uvLineFrom'].forEach((k) =>
    assert.equal(counts[k], 4, k + ' appears in four slots (one per metric picker)'));
  ['rainBarFrom', 'radarBarFrom'].forEach((k) => assert.equal(counts[k], 1, k + ' appears once'));
  ALERT_STEMS.forEach((stem) => ['On', 'Warn', 'Danger', 'Max', 'WarnLook', 'WarnColor', 'DangerColor']
    .forEach((suffix) => assert.equal(counts['thresh' + stem + suffix], 1,
      'thresh' + stem + suffix + ' appears once (the alert sheet)')));
  assert.equal(counts.windScale, 12, 'windScale appears in twelve slots (4 pickers × 3 units)');
  assert.equal(counts.pressureScale, 4, 'pressureScale appears in four slots (one per metric picker)');
  assert.equal(counts.theme, 2, 'theme appears in two slots (color / B&W env)');
  assert.equal(counts.themeNight, 2, 'themeNight appears in two slots (color / B&W env)');
  assert.equal(counts.colorUSFederal, 2, 'colorUSFederal appears in exactly two slots');
  assert.equal(counts.tomorrowioApiKey, 2, 'tomorrow.io key in the Setup + Graphs tabs\' key sheets');
  assert.equal(counts.tomorrowioFitBudget, 2, 'tomorrow.io budget guard in the Setup + Graphs tabs\' key sheets');
  ['batteryLowLevel', 'btIcons', 'vibe', 'themeAutoMode'].forEach((k) =>
    assert.equal(counts[k], 2, k + ' appears in exactly two slots'));
  assert.equal(counts.rainCountdownHorizon, 1, 'the rain window appears once (the Rain sheet)');
  assert.deepEqual(Object.keys(counts).sort(), EXPECTED_KEYS.slice().sort());
});

test('every status slot is immediately followed by its own conditional date control', () => {
  const slotKeys = [
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight',
    'statusTopLeft', 'statusTopMid', 'statusTopRight',
    // Bars 4 to 6 (Pebble Time 2).
    'statusBar4Left', 'statusBar4Mid', 'statusBar4Right',
    'statusBar5Left', 'statusBar5Mid', 'statusBar5Right',
    'statusBar6Left', 'statusBar6Mid', 'statusBar6Right'
  ];
  slotKeys.forEach((slotKey) => {
    const slot = byKey(slotKey);
    const date = byKey(slotKey + 'Countdown');
    assert.ok(date, slotKey + ' date exists');
    assert.equal(date.type, 'date');
    assert.equal(date.label, 'Countdown date');
    assert.deepEqual(date.defaultFrom, { resolver: 'todayDate' });
    assert.equal(date.joinPrevious, true);
    const section = schema.tabs.find((tab) => tab.id === 'watch').sections
      .find((sec) => sec.items.indexOf(slot) !== -1);
    assert.equal(section.items[section.items.indexOf(slot) + 1], date,
      slotKey + ' date follows its select');
    assert.match(JSON.stringify(date.showWhen),
      new RegExp('"' + slotKey + '".*"countdown"'));
  });
  assert.equal(items.filter((item) => item.type === 'date').length, 21);
});

test('defaults match Clay/clay-settings (not the prototype drift)', () => {
  assert.equal(byKey('provider').defaultValue, 'wunderground');
  assert.equal(byKey('radarProvider').defaultValue, 'rainbow');
  assert.equal(byKey('timeFont').defaultValue, 'roboto');
  assert.equal(byKey('sleepNightEnabled').defaultValue, true);
  assert.equal(byKey('fetchIntervalMin').defaultValue, '15');
});

test('B/W bar-scale hints: the radar legend is a gated staticText, the forecast one rides the Bars hint', () => {
  const hints = items.filter((i) => i.type === 'staticText' && i.showWhen && i.showWhen.all);
  // Effective color: real B&W hardware OR the Black & White theme (bw/bw-light) on a color watch.
  const isBwGated = (h, cond) =>
    JSON.stringify(h.showWhen.all) === JSON.stringify([{ not: { all: [{ env: 'color' }, { key: 'theme', nin: ['bw', 'bw-light'] }] } }, cond]);
  assert.ok(hints.some((h) => isBwGated(h, { key: 'radarMode', eq: 'graph' })), 'radar B/W hint missing');
  // The forecast's scale note and B/W legend folded into the Bars row's own info text:
  // no staticText of its own any more, the resolver picks the note per effective colour.
  assert.equal(hints.some((h) => isBwGated(h, { key: 'barSource', eq: 'rain' })), false,
    'no standalone forecast B/W hint: it rides the Bars row\'s hint');
  const bars = byKey('barSource');
  assert.equal(bars.hintFrom.resolver, 'colorNoteHint');
  assert.match(bars.hintFrom.args.colorNote, /don't scale linearly/);
  assert.match(bars.hintFrom.args.bwNote, /don't scale linearly/);
  assert.notEqual(bars.hintFrom.args.colorNote, bars.hintFrom.args.bwNote, 'a colour note and a B/W legend');
  // No messageKey, so they never serialize into the settings blob.
  hints.forEach((h) => assert.equal(h.messageKey, undefined));
});

test('B/W bar-scale hints actually show for bw-light (not just bw) via the show-when evaluator', () => {
  const radarHint = items.find((i) => i.type === 'staticText' && i.showWhen && i.showWhen.all
    && JSON.stringify(i.showWhen.all).indexOf('"radarMode","eq":"graph"') >= 0
    && JSON.stringify(i.showWhen.all).indexOf('"not"') >= 0);
  assert.ok(radarHint, 'radar B/W hint item found');
  assert.equal(showWhen.isVisible(radarHint, { env: { color: true }, theme: 'bw-light', radarMode: 'graph' }), true,
    'B/W legend shows for bw-light on a color env');
  assert.equal(showWhen.isVisible(radarHint, { env: { color: true }, theme: 'dark', radarMode: 'graph' }), false,
    'B/W legend hidden for dark on a color env');
  // The Bars row's hint answers the same split: the B/W legend for bw-light, the colour
  // note for dark, and nothing of its own while the bars are off.
  const bars = byKey('barSource');
  const resolve = global.PConf.hintResolvers.get(bars.hintFrom.resolver);
  const args = (value) => Object.assign({ value, staticHint: bars.hintByValue[value] }, bars.hintFrom.args);
  const bwLightHint = resolve({ theme: 'bw-light' }, { color: true }, args('rain'));
  const darkHint = resolve({ theme: 'dark' }, { color: true }, args('rain'));
  assert.ok(bwLightHint.indexOf(bars.hintFrom.args.bwNote) >= 0,
    'B/W legend in the Bars hint for bw-light on a color env');
  assert.equal(bwLightHint.indexOf(bars.hintFrom.args.colorNote), -1,
    'no colour note in the Bars hint for bw-light on a color env');
  assert.ok(darkHint.indexOf(bars.hintFrom.args.colorNote) >= 0,
    'colour note in the Bars hint for dark on a color env');
  assert.equal(darkHint.indexOf(bars.hintFrom.args.bwNote), -1,
    'B/W legend hidden from the Bars hint for dark on a color env');
  assert.equal(resolve({ theme: 'dark' }, { color: true }, args('off')), null, 'no scale note with the bars off');
});

test('COLOR-capability + showWhen wiring', () => {
  ['rainBarColor','radarColor','colorTime'].forEach((k) => assert.ok(byKey(k).capabilities.indexOf('COLOR') >= 0));
  // Fill is available for every metric EXCEPT feels-like and dew point, which ride the
  // temperature axis and so have no meaningful zero to fill down to — and not for a
  // stripe-styled main line, which has no curve to fill below (unless the watch ignores
  // the styles, or the metric cannot be a stripe and so draws a stored one as a line).
  assert.deepEqual(byKey('secondaryLineFill').showWhen, { all: [
    { key: 'secondaryLine', nin: ['feels', 'dew'] },
    { any: [{ not: { env: 'lineStyles' } },
      { key: 'secondaryLineStyle', nin: ['stripeTop', 'stripeBottom'] },
      { key: 'secondaryLine', nin: ['precip_prob', 'cloud', 'wind', 'gust', 'uv'] }] }
  ] });
  assert.deepEqual(byKey('owmApiKey').showWhen, { key: 'provider', eq: 'openweathermap' });
  assert.deepEqual(byKey('devStatsClear').showWhen, { key: 'devStatsEnabled', eq: true });
});

test('the fill toggle hides for feels-like and stays visible for every other metric', () => {
  const fill = byKey('secondaryLineFill');
  ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure'].forEach((m) => {
    assert.equal(showWhen.isVisible(fill, { secondaryLine: m, env: {} }), true, m + ' keeps the fill row');
  });
  assert.equal(showWhen.isVisible(fill, { secondaryLine: 'feels', env: {} }), false,
    'feels-like hides the fill row');
  assert.equal(showWhen.isVisible(fill, { secondaryLine: 'dew', env: {} }), false,
    'dew point hides the fill row');
  ['stripeTop', 'stripeBottom'].forEach((st) => {
    assert.equal(showWhen.isVisible(fill, { secondaryLine: 'cloud', secondaryLineStyle: st,
      env: { lineStyles: true } }), false, st + ' hides the fill row');
    assert.equal(showWhen.isVisible(fill, { secondaryLine: 'cloud', secondaryLineStyle: st,
      env: { lineStyles: false } }), true, st + ' is ignored where the watch ignores styles');
    // Pressure cannot be a stripe: a stored one draws as a line, which fills — and the
    // row must say so in the same render the metric changed in, before the style row's
    // display-snap has rewritten the stored value.
    assert.equal(showWhen.isVisible(fill, { secondaryLine: 'pressure', secondaryLineStyle: st,
      env: { lineStyles: true } }), true, st + ' on pressure keeps the fill row');
  });
  // The metric picker carries the hook that clears the stored value on the way in, after the
  // limit's (graph-styles-page.js limitPicked, which keeps the fill for its Undo).
  assert.deepEqual(byKey('secondaryLine').onChange, ['graphLimitPicked', 'forecastMetricFill']);
});

// Radar-only Tomorrow.io: its key sheet's gate (Tomorrow.io drives a running radar but is not
// the weather provider).
const TOMORROWIO_RADAR_ONLY_WHEN = { all: [{ key: 'radarProvider', eq: 'tomorrowio' }, { key: 'radarEnabled', ne: false },
  { key: 'provider', ne: 'tomorrowio' }] };

test('tomorrow.io key renders under whichever picker uses it: the weather provider\'s key sheet or the radar\'s (radar-only)', () => {
  const keys = items.filter((i) => i.messageKey === 'tomorrowioApiKey');
  assert.equal(keys.length, 2, 'one instance per context (mutually exclusive)');
  const whens = keys.map((k) => JSON.stringify(k.showWhen));
  assert.ok(whens.includes(JSON.stringify({ key: 'provider', eq: 'tomorrowio' })),
    'weather-provider instance (the Setup tab\'s Tomorrow.io key sheet)');
  assert.ok(whens.includes(JSON.stringify(TOMORROWIO_RADAR_ONLY_WHEN)),
    'radar-only instance (the radar\'s Tomorrow.io key sheet)');
  const sheetOf = (tabId, sheetId) => schema.tabs.find((t) => t.id === tabId).sections.find((s) => s.sheetId === sheetId);
  assert.ok(sheetOf('setup', 'providerKeyTomorrowio').items.some((i) => i.messageKey === 'tomorrowioApiKey'
    && i.showWhen.key === 'provider'), 'the weather instance sits in Setup\'s key sheet');
  assert.ok(sheetOf('setup', 'radarKeyTomorrowio').items.some((i) => i.messageKey === 'tomorrowioApiKey'
    && JSON.stringify(i.showWhen) === JSON.stringify(TOMORROWIO_RADAR_ONLY_WHEN)),
    'the radar-only instance sits in the radar\'s key sheet, on Setup too');
  keys.forEach((k) => assert.equal(k.suffixAction, 'testTomorrowioKey'));
  keys.forEach((k) => assert.equal(k.label, 'API key', 'each sheet\'s title names the provider'));
});

test('no key rows on the Data sources card: every key lives in a key sheet that opens on its field', () => {
  // The weather providers' key rows, "Rainbow (own key)"'s and radar-only Tomorrow.io's all
  // live in their key sheets, all on the Setup tab, which the key rows under the pickers open.
  const setup = schema.tabs.find((t) => t.id === 'setup');
  const card = setup.sections.find((s) => s.id === 'dataSources');
  ['owmApiKey', 'yandexApiKey', 'tomorrowioApiKey', 'tomorrowioFitBudget', 'rainbowApiKey', 'rainbowFitBudget']
    .forEach((key) => {
      assert.equal(card.items.some((i) => i.messageKey === key), false, key + ' is not on the card');
    });
  assert.equal(schema.tabs.find((t) => t.id === 'graphs').sections.some((s) => /^radarKey/.test(s.sheetId || '')), false,
    'no key sheet left on the Graphs tab');
  // In a key sheet the key field is the first row, so it joins nothing; the tomorrow.io
  // and Rainbow budget guards below it keep the loose join to the field (the read-out
  // between them).
  const sheets = setup.sections.filter((s) => /^(providerKey|radarKey)/.test(s.sheetId || ''));
  assert.deepEqual(sheets.map((s) => s.sheetId), ['providerKeyOwm', 'providerKeyTomorrowio', 'providerKeyYandex',
    'radarKeyRainbow', 'radarKeyTomorrowio'], 'five key sheets: three weather providers, Rainbow (own key), radar-only Tomorrow.io');
  sheets.forEach((sheet) => {
    assert.equal(sheet.items[0].joinPrevious, undefined, sheet.sheetId + ' opens on its key field');
    sheet.items.slice(1).forEach((item) => assert.equal(item.joinPrevious, 'loose', item.messageKey));
  });
});

test('your bars: the Health and Radar bars\' dialogs and slots show on every watch that draws them, whatever the modes', () => {
  // Since 3.0.0 the Status bars tab lists every bar, also one no screen shows (the Your status bars
  // card says "No screen"), so any bar can go onto any screen: the gate is the watch's alone.
  const watch = schema.tabs.find((t) => t.id === 'watch');
  [['statusHealth', 'health'], ['statusRadar', 'radar']].forEach(([prefix, cap]) => {
    const dialog = watch.sections.find((s) => s.sheetId === 'bar-' + cap);
    [dialog].concat(['Left', 'Mid', 'Right'].map((part) => byKey(prefix + part))).forEach((item) => {
      const k = item.messageKey || item.sheetId;
      ['off', 'slot', 'status', 'all'].forEach((healthMode) => ['off', 'countdown', 'status', 'graph'].forEach((radarMode) =>
        assert.equal(showWhen.isVisible(item, { healthMode, radarMode, env: { health: true, radar: true } }), true,
          k + ' ' + healthMode + ' ' + radarMode)));
      assert.equal(showWhen.isVisible(item, { healthMode: 'all', radarMode: 'graph', env: { [cap]: false } }), false,
        k + ': none on a watch without it');
    });
    // The bar's name is a page-only hidden key its dialog's title renames: no row to gate.
    assert.deepEqual(byKey(prefix + 'Name'), { type: 'hidden', messageKey: prefix + 'Name', defaultValue: '',
      onChange: 'barRenamed' }, prefix + 'Name: a hidden key, cleaned by screens-page.js barRenamed');
  });
});

test('hrScale is a range slider gated to HR hardware and the graph mode', () => {
  const it = byKey('hrScale');
  assert.ok(it, 'hrScale item exists');
  assert.equal(it.type, 'range');
  // The default, the clay-payload fallback and the watch's HEALTH_HR_LO/HEALTH_HR_HI
  // are one number in three places: a watch that never received the key must draw the
  // same scale as one that did. Assert against the C header rather than a literal, so
  // moving one of the three without the others fails here.
  assert.equal(it.defaultValue, '40-150');
  const graphC = require('fs').readFileSync(
    require('path').join(__dirname, '../src/c/layers/health_graph_layer.c'), 'utf8');
  const lo = /#define\s+HEALTH_HR_LO\s+(\d+)/.exec(graphC);
  const hi = /#define\s+HEALTH_HR_HI\s+(\d+)/.exec(graphC);
  assert.ok(lo && hi, 'HEALTH_HR_LO/HI found in health_graph_layer.c');
  assert.equal(it.defaultValue, lo[1] + '-' + hi[1],
    'the schema default and the watch constants must stay in lockstep');
  assert.equal(it.min, 30);
  assert.equal(it.max, 220);
  assert.equal(it.step, 5);
  assert.equal(it.minSpan, 50);
  assert.equal(it.unit, 'BPM');
  // The HR *line* only exists in the graph, and only sensor watches ever have data.
  assert.deepEqual(it.showWhen, {
    all: [{ env: 'hr' }, { key: 'healthMode', eq: 'all' }],
  });
});

test('hrScale is hidden on aplite and on sensorless watches', () => {
  const it = byKey('hrScale');
  const S = { healthMode: 'all' };
  const vis = (plat) => showWhen.isVisible(it, Object.assign({}, S, {
    env: platform.computeEnv({ platform: plat }),
  }));
  assert.equal(vis('diorite'), true, 'Pebble 2 has an HR sensor');
  assert.equal(vis('emery'), true, 'Pebble Time 2 has an HR sensor');
  assert.equal(vis('aplite'), false, 'aplite has no health at all');
  assert.equal(vis('basalt'), false, 'no HR sensor -> no scale to set');
  // Right platform, wrong mode.
  assert.equal(showWhen.isVisible(it, {
    healthMode: 'status', env: platform.computeEnv({ platform: 'diorite' }),
  }), false, 'no graph in status mode');
});

test('radarNoRainText: visible default, 24-char UI cap, graph-only', () => {
  const item = byKey('radarNoRainText');
  assert.ok(item, 'radarNoRainText item exists');
  assert.equal(item.type, 'text');
  // The watch's built-in string ships as a VISIBLE defaultValue (not a
  // placeholder) so users see and override the actual message; clearing the
  // field falls back to the built-in string watch-side.
  assert.equal(item.defaultValue, "You're good :)");
  // Soft UI cap; the real limit is 24 UTF-8 BYTES, enforced phone-side at pack
  // time.
  assert.equal(item.attributes.maxlength, 24);
  // Only the radar GRAPH (rain_radar_layer.c) ever draws the message — the
  // status bar and the countdown have no plot to write it on — so the field
  // follows the graph, not the radar as a whole.
  assert.deepEqual(item.showWhen, {key: 'radarMode', eq: 'graph'},
    'shown only in Status + Graph mode');
  const radarItems = schema.tabs.find((t) => t.id === 'graphs').sections.find((sec) => sec.id === 'radar').items;
  const idx = radarItems.indexOf(item);
  assert.ok(idx !== -1, 'lives in the Graphs tab\'s radar card');
  assert.equal(radarItems[idx - 1].messageKey, 'radarSky',
    'follows the radar appearance settings (colour, legend, sky rows), not mid-provider-config');
  assert.equal(radarItems[idx - 2].type, 'staticText', 'the B&W legend');
  assert.equal(radarItems[idx - 3].messageKey, 'radarColor');
  // The bars' direction went behind More options, which render after the card's main rows.
  assert.equal(radarItems[idx + 1].messageKey, 'radarBarFrom');
  assert.equal(radarItems[idx + 1].more, true);
  // End-to-end through the real renderer: the maxlength attribute and the
  // visible default both land on the <input>.
  const eng = require('../src/pkjs/config-ui/lib/engine.js');
  const S = eng.hydrate(schema, {});
  S.radarMode = 'graph';   // a screen shows the radar graph (a new install has none)
  const ENV = platform.computeEnv({ platform: 'basalt' });
  const body = eng.renderBody(schema, 'graphs', {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
    openEdit: null, selectQuery: '', collapsed: {}, activePane: { graphs: 'radar' },
    evalCtx: Object.assign({}, S, { env: ENV }),
  });
  assert.match(body, /data-k="radarNoRainText" value="You(?:'|&#39;|&#x27;|&apos;)re good :\)" placeholder="" maxlength="24"/,
    'the rendered input carries the visible default and the 24 cap');

  // ...and it disappears in the modes with no graph to draw it in.
  ['status', 'countdown', 'off'].forEach((mode) => {
    const S2 = eng.hydrate(schema, {});
    S2.radarMode = mode;
    const html = eng.renderBody(schema, 'graphs', {
      S: S2, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
      openEdit: null, selectQuery: '', collapsed: {}, activePane: { graphs: 'radar' },
      evalCtx: Object.assign({}, S2, { env: ENV }),
    });
    assert.ok(html.indexOf('data-k="radarNoRainText"') === -1,
      'no-rain field hidden in radarMode=' + mode);
  });
});

const metricOptions = (S, env, args) =>
  global.PConf.optionsResolvers.get('forecastMetric')(S, env, args);

test('secondaryLine is a 8-metric dropdown with no Off (resolver-derived)', () => {
  const sec = byKey('secondaryLine');
  assert.equal(sec.type, 'select');
  assert.equal(sec.optionsFrom.resolver, 'forecastMetric');
  const vals = metricOptions({}, { platform: 'basalt' }).map((o) => o[1]);
  assert.deepEqual(vals, ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew']);
  assert.equal(sec.defaultValue, 'precip_prob');
});

test('thirdLine derives options from secondaryLine, excluding it, with Off the default', () => {
  const third = byKey('thirdLine');
  assert.equal(third.type, 'select');
  // Off since 2.6 (2.6's Clean graph); an existing install without the key keeps its UV dots.
  assert.equal(third.defaultValue, 'off');
  assert.equal(require('../src/pkjs/clay-settings.js').upgradeBackfill().thirdLine, 'uv');
  assert.equal(third.optionsFrom.resolver, 'forecastMetric');
  assert.deepEqual(third.optionsFrom.args, { key: 'thirdLine', off: true, exclude: ['secondaryLine'] });
  // Every secondary metric yields Off + the OTHER seven (never itself).
  ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew'].forEach((sec) => {
    const vals = metricOptions({ secondaryLine: sec }, { platform: 'basalt' }, { off: true, exclude: ['secondaryLine'] })
      .map((o) => o[1]);
    assert.equal(vals[0], 'off', sec + ' third options must start with off');
    assert.ok(!vals.includes(sec), sec + ' must be excluded from its own third-line options');
    assert.equal(vals.length, 8, sec + ' → off + 7 others');
  });
});

test('feels-like is left out of both metric pickers on aplite', () => {
  const sec = metricOptions({}, { platform: 'aplite' }).map((o) => o[1]);
  assert.deepEqual(sec, ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure']);
  const third = metricOptions({ secondaryLine: 'precip_prob' }, { platform: 'aplite' }, { off: true, exclude: ['secondaryLine'] })
    .map((o) => o[1]);
  assert.deepEqual(third, ['off', 'cloud', 'wind', 'gust', 'uv', 'pressure']);
});

test('windScale has twelve contextual slots: one per picker and wind unit, and one shows', () => {
  const slots = items.filter((i) => i.messageKey === 'windScale');
  assert.equal(slots.length, 12, 'twelve windScale slots');
  const pickers = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
  const units = ['kph', 'mph', 'knots'];
  const midShows = { kph: '50 kph', mph: '31 mph', knots: '27 kn' };
  const env = platform.computeEnv({ platform: 'basalt' });
  // Wind on one picker in one unit: exactly that picker's copy for that unit shows, the
  // copies in picker order, each picker's three in unit order.
  pickers.forEach((picker, p) => units.forEach((windUnits, u) => {
    const S = { secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'off', fifthLine: 'off', windUnits };
    S[picker] = 'wind';
    const shown = slots.filter((s) => showWhen.isVisible(s, Object.assign({ env }, S)));
    assert.deepEqual(shown, [slots[p * 3 + u]], picker + ' ' + windUnits);
    assert.ok(shown[0].hintByValue.mid.indexOf(midShows[windUnits]) >= 0,
      windUnits + ' mid hint should show ' + midShows[windUnits] + '; got: ' + shown[0].hintByValue.mid);
  }));
});

// The Theme & night card (Watchface tab): the theme and everything that changes after dark,
// in one home. Each night feature still keeps its hours in its own stored pair; one shared
// Night hours row (page-only: uiOnly, never stored) stands for all three, and Separate
// hours (More options, also page-only) brings each feature's own From–To back. So every
// stored key in the card still means exactly what it meant before the card existed.
const nightSection = () => schema.tabs.find((t) => t.id === 'watchface').sections
  .find((s) => s.id === 'themeNight');
const basaltEnv = platform.computeEnv({ platform: 'basalt' });
const emeryEnv = platform.computeEnv({ platform: 'emery' });
const visIn = (env) => (item, S) => showWhen.isVisible(item, Object.assign({ env: env }, S));
// Separate hours on: the one state that brings each feature's own hour pair on screen.
const NIGHT_SEPARATE = { key: 'nightHoursSeparate', eq: true };

test('the Alerts tab: between Status bars and Graphs, hidden on aplite, holding the alerts\' cards and their sheets', () => {
  assert.deepEqual(schema.tabs.map((t) => t.id),
    ['weather', 'watchface', 'watch', 'alerts', 'graphs', 'setup']);
  const tab = schema.tabs.find((t) => t.id === 'alerts');
  assert.equal(tab.label, 'Alerts');
  assert.deepEqual(tab.showWhen, { env: 'onDemand' }, 'env-hidden where the watch has no Alerts');
  const ctx = (p) => ({ env: platform.computeEnv({ platform: p }) });
  assert.equal(showWhen.isVisible(tab, ctx('aplite')), false, 'gone on aplite');
  ['basalt', 'diorite', 'chalk', 'emery', 'flint'].forEach((p) =>
    assert.equal(showWhen.isVisible(tab, ctx(p)), true, 'shown on ' + p));
  assert.equal(showWhen.isVisible(tab, { env: platform.computeEnv(null) }), true, 'an unknown watch reads as capable');
  const cards = tab.sections.filter((s) => !s.sheetOnly);
  assert.deepEqual(cards.map((s) => s.id), ['onDemand', 'onDemandItems'],
    'the About alerts card and the alert items\' card, and no other card');
  assert.equal(cards[0].title, 'About alerts');
  cards.forEach((c) => assert.ok(!c.items.some((i) => i.messageKey), c.id + ' stores nothing itself'));
  // Everything else on the tab is a dialog the items' rows open.
  assert.deepEqual(tab.sections.filter((s) => s.sheetOnly).map((s) => s.sheetId),
    ['odLists', 'odBattery', 'odBluetooth', 'odQuiet', 'odSleep', 'alertRain']
      .concat(ALERT_STEMS.map((stem) => 'alert' + stem)));
});

test('the Theme & night card sits between the screens\' cards and Time, and opens on the theme pickers', () => {
  const wf = schema.tabs.find((t) => t.id === 'watchface');
  const night = nightSection();
  assert.equal(night.title, 'Theme & night');
  // Cards only: a sheetOnly section is a dialog body, never drawn on the tab, so it
  // does not count as "between" two cards — the dim colour's sheet sits in the array
  // right below the card whose row opens it.
  const cards = wf.sections.filter((s) => !s.sheetOnly);
  const nightIndex = cards.indexOf(night);
  assert.deepEqual(cards.slice(1, nightIndex).map((c) => c.id), ['screens', 'layout', 'screenSwitching'],
    'the Screens card (Layout on aplite) and Screen switching above it');
  assert.equal(cards[nightIndex + 1].id, 'time', 'Time follows Theme & night');
  // The theme pickers moved here from General's top card; the location rows did not.
  assert.deepEqual(night.items.slice(0, 2).map((i) => i.messageKey), ['theme', 'theme']);
  ['locationMode', 'location', 'gpsCacheMin'].forEach((k) =>
    assert.ok(!night.items.some((i) => i.messageKey === k), k + ' is not in the Theme & night card'));
});

test('the Theme & night card: the theme, the Night hours, then dim backlight, the night theme and the battery saver', () => {
  // The dim colour's row maps to '>' + its sheetId, since a `sheet` row stores nothing
  // of its own — the rgb key it opens lives in the sheetOnly section below the card (see
  // test/config-night-color-sheet.test.js). Anything else without a key (a sub-header)
  // would show up as '#<text>'.
  // Each group is its switch, then its own hours (shown only with Separate hours on);
  // only the night theme carries a mode row, because only it has a non-clock
  // alternative (the sun) to choose — one key, relabelled per mode.
  assert.deepEqual(nightSection().items.map(
    (i) => i.messageKey || (i.sheetId ? '>' + i.sheetId : '#' + i.text)), [
    'theme', 'theme', 'nightHoursFrom', 'nightHoursTo',
    'backlightDim', 'backlightDimStartHour', 'backlightDimEndHour',
    'themeAuto', 'themeNight', 'themeNight', 'themeAutoMode', 'themeAutoMode',
    'themeAutoStartHour', 'themeAutoEndHour',
    'sleepNightEnabled', 'sleepStartHour', 'sleepEndHour',
    'nightHoursSeparate', '>backlightColor'
  ]);
  // Separate hours and the dim colour sit behind the card's More options.
  assert.deepEqual(nightSection().items.filter((i) => i.more).map(
    (i) => i.messageKey || '>' + i.sheetId), ['nightHoursSeparate', '>backlightColor']);
});

// The defect this restructure exists to prevent: a mode key whose runtime reader was
// never written silently disabled the feature the user had just configured. The card
// offers exactly ONE stored mode key, and it is the one that predates this work; the
// shared Night hours and Separate hours are page-only, so nothing on the watch or phone
// has to read them.
test('themeAutoMode is the only mode key in the Theme & night card', () => {
  const modes = nightSection().items.filter((i) => i.type === 'segmented');
  assert.deepEqual(modes.map((i) => i.messageKey), ['themeAutoMode', 'themeAutoMode'],
    'one key, two rows: relabelled per hours mode');
  // Same stored values under both labels — 'manual' is relabelled, never renamed.
  assert.deepEqual(modes[0].options, [['Night hours', 'manual'], ['Sunrise/sunset', 'sun']]);
  assert.deepEqual(modes[1].options, [['Sunrise/sunset', 'sun'], ['Custom', 'manual']]);
  modes.forEach((m) => assert.equal(m.defaultValue, 'sun'));
  // Gated apart by Separate hours: exactly one shows at a time.
  [false, true].forEach((sep) => {
    const shown = modes.filter((m) => visIn(basaltEnv)(m, { themeAuto: true, nightHoursSeparate: sep }));
    assert.deepEqual(shown, [modes[sep ? 1 : 0]], 'Separate hours ' + sep + ': one Hours row');
  });
  ['sleepNightMode', 'sleepNightStartHour', 'sleepNightEndHour', 'backlightDimMode']
    .forEach((k) => assert.equal(byKey(k), undefined, k + ' is gone from the schema'));
  ['nightHoursFrom', 'nightHoursTo', 'nightHoursSeparate'].forEach((k) =>
    assert.equal(byKey(k).uiOnly, true, k + ' is page-only: never stored, never sent'));
});

// Each group opens on its own switch: a plain toggle row whose hint carries the group's
// copy — label, hint under it, switch beside it, like every other toggle row on the
// Watchface tab. No sub-header heads a group: a sub-header now splits a section into
// cards of its own, which would tear the night features apart.
const GROUP_KEYS = ['backlightDim', 'themeAuto', 'sleepNightEnabled'];
test('each night group opens on its own switch row, which carries the copy', () => {
  const night = nightSection();
  assert.ok(!night.items.some((i) => i.type === 'subheader'), 'no sub-header in the Theme & night card');
  GROUP_KEYS.forEach((k) => {
    const toggle = byKey(k);
    assert.ok(night.items.indexOf(toggle) !== -1, k + ' lives in the Theme & night card');
    assert.equal(toggle.type, 'toggle', k + ' is the group\'s switch');
    assert.ok(toggle.hint, k + ' explains its group in its own hint');
  });
});

// --- the card's divider rule (owner review of the rendered page) ---
// BETWEEN top-level rows: a line, there whether or not the group above it expanded. WITHIN
// a group: none — the rows a switch reveals belong to that switch (joinPrevious) and read
// as one block. These tests drive the real renderer to check it: every line in the card
// sits directly above a top-level row, and every top-level row but the first has one.
// Rendered, not read off the schema: which row draws a divider depends on what is
// actually VISIBLE, which no amount of schema-reading would show.
//
// A top-level row (an OPENER) is the Theme picker, the shared Night hours, one of the
// GROUP_KEYS switches, one of the More options rows (Separate hours, the dim colour), or
// the More options row itself — found by the key its control carries, so the outline
// names each one without relying on how the row is classed.
const OPENER_RE = new RegExp('data-(?:k|select)="(?:' + ['theme', 'nightHoursFrom', 'nightHoursSeparate']
  .concat(GROUP_KEYS).join('|') + ')"|data-edit-sheet="backlightColor"');
// A row's opening tag: the card's rows are divs, its More options row a button.
const ROW_TAG_RE = /<(?:div|button)(?: type="button")? class="((?:row|static|subhdr|intro|blockrow)(?:\s[^"]*)?)"/g;
const nightOutline = (state, env, more) => {
  const eng = require('../src/pkjs/config-ui/lib/engine.js');
  const S = Object.assign(eng.hydrate(schema, {}), state || {});
  const ENV = env || emeryEnv;
  const body = eng.renderBody(schema, 'watchface', {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
    openEdit: null, selectQuery: '', collapsed: {},
    // more: the card's More options forced open; otherwise the engine decides, as the
    // page does (open when one of them holds a customised value, e.g. Separate hours).
    moreOpen: more ? new Proxy({}, { get: () => true }) : undefined,
    evalCtx: Object.assign({}, S, { env: ENV }),
  });
  // The Theme & night card only: from its header to wherever the next card starts.
  const at = body.indexOf('>Theme &amp; night<');
  const card = body.slice(at, (body.indexOf('<div class="card', at) + 1) || undefined);
  // Its chrome elements in order — rows, sub-headers, intros and blocks — as "<class>",
  // or "<class>:<title>" for a top-level row (its .lbl, or the More row's own label),
  // ignoring everything nested inside them. ` wrap` is dropped: it only says the hint is
  // long enough to wrap under the label, which is copy, not a join or a line.
  const out = [];
  const re = new RegExp(ROW_TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(card))) {
    const own = card.slice(m.index + 1).split(/<(?:div|button)(?: type="button")? class="row/)[0];
    const lbl = (/\bmore-row\b/.test(m[1]) && /class="more-lbl">([^<]*)</.exec(own))
      || (OPENER_RE.test(own) && /class="lbl">([\s\S]*?)<\/div>/.exec(own));
    // The label's text alone: its '?' button and any wrapping span stripped.
    const text = lbl && lbl[1].replace(/<button[\s\S]*?<\/button>/g, '').replace(/<[^>]*>/g, '').trim();
    out.push(m[1].replace(/ wrap\b/, '') + (lbl ? ':' + text : ''));
  }
  return out;
};
// An outline entry's class list, without the ":<title>" a top-level row carries.
const clsOf = (entry) => entry.split(':')[0];
const titleOf = (entry) => entry.slice(entry.indexOf(':') + 1);
const isGroupOpener = (entry) => entry.indexOf(':') !== -1;
// A row with neither join class keeps its bottom border: it draws a line.
const drawsLine = (entry) => /^row\b/.test(entry) && !/\bnbl?\b/.test(clsOf(entry));
// The states worth rendering: each switch off or on, the night theme on the sun or on the
// clock, and the shared Night hours vs. Separate hours (each feature's own From–To).
const NIGHT_STATES = {
  'everything off': { backlightDim: false, themeAuto: false, sleepNightEnabled: false },
  'defaults': {},
  'everything on': { backlightDim: true, themeAuto: true, sleepNightEnabled: true },
  'everything on, theme on night hours': { backlightDim: true,
    themeAuto: true, themeAutoMode: 'manual', sleepNightEnabled: true },
  'separate hours, everything on': { backlightDim: true, themeAuto: true, sleepNightEnabled: true,
    nightHoursSeparate: true },
  'separate hours, everything on, theme on custom hours': { backlightDim: true,
    themeAuto: true, themeAutoMode: 'manual', sleepNightEnabled: true, nightHoursSeparate: true },
};

test('Theme & night: every line in the card introduces a top-level row, in every expansion state', () => {
  Object.keys(NIGHT_STATES).forEach((name) => {
    const st = NIGHT_STATES[name];
    const separate = st.nightHoursSeparate === true;
    // The shared Night hours and Separate hours show while a night feature reads hours.
    const inUse = st.backlightDim !== false || st.sleepNightEnabled !== false
      || (st.themeAuto === true && st.themeAutoMode === 'manual');
    [false, true].forEach((more) => {
      const label = name + (more ? ' (More options open)' : '');
      const outline = nightOutline(st, emeryEnv, more);
      // Separate hours is a customised value: its More options open on their own.
      const moreShown = more || separate;
      const moreRows = (inUse ? ['Separate hours'] : []).concat(st.backlightDim !== false ? ['Dim backlight color'] : []);
      const expected = ['Theme'].concat(separate || !inUse ? [] : ['Night hours'],
        ['Dim backlight', 'Night theme', 'Battery saver'],
        moreShown ? moreRows : [],
        moreRows.length ? [moreShown ? 'Fewer options' : 'More options'] : []);
      assert.deepEqual(outline.filter(isGroupOpener).map(titleOf), expected, label + ': the top-level rows');
      // A row that keeps its divider (no nb/nbl) either ENDS the card — whose divider
      // .card .row:last-child removes anyway — or sits directly above a top-level row,
      // where its line separates the two. So no line falls inside a group...
      outline.forEach((entry, i) => {
        if (!drawsLine(entry)) { return; }
        assert.ok(i === outline.length - 1 || isGroupOpener(outline[i + 1]),
          label + ': element ' + i + ' ("' + entry + '") draws a line inside a group');
      });
      // ...and every top-level row but the first has one above it.
      outline.filter(isGroupOpener).slice(1).forEach((opener) => {
        const i = outline.indexOf(opener);
        assert.ok(drawsLine(outline[i - 1]),
          label + ': "' + outline[i - 1] + '" draws no line above ' + titleOf(opener));
      });
    });
  });
});

test('Theme & night: a group is separated from the one above even when it is collapsed', () => {
  // The regression this rule exists for: with its switch off a group renders NOTHING
  // but its switch row, and a join from the group below must not take that row's line
  // away — or the two groups run together. Each collapsed switch row keeps its own
  // divider, and that divider is the line into the next row.
  // With no night feature on, the Night hours have nothing to drive: no shared row, no
  // Separate hours — and so no More options either.
  assert.deepEqual(nightOutline(NIGHT_STATES['everything off']), [
    'row:Theme',
    'row:Dim backlight',
    'row:Night theme',
    'row:Battery saver',
  ], 'collapsed groups back to back, each only its switch row, each drawing its line');

  // With the shared Night hours, Dim backlight and the battery saver have no rows of
  // their own to reveal: the Night hours row above stands for their hours. The night
  // theme reveals its theme and its Hours mode, joined tight under the switch; the
  // group's LAST row keeps its divider, and that is the line into the next group.
  assert.deepEqual(nightOutline(NIGHT_STATES['everything on, theme on night hours']), [
    'row:Theme', 'row hours:Night hours',
    'row:Dim backlight',
    'row nb:Night theme', 'row nb indent', 'row indent',
    'row:Battery saver',
    'row more-row:More options',
  ]);

  // With Separate hours, each switch opens straight onto its own From–To — no mode row
  // stands between Dim backlight or the battery saver and the hours they govern. Each
  // switch row is `nb` (tight): the first row it reveals joins it. The More options are
  // out (Separate hours is a customised value): Separate hours itself, then the dim
  // colour — one nav row showing a swatch of the current value, its three channel
  // sliders in a dialog.
  assert.deepEqual(nightOutline(NIGHT_STATES['separate hours, everything on, theme on custom hours']), [
    'row:Theme',
    'row nb:Dim backlight', 'row hours indent',
    'row nb:Night theme', 'row nb indent', 'row nb indent', 'row hours indent',
    'row nb:Battery saver', 'row hours indent',
    'row:Separate hours', 'row nav:Dim backlight color',
    'row more-row:Fewer options',
  ]);
});

test('Theme & night: a group the watch cannot offer takes its line with it', () => {
  // basalt has a colour screen but a white backlight, so the whole Dim backlight group
  // is gated away — switch and rows, and its colour under More options. The card simply
  // steps from the Night hours to the NIGHT theme, with no stray line or empty row left
  // where the dim group used to be.
  assert.deepEqual(nightOutline({}, basaltEnv), [
    'row:Theme', 'row hours:Night hours',
    'row:Night theme',
    'row:Battery saver',
    'row more-row:More options',
  ]);
  assert.deepEqual(nightOutline({}, basaltEnv, true).filter(isGroupOpener).map(titleOf),
    ['Theme', 'Night hours', 'Night theme', 'Battery saver', 'Separate hours', 'Fewer options'],
    'no dim colour under More options either');
  // aplite has no theme to pick or switch, so nothing is left to keep separate hours for:
  // the Night hours and the battery saver, and no More options row at all.
  assert.deepEqual(nightOutline({}, platform.computeEnv({ platform: 'aplite' })), [
    'row hours:Night hours',
    'row:Battery saver',
  ]);
});

// --- the card's SPACING rule (owner review of the rendered page) ---
// Dropping the divider is only half of "one block": the rows also have to step evenly.
// The engine has two join flavours and they space differently — a TIGHT join
// (joinPrevious: true) pulls 5px off each side of the seam via .row.nb / .row.nb + .row,
// a LOOSE one (joinPrevious: 'loose') drops only the line and leaves the standard 14px —
// so a group mixing them renders one gap at 10px and the next at 28px. That was the
// report: "Enabled hours, from and the color are not evenly spaced". Every join INSIDE a
// night group is tight — the switch row's own seam to the first row it reveals
// included — so the whole card keeps one rhythm.
//
// The numbers are read out of shell.html rather than written here: change the CSS and
// this test re-derives the gap instead of quietly pinning a stale one.
const SHELL_CSS = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '../src/pkjs/config-ui/lib/shell.html'), 'utf8');
const cssPx = (re, what) => {
  const m = re.exec(SHELL_CSS);
  assert.ok(m, 'shell.html still defines ' + what);
  return Number(m[1]);
};
// .row's own padding shorthand ("14px 16px"), then the tight-join overrides.
const ROW_PAD = cssPx(/\.row \{[^}]*padding:\s*(\d+)px\s+\d+px/, '.row padding');
const NB_BOTTOM = cssPx(/\.row\.nb,[^{]*\{\s*padding-bottom:\s*(\d+)px/, '.row.nb padding-bottom');
const NB_TOP = cssPx(/\.row\.nb \+ \.row,[^{]*\{\s*padding-top:\s*(\d+)px/, '.row.nb + .row padding-top');
const TIGHT_GAP = NB_BOTTOM + NB_TOP;
const LOOSE_GAP = ROW_PAD + ROW_PAD;

/** Vertical gap between a row and the row directly below it, in px. Both halves are set
 * by the UPPER row's class: .row.nb trims its own padding-bottom and .row.nb + .row trims
 * the next row's padding-top; .nbl (loose) touches neither.
 * @param {string} upperCls class list of the row above the seam
 * @returns {number} gap in px
 */
const rowGap = (upperCls) => (/\bnb\b/.test(upperCls) ? TIGHT_GAP : LOOSE_GAP);
// The More options zone is page-wide chrome with paddings of its own (.row.nav,
// .row.more-row): the card's own rhythm is measured on the rows above it.
const isMoreChrome = (entry) => /\b(?:nav|more-row)\b/.test(clsOf(entry));
// The whole More options zone: the card's more:true rows (read off the schema, so a plain
// toggle row like Separate hours counts too) plus that chrome. While the zone is open it
// starts at its first more:true row, not at the first nav/More row.
const NIGHT_MORE_LABELS = nightSection().items.filter((i) => i.more).map((i) => i.label);
const isMoreZone = (entry) => isMoreChrome(entry)
  || (isGroupOpener(entry) && NIGHT_MORE_LABELS.indexOf(titleOf(entry)) >= 0);

test('Theme & night: consecutive rows inside a group are evenly spaced, in every expansion state', () => {
  assert.notEqual(TIGHT_GAP, LOOSE_GAP, 'the two join flavours really do space differently');
  const seen = [];
  Object.keys(NIGHT_STATES).forEach((name) => {
    const outline = nightOutline(NIGHT_STATES[name]);
    // .row.slot would bring a third padding (8px) into the card and break the two-number
    // model above; nothing in this card uses it.
    outline.forEach((cls) => assert.ok(!/\bslot\b/.test(cls), name + ': no compact slot rows here'));
    // Split into groups at the top-level rows; inside a group, measure every row-to-row
    // seam, starting with the switch row's own seam to the first row it reveals.
    let group = null;
    outline.forEach((entry, i) => {
      if (!/^row/.test(entry)) { return; }
      if (isGroupOpener(entry)) { group = titleOf(entry); }
      const next = outline[i + 1];
      // last row of its group: the card ends, or the next top-level row follows
      if (!next || !/^row/.test(next) || isGroupOpener(next)) { return; }
      const cls = clsOf(entry);
      const gap = rowGap(cls);
      seen.push({ state: name, group: group, gap: gap, cls: cls });
    });
    // Within each group, every seam is the same size.
    const byGroup = {};
    seen.filter((s) => s.state === name).forEach((s) => {
      (byGroup[s.group] = byGroup[s.group] || []).push(s.gap);
    });
    Object.keys(byGroup).forEach((g) => {
      const gaps = byGroup[g];
      assert.deepEqual(gaps, gaps.map(() => gaps[0]),
        name + ' / ' + g + ': rows step unevenly (' + gaps.join(', ') + 'px)');
    });
  });
  // ...and the whole card settles on ONE rhythm, not a tight group beside a loose one.
  assert.ok(seen.length >= 3, 'the states above really do exercise several seams');
  seen.forEach((s) => assert.equal(s.gap, TIGHT_GAP,
    s.state + ' / ' + s.group + ': "' + s.cls + '" leaves ' + s.gap + 'px, not the card\'s '
    + TIGHT_GAP + 'px — every join inside a night group is tight'));
});

// --- the card's RHYTHM against the rest of the Watchface tab (the v1.18 regression) ---
// Even steps inside a group are not enough: the card also has to step like the cards
// around it. v1.18 opened every group with the threshold sheets' heading + intro chrome,
// whose own standoffs knocked every seam touching them off the tab's row rhythm. The
// invariant: the card is rows only, so every seam is a row seam sized by the same .row
// paddings as the rest of the tab (ROW_PAD / NB_*, read from shell.html above) — tight
// inside a group, one plain row divider between top-level rows.
test('Theme & night: the card steps in the Watchface tab\'s row rhythm, on every watch and in every state', () => {
  // Every platform, not a sample: the Theme and Theme at night rows have a colour copy
  // and a B/W one (diorite/flint), and only rendering both pins each copy's own join.
  const envs = {};
  ['aplite', 'basalt', 'chalk', 'diorite', 'emery', 'flint', 'gabbro'].forEach((p) => {
    envs[p] = platform.computeEnv({ platform: p });
  });
  let seams = 0;
  Object.keys(envs).forEach((envName) => {
    Object.keys(NIGHT_STATES).forEach((state) => {
      const name = envName + ' / ' + state;
      const full = nightOutline(NIGHT_STATES[state], envs[envName]);
      // Rows only: no heading bar and no intro block anywhere in the card.
      full.forEach((e) => assert.match(e, /^row\b/, name + ': "' + e + '" is not a row'));
      // The More options zone starts on a line of its own: the row above it is not joined.
      const firstMore = full.findIndex(isMoreZone);
      if (full.some((e) => isGroupOpener(e) && titleOf(e) === 'Separate hours')) {
        // With the zone open, Separate hours (a plain toggle row) opens it: the seam into
        // it is the one to check, not the one above the dim-colour nav row.
        assert.equal(titleOf(full[firstMore]), 'Separate hours',
          name + ': the open More options zone starts at Separate hours');
      }
      if (firstMore > 0) {
        assert.ok(drawsLine(full[firstMore - 1]), name + ': "' + full[firstMore - 1]
          + '" must draw the line above the More options');
      }
      const outline = full.filter((e) => !isMoreChrome(e));
      // It opens on a top-level row, so the card title stands off it by one ROW_PAD, like
      // every other card's first row.
      assert.ok(isGroupOpener(outline[0]), name + ': the card opens on a top-level row');
      for (let i = 1; i < outline.length; i++) {
        const above = clsOf(outline[i - 1]);
        seams++;
        if (isGroupOpener(outline[i])) {
          // Into the next top-level row: ROW_PAD, the row above's own 1px divider,
          // ROW_PAD — exactly two unjoined rows, like any other divider on the tab.
          assert.doesNotMatch(above, /\bnbl?\b/,
            name + ': "' + above + '" must draw the line into the row below');
          assert.equal(rowGap(above), LOOSE_GAP, name + ': top-level rows sit a divider apart');
        } else {
          assert.equal(rowGap(above), TIGHT_GAP, name + ': "' + above + '" -> "' + outline[i]
            + '" steps ' + rowGap(above) + 'px, not a tight join\'s ' + TIGHT_GAP + 'px');
        }
      }
    });
  });
  assert.ok(seams >= 20, 'the watches and states above really do exercise the card\'s seams');
});

// The card's one shared window is page-only: the Night hours stand for the three stored
// pairs and write all three, so no stored key gained a meaning or a reader.
test('the Theme & night card opens on the theme, then the shared Night hours, which store nothing', () => {
  const night = nightSection();
  assert.equal(night.intro, undefined, 'the card carries no intro of its own');
  assert.equal(night.items[0].messageKey, 'theme', 'the Theme picker heads the card');
  assert.ok(!night.items.some((i) => i.type === 'subheader'), 'no sub-header in the card');
  const from = byKey('nightHoursFrom'), to = byKey('nightHoursTo');
  assert.equal(from.groupLabel, 'Night hours', 'one From – To row, labelled Night hours');
  assert.equal(from.inline, to.inline, 'rendered as one From/To row');
  [from, to].forEach((it) => {
    assert.equal(it.uiOnly, true, it.messageKey + ' is never stored');
    assert.equal(it.onChange, 'nightHoursSync', it.messageKey + ' writes the three pairs');
    assert.equal(it.initFrom.resolver, 'nightHoursValue', it.messageKey + ' opens on the pairs\' hours');
    assert.deepEqual(it.showWhen.all[0], { not: NIGHT_SEPARATE }, it.messageKey + ' gives way to Separate hours');
    // ...and shows only while a night feature reads hours (night-hours.js PAIRS inUse).
    const inUse = it.showWhen.all[1].any;
    assert.equal(inUse.length, 3, 'Dim backlight, the Night theme on its own hours, the Battery saver');
  });
  const sep = byKey('nightHoursSeparate');
  assert.equal(sep.uiOnly, true);
  assert.equal(sep.label, 'Separate hours');
  assert.equal(sep.more, true, 'Separate hours sits behind More options');
  assert.equal(sep.initFrom.resolver, 'nightHoursSeparate', 'on as the page opens when the pairs differ');
});

// The saver no longer only stops weather FETCHES: with the phone-battery slot it also
// suppresses the status micro-send (level changes and charging transitions alike), so
// the copy has to describe sending rather than fetching or it under-promises what the
// toggle now turns off. The wording was dictated by the design
// (docs/superpowers/specs/2026-08-20-phone-battery-slot-design.md §3), not derived. It
// is the toggle's hint, and says "between the hours below" where the saver's own From/To
// sits right under it (Separate hours), "during Night hours" where the shared row stands
// for it.
//
// sleepStartHour/sleepEndHour are the saver's original keys and never meant anything
// else: same keys, same options, same defaults. Nothing stored on any install changes
// meaning, so the restructure needs no migration.
test('the battery saver owns its hours outright and still talks about SENDING', () => {
  const nightHours = require('../src/pkjs/settings/night-hours.js');
  const on = byKey('sleepNightEnabled');
  assert.equal(on.label, 'Battery saver', 'the word "Night" moved up to the card title');
  assert.equal(on.defaultValue, true);
  assert.equal(on.hint,
    'Stop sending updates to your watch between the hours below to save battery.');
  assert.equal(on.hintFrom.resolver, 'nightFeatureHint');
  assert.equal(nightHours.nightFeatureHint({ nightHoursSeparate: false }, basaltEnv, on.hintFrom.args),
    'Stop sending updates to your watch during Night hours to save battery.', 'the shared-mode copy');
  assert.equal(nightHours.nightFeatureHint({ nightHoursSeparate: true }, basaltEnv, on.hintFrom.args), null,
    'with Separate hours the row\'s own hint stands');

  const from = byKey('sleepStartHour'), to = byKey('sleepEndHour');
  assert.equal(from.label, 'From');
  assert.equal(to.label, 'To');
  assert.equal(from.groupLabel, 'From – To');
  assert.equal(from.defaultValue, '0', 'unchanged — no install moves its window');
  assert.equal(to.defaultValue, '7');
  assert.equal(from.options.length, 24, 'the shared HOURS ladder');
  assert.equal(from.inline, to.inline, 'rendered as one From/To row');
  // Gated on the saver and Separate hours: no mode row stands between the switch and
  // the hours.
  assert.deepEqual(from.showWhen, { all: [{ key: 'sleepNightEnabled', eq: true }, NIGHT_SEPARATE] });
  assert.deepEqual(to.showWhen, { all: [{ key: 'sleepNightEnabled', eq: true }, NIGHT_SEPARATE] });

  const vis = visIn(basaltEnv);
  assert.equal(vis(from, { sleepNightEnabled: false, nightHoursSeparate: true }), false,
    'the hours follow the switch');
  assert.equal(vis(from, { sleepNightEnabled: true, nightHoursSeparate: true }), true);
  assert.equal(vis(to, { sleepNightEnabled: true, nightHoursSeparate: true }), true);
  assert.equal(vis(from, { sleepNightEnabled: true, nightHoursSeparate: false }), false,
    'with the shared Night hours the pair is the Night hours row');
});

test('Dim backlight is emery-only, on by default, and carries a dim-red RGB colour', () => {
  const on = byKey('backlightDim');
  assert.equal(on.type, 'toggle');
  assert.equal(on.defaultValue, true);
  // The LED fact, NOT capabilities:['COLOR'] — that one means "colour screen" and is
  // true on basalt/chalk, which have a plain white backlight.
  assert.deepEqual(on.showWhen, { env: 'colorBacklight' });
  assert.equal(on.capabilities, undefined);

  // The dim window is the feature's own pair, under the switch with Separate hours (the
  // shared Night hours stand for it otherwise). 0–7 stands: it is the stretch where a
  // full-brightness backlight actually hurts, and it is also night-light.js's own
  // fallback, so a never-configured install and the page agree.
  const from = byKey('backlightDimStartHour'), to = byKey('backlightDimEndHour');
  assert.equal(from.defaultValue, '0');
  assert.equal(to.defaultValue, '7');
  assert.equal(from.label, 'From');
  assert.equal(to.label, 'To');
  assert.equal(from.inline, to.inline, 'rendered as one From/To row');
  assert.equal(from.options.length, 24, 'the shared HOURS ladder');

  // The colour keeps its key, its "r,g,b" format and its default — only its SURFACE
  // moved: the sliders live in a dialog now, gated by that section rather than by the
  // item (test/config-night-color-sheet.test.js owns the surface itself).
  const colour = byKey('backlightDimColor');
  assert.equal(colour.type, 'rgb', 'three channel sliders storing one "r,g,b" string');
  assert.equal(colour.defaultValue, '40,10,0', 'a dim red: the driver scales each channel by the watch brightness');

  const BACKLIGHT_KEYS = ['backlightDim', 'backlightDimStartHour', 'backlightDimEndHour'];
  const on_ = { backlightDim: true, nightHoursSeparate: true };
  BACKLIGHT_KEYS.forEach((k) => {
    assert.equal(visIn(emeryEnv)(byKey(k), on_), true, k + ' shows on emery');
    assert.equal(visIn(basaltEnv)(byKey(k), on_), false,
      k + ' hides on a colour screen with a white backlight');
  });
  const vis = visIn(emeryEnv);
  assert.equal(vis(from, { backlightDim: true, nightHoursSeparate: true }), true,
    'switched on, the hours are right there');
  assert.equal(vis(to, { backlightDim: true, nightHoursSeparate: true }), true);
  assert.equal(vis(from, { backlightDim: false, nightHoursSeparate: true }), false,
    'switched off, only the switch row is left');
  assert.equal(vis(to, { backlightDim: false, nightHoursSeparate: true }), false);
  assert.equal(vis(from, { backlightDim: true, nightHoursSeparate: false }), false,
    'with the shared Night hours the pair is the Night hours row');
});

test('metric options are spelled out fully on both pickers', () => {
  assert.deepEqual(metricOptions({}, { platform: 'basalt' }), [
    ['Precipitation %', 'precip_prob'], ['Cloud cover %', 'cloud'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'], ['UV Index', 'uv'], ['Air pressure (hPa)', 'pressure'], ['Feels-like temperature', 'feels'],
    ['Dew point', 'dew']
  ]);
  const thirdOf = (sec) => metricOptions({ secondaryLine: sec }, { platform: 'basalt' }, { off: true, exclude: ['secondaryLine'] });
  const labelOf = (sec, val) => thirdOf(sec).find((o) => o[1] === val)[0];
  assert.equal(thirdOf('precip_prob')[0][0], 'Off');
  assert.equal(labelOf('wind', 'precip_prob'), 'Precipitation %');
  assert.equal(labelOf('precip_prob', 'gust'), 'Wind gusts');
  assert.equal(labelOf('precip_prob', 'uv'), 'UV Index');
  assert.equal(labelOf('gust', 'wind'), 'Wind speed');
  assert.equal(labelOf('precip_prob', 'feels'), 'Feels-like temperature');
  assert.equal(labelOf('feels', 'pressure'), 'Air pressure (hPa)');
  assert.equal(labelOf('precip_prob', 'dew'), 'Dew point');
});

// --- The forecast line hints (forecast-hints.js 'forecastMetricHint' / 'lineStyleHint') ---
// The scale explanation rides the LINE-STYLE picker: a curve or its marks show a value
// by height, a stripe by colour strength. The metric pickers keep only what holds
// whatever the style — plus the height wording on a watch without style pickers.
// Resolved through the engine with the real schema items, so the wiring (resolver id,
// args) is pinned along with the copy.
const engineLib = require('../src/pkjs/config-ui/lib/engine.js');
const LINE_KEYS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
const GRAPH_METRIC_IDS = ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew'];
const STYLE_IDS = ['line', 'bold', 'dots', 'x', 'stripeTop', 'stripeBottom'];
const STYLED_ENV = platform.computeEnv({ platform: 'basalt' });
const APLITE_ENV = platform.computeEnv({ platform: 'aplite' });
/** A row's resolved hint for settings S (the row shows S[key]). */
const hintOf = (key, S, env) => engineLib.resolveHint(byKey(key), S, env, S[key]);

const HEIGHT = {
  precip_prob: 'Half height is a 50% chance of rain, full height is 100%.',
  cloud: 'Half height is half the sky covered, full height is overcast.',
  wind: 'The height follows the Wind graph scale setting.',
  gust: 'The height follows the Wind graph scale setting.',
  uv: 'Half height is UV 5.5, full height is UV 11 (extreme).',
  pressure: 'Shows sea-level pressure. The height follows the Pressure graph scale below.',
  feels: 'Uses the same scale as the temperature curve.',
  dew: 'Uses the same scale as the temperature curve.'
};
// A stripe's colour steps on its metric's own scale (stripe-levels.js): rain chance
// 1-10 / 11-30 / 31-60 / 61-100 %, cloud 10-29 / 30-59 / 60-89 / 90-100 %, and wind,
// gusts and UV from 1, 30, 60 and 90 % up their scale (UV 11: 3.3, 6.6, 9.9).
const STRIPE = {
  precip_prob: 'The color gets stronger in four steps: 1–10%, 11–30%, 31–60% and 61–100% chance of rain.',
  cloud: 'The color gets stronger in four steps: 10–29%, 30–59%, 60–89% and 90–100% of the sky covered.',
  wind: 'The color strength follows the Wind graph scale setting, with full color from 90% of its top.',
  gust: 'The color strength follows the Wind graph scale setting, with full color from 90% of its top.',
  uv: 'The color steps up at UV 3.3 and 6.6, with full color from UV 9.9.'
};

test('metric pickers keep only the notes that hold whatever the style', () => {
  const expected = {
    precip_prob: '', cloud: '', wind: '', gust: 'Shows the hourly peak.', uv: '',
    pressure: '', feels: '', dew: 'The closer it runs to the temperature, the more humid it feels.', off: ''
  };
  LINE_KEYS.forEach((key) => {
    Object.keys(expected).forEach((m) => {
      if (key === 'secondaryLine' && m === 'off') { return; }
      assert.equal(hintOf(key, { [key]: m }, STYLED_ENV), expected[m], key + '.' + m);
    });
  });
});

test('a metric picker names a gap in the picked provider only', () => {
  const pick = (m, provider) => hintOf('secondaryLine', { secondaryLine: m, provider }, STYLED_ENV);
  const YANDEX = 'Not available with Yandex.';
  const METNO = 'Not available with Met.no outside the Nordics.';
  ['cloud', 'pressure'].forEach((m) => assert.equal(pick(m, 'yandex'), YANDEX, m));
  assert.equal(pick('dew', 'yandex'),
    'The closer it runs to the temperature, the more humid it feels. ' + YANDEX, 'after the metric\'s note');
  assert.equal(pick('precip_prob', 'metno'), METNO);
  assert.equal(pick('gust', 'metno'), 'Shows the hourly peak. ' + METNO);
  assert.equal(pick('cloud', 'metno'), '', 'Met.no sends clouds');
  assert.equal(pick('precip_prob', 'dwd'), '', 'nothing for a provider without the gap');
});

test('without style pickers (aplite) the metric picker keeps the height scale after its note', () => {
  const expected = {
    precip_prob: 'Half height is a 50% chance of rain, full height is 100%.',
    cloud: 'Half height is half the sky covered, full height is overcast.',
    wind: 'The height follows the Wind graph scale setting.',
    gust: 'Shows the hourly peak. The height follows the Wind graph scale setting.',
    uv: 'Half height is UV 5.5, full height is UV 11 (extreme).',
    pressure: 'Shows sea-level pressure. The height follows the Pressure graph scale below.',
    feels: 'Uses the same scale as the temperature curve.',
    dew: 'The closer it runs to the temperature, the more humid it feels. '
      + 'Uses the same scale as the temperature curve.'
  };
  GRAPH_METRIC_IDS.forEach((m) => {
    assert.equal(hintOf('secondaryLine', { secondaryLine: m }, APLITE_ENV), expected[m], 'aplite ' + m);
    // The same truthy test as the style rows' {env: 'lineStyles'} gate: whenever those
    // rows are hidden, the metric picker explains the scale itself.
    assert.equal(hintOf('thirdLine', { thirdLine: m }, {}), expected[m], 'no lineStyles fact ' + m);
  });
  assert.equal(hintOf('thirdLine', { thirdLine: 'off' }, APLITE_ENV), '', 'Off explains itself');
  // The style rows really are hidden wherever this wording shows.
  assert.equal(showWhen.isVisible(byKey('secondaryLineStyle'), { env: APLITE_ENV }), false);
});

test('line-style pickers: the scale of their own line\'s metric, one resolver for all four', () => {
  LINE_KEYS.forEach((key) => {
    const item = byKey(key + 'Style');
    assert.deepEqual(item.hintFrom, { resolver: 'lineStyleHint', args: { metricKey: key } }, key);
    assert.equal(item.hintByValue, undefined, key + 'Style carries no static per-style copy');
  });
  // Each picker reads ITS line's metric, not a sibling's.
  const S = { secondaryLine: 'uv', thirdLine: 'precip_prob', fourthLine: 'cloud', fifthLine: 'gust',
    secondaryLineStyle: 'line', thirdLineStyle: 'line', fourthLineStyle: 'line', fifthLineStyle: 'line' };
  assert.equal(hintOf('secondaryLineStyle', S, STYLED_ENV), HEIGHT.uv);
  assert.equal(hintOf('thirdLineStyle', S, STYLED_ENV), HEIGHT.precip_prob);
  assert.equal(hintOf('fourthLineStyle', S, STYLED_ENV), HEIGHT.cloud);
  assert.equal(hintOf('fifthLineStyle', S, STYLED_ENV), HEIGHT.gust);
});

test('line-style hint: every metric x style reads height for curves and marks, colour strength for stripes', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  // The stripe copy covers exactly the metrics a stripe can show (the picker offers no
  // stripe for any other, so no other combination can reach the hint).
  assert.deepEqual(Object.keys(STRIPE).sort(), lineStyle.STRIPE_METRIC_IDS.slice().sort());
  assert.deepEqual(Object.keys(require('../src/pkjs/settings/forecast-hints.js').STRIPE_SCALE).sort(),
    lineStyle.STRIPE_METRIC_IDS.slice().sort(), 'forecast-hints.js STRIPE_SCALE keys = STRIPE_METRIC_IDS');
  const expected = (m, st) => {
    if (st === 'line' || st === 'bold') { return HEIGHT[m]; }
    if (st === 'dots') { return HEIGHT[m] + ' The dots line up with the rain bars.'; }
    if (st === 'x') { return HEIGHT[m] + ' The marks line up with the rain bars.'; }
    return STRIPE[m] + ' The stripe has one cell per hour.'
      + (st === 'stripeBottom' ? ' It sits under the zero line, where bars and lines never cover it.' : '');
  };
  LINE_KEYS.forEach((key) => {
    GRAPH_METRIC_IDS.forEach((m) => {
      STYLE_IDS.forEach((st) => {
        if (lineStyle.isStripeValue(st) && !lineStyle.metricAllowsStripe(m)) { return; }
        assert.equal(hintOf(key + 'Style', { [key]: m, [key + 'Style']: st }, STYLED_ENV), expected(m, st),
          key + 'Style ' + m + ' / ' + st);
      });
    });
    assert.equal(hintOf(key + 'Style', { [key]: 'off', [key + 'Style']: 'dots' }, STYLED_ENV), '',
      key + ': a line that is off explains nothing');
  });
  // Spelled out once, so the composed copy reads as written.
  const S = { secondaryLine: 'precip_prob', secondaryLineStyle: 'stripeBottom' };
  assert.equal(hintOf('secondaryLineStyle', S, STYLED_ENV), 'The color gets stronger in four steps: 1–10%, 11–30%, '
    + '31–60% and 61–100% chance of rain. The stripe has one cell per hour. It sits under the zero line, where bars '
    + 'and lines never cover it.');
  assert.equal(hintOf('secondaryLineStyle', { secondaryLine: 'uv', secondaryLineStyle: 'x' }, STYLED_ENV),
    'Half height is UV 5.5, full height is UV 11 (extreme). The marks line up with the rain bars.');
});

test('forecast hints: no name echo, no colour, and the wind scale is named rather than placed', () => {
  const all = [];
  GRAPH_METRIC_IDS.forEach((m) => {
    all.push(['metric ' + m, hintOf('thirdLine', { thirdLine: m }, STYLED_ENV)]);
    all.push(['aplite ' + m, hintOf('thirdLine', { thirdLine: m }, APLITE_ENV)]);
    STYLE_IDS.forEach((st) => {
      if (/^stripe/.test(st) && !STRIPE[m]) { return; }   // not offered for this metric
      all.push([m + '/' + st, hintOf('thirdLineStyle', { thirdLine: m, thirdLineStyle: st }, STYLED_ENV)]);
    });
  });
  all.forEach(([what, h]) => {
    assert.ok(!/by default|square dots|x marks|thin line|thick line|stripe at/i.test(h), what + ' echoes a label: ' + h);
    // A colour name would be wrong on Light, B/W and after a custom pick.
    assert.ok(!/grey|gray|blue|yellow|white/i.test(h), what + ' names a colour: ' + h);
  });
  // With wind and gusts both picked, the one scale row sits under the first of them.
  ['wind', 'gust'].forEach((m) => {
    STYLE_IDS.forEach((st) => {
      assert.ok(!/below/.test(hintOf('fourthLineStyle', { fourthLine: m, fourthLineStyle: st }, STYLED_ENV)
        .replace('Below the zero line', '')), m + '/' + st + ' must not point below');
    });
    assert.ok(!/below/.test(hintOf('fourthLine', { fourthLine: m }, APLITE_ENV)), 'aplite ' + m);
  });
  // Pressure names sea level, so an altitude reading makes sense.
  assert.ok(hintOf('secondaryLineStyle', { secondaryLine: 'pressure', secondaryLineStyle: 'line' }, STYLED_ENV)
    .includes('sea-level'));
});

test('each forecast line\'s dialog nests its style, fill and wind scale under the line that enables them', () => {
  // Every line's rows sit in its own dialog: the fill only in the Main metric's, three
  // wind-scale slots in each.
  LINE_SHEETS.forEach((id) => {
    const sheetKeys = lineSheetById(id).items.map((i) => i.messageKey);
    assert.equal(sheetKeys.filter((k) => k === 'windScale').length, 3, id + ': one wind scale per wind unit');
    assert.equal(sheetKeys.indexOf('secondaryLineFill') !== -1, id === 'lineMain', id + ': the fill is the main line\'s');
  });
  const keys = forecastItems(schema).map((i) => i.messageKey).filter(Boolean);
  const iSolid = keys.indexOf('secondaryLine');
  const iFill = keys.indexOf('secondaryLineFill');
  const iThird = keys.indexOf('thirdLine');
  const iFourth = keys.indexOf('fourthLine');
  const iFifth = keys.indexOf('fifthLine');
  assert.ok(iSolid >= 0 && iFill > iSolid && iThird > iFill && iFourth > iThird && iFifth > iFourth,
    'order must be Main metric -> Fill area -> Second -> Third -> Fourth metric; got ' + keys.join(','));
  // Each line's style picker sits directly under its metric picker.
  assert.equal(keys.indexOf('secondaryLineStyle'), iSolid + 1, 'main style under Main metric');
  assert.equal(keys.indexOf('thirdLineStyle'), iThird + 1, 'second style under Second metric');
  assert.equal(keys.indexOf('fourthLineStyle'), iFourth + 1, 'third style under Third metric');
  assert.equal(keys.indexOf('fifthLineStyle'), iFifth + 1, 'fourth style under Fourth metric');
  const windIdxs = keys.reduce((a, k, i) => (k === 'windScale' ? a.concat(i) : a), []);
  assert.equal(windIdxs.length, 12, 'twelve wind-scale slots (4 pickers × 3 units)');
  assert.ok(windIdxs.slice(0, 3).every((i) => i > iFill && i < iThird),
    'secondary-line wind-scale copies sit under the solid line');
  assert.ok(windIdxs.slice(3, 6).every((i) => i > iThird && i < iFourth),
    'third-line wind-scale copies sit under the second metric');
  assert.ok(windIdxs.slice(6, 9).every((i) => i > iFourth && i < iFifth),
    'fourth-line wind-scale copies sit under the third metric');
  assert.ok(windIdxs.slice(9).every((i) => i > iFifth),
    'fifth-line wind-scale copies sit under the fourth metric');
});

test('startOnWeatherTab is a page-only toggle that defaults to Watchface', () => {
  const item = byKey('startOnWeatherTab');
  assert.equal(item.type, 'toggle');
  assert.equal(item.defaultValue, false, 'Watchface stays the opening tab out of the box');
  assert.ok(item.label && item.hint, 'it is a user-facing setting, labelled and explained');
  assert.match(item.hint, /instead of Watchface\./);
  // Hide info text is the same kind of setting: it only shapes this page (the schema's
  // infoIconsKey), off by default so every explanation is in view out of the box.
  const hide = byKey('hideInfoText');
  assert.equal(schema.infoIconsKey, 'hideInfoText', 'the engine reads the info mode from this key');
  assert.equal(hide.type, 'toggle');
  assert.equal(hide.label, 'Hide info text');
  assert.equal(hide.defaultValue, false, 'info text in view out of the box');
  assert.ok(hide.hint, 'it is explained');
  assert.equal(hide.uiOnly, undefined, 'a stored page setting, unlike the uiOnly Night hours pickers');
  // Display-only, like the rest of the Weather tab: it picks a tab in the
  // settings page and is never read by the watch-side JS, so no payload
  // builder may so much as mention it.
  const fs = require('node:fs');
  const path = require('node:path');
  const pkjs = path.join(__dirname, '..', 'src', 'pkjs');
  const watchSide = fs.readdirSync(pkjs).filter((f) => f.slice(-3) === '.js');
  // Phone-side support for the settings page itself, which may read the page's own
  // keys: weather-tab-cache.js keeps the Weather tab's data only while the tab is in
  // use, and telemetry-settings.js reports the toggle to the telemetry ingest. Neither
  // may reach the watch — no AppMessage, no outbox.
  const PAGE_SUPPORT = ['weather-tab-cache.js', 'telemetry-settings.js'];
  PAGE_SUPPORT.forEach((f) => {
    const src = fs.readFileSync(path.join(pkjs, f), 'utf8');
    assert.ok(!/sendAppMessage|outbox|clay-payload/.test(src), f + ' must not talk to the watch');
  });
  watchSide.filter((f) => PAGE_SUPPORT.indexOf(f) === -1).forEach((f) => {
    const src = fs.readFileSync(path.join(pkjs, f), 'utf8');
    ['startOnWeatherTab', 'hideInfoText'].forEach((k) =>
      assert.equal(src.indexOf(k), -1, 'watch-side ' + f + ' must not read the page-only ' + k));
  });
  // Guard the guard: the scan really does cover the payload builder, and
  // that builder really does carry watch settings.
  assert.ok(watchSide.indexOf('clay-payload.js') !== -1, 'the scan includes the Clay payload builder');
  assert.ok(fs.readFileSync(path.join(pkjs, 'clay-payload.js'), 'utf8').indexOf('settings.btIcons') !== -1,
    'and a key the watch DOES receive shows up in it');
});

// aplite has no screens (no flick, no radar, no Health): its Watchface tab keeps a plain
// Layout choice, the three calendars. Every other watch edits its screens instead.
test('aplite\'s Layout card: Full calendar, Compact calendar, No calendar, the rest dormant', () => {
  const watchface = schema.tabs.find((tab) => tab.id === 'watchface');
  const section = watchface.sections.find((s) => s.id === 'layout');
  assert.equal(section.title, 'Layout');
  assert.deepEqual(section.showWhen, { env: 'platform', eq: 'aplite' }, 'aplite only');
  const t = section.items[0];
  assert.equal(t.messageKey, 'layoutPreset');
  assert.equal(t.type, 'radio');
  assert.equal(t.defaultValue, 'compactCal');
  assert.equal(t.options, undefined, 'derived, so the engine\'s dormant fallback applies');
  assert.deepEqual(t.optionsFrom, { resolver: 'apliteLayouts' });
  assert.deepEqual(global.PConf.optionsResolvers.get('apliteLayouts')({}, platform.computeEnv({ platform: 'aplite' })),
    [['Full calendar', 'fullCal'], ['Compact calendar', 'compactCal'], ['No calendar', 'noCal']]);
  assert.deepEqual(t.hintByValue, { fullCal: 'Shows a calendar with 3 rows.', compactCal: 'Shows a calendar with 2 rows.',
    noCal: 'No calendar, so the forecast graph is bigger.' });
  // A stored value aplite runs as Compact calendar (view-cycle.js presetKeyFor: Weather only
  // and a custom layout fold to it; compactDense draws it without a status row) lies dormant.
  assert.deepEqual(t.dormantValues, ['compactDense', 'weatherOnly', 'custom']);
  assert.equal(byKey('layoutPreset'), t, 'the one layoutPreset row');
  assert.equal(watchface.pinBlock, 'watchPreview', 'the watch, every screen of it, is pinned atop the tab');
  // Not in Setup's Misc card (the old More tab's Misc).
  const misc = schema.tabs.find((tab) => tab.id === 'setup').sections.find((s) => s.id === 'about');
  assert.equal(misc.title, 'Misc');
  assert.ok(!misc.items.some((i) => i.messageKey === 'layoutPreset'), 'not in the Misc section');
  // "First week to display" only matters for a 3-row calendar; it is always shown.
  assert.equal(byKey('firstWeek').showWhen, undefined);
});

// A dormant value must lie DORMANT, not be migrated away: the radio displays the Compact
// calendar fallback and leaves the stored choice untouched. A truly invalid value still
// hard-snaps.
test('a dormant compactDense renders the compactCal fallback on aplite but stays in state', () => {
  const eng = require('../src/pkjs/config-ui/lib/engine.js');
  const ENV = platform.computeEnv({ platform: 'aplite' });
  const cx = (S) => ({ S, ENV, USERDATA: {}, evalCtx: Object.assign({}, S, { env: ENV }) });

  const S = eng.hydrate(schema, {});
  S.layoutPreset = 'compactDense';
  S.healthMode = 'off';   // as aplite's page holds them (onbuild.js)
  S.radarMode = 'off';
  const html = eng.renderBody(schema, 'watchface', cx(S));
  assert.equal(S.layoutPreset, 'compactDense', 'stored dense choice survives the render');
  assert.match(html, /class="on" data-k="layoutPreset" data-v="compactCal"/,
    'the radio shows compactCal selected as the display fallback');

  // The generic lockstep rule is untouched: an unknown value still snaps into state.
  S.layoutPreset = 'bogus';
  eng.renderBody(schema, 'watchface', cx(S));
  assert.equal(S.layoutPreset, 'compactCal', 'invalid values still hard-snap');
});

test('Screen switching: Double flick and Back to Default after, once there is a screen to flick to', () => {
  const sec = schema.tabs.find((t) => t.id === 'watchface').sections.find((s) => s.id === 'screenSwitching');
  assert.equal(sec.title, 'Screen switching');
  assert.deepEqual(sec.items.map((i) => i.messageKey), ['doubleFlick', 'viewResetMin']);
  const [flick, reset] = sec.items;
  assert.equal(flick.type, 'toggle');
  assert.equal(flick.label, 'Double flick to switch');
  assert.equal(flick.defaultValue, false, 'one flick switches until the user opts in');
  // Not "quick": a second flick under the 500 ms debounce reads as the same flick, and
  // a BMI160 watch delivers none sooner than ~1.28 s (layout.h VIEW_FLICK_PAIR_MS).
  assert.equal(flick.hint, 'Switch only on a second flick within a few seconds of the first.');
  assert.equal(reset.type, 'segmented');
  assert.equal(reset.label, 'Back to Default after');
  assert.equal(reset.defaultValue, '2');
  assert.deepEqual(reset.options, [['Never', '0'], ['1m', '1'], ['2m', '2'], ['5m', '5'], ['10m', '10']]);
  [flick, reset].forEach((i) => assert.equal(i.showWhen, undefined, i.messageKey + ': the card\'s gate alone'));
  // Shown on a watch with flick screens while there are two screens or more (manyScreens).
  const custom = (viewCount) => ({ layoutPreset: 'custom', customLayoutSeeded: true, viewCount,
    viewTop1: 'none', viewBody1: 'forecast', viewUpper1: 'weather', viewLower1: 'off' });
  const vis = (p, S) => showWhen.isVisible(sec, Object.assign({ env: platform.computeEnv({ platform: p }) }, S));
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) => {
    assert.equal(vis(p, custom('1')), false, p + ': the Default screen alone');
    assert.equal(vis(p, custom('2')), true, p + ': a screen to flick to');
  });
  assert.equal(vis('aplite', custom('2')), false, 'aplite has no flick');
});

test('swapClockStatus: aplite\'s Layout card, applied exactly where the radio shows Compact calendar', () => {
  const it = byKey('swapClockStatus');
  assert.ok(it, 'swapClockStatus item exists');
  assert.equal(it.type, 'toggle');
  // A fresh install gets the swapped Compact layout: the status row reads better beside
  // the forecast than above the clock.
  assert.equal(it.defaultValue, true);
  assert.match(it.hint, /status row below the clock/);
  const layout = schema.tabs.find((t) => t.id === 'watchface').sections.find((s) => s.id === 'layout');
  assert.ok(layout.items.indexOf(it) > 0, 'under the Layout radio (a screen\'s order says it elsewhere)');
  // The toggle follows the preset the radio DISPLAYS (a dormant value shows as Compact
  // calendar), and the wire follows the toggle, so the two never disagree.
  const vc = require('../src/pkjs/view-cycle.js');
  const radio = byKey('layoutPreset');
  const env = platform.computeEnv({ platform: 'aplite' });
  ['compactCal', 'compactDense', 'custom', 'fullCal', 'noCal', 'weatherOnly'].forEach((layoutPreset) => {
    const S = { layoutPreset, healthMode: 'off', radarMode: 'off' };
    const offered = global.PConf.optionsResolvers.get(radio.optionsFrom.resolver)(S, env);
    const shown = offered.some((o) => o[1] === layoutPreset) ? layoutPreset : 'compactCal';
    assert.equal(showWhen.isVisible(it, Object.assign({ env }, S)), shown === 'compactCal',
      layoutPreset + ': toggle visible iff the radio shows Compact calendar');
    const on = vc.resolveViewCycle(Object.assign({ swapClockStatus: true }, S), env);
    const off = vc.resolveViewCycle(Object.assign({ swapClockStatus: false }, S), env);
    assert.equal(JSON.stringify(on) !== JSON.stringify(off), shown === 'compactCal',
      layoutPreset + ': applied iff shown');
  });
});


test('largeGraphFont is offered on emery only, and hidden when watchInfo is unavailable', () => {
  const it = byKey('largeGraphFont');
  assert.equal(it.type, 'toggle');
  // ON out of the box: the taller tier is the more readable one on emery's 200 px
  // screen, so it is the shipped default rather than something to go and find.
  assert.equal(it.defaultValue, true);
  assert.equal(it.label, 'Larger graph fonts');
  assert.deepEqual(it.showWhen, { env: 'platform', eq: 'emery' });
  const emery = { env: platform.computeEnv({ platform: 'emery' }) };
  const basalt = { env: platform.computeEnv({ platform: 'basalt' }) };
  const aplite = { env: platform.computeEnv({ platform: 'aplite' }) };
  // computeEnv(null).platform is '' - an emery-only cosmetic toggle fails closed.
  const unknown = { env: platform.computeEnv(null) };
  assert.equal(showWhen.isVisible(it, emery), true, 'shown on emery');
  assert.equal(showWhen.isVisible(it, basalt), false, 'hidden on basalt (no room; its left axis is already calendar-sized)');
  assert.equal(showWhen.isVisible(it, aplite), false, 'hidden on aplite');
  assert.equal(showWhen.isVisible(it, unknown), false, 'hidden without watchInfo');
});

test('the Forecast pane is the Your graphs card; a graph\'s cards are its dialog\'s, Other after Rain bars', () => {
  const graphs = graphsTab();
  // The pane: the list alone, on every watch, with no pinned preview of its own (each row draws
  // its graph; the dialog pins the one it shows).
  const ids = graphs.sections.filter((sec) => sec.pane === 'forecast' && !sec.sheetOnly).map((sec) => sec.id);
  assert.deepEqual(ids, ['graphStyle']);
  const list = graphs.sections.find((sec) => sec.id === 'graphStyle');
  assert.equal(list.showWhen, undefined, 'every watch lists its graphs');
  assert.equal(list.block, 'graphList');
  assert.equal(graphs.panes.find((p) => p.id === 'forecast').pinBlock, undefined);
  // The dialog: the graph's preview pinned, its cards in order.
  const dlg = graphDialog(schema);
  assert.equal(dlg.pinBlock, 'forecastPreview');
  assert.deepEqual(dialogCards(schema).map((c) => c.head.text), ['Lines', 'Rain bars', 'Other', 'Left axis', '', 'Show on']);
  assert.deepEqual(dialogCard(schema, 'Rain bars').items.map((it) => it.messageKey), ['barSource', 'rainBarColor', 'rainBarFrom'],
    'only about the bars: the shading left');
  const other = dialogCard(schema, 'Other');
  assert.equal(other.head.showWhen, undefined, 'the shading is on every watch, so the card is too');
  assert.deepEqual(other.items.map((it) => it.messageKey), ['dayNightShading', 'forecastHours']);
});

test('forecastHours: the Forecast length row closes the Other card, emery only', () => {
  const forecastSpan = require('../src/pkjs/forecast-span.js');
  const it = byKey('forecastHours');
  assert.equal(it.label, 'Forecast length');
  assert.equal(it.type, 'segmented');
  assert.equal(it.defaultValue, '48', 'a new install looks as far ahead as the feed reaches');
  // The options are the forecastSpanOptions resolver's (forecast-hints.js): the stored values
  // are CHOICES whatever the settings, and the long span keeps its '48' token while its label
  // names the whole hours the watch will show for the provider and the layout
  // (forecast-span-hours.js, test/forecast-span-hours.test.js).
  assert.equal(it.options, undefined, 'no static list: the label follows the settings');
  assert.deepEqual(it.optionsFrom, { resolver: 'forecastSpanOptions' });
  const resolve = global.PConf.optionsResolvers.get('forecastSpanOptions');
  assert.equal(typeof resolve, 'function', 'forecast-hints.js registers forecastSpanOptions');
  const emery = platform.computeEnv({ platform: 'emery' });
  const labels = (over) => resolve(Object.assign({}, settings.getDefaults(), over), emery, {});
  assert.deepEqual(labels({}).map((o) => o[1]), forecastSpan.CHOICES, 'the stored values are CHOICES');
  assert.deepEqual(labels({}), [['12 h', '12'], ['24 h', '24'], ['48 h', '48']],
    'a fresh install: Weather Underground\'s 48 hours');
  // A new install's graph draws the high and low on the graph: no left axis.
  assert.deepEqual(labels({ provider: 'openmeteo' }).map((o) => o[0]), ['12 h', '24 h', '66 h']);
  assert.deepEqual(labels({ provider: 'openmeteo', forecastAxisNumbers: 'off' }).map((o) => o[0]),
    ['12 h', '24 h', '66 h']);
  assert.deepEqual(labels({ provider: 'openmeteo', forecastAxisNumbers: 'axis' }).map((o) => o[0]),
    ['12 h', '24 h', '58 h']);
  assert.deepEqual(labels({ provider: 'openweathermap', forecastAxisNumbers: 'axis' }).map((o) => o[0]),
    ['12 h', '24 h', '47 h']);
  // A Health screen (Status + Graph) puts the health graph in the cycle, and its step marks
  // never widen the forecast's strip: GOTHIC_18's two-digit hi/lo label leaves 60 either way.
  assert.deepEqual(labels({ provider: 'openmeteo', forecastAxisNumbers: 'axis', largeGraphFont: false,
    healthMode: 'all' }).map((o) => o[0]), ['12 h', '24 h', '60 h']);
  assert.deepEqual(labels({ provider: 'openmeteo', forecastAxisNumbers: 'axis', largeGraphFont: false,
    healthMode: 'status' }).map((o) => o[0]), ['12 h', '24 h', '60 h']);
  assert.equal(it.hintByValue['48'], 'As many hours as your weather provider\'s hourly forecast '
    + 'covers and the graph can fit, in narrow columns. The number of hours depends on the provider and '
    + 'the graph\'s layout.');
  assert.equal(it.hintByValue['12'], 'The next 12 hours, in wider columns.');
  assert.equal(it.hintByValue['24'], 'The next 24 hours.');
  assert.deepEqual(it.showWhen, { env: 'forecastSpan' });
  assert.ok(!it.more, 'the span frames the whole graph: never behind More');
  const visible = (p) => showWhen.isVisible(it, { env: platform.computeEnv(p ? { platform: p } : null) });
  assert.equal(visible('emery'), true, 'shown on emery');
  ['basalt', 'chalk', 'diorite', 'flint', 'aplite'].forEach((p) => assert.equal(visible(p), false, p));
  assert.equal(visible(null), false, 'hidden without watchInfo (fail closed)');
});

// The forecast's left axis options (emery only; src/pkjs/forecast-axis.js).
test('Left axis: Left axis values in the card, the scale and the font size under More, after Other, emery only', () => {
  const forecastAxis = require('../src/pkjs/forecast-axis.js');
  const titles = dialogCards(schema).map((c) => c.head.text);
  const at = titles.indexOf('Left axis');
  assert.ok(at > 0, 'the card is in the graph dialog');
  assert.equal(titles[at - 1], 'Other', 'directly after Other');
  assert.equal(titles[at + 1], '', 'directly before the Graph colors card');
  const card = dialogCard(schema, 'Left axis');
  // Emery only: each row carries the gate, and a card with no row to show drops out (engine
  // buildCards), so its subheader needs none.
  assert.equal(card.head.showWhen, undefined);
  card.items.forEach((it) => assert.match(JSON.stringify(it.showWhen), /"eq":"emery"/, it.messageKey + ': emery only'));
  // The betas' Axis line and Number outline rows are gone: both follow where the numbers go.
  // Larger graph fonts joined it from the Views card (the owner's Screens plan): it sizes
  // the axis labels.
  assert.deepEqual(card.items.map((it) => it.messageKey), ['forecastAxisNumbers', 'forecastAxisScale',
    'largeGraphFont']);
  const font = byKey('largeGraphFont');
  assert.equal(font.more, true, 'Larger graph fonts is behind More options');
  assert.equal(font.label, 'Larger graph fonts');
  assert.equal(font.defaultValue, true);
  assert.equal(byKey('forecastAxisLine'), undefined, 'no Axis line row');
  assert.equal(byKey('forecastAxisOutline'), undefined, 'no Number outline row');
  const nums = byKey('forecastAxisNumbers'), scale = byKey('forecastAxisScale');
  assert.ok(!nums.more, 'the values are not collapsed');
  assert.equal(scale.more, true, 'the scale is behind More options');
  assert.equal(nums.label, 'Left axis values');
  assert.equal(scale.label, 'High/low includes feels-like & dew point');
  assert.equal(nums.type, 'segmented');
  // On graph since 2.6: a new install's graph.
  assert.equal(nums.defaultValue, 'graph');
  assert.deepEqual(nums.options.map((o) => o[1]), forecastAxis.NUMBERS, 'the stored values are NUMBERS');
  assert.deepEqual(nums.options.map((o) => o[0]), ['On axis', 'On graph', 'Off']);
  assert.deepEqual(Object.keys(nums.hintByValue).sort(), ['graph', 'off'], 'On axis needs no hint');
  assert.match(nums.hintByValue.graph, /Removes the left axis/);
  assert.match(nums.hintByValue.off, /Removes the left axis/);
  assert.equal(scale.type, 'toggle');
  assert.equal(scale.defaultValue, false);
  // An absent key reads as the graph from before the key existed, On axis, which is what an
  // existing install without it is backfilled (a new install stores On graph); a beta's
  // stored 'beside' reads the same.
  assert.equal(forecastAxis.numbers({}), 'axis');
  assert.equal(require('../src/pkjs/clay-settings.js').upgradeBackfill().forecastAxisNumbers, 'axis');
  assert.equal(forecastAxis.numbers({ forecastAxisNumbers: 'beside' }), 'axis');
  assert.equal(forecastAxis.scale({}), scale.defaultValue);

  const vis = (it, p, S) => showWhen.isVisible(it, Object.assign({}, S || {}, {
    env: platform.computeEnv(p ? { platform: p } : null) }));
  // The numbers row: emery only, hidden without watchInfo (fail closed).
  assert.equal(vis(nums, 'emery'), true, 'numbers on emery');
  ['basalt', 'chalk', 'diorite', 'flint', 'aplite', null].forEach((p) =>
    assert.equal(vis(nums, p), false, 'numbers on ' + p));
  // The scale: numbers drawn and a feels-like or dew point line drawn, on any line.
  ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'].forEach((key) => {
    ['feels', 'dew'].forEach((metric) => {
      const S = { forecastAxisNumbers: 'graph' };
      S[key] = metric;
      assert.equal(vis(scale, 'emery', S), true, key + ' ' + metric);
      assert.equal(vis(scale, 'emery', Object.assign({}, S, { forecastAxisNumbers: 'axis' })), true,
        key + ' ' + metric + ' on axis');
      assert.equal(vis(scale, 'emery', Object.assign({}, S, { forecastAxisNumbers: 'off' })), false,
        key + ' ' + metric + ' numbers off');
      assert.equal(vis(scale, 'basalt', S), false, key + ' ' + metric + ' basalt');
    });
  });
  assert.equal(vis(scale, 'emery', { secondaryLine: 'wind', thirdLine: 'uv' }), false, 'no temperature-axis line');
});

const radarItem = () => byKey('radarSource');
const RADAR_ON_WHEN = { all: [{ env: 'radar' }, { key: 'radarEnabled', ne: false }] };

test('the Rain radar picker (Setup › Data sources): Off, then DWD/Met.no/Rainbow (limited)/Rainbow (own key)/Tomorrow.io', () => {
  const item = radarItem();
  assert.equal(item.type, 'select', 'dropdown — the options carry a desc line each');
  assert.equal(item.label, 'Rain radar');
  assert.equal(item.optionsFrom, undefined, 'a static list: each Rainbow option names its own source');
  assert.deepEqual(item.options.map((o) => [o[0], o[1]]), [
    ['Off', 'off'],
    ['DWD', 'dwd'],
    ['Met.no', 'metno'],
    ['Rainbow (limited)', 'rainbow'],
    ['Rainbow (own key)', 'rainbowkey'],
    ['Tomorrow.io', 'tomorrowio']
  ], 'Off first, then Rainbow twice, one option per radar source (radar-factory.js)');
  assert.deepEqual(item.options[0][2], { desc: 'No rain radar and no rain alert' });
  assert.equal(item.defaultValue, 'rainbow', 'a fresh install runs the radar that needs no key');
  assert.deepEqual(item.showWhen, { env: 'radar' }, 'no Rain radar row on aplite');
  assert.equal(item.recommendFrom, 'recommendedRadarProvider');
  // Page-only over two stored keys, so Off keeps the source (screens-page.js): the picker
  // opens on Off or the source, and a pick writes radarEnabled and, for a source, radarProvider.
  assert.equal(item.uiOnly, true, 'never stored, never sent');
  assert.deepEqual(item.initFrom, { resolver: 'radarSourceValue' });
  assert.equal(item.onChange, 'radarSourcePicked');
  const SP = require('../src/pkjs/settings/screens-page.js');
  assert.equal(SP.radarSourceValue({ radarEnabled: false, radarProvider: 'dwd' }), 'off');
  assert.equal(SP.radarSourceValue({ radarEnabled: true, radarProvider: 'dwd' }), 'dwd');
  assert.equal(SP.radarSourceValue({}), 'rainbow', 'an absent source reads as the default');
  // The two stored keys ride hidden rows on the Graphs tab's Rain radar pane, so Save writes them.
  const pane = graphsTab().sections.find((sec) => sec.id === 'radar');
  [['radarEnabled', true], ['radarProvider', 'rainbow']].forEach(([key, dflt]) => {
    const row = pane.items.find((i) => i.messageKey === key);
    assert.ok(row, key + ' is in the Rain radar pane');
    assert.equal(row.type, 'hidden', key);
    assert.equal(row.defaultValue, dflt, key);
  });
});

// "Rainbow (own key)" is a keyed source of the radar picker, wired like a keyed weather
// provider (settings/key-status.js): one table for every key-status resolver.
const RAINBOW_OWN_KEY_WHEN = { all: [{ key: 'radarProvider', eq: 'rainbowkey' }, { key: 'radarEnabled', ne: false }] };
const radarPickerSection = () => schema.tabs.find((t) => t.id === 'setup').sections.find((sec) => sec.id === 'dataSources');
// Each key table's picker row: the Weather picker for provider, the Rain radar picker for
// radarProvider (it writes radarProvider, so its key rows name that key as their picker).
const PICKER_ROW = { provider: 'provider', radarProvider: 'radarSource' };
const PICKER_ATTENTION = { provider: { resolver: 'keyAttention' }, radarProvider: { resolver: 'radarKeyAttention' } };

// The key tables live in settings/key-sources.js, one per picker, by the picker's
// messageKey. The rows' key-status resolvers read them in the page by the row's picker —
// the picker row's own messageKey, the key row's args.picker — so no row hands them a table
// (the schema does not carry the tables); the key sheets are built from them; and Setup's
// Tomorrow.io sheet is gated on the radar source's sharedSheet condition, so the sheet the
// Rain radar's key row opens while Tomorrow.io is both is the one that shows.
test('the provider and radar rows read their key tables from key-sources.js', () => {
  const KEY_SOURCES = require('../src/pkjs/settings/key-sources.js');
  assert.deepEqual(Object.keys(KEY_SOURCES), ['provider', 'radarProvider']);
  Object.keys(KEY_SOURCES).forEach((picker) => {
    const row = byKey(PICKER_ROW[picker]);
    assert.deepEqual(row.attentionFrom, PICKER_ATTENTION[picker],
      picker + ': no args, the table is found by the picker\'s messageKey');
    const section = schema.tabs.reduce((found, t) => found
      || t.sections.find((sec) => sec.items.indexOf(row) !== -1), null);
    assert.equal(section, radarPickerSection(), picker + ': on the Data sources card');
    const keyRow = section.items.find((i) => i.type === 'sheet' && i.labelFrom && i.labelFrom.resolver === 'keyRowLabel'
      && i.labelFrom.args.picker === picker);
    assert.ok(keyRow, picker + ': a key row under the picker');
    [keyRow.editSheetFrom, keyRow.labelFrom, keyRow.hintFrom].forEach((r) =>
      assert.deepEqual(r.args, { picker: picker }, picker + ': the key row names its picker, nothing more'));
    const sources = KEY_SOURCES[picker].sources;
    Object.keys(sources).forEach((id) => {
      const sheet = schema.tabs.reduce((found, t) => found
        || t.sections.find((s) => s.sheetOnly && s.sheetId === sources[id].sheetId), null);
      assert.ok(sheet, picker + '/' + id + ': its key sheet is built');
      assert.equal(sheet.title, sources[id].name, picker + '/' + id);
      assert.equal(sheet.items[0].messageKey, sources[id].keyField, picker + '/' + id);
    });
  });
  assert.ok(JSON.stringify(schema).indexOf('"keyed"') === -1, 'no row carries a key table into the page');
  const shared = KEY_SOURCES.radarProvider.sources.tomorrowio.sharedSheet;
  const setup = schema.tabs.find((t) => t.id === 'setup');
  const sheet = setup.sections.find((s) => s.sheetOnly && s.sheetId === shared.sheetId);
  assert.ok(sheet, 'the shared sheet is the Setup tab\'s');
  assert.deepEqual(sheet.showWhen, { key: shared.key, eq: shared.eq });
  sheet.items.forEach((i) => assert.deepEqual(i.showWhen, { key: shared.key, eq: shared.eq }, i.messageKey));
});

test('the radar picker and its key row read ONE key table for the row, its label, summary, note and Save dialog', () => {
  const KEY_SOURCES = require('../src/pkjs/settings/key-sources.js');
  const item = radarItem();
  // The picker has no Edit button, badge or derived summary: the key row under it opens
  // the key sheet, and the picker's info text is its per-source copy alone.
  assert.equal(item.editSheetFrom, undefined, 'no Edit button on the picker');
  assert.equal(item.editBadgeFrom, undefined, 'no badge on the picker');
  assert.equal(item.hintFrom, undefined, 'the picker\'s info text is its per-source copy');
  assert.ok(item.hintByValue.rainbow, 'RADAR_SOURCE_HINTS');
  // Its key check is keyAttention's on radarProvider, asked only while the radar runs.
  assert.deepEqual(item.attentionFrom, { resolver: 'radarKeyAttention' });
  const attention = global.PConf.attentionResolvers.get('radarKeyAttention');
  assert.equal(attention({ radarEnabled: false, radarProvider: 'rainbowkey', rainbowApiKey: '' }, {}), null,
    'the radar off: no call is made, so nothing to ask');
  assert.notEqual(attention({ radarEnabled: true, radarProvider: 'rainbowkey', rainbowApiKey: '' }, {}), null,
    'the radar on with no key: asked');
  const table = KEY_SOURCES.radarProvider;
  assert.equal(table.outcome, 'the watch gets no rain radar');
  assert.deepEqual(Object.keys(table.sources), ['rainbowkey', 'tomorrowio'], 'the own key and Tomorrow.io');
  assert.deepEqual(table.sources.rainbowkey, { name: 'Rainbow', sheetId: 'radarKeyRainbow', keyField: 'rainbowApiKey',
    test: true, usage: 'rainbow' });
  // Tomorrow.io's key is the weather provider's: the same entry (one key, one verdict: the
  // phone keeps both pickers' answers to it under the one id), only its own sheet differs, and
  // while Tomorrow.io is the weather provider too the weather provider's sheet holds the key.
  const weatherTio = KEY_SOURCES.provider.sources.tomorrowio;
  assert.deepEqual(table.sources.tomorrowio, Object.assign({}, weatherTio, { sheetId: 'radarKeyTomorrowio',
    sharedSheet: { key: 'provider', eq: 'tomorrowio', sheetId: 'providerKeyTomorrowio' } }));
  assert.equal(weatherTio.sheetId, 'providerKeyTomorrowio');

  const section = radarPickerSection();
  const at = section.items.indexOf(item);
  const note = section.items[at + 1];
  assert.equal(note.type, 'staticText', 'the missing-key (or out-of-coverage) note hugs the row');
  assert.equal(note.style, 'info');
  assert.equal(note.joinPrevious, true);
  assert.deepEqual(note.textFrom, { resolver: 'radarProviderNote', args: { picker: 'radarProvider' } },
    'a staticText has no messageKey, so its args name the picker');
  assert.deepEqual(note.showWhen, RADAR_ON_WHEN, 'while the radar runs');
  // The key row: a nav row reading the very same table for its sheet, label and summary.
  const keyRow = section.items[at + 2];
  assert.equal(keyRow.type, 'sheet');
  assert.equal(keyRow.editSheetFrom.resolver, 'keySheet');
  assert.equal(keyRow.labelFrom.resolver, 'keyRowLabel');
  assert.equal(keyRow.hintFrom.resolver, 'keyRowSummary');
  [keyRow.editSheetFrom.args, keyRow.labelFrom.args, keyRow.hintFrom.args].forEach((a) =>
    assert.deepEqual(a, { picker: 'radarProvider' }, 'the picker, whose key-sources.js table the resolvers read'));
  assert.deepEqual(keyRow.showWhen, RADAR_ON_WHEN, 'while the radar runs');
  assert.equal(section.items[at + 3].messageKey, 'aqiSource', 'Air quality follows the key row');
  // The radar's preview is the Graphs tab's Rain radar pane's pinned header, and the scale
  // note rides the Radar color row's info text there.
  assert.equal(items.filter((i) => i.blockBefore === 'radarPreview').length, 0, 'no row hosts the preview');
  assert.equal(graphsTab().panes.find((p) => p.id === 'radar').pinBlock, 'radarPreview');
  const colorHint = byKey('radarColor').hintFrom;
  assert.equal(colorHint.resolver, 'radarColorHint');
  assert.match(colorHint.args.note, /don't scale linearly/, 'the SCALE_NOTE');
});

test('"Rainbow (own key)"\'s key sheet: the key field and the budget guard, only while it drives a running radar', () => {
  const setup = schema.tabs.find((t) => t.id === 'setup');
  const sheet = setup.sections.find((s) => s.sheetId === 'radarKeyRainbow');
  assert.ok(sheet, 'a sheet on the Setup tab, beside the picker whose key row opens it');
  assert.equal(sheet.sheetOnly, true, 'rendered only as a sheet');
  assert.equal(sheet.title, 'Rainbow', 'titled with the source\'s name');
  assert.deepEqual(sheet.showWhen, RAINBOW_OWN_KEY_WHEN);
  assert.deepEqual(sheet.items.map((i) => i.messageKey), ['rainbowApiKey', 'rainbowFitBudget']);
  sheet.items.forEach((i) => assert.deepEqual(i.showWhen, RAINBOW_OWN_KEY_WHEN, i.messageKey + ' shares the gate'));
  assert.equal(showWhen.isVisible(sheet, { radarProvider: 'rainbowkey', radarEnabled: true }), true);
  assert.equal(showWhen.isVisible(sheet, { radarProvider: 'rainbowkey' }), true, 'an absent switch reads as on');
  assert.equal(showWhen.isVisible(sheet, { radarProvider: 'rainbowkey', radarEnabled: false }), false,
    'radar off: no Rainbow call is made');
  ['dwd', 'metno', 'rainbow', 'tomorrowio'].forEach((p) => {
    assert.equal(showWhen.isVisible(sheet, { radarProvider: p, radarEnabled: true }), false, 'closed for ' + p);
  });
});

test('radar-only Tomorrow.io\'s key sheet: the weather provider\'s Tomorrow.io rows, only while it drives a running radar alone', () => {
  const setup = schema.tabs.find((t) => t.id === 'setup');
  const sheet = setup.sections.find((s) => s.sheetId === 'radarKeyTomorrowio');
  const weather = setup.sections.find((s) => s.sheetId === 'providerKeyTomorrowio');
  assert.ok(sheet, 'a sheet on the Setup tab');
  assert.equal(setup.sections.indexOf(sheet), setup.sections.findIndex((s) => s.sheetId === 'radarKeyRainbow') + 1,
    'after "Rainbow (own key)"\'s, as in the picker');
  assert.equal(sheet.sheetOnly, true, 'rendered only as a sheet');
  assert.equal(sheet.title, 'Tomorrow.io', 'titled with the source\'s name, as the weather provider\'s');
  assert.equal(sheet.title, weather.title);
  assert.deepEqual(sheet.showWhen, TOMORROWIO_RADAR_ONLY_WHEN);
  sheet.items.forEach((i) => assert.deepEqual(i.showWhen, TOMORROWIO_RADAR_ONLY_WHEN, i.messageKey + ' shares the gate'));
  const strip = (it) => Object.assign({}, it, { showWhen: undefined });
  assert.deepEqual(sheet.items.map(strip), weather.items.map(strip), 'the same rows as the weather provider\'s sheet');
  const at = (S) => showWhen.isVisible(sheet, S);
  const both = (S) => [at(S), showWhen.isVisible(weather, S)];
  assert.deepEqual(both({ provider: 'dwd', radarProvider: 'tomorrowio', radarEnabled: true }), [true, false], 'radar-only');
  assert.deepEqual(both({ provider: 'tomorrowio', radarProvider: 'tomorrowio', radarEnabled: true }), [false, true],
    'both: the weather provider\'s sheet holds the one key');
  assert.deepEqual(both({ provider: 'tomorrowio', radarProvider: 'rainbow', radarEnabled: true }), [false, true]);
  assert.deepEqual(both({ provider: 'dwd', radarProvider: 'tomorrowio', radarEnabled: false }), [false, false],
    'radar off: no Tomorrow.io call is made');
  ['dwd', 'metno', 'rainbow', 'rainbowkey'].forEach((p) =>
    assert.equal(at({ provider: 'dwd', radarProvider: p, radarEnabled: true }), false, 'closed for ' + p));
});

test('the Rain radar pane: why it draws nothing, then the look rows a screen showing the radar graph needs', () => {
  const radarCard = graphsTab().sections.find((sec) => sec.id === 'radar');
  // While the radar is off: a note with the way to Setup › Data sources.
  assert.deepEqual(radarCard.items[0], { type: 'staticText', style: 'info',
    text: 'The rain radar is off. Turn it on in <button type="button" class="txt-link" data-goto-tab="setup">'
      + 'Setup › Data sources</button>.', showWhen: { key: 'radarEnabled', eq: false } });
  // While it runs but no screen shows the radar graph (the worked-out mode is not Graph): a
  // note with the way to the screens.
  assert.equal(radarCard.items[1].type, 'staticText');
  assert.equal(radarCard.items[1].text, 'No screen shows the rain radar. Add it to a screen on the <button type="button"'
    + ' class="txt-link" data-goto-tab="watchface">Watchface tab</button>.');
  assert.deepEqual(radarCard.items[1].showWhen, { all: [{ key: 'radarEnabled', ne: false }, { key: 'radarMode', ne: 'graph' }] });
  // The preview is no row's block: it is the radar pane's pinned header, which draws
  // whatever the mode shows (a "Radar off" frame included).
  assert.equal(items.filter((item) => item.blockBefore === 'radarPreview').length, 0, 'no row hosts the preview');
  assert.equal(graphsTab().panes.find((p) => p.id === 'radar').pinBlock, 'radarPreview');
  // The colour row and the B/W legend standing in for it: graph mode only.
  const legend = radarCard.items.find((i) => i.type === 'staticText' && i.hinted);
  [byKey('radarColor'), legend].forEach((item) => {
    assert.ok(item.showWhen.all.some((condition) =>
      condition.key === 'radarMode' && condition.eq === 'graph'));
  });
  ['radarSky', 'radarNoRainText'].forEach((k) =>
    assert.deepEqual(byKey(k).showWhen, { key: 'radarMode', eq: 'graph' }, k));
});

// Helper: the per-value "why" hint for a provider value (weather or radar picker) — the
// picker's hintByValue, rendered wrapping around the trigger by the hinted-row layout.
function whyNote(key, value) {
  const it = byKey(key);
  return it && it.hintByValue && it.hintByValue[value];
}

test('each weather + radar provider has a per-value "why" hint on its picker', () => {
  ['dwd', 'metno', 'openmeteo', 'openweathermap', 'tomorrowio', 'wunderground', 'yandex'].forEach((v) => {
    assert.ok(typeof whyNote('provider', v) === 'string' && whyNote('provider', v).length > 0, v + ' weather why note');
  });
  ['dwd', 'metno', 'rainbow', 'rainbowkey', 'tomorrowio'].forEach((v) => {
    assert.ok(typeof whyNote('radarSource', v) === 'string' && whyNote('radarSource', v).length > 0, v + ' radar why note');
  });
  assert.equal(whyNote('radarSource', 'off'), undefined, 'Off says it in its own line');
  // Content spot-checks: the note carries the real "why".
  assert.match(whyNote('provider', 'wunderground'), /crowd-sourced|250,000/i);
  assert.match(whyNote('provider', 'dwd'), /Germany/);
  assert.match(whyNote('radarSource', 'tomorrowio'), /budget/i, 'radar Tomorrow.io keeps the key/budget caveat');
  // "Rainbow (limited)"'s note, verbatim: how often the shared radar refreshes.
  assert.equal(whyNote('radarSource', 'rainbow'), 'Refreshes at most every 30 minutes. Powered by '
    + '<a target=\'_blank\' href=\'https://rainbow.ai\'>Rainbow.ai</a>.');
  // "Rainbow (own key)"'s note, verbatim: what the own key gets, and what it costs.
  assert.equal(whyNote('radarSource', 'rainbowkey'),
    'A worldwide nowcast from satellite and radar data. It uses your own Rainbow key, so it refreshes at every update. '
    + 'A key is free: Rainbow\'s free plan covers 5,000 calls a month. Powered by '
    + '<a target=\'_blank\' href=\'https://rainbow.ai\'>Rainbow.ai</a>.');
  // Rainbow's terms ask for a "Powered by Rainbow.ai" link, under both Rainbow options.
  ['rainbow', 'rainbowkey'].forEach((v) => assert.match(whyNote('radarSource', v),
    /Powered by <a target='_blank' href='https:\/\/rainbow\.ai'>Rainbow\.ai<\/a>\.$/, v));
  // The old showWhen-gated staticText notes are gone — the hint is the only copy.
  assert.ok(!items.some((i) => i.type === 'staticText' && i.showWhen
    && (i.showWhen.key === 'provider' || i.showWhen.key === 'radarProvider' || i.showWhen.key === 'radarSource')),
    'no leftover per-provider staticText notes');
});

test('theme switching: toggle + Night theme + mode + custom hours, gated correctly', () => {
  const auto = byKey('themeAuto');
  assert.equal(auto.type, 'toggle');
  assert.equal(auto.label, 'Night theme');
  assert.equal(auto.defaultValue, false, 'off by default');
  assert.deepEqual(auto.onChange, ['themeAutoPreset', 'nightFeatureOn'],
    'first enable seeds a night theme, and the switch joins the shared Night hours');
  ['backlightDim', 'sleepNightEnabled'].forEach((k) => assert.equal(byKey(k).onChange, 'nightFeatureOn', k));
  items.filter((i) => i.messageKey === 'themeAutoMode').forEach((it) => assert.equal(it.onChange, 'nightFeatureOn', 'both Hours rows'));
  assert.deepEqual(auto.showWhen, { env: 'themePolarity' }, 'hidden on aplite like the theme picker');
  assert.equal(byKey('themeAutoStartHour').label, 'From',
    'hour labels match the other night rows');
  assert.equal(byKey('themeAutoEndHour').label, 'To');

  const nightItems = items.filter((i) => i.messageKey === 'themeNight');
  assert.equal(nightItems.length, 2, 'a color and a B&W-polarity Night select');
  nightItems.forEach((i) => {
    assert.equal(i.defaultValue, 'dark');
    assert.equal(i.label, 'Theme at night');
    assert.equal(i.indent, true, 'it sits under the Night theme switch');
    assert.equal(i.onChange, undefined,
      'no themeConvert: stored colour defaults track the DAY polarity; the night flip converts a send-time scratch copy');
  });

  const modes = items.filter((i) => i.messageKey === 'themeAutoMode');
  assert.equal(modes.length, 2, 'one Hours row per hours mode (shared Night hours / Separate hours)');
  modes.forEach((mode) => {
    assert.equal(mode.type, 'segmented');
    assert.equal(mode.label, 'Hours');
    assert.equal(mode.defaultValue, 'sun', 'enabling defaults to sunrise/sunset');
    // No hintByValue here, deliberately: the switch's info text already says what it
    // does, and a per-value line under the segmented control wrapped badly on a phone.
    // The option labels carry the meaning instead.
    assert.equal(mode.hintByValue, undefined, 'the mode explains itself via its options');
  });
  // Two options per row, and this is the only mode key in the card: the sun is a genuine
  // alternative to a clock window, so it has to be chosen somewhere. 'manual' is the
  // STORED value for clock hours — relabelled ("Night hours" with the shared row, "Custom"
  // with Separate hours), never renamed, so an install that already picked fixed hours
  // keeps them.
  modes.forEach((mode) => assert.deepEqual(mode.options.map((o) => o[1]).sort(), ['manual', 'sun']));
  assert.deepEqual(modes[0].options.map((o) => o[0]), ['Night hours', 'Sunrise/sunset']);
  assert.deepEqual(modes[1].options.map((o) => o[0]), ['Sunrise/sunset', 'Custom']);

  assert.equal(byKey('themeAutoStartHour').defaultValue, '20');
  assert.equal(byKey('themeAutoEndHour').defaultValue, '7');
  assert.equal(byKey('themeAutoStartHour').options.length, 24, 'the shared HOURS ladder');

  // Visibility contract on a color watch: the Theme select stays put whatever the
  // switch is doing (it IS the day theme), and only the custom hour rows follow the
  // mode. Aplite sees none of the switching rows.
  const colorEnv = platform.computeEnv({ platform: 'basalt' });
  const apliteEnv = platform.computeEnv({ platform: 'aplite' });
  const vis = (item, S) => showWhen.isVisible(item, Object.assign({ env: colorEnv }, S));
  const themeItems = items.filter((i) => i.messageKey === 'theme');
  const plainColor = themeItems.find((i) => i.hintByValue);
  assert.equal(vis(plainColor, { themeAuto: false }), true);
  assert.equal(vis(plainColor, { themeAuto: true }), true, 'the Theme row does not disappear');
  assert.equal(vis(byKey('themeAutoStartHour'), { themeAuto: true, themeAutoMode: 'sun', nightHoursSeparate: true }),
    false, 'following the sun hides the custom pair');
  assert.equal(vis(byKey('themeAutoStartHour'), { themeAuto: true, themeAutoMode: 'manual', nightHoursSeparate: true }),
    true);
  assert.equal(vis(byKey('themeAutoStartHour'), { themeAuto: true, themeAutoMode: 'manual', nightHoursSeparate: false }),
    false, 'with the shared Night hours the Night hours row stands for the pair');
  [auto].concat(nightItems, modes).forEach((i) => {
    assert.equal(showWhen.isVisible(i, { env: apliteEnv, themeAuto: true }), false,
      JSON.stringify(i.showWhen) + ' must be hidden on aplite');
  });
});

test('aplite hides the theme picker entirely (light polarity compiled out); diorite keeps its 2-option slot', () => {
  // The watch compiles the light polarity out on aplite (no WW_THEME_POLARITY —
  // the theme sweep pushed the image past the 24 KB launch ceiling), so offering
  // a theme choice there would be a silent no-op. diorite/flint (also B&W) keep it.
  const themeItems = items.filter((i) => i.messageKey === 'theme');
  const apliteEnv = platform.computeEnv({ platform: 'aplite' });
  const dioriteEnv = platform.computeEnv({ platform: 'diorite' });
  themeItems.forEach((i) => {
    assert.equal(showWhen.isVisible(i, { env: apliteEnv }), false,
      'theme slot "' + JSON.stringify(i.showWhen) + '" must be hidden on aplite');
  });
  const visibleOnDiorite = themeItems.filter((i) => showWhen.isVisible(i, { env: dioriteEnv }));
  assert.equal(visibleOnDiorite.length, 1, 'diorite keeps exactly one theme slot');
  assert.deepEqual(visibleOnDiorite[0].options.map((o) => o[1]), ['dark', 'light']);
});

// Each capabilities:[COLOR] item with the gate that must carry its theme exclusion
// (`when`): its OWN showWhen, or, only for an item with no gate of its own (the Graph
// colors card's lone nav row), its section's, which gates it the way a sheet gates its
// rows. `rendered` is the full gate the row renders under (own AND section, real
// predicates only: an empty `{}` would evaluate false and make every check vacuous).
const colorGatedWithSection = () => {
  const out = [];
  schema.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((i) => {
    if (i.capabilities && i.capabilities.indexOf('COLOR') >= 0) {
      const gates = [i.showWhen, sec.showWhen].filter(Boolean);
      out.push({ item: i, when: i.showWhen || sec.showWhen || null,
        rendered: gates.length ? { all: gates } : null });
    }
  })));
  return out;
};
// A context in which every non-theme condition a COLOR row (or its section) can carry is
// met: every env fact a section needs, the health/radar/bars views on, the holiday
// calendar on, every forecast line drawn. Only the theme can hide a row under it.
const COLOR_ROW_CTX = {
  env: { color: true, health: true, hr: true, thresholds: true, onDemand: true, radar: true, lineStyles: true },
  healthMode: 'all', radarMode: 'graph', barSource: 'rain', radarProvider: 'dwd', holidaysEnabled: true,
  secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'cloud', fifthLine: 'wind',
};
const colorRowVisible = (item, when, theme) => showWhen.isVisible(Object.assign({}, item, { showWhen: when }),
  Object.assign({}, COLOR_ROW_CTX, { theme }));

test('every capabilities:[COLOR] item additionally requires theme not in [bw, bw-light] (effective color)', () => {
  const colorGated = colorGatedWithSection();
  assert.ok(colorGated.length > 0, 'expected at least one capabilities:[COLOR] item');
  colorGated.forEach(({ item: i, when }) => {
    const asStr = JSON.stringify(when);
    assert.ok(asStr.indexOf('"theme"') >= 0, i.messageKey + ' (label "' + i.label + '") is missing a theme gate: ' + asStr);
    // Every such gate must exclude bw-light too, not just bw (nin form, or an eq to
    // something other than bw/bw-light for the dark/light contextual slots).
    const isBwLightExcluded = asStr.indexOf('bw-light') >= 0
      || asStr.indexOf('"eq":"dark"') >= 0 || asStr.indexOf('"eq":"light"') >= 0;
    assert.ok(isBwLightExcluded, i.messageKey + ' (label "' + i.label + '") does not exclude bw-light: ' + asStr);
  });
});

test('bw-light hides every effective-color gate (color pickers, B/W legends, scale notes) via the show-when evaluator', () => {
  const colorGated = colorGatedWithSection();
  assert.ok(colorGated.length > 0, 'expected at least one capabilities:[COLOR] item');
  colorGated.forEach(({ item: i, when, rendered }) => {
    const name = (i.messageKey || i.type) + ' (label "' + i.label + '")';
    // Guard the guard: under the same context a colour theme shows the row (dark, or light
    // for a light-only slot), even through its section's gate. So the context really does
    // satisfy everything but the theme, and the hide below is the theme's doing.
    assert.ok(['dark', 'light'].some((theme) => colorRowVisible(i, rendered, theme)),
      name + ' must show for a colour theme when every other condition holds: ' + JSON.stringify(rendered));
    // The row's own gate (the section's only for a gate-less row) hides it in both B&W themes.
    ['bw', 'bw-light'].forEach((theme) => {
      assert.equal(colorRowVisible(i, when, theme), false, name + ' must be hidden when theme is ' + theme);
    });
  });
  // Spot-check the positive control is not vacuous: the dark theme shows the time and calendar colours.
  ['colorTime', 'colorToday', 'colorSunday', 'colorSaturday'].forEach((k) => {
    const entry = colorGated.find((e) => e.item.messageKey === k);
    assert.equal(colorRowVisible(entry.item, entry.rendered, 'dark'), true, k + ' shows in the dark theme');
  });
});

test('Status bars tab (id watch): Your status bars, the All status bars card, then each bar\'s dialog in watch/forecast/health/radar order, bars 4 to 6, then the slot dialogs', () => {
  const watch = schema.tabs.find((t) => t.id === 'watch');
  // The label was renamed (Status slots → Status bars); the id stays 'watch' —
  // deep links and this very lookup key on it.
  assert.equal(watch.label, 'Status bars', 'tab label renamed, id kept');
  assert.equal(watch.pinBlock, undefined, 'nothing pinned atop the tab: Your status bars draws each bar');
  // Your status bars (the owner's pick, 2026-11-09: a list of the bars, a dialog per bar).
  const list = watch.sections[0];
  assert.deepEqual([list.id, list.title, list.block, list.items.length], ['yourBars', 'Your status bars', 'barsList', 0],
    'the tab opens on the Your status bars card, drawn by screens-page.js barsCard');
  assert.ok(/\bbar\b/.test(list.intro) && /Tap a slot/.test(list.intro) && /bar’s name/.test(list.intro),
    'its intro describes the bars once: a slot can be tapped, and a bar\'s name');
  assert.deepEqual(watch.sections.filter((s) => !s.sheetOnly).map((s) => s.id), ['yourBars', 'statusAll'],
    'the tab\'s two cards');
  const titles = watch.sections.map((s) => s.title).filter(Boolean);
  // The owner's order (2026-10-01: "1: watch status bar 2 weather 3 health 4 radar"),
  // the page's only (it was Forecast, Radar, Health, Watch): on-demand.js BARS and the
  // wire keep their own order. Bars 4 to 6 (Pebble Time 2) follow, each shown once New status bar
  // made its bar.
  assert.deepEqual(titles.slice(0, 9),
    ['Your status bars', 'All status bars', 'Watch bar', 'Forecast bar', 'Health bar', 'Radar bar', 'Status bar 4', 'Status bar 5', 'Status bar 6'],
    'the bars\' dialogs follow the two cards, in order');
  assert.deepEqual(require('../src/pkjs/on-demand.js').BARS.map((b) => b.bar),
    ['top', 'forecast', 'radar', 'health', 'bar4', 'bar5', 'bar6'], 'the contract\'s bar order stays');
  assert.ok(!watch.sections.some((s) => s.id === 'onDemand'), 'the Alert settings card is on the Alerts tab');
  const SCREENS = require('../src/pkjs/screens.js');
  const PAGE = require('../src/pkjs/on-demand.js').PAGE_BARS;
  const dialogs = watch.sections.filter((s) => /^bar-/.test(s.sheetId || ''));
  assert.deepEqual(dialogs.map((s) => s.sheetId), PAGE.map((b) => SCREENS.barSheet(b.bar)), 'one dialog per bar');
  dialogs.forEach((sec, i) => {
    const b = PAGE[i];
    assert.equal(sec.sheetOnly, true, sec.sheetId + ': a dialog, never a card');
    assert.equal(sec.id, sec.sheetId, sec.sheetId + ': its section id is its sheet id');
    assert.deepEqual(sec.titleBy, { resolver: 'barName', args: { bar: b.bar } }, sec.sheetId + ': titled by its name');
    assert.equal(sec.pinBlock, 'barPicture', sec.sheetId + ': its own picture pinned');
    assert.deepEqual(sec.items[0], { type: 'subheader', text: 'Slots' }, sec.sheetId + ': its Slots card first');
    assert.deepEqual(sec.rename, b.bar === 'top' ? undefined
      : { key: b.prefix + 'Name', label: 'Status bar name', placeholder: b.name, maxlength: SCREENS.NAME_MAX },
    sec.sheetId + ': the title renames the bar, the Watch bar\'s excepted');
  });
  ['bar4', 'bar5', 'bar6'].forEach((id, i) => {
    const card = watch.sections.find((s) => s.sheetId === 'bar-' + id);
    const prefix = 'statusBar' + (i + 4);
    assert.deepEqual(card.showWhen, { all: [{ env: 'extraBars' }, { key: prefix + 'Made', eq: true }] },
      id + ': once made, on a watch that has it');
    // Delete status bar: the page's one Delete (style 'delete'), drawn under the Slots card; no card
    // of its own (no empty subheader before it).
    const del = card.items[card.items.length - 1];
    assert.deepEqual([del.type, del.style, del.action, del.actionArg, del.label],
      ['button', 'delete', 'deleteBar', id, 'Delete status bar'], id + ': Delete status bar last');
    assert.equal(card.items.filter((it) => it.type === 'subheader').length, 1, id + ': the Slots card alone');
  });
  // The made flags and the names: hidden keys of a section never opened.
  const keys = watch.sections.find((s) => s.sheetId === 'barKeys');
  assert.deepEqual(keys.items.map((i) => i.messageKey), ['statusBar4Made', 'statusBar5Made', 'statusBar6Made',
    'statusForecastName', 'statusHealthName', 'statusRadarName', 'statusBar4Name', 'statusBar5Name', 'statusBar6Name']);
  assert.ok(keys.items.every((i) => i.type === 'hidden'), 'all hidden');
  watch.sections.forEach((s) => assert.equal(s.groupCard, undefined, (s.id || s.sheetId) + ': a card of its own'));
  // The per-slot edit sheets (sheetOnly, opened from a slot's Edit button — never
  // cards) follow in the sections array (see alertSlotSheet / goalSlotSheet). Each is
  // titled after the SLOT: it configures the slot's bold mode as well as its
  // thresholds/goals, so the goal-vs-threshold split lives on the group header inside,
  // not in the sheet title.
  assert.deepEqual(titles.slice(9, 17),
    ['Air quality (AQI) slot', 'Pollen slot', 'Wind speed slot',
      'Wind gusts slot', 'UV index slot', 'Steps slot', 'Sleep slot',
      'Walked distance slot'],
    'per-slot edit sheets follow the bars, in kind order');
  // The bold-only slot sheets (level-less kinds, one Bold row each) follow, in
  // the contract's wire-id order (KINDS 8..19). 'Phone battery slot' is last and
  // serves BOTH phone-battery kinds (18 and 19) — they share key 'PhoneBattery',
  // so there are eleven sheets for twelve bold-only kinds. The weather condition slot's
  // dialog, its Look and no Bold row, closes the tab.
  assert.deepEqual(titles.slice(17),
    ['Temperature slot', 'Air pressure (hPa) slot', 'Sunrise/sunset slot',
      'Date slot', 'Calendar week slot', 'City slot', 'Date countdown slot',
      'Heart rate slot', 'Battery percentage slot', 'Dew point slot',
      'Phone battery slot', 'Weather condition slot'],
    'bold-only slot sheets follow, in wire-id order, then the condition slot\'s');
  // Every slot sheet previews the bars while it is open (the bar it came from, when it came
  // from a bar's dialog: preview-status-bars.js statusBarsPreview).
  watch.sections.filter((s) => /^thresh/.test(s.sheetId || '')).forEach((s) =>
    assert.equal(s.pinBlock, 'statusBarsPreview', s.sheetId + ': the bars\' preview pinned'));
  // The side lists' hidden items (untitled, never opened), then the alerts' item sheets,
  // moved with the alerts to the Alerts tab, in its rows' order.
  const alertTitles = schema.tabs.find((t) => t.id === 'alerts').sections.filter((s) => s.sheetOnly)
    .map((s) => s.title).filter(Boolean);
  assert.deepEqual(alertTitles,
    ['Battery', 'Bluetooth', 'Quiet time', 'Battery saver', 'Rain alert', 'Wind gusts alert', 'UV index alert',
      'Air quality (AQI) alert', 'Pollen alert', 'Wind speed alert'],
    'the item sheets close the Alerts tab, in the card\'s order');
  // Time and Calendar close the Watchface tab (order Time, Calendar) — the Status bars
  // tab holds nothing but slot config.
  const wfTitles = schema.tabs.find((t) => t.id === 'watchface')
    .sections.filter((s) => !s.sheetOnly).map((s) => s.title).filter(Boolean);
  assert.deepEqual(wfTitles.slice(-2), ['Time', 'Calendar'],
    'the Watchface tab ends with Time then Calendar');
  assert.equal(byKey('statusTopLeft').hint, undefined, 'left-slot hint removed');
  const wsb = watch.sections.find((s) => s.title === 'Watch bar').items;
  assert.ok(!wsb.some((i) => i.type === 'staticText'), 'no note above the Watch bar slots');
  const rightIdx = wsb.findIndex((i) => i.messageKey === 'statusTopRight');
  const countdownIdx = wsb.findIndex((i) => i.messageKey === 'statusTopRightCountdown');
  const alertsIdx = wsb.findIndex((i) => i.type === 'button' && i.label === 'Alerts');
  const battIdx = wsb.findIndex((i) => i.messageKey === 'batteryLowOnly');
  assert.equal(countdownIdx, rightIdx + 1, 'top-right countdown date follows its slot');
  assert.equal(alertsIdx, countdownIdx + 1, 'the Alerts row follows the slots');
  assert.deepEqual(wsb[alertsIdx + 1], { type: 'subheader', text: 'Icons and vibration', showWhen: { not: ON_DEMAND_WHEN } },
    'then aplite\'s card of its own');
  assert.equal(battIdx, alertsIdx + 2, 'aplite\'s battery toggle leads it');
});

// --- Alerts: each bar's Alerts row, the side lists' hidden items, the Alerts tab's cards and
// their item sheets with their Shows on grids ---
const ON_DEMAND_WHEN = { env: 'onDemand' };
const OD = require('../src/pkjs/on-demand.js');
const alertsTab = () => schema.tabs.find((t) => t.id === 'alerts');
// The Alerts tab's first card, About alerts (the old Alert settings card's intro and reset).
const onDemandSection = () => alertsTab().sections.find((s) => s.id === 'onDemand');
// The Alerts tab's untitled card of rows, one per item, each opening its sheet.
const onDemandItemsSection = () => alertsTab().sections.find((s) => s.id === 'onDemandItems');
// The item sheets moved with the alerts to the Alerts tab (a sheet opens from any tab).
const alertSheet = (id) => alertsTab().sections.find((s) => s.sheetId === id);
// "The item shows on a status bar": the when-resolver alerts-schema.js onDemandPlacedWhen
// builds (on-demand.js placedAnywhere, the reading the wire packs; when-resolvers.js).
const placedWhenOf = (code) => ({ when: 'onDemandPlaced', args: { code } });

test('the eight side lists: one plain hidden item each, ahead of the Alerts tab\'s item sheets', () => {
  const keys = [];
  OD.BARS.forEach((b) => OD.SIDES.forEach((side) => keys.push(OD.itemsKey(b.bar, side))));
  keys.forEach((k) => {
    const own = items.filter((i) => i.messageKey === k);
    assert.equal(own.length, 1, k + ': exactly one item (hydrate, serialize, its default and reset)');
    assert.deepEqual(own[0], { type: 'hidden', messageKey: k, defaultValue: OD.DEFAULTS[k] },
      k + ': no options and no onChange (the grids write through on-demand.js)');
  });
  const sec = alertSheet('odLists');
  assert.equal(sec.sheetOnly, true);
  assert.deepEqual(sec.showWhen, ON_DEMAND_WHEN);
  assert.equal(sec.title, undefined, 'never opened');
  assert.deepEqual(sec.items.map((i) => i.messageKey), keys, 'BARS order, left then right');
  // The lists moved with the alerts to the Alerts tab: its first sheet, right before the
  // item sheets whose grids write them.
  const ids = alertsTab().sections.filter((s) => s.sheetOnly).map((s) => s.sheetId);
  assert.equal(ids[0], 'odLists');
  assert.equal(ids[1], 'odBattery');
  schema.tabs.filter((t) => t.id !== 'alerts').forEach((t) => assert.ok(!t.sections.some((s) => s.sheetId === 'odLists'),
    t.id + ': the lists live on the Alerts tab only'));
  ['odTop', 'odForecast', 'odRadar', 'odHealth'].forEach((id) =>
    schema.tabs.forEach((t) => assert.ok(!t.sections.some((s) => s.sheetId === id), id + ': the per-bar sheets are gone')));
});

const ALERT_CODES = ['battery', 'bt', 'qt', 'snooze', 'rain', 'gust', 'uv', 'aqi', 'pollen', 'wind'];
const ITEM_SHEET = { battery: 'odBattery', bt: 'odBluetooth', qt: 'odQuiet', snooze: 'odSleep', rain: 'alertRain',
  gust: 'alertGust', uv: 'alertUv', aqi: 'alertAqi', pollen: 'alertPollen', wind: 'alertWind' };
const SHOWS_ON_NOTE = 'On each bar, the alert can show on the left or the right, not both. When a bar runs out of'
  + ' room, the alerts lower in the Alerts tab’s list are hidden first.';
const SUBJECT = { gust: 'the gust speed', uv: 'the UV index', aqi: 'the air quality index', pollen: 'the pollen index',
  wind: 'the wind speed' };
const DEFAULT_VIEW_NOTE_TEXT = 'Your Default screen has no Watch bar, so this alert won’t show there. Tick a bar that screen shows.';

test('every item sheet opens on its Shows on card: the note, the grid, the Default view note; the grid stores nothing', () => {
  ALERT_CODES.forEach((code) => {
    const sheet = alertSheet(ITEM_SHEET[code]);
    assert.ok(sheet, code + ': its sheet');
    // The Shows on card: its sub-header carries the side rules as its intro.
    assert.deepEqual(sheet.items[0], { type: 'subheader', text: 'Shows on', intro: SHOWS_ON_NOTE
      + (SUBJECT[code] ? ' If the status slot on the same side shows ' + SUBJECT[code] + ', the alert shows in'
        + ' that slot, in the alert’s colors, instead of adding its icon.' : '') }, code + ': the card and its note');
    // Rain's two notes on why it may not show sit between the header and the grid.
    const at = sheet.items.findIndex((i) => i.type === 'checklist');
    assert.equal(at, code === 'rain' ? 3 : 1, code + ': the grid follows the header (and Rain\'s notes)');
    assert.deepEqual(sheet.items[at], {
      type: 'checklist', label: 'Shows on', captionsOnly: true, check: code, writeWith: 'onDemandTick',
      columns: [{ label: 'Left' }, { label: 'Right' }],
      optionsFrom: { resolver: 'onDemandBars', args: { code } }
    }, code + ': the grid');
    // Under the grid: where the fix is while the Default view shows no bar with Alerts —
    // the same predicate as the About alerts card's own note.
    const note = sheet.items[at + 1];
    assert.equal(note.type, 'staticText');
    assert.equal(note.style, 'info');
    assert.equal(note.text, DEFAULT_VIEW_NOTE_TEXT);
    assert.deepEqual(note.showWhen, onDemandSection().items[1].showWhen, code + ': the Default view note\'s gate');
    assert.equal(sheet.items.filter((i) => i.check !== undefined).length, 1, code + ': one grid');
  });
  // Every checklist shows other items' keys and writes them through on-demand.js: none
  // carries one itself.
  items.filter((i) => i.type === 'checklist').forEach((i) => {
    assert.equal(i.messageKey, undefined, 'a Shows on grid stores nothing of its own');
    assert.ok(i.check !== undefined, 'every checklist on the page is a Shows on grid');
    assert.equal(i.writeWith, 'onDemandTick', 'and taps go to on-demand.js');
  });
});

test('the Quiet time and Sleep sheets: the Shows on card, nothing else', () => {
  [['odQuiet', 'Quiet time', 'qt', 'Shows the quiet time icon at the edge of a status bar while Quiet Time is on.'],
    ['odSleep', 'Battery saver', 'snooze', 'Shows the sleep icon at the edge of a status bar during the Battery saver hours'
      + ' (Watchface › Theme & night).']].forEach(([id, title, code, intro]) => {
    const sheet = alertSheet(id);
    assert.equal(sheet.sheetOnly, true);
    assert.deepEqual(sheet.showWhen, ON_DEMAND_WHEN);
    assert.equal(sheet.title, title);
    assert.equal(sheet.intro, intro);
    assert.deepEqual(sheet.items.map((i) => i.type), ['subheader', 'checklist', 'staticText'],
      id + ': the Shows on header, the grid and the Default view note alone');
    assert.equal(sheet.items[1].check, code);
  });
});

test('the Alerts tab\'s cards: gated to a watch with On demand; About alerts\' intro and reset, then the rows in order', () => {
  const sec = onDemandSection();
  assert.equal(sec.title, 'About alerts');
  assert.equal(sec.groupCard, undefined, 'a card of its own');
  assert.deepEqual(sec.showWhen, ON_DEMAND_WHEN);
  // The owner's wording, 2026-10-01: when an alert shows, then examples; its last sentence
  // the owner's of 2026-10-02 (each item's sheet opens on its Shows on grid). Its reset
  // left the copy for a link row of its own.
  // Its second paragraph (the owner, 2026-10-04) carries the warn level onto the graph
  // lines, linking the Graphs tab's Forecast pane.
  assert.equal(sec.intro, 'An alert shows at the edge of a status bar only when it reaches its warn level or is'
    + ' active right now. The rest of the time it stays hidden. For example, the battery is low, Bluetooth is'
    + ' disconnected, rain is coming, or the UV or wind forecast reaches its warn level. Open an alert to choose'
    + ' which status bars show it, on the left or the right.'
    + '<p class="intro-more">The warn level works on the graph too. Set the Visible values of a wind, gust or UV'
    + ' line to Alert (<button type="button" class="txt-link" data-goto-tab="graphs" data-goto-pane="forecast">'
    + 'Graphs › Forecast › a graph</button>), and the line shows only in the hours that reach the warn level.</p>');
  assert.equal(sec.intro.indexOf('data-action'), -1, 'no inline reset in the intro any more');
  const ctx = (p) => ({ env: platform.computeEnv({ platform: p }) });
  const rowsSec = onDemandItemsSection();
  [sec, rowsSec].forEach((s) => {
    assert.equal(showWhen.isVisible(s, ctx('aplite')), false, s.id + ': gone on aplite');
    ['basalt', 'diorite', 'chalk', 'emery', 'flint'].forEach((p) =>
      assert.equal(showWhen.isVisible(s, ctx(p)), true, s.id + ': shown on ' + p));
  });
  assert.deepEqual(sec.items[0], { type: 'button', style: 'link', action: 'resetOnDemand',
    label: 'Reset alert settings to defaults' }, 'the reset, a link row');
  assert.equal(sec.items.length, 2);
  assert.equal(sec.items[1].type, 'staticText');
  assert.equal(sec.items[1].style, 'info');
  assert.equal(sec.items[1].text, 'Your Default screen has no Watch bar, so Alerts won’t show there.'
    + ' Open an alert and, under Shows on, pick another status bar that screen shows.');
  assert.equal(rowsSec.title, undefined, 'the rows\' card is untitled: its sub-headers name its groups');
  assert.deepEqual(rowsSec.showWhen, ON_DEMAND_WHEN);
  const it = rowsSec.items;
  assert.deepEqual(it.map((i) => i.sheetId || i.label || i.text || i.type), [
    'System info', 'odBattery', 'odBluetooth', 'odQuiet', 'odSleep', 'Weather alerts',
    'alertRain', 'alertGust', 'alertUv', 'alertAqi', 'alertPollen', 'alertWind']);
  // A row whose alert is on no bar reads dimmed: its summary goes faint while the item is
  // placed nowhere.
  const faint = (code) => ({ not: placedWhenOf(code) });
  assert.deepEqual(it[0], { type: 'subheader', text: 'System info' });
  // No row joins another and the System info rows and Rain carry no badge any more: their
  // summaries say it all.
  assert.deepEqual(it[1], { type: 'sheet', sheetId: 'odBattery', label: 'Battery', icon: 'battery',
    hintFrom: { resolver: 'onDemandBatteryText' }, summaryFaintFrom: faint('battery') });
  assert.deepEqual(it[2], { type: 'sheet', sheetId: 'odBluetooth', label: 'Bluetooth', icon: 'bluetooth',
    hintFrom: { resolver: 'onDemandBluetoothText' }, summaryFaintFrom: faint('bt') });
  // Quiet time and Sleep: a sheet that places them (the owner, 2026-10-02).
  assert.deepEqual(it[3], { type: 'sheet', sheetId: 'odQuiet', label: 'Quiet time', icon: 'quiet',
    hintFrom: { resolver: 'onDemandPlainText', args: { code: 'qt', text: 'While Quiet Time is on' } },
    summaryFaintFrom: faint('qt') });
  assert.deepEqual(it[4], { type: 'sheet', sheetId: 'odSleep', label: 'Battery saver', icon: 'snooze',
    hintFrom: { resolver: 'onDemandSleepText' }, summaryFaintFrom: faint('snooze') });
  assert.deepEqual(it[5], { type: 'subheader', text: 'Weather alerts' });
  assert.deepEqual(it[6], {
    type: 'sheet', sheetId: 'alertRain', label: 'Rain', icon: 'rain',
    hintFrom: { resolver: 'rainAlertHint', args: {
      windows: [['Within 30 min', '30'], ['Within 60 min', '60'], ['Within 2 hours', '120']],
      looks: [['Icon', 'icon'], ['Icon + minutes', 'minutes'], ['Text', 'text']] } },
    summaryFaintFrom: faint('rain')
  });
  // The window values the hint prints are the rain sheet's, the look list its own.
  assert.deepEqual(it[6].hintFrom.args.windows.map((o) => o[1]),
    byKey('rainCountdownHorizon').options.map((o) => o[1]));
  assert.deepEqual(it[6].hintFrom.args.looks, byKey('rainAlertDisplay').options);
  const KINDS = [['Gust', 'Wind gusts', 'gust'], ['Uv', 'UV index', 'uv'], ['Aqi', 'Air quality', 'aqi'],
    ['Pollen', 'Pollen', 'pollen'], ['Wind', 'Wind speed', 'wind']];
  KINDS.forEach(([stem, label, icon], k) => {
    const row = { type: 'sheet', sheetId: 'alert' + stem, label, icon,
      hintFrom: { resolver: 'alertLevelsHint',
        args: { keyStem: stem, days: [['Today', 'today'], ['Today + tomorrow', 'tomorrow']] } },
      editBadgeFrom: { resolver: 'alertLevelBadge', args: { keyStem: stem } }, summaryFaintFrom: faint(icon) };
    if (stem === 'Pollen') { row.showWhen = { key: 'provider', eq: 'dwd' }; }
    assert.deepEqual(it[7 + k], row, stem + ' row');
    assert.deepEqual(it[7 + k].hintFrom.args.days, byKey('alert' + stem + 'Days').options, stem);
  });
  assert.ok(!sec.items.concat(it).some((r) => r.messageKey), 'no control on the cards: every row reads or opens a sheet');
});

// alerts-schema.js keeps its own presentation list of the metric alerts (labels, icons, sheet
// copy — they really do differ per kind), but which alerts exist and their order are
// the contract's (status-thresholds.js ALERT_KINDS): the card's rows and the tab's
// alert sheets follow it, stem for stem.
test('the Alerts tab\'s alert rows and the alert sheets follow the contract\'s ALERT_KINDS order', () => {
  const thresholds = require('../src/pkjs/status-thresholds.js');
  const stems = thresholds.ALERT_KINDS.map((a) => a.key);
  const sheetIds = stems.map((stem) => 'alert' + stem);
  const rows = onDemandItemsSection().items.filter((i) => i.type === 'sheet' && /^alert/.test(i.sheetId)
    && i.sheetId !== 'alertRain');
  assert.deepEqual(rows.map((r) => r.sheetId), sheetIds, 'the card\'s metric rows');
  assert.deepEqual(rows.map((r) => r.hintFrom.args.keyStem), stems, 'each row\'s hint names its own kind');
  assert.deepEqual(rows.map((r) => r.editBadgeFrom.args.keyStem), stems, 'each row\'s badge names its own kind');
  assert.deepEqual(alertsTab().sections.filter((s) => s.sheetOnly && /^alert/.test(s.sheetId))
    .map((s) => s.sheetId), ['alertRain'].concat(sheetIds), 'the sheets, rain first');
});

test('the Battery sheet: the warn level in the watch\'s charge steps, and the Look', () => {
  const sheet = alertSheet('odBattery');
  assert.equal(sheet.title, 'Battery');
  assert.deepEqual(sheet.showWhen, ON_DEMAND_WHEN);
  assert.equal(sheet.intro, 'Shows the battery icon at the edge of a status bar while the watch battery is'
    + ' at or below the warn level. If a bar already shows the battery in a status slot (Watch battery or Watch'
    + ' battery percentage), the icon stays off that bar until that slot is hidden to make room.');
  // The Shows on card (header, grid, Default view note), then the Alert card.
  assert.deepEqual(sheet.items.slice(0, 3).map((i) => i.type), ['subheader', 'checklist', 'staticText']);
  assert.deepEqual(sheet.items[3], { type: 'subheader', text: 'Alert' });
  const row = (step, gate) => ({ type: 'range', single: true, messageKey: 'batteryLowLevel', label: 'Warn level',
    min: step, max: 30, step, unit: '%', defaultValue: '10',
    hint: 'Shows the battery icon when the battery is at or below this level.',
    showWhen: gate });
  assert.deepEqual(sheet.items[4], row(5, { env: 'fineBattery' }), 'emery: 5..30 in 5s');
  assert.deepEqual(sheet.items[5], row(10, { not: { env: 'fineBattery' } }), 'every other watch: 10..30 in 10s');
  assert.deepEqual(sheet.items[6], {
    type: 'segmented', messageKey: 'batteryLowDisplay', label: 'Look', defaultValue: 'icon',
    options: [['Icon', 'icon'], ['Icon + value', 'value']],
    hintByValue: { value: 'Adds the charge after the icon, like 8%. When the bar runs out of room, the status slot'
      + ' on the alert’s side and the middle slot first shorten, then hide. Only then does it drop to the icon alone.' }
  });
  assert.equal(sheet.items.length, 7);
  // Exactly one Warn level row shows per platform; an unknown one reads the 10 % steps.
  const shown = (p) => sheet.items.slice(4, 6).filter((i) => showWhen.isVisible(i,
    { env: platform.computeEnv(p === null ? null : { platform: p }) }));
  assert.deepEqual(shown('emery').map((i) => i.step), [5]);
  ['basalt', 'diorite', 'flint', 'chalk', 'aplite', null].forEach((p) =>
    assert.deepEqual(shown(p).map((i) => i.step), [10], String(p)));
  // The 10 % slider shows a stored 5/15/25 at the next step up, the value the phone sends.
  const RC = require('../src/pkjs/config-ui/lib/range-control.js');
  for (let v = 5; v <= 30; v += 5) {
    const S = { batteryLowLevel: String(v) };
    assert.equal(RC.parseSingle(S.batteryLowLevel, sheet.items[5]), OD.batteryLevel(S, platform.computeEnv({ platform: 'basalt' })),
      'basalt ' + v);
    assert.equal(RC.parseSingle(S.batteryLowLevel, sheet.items[4]), OD.batteryLevel(S, platform.computeEnv({ platform: 'emery' })),
      'emery ' + v);
  }
});

test('aplite keeps the Watch bar\'s own battery, quiet time and Bluetooth rows, and only it', () => {
  const wsb = schema.tabs.find((t) => t.id === 'watch').sections.find((s) => s.title === 'Watch bar').items;
  const own = ['batteryLowOnly', 'showQt', 'vibe', 'btIcons'].map((k) => wsb.find((i) => i.messageKey === k));
  own.forEach((it) => assert.deepEqual(it.showWhen, { not: ON_DEMAND_WHEN }, it.messageKey));
  assert.equal(own[3].joinPrevious, 'loose', 'the two Bluetooth rows stay grouped');
  const vis = (p) => own.filter((it) => showWhen.isVisible(it, { env: platform.computeEnv({ platform: p }) }))
    .map((it) => it.messageKey);
  assert.deepEqual(vis('aplite'), ['batteryLowOnly', 'showQt', 'vibe', 'btIcons']);
  ['basalt', 'diorite', 'emery', 'flint'].forEach((p) => assert.deepEqual(vis(p), [], p));
});

test('rainCountdownHorizon: one row, the Rain sheet\'s Time window, ahead of its Look', () => {
  const rows = items.filter((i) => i.messageKey === 'rainCountdownHorizon');
  // The Radar tab's 'Rain alert window' copy is gone with the Radar tab: the rain alert's
  // window is set where the rest of the rain alert is (the owner's of 2026-10-02: "Rain
  // alert window can be removed from the radar tab.. Alerts is enough").
  assert.equal(rows.length, 1, 'one row for the key');
  const sheet = alertSheet('alertRain');
  const at = sheet.items.indexOf(rows[0]);
  assert.ok(at !== -1, 'it lives in the Rain sheet');
  assert.equal(rows[0].showWhen, undefined, 'ungated in its sheet: the sheet\'s own gate is enough');
  assert.deepEqual(sheet.items[at - 1], { type: 'subheader', text: 'Alert' }, 'it opens the Rain sheet\'s Alert card');
  assert.equal(sheet.items[at + 1].messageKey, 'rainAlertDisplay', 'the Look follows it');
  assert.equal(rows[0].type, 'segmented');
  assert.equal(rows[0].label, 'Time window');
  assert.equal(rows[0].defaultValue, '60');
  assert.deepEqual(rows[0].options, [['30 min', '30'], ['60 min', '60'], ['2 hours', '120']]);
  const radarSec = graphsTab().sections.find((s) => s.id === 'radar');
  assert.ok(!radarSec.items.some((i) => i.messageKey === 'rainCountdownHorizon'), 'no copy beside the radar');
});

// Each metric alert's Days and tomorrow mark against the contract the bake reads them
// through (status-thresholds.js alertDays / alertNextDayMark): the same values, the
// same default for an absent key, and a mark row that shows exactly while the bake
// would read the mark — whatever is stored, an unknown Days included.
test('the alert Days and tomorrow-mark rows agree with the contract', () => {
  const TH = require('../src/pkjs/status-thresholds.js');
  const pair = require('../src/pkjs/status-pair.js');
  TH.ALERT_KINDS.forEach((a) => {
    const days = byKey('alert' + a.key + 'Days');
    const mark = byKey('alert' + a.key + 'NextDayMark');
    assert.deepEqual(days.options.map((o) => o[1]), TH.ALERT_DAYS, a.key + ': the contract\'s Days');
    assert.equal(days.defaultValue, TH.alertDays({}, a.code), a.key + ': the Days an absent key reads as');
    assert.equal(days.defaultValue, 'tomorrow', 'the owner\'s default: Today + tomorrow');
    assert.deepEqual(mark.options.map((o) => o[1]), TH.ALERT_NEXT_DAY_MARKS, a.key + ': the contract\'s marks');
    assert.deepEqual(mark.options.map((o) => o[1]), Object.keys(pair.NEXT_DAY_MARKS),
      a.key + ': the slot\'s mark choices');
    assert.deepEqual(mark.options, byKey('uvSlotNextDayMark').options, a.key + ': labelled as the slot\'s');
    assert.equal(mark.defaultValue, TH.alertNextDayMark({}, a.code), a.key + ': the mark an absent key reads as');
    [undefined, 'today', 'tomorrow', 'bogus', 3].forEach((v) => {
      const s = { ['alert' + a.key]: true, ['alert' + a.key + 'Days']: v };
      assert.equal(showWhen.isVisible(mark, s), TH.alertDays(s, a.code) === 'tomorrow',
        a.key + ' Days ' + String(v) + ': the mark row shows exactly while the alert looks ahead');
    });
  });
});

test('the All status bars card carries the reset-status-bars link row, ungated', () => {
  const watch = schema.tabs.find((t) => t.id === 'watch');
  const intro = watch.sections.find((s) => s.id === 'statusAll');
  // A text-link row of its own (it was an inline text button at the end of the intro —
  // owner, 2026-10-01: "the reset to default button should be an inline text button, like
  // the telemetry section"), dispatching blocks.js resetStatusSlots through the engine's
  // [data-action] handler. Its label covers slots + Bold and stays truthful on aplite.
  // The tab's intro moved to the Your status bars card above it, still without a button.
  assert.equal(intro.intro, undefined, 'no intro of its own');
  const list = watch.sections.find((s) => s.id === 'yourBars');
  assert.equal(list.intro.indexOf('<button'), -1, 'no inline reset in the tab\'s intro');
  assert.equal(list.intro.indexOf('txt-act-btn'), -1, 'not the boxed chip either');
  // Owner, 2026-10-04: the reset moves under the card's More options, after Bold values.
  const reset = intro.items[intro.items.length - 1];
  assert.deepEqual(reset, { type: 'button', style: 'link', action: 'resetStatusSlots',
    label: 'Reset status bars to defaults', more: true }, 'the card ends on the reset link, under More options');
  // The button resets slots too, which every platform has — so unlike the Bold
  // machinery it must NOT be thresholds-gated (neither the section nor the row).
  assert.equal(intro.showWhen, undefined, 'the card carries no platform gate');
  assert.equal(reset.showWhen, undefined, 'the reset row carries no platform gate');
  // Bold values (thresholds-gated, in view: the owner, 2026-11-06) is the card's other row:
  // 3.2.0's Weather alerts replace slots moved into the Rain alert dialog (below).
  assert.deepEqual(intro.items.slice(0, -1).map((i) => i.messageKey), ['statusBoldAll']);
  assert.equal(byKey('statusBoldAll').more, undefined, 'Bold values is not tucked under More options');
  assert.deepEqual(byKey('statusBoldAll').showWhen, { env: 'thresholds' });
});

// The Rain alert's "Replaces the slot" (the owner's, 2026-11-14: one switch, in the Rain alert
// dialog, on by default; the metric alerts always sit beside their slot): the toggle follows
// the Look in the Rain sheet's Alert card, reads its default from the contract, says what
// each value does, and Reset alert settings puts it back. 3.2.0's All status bars row for
// every weather alert is gone.
test('Replaces the slot: the Rain alert\'s own switch, on by default, reset with the alert settings', () => {
  const rows = items.filter((i) => i.messageKey === 'rainAlertReplacesSlot');
  assert.equal(rows.length, 1, 'one row for the key');
  const row = rows[0];
  const sheet = alertSheet('alertRain');
  const at = sheet.items.indexOf(row);
  assert.ok(at !== -1, 'it lives in the Rain sheet');
  assert.equal(sheet.items[at - 1].messageKey, 'rainAlertDisplay', 'it follows the Look');
  assert.equal(row.type, 'toggle');
  assert.equal(row.label, 'Replaces the slot');
  assert.equal(row.defaultValue, true);
  assert.equal(row.defaultValue, require('../src/pkjs/status-thresholds.js').rainAlert(null).replacesSlot,
    'the default is the contract\'s');
  assert.equal(row.showWhen, undefined, 'ungated in its sheet: the sheet\'s own gate is enough');
  assert.ok(/takes the place of the status slot/.test(row.hintByValue['true']), 'on: takes its place');
  assert.ok(/beside the status slot/.test(row.hintByValue['false']), 'off: beside it');
  assert.equal(items.filter((i) => i.messageKey === 'alertsReplaceSlot').length, 0, 'the shared row is gone');
  ['alertUv', 'alertWind', 'alertGust', 'alertAqi', 'alertPollen'].forEach((id) => {
    assert.ok(!alertSheet(id).items.some((i) => /Replace/i.test(i.messageKey || '')), id + ' has no switch');
  });
  const S = { rainAlertReplacesSlot: false };
  global.PConf.actions.resetOnDemand(null, S, { platform: 'basalt', onDemand: true },
    (k) => (k === 'rainAlertReplacesSlot' ? true : undefined));
  assert.equal(S.rainAlertReplacesSlot, true, 'Reset alert settings puts it back');
});

test('every threshold sheet is sheetOnly and gated off on aplite (which compiles the highlight out)', () => {
  // aplite paints its status rows from the lean status_row_aplite.c twin and has no
  // WW_THRESHOLD_HIGHLIGHT, so a threshold sheet there would silently do nothing. The
  // gate is section-level, and it composes with — not replaces — the per-item health
  // gate and the color pickers' COLOR-capability + non-B&W-theme rules.
  const watch = schema.tabs.find((t) => t.id === 'watch');
  // Bars 4 to 6's made flags and the bars' names ride a sheetOnly section of their own, never
  // opened as a sheet of its own (schema.js barKeysSection); each bar's dialog is a sheet that
  // holds slots, not levels (barDialog).
  const sheets = watch.sections.filter((s) => s.sheetOnly && s.sheetId !== 'barKeys' && !/^bar-/.test(s.sheetId));
  // The weather condition slot's dialog comes last: its Look, no levels and no bold row, so
  // not a thresh<Stem> sheet (blocks.js statusSlotEditSheet names it).
  assert.equal(sheets.length, 20,
    'one edit sheet per boldable slot kind (8 threshold + 11 bold-only), then the condition slot\'s');
  assert.deepEqual(sheets.map((s) => s.sheetId),
    ['threshAqi', 'threshPollen', 'threshWind', 'threshGust', 'threshUv',
      'threshSteps', 'threshSleep', 'threshDistance',
      'threshTemp', 'threshPressure', 'threshSun', 'threshDate', 'threshWeek',
      'threshCity', 'threshCountdown', 'threshHr', 'threshBatteryPct',
      'threshDew', 'threshPhoneBattery', 'slotCondition'],
    'sheet ids follow the thresh<Stem> convention the slot resolver derives');
  // The On demand sheets (the side lists' section + 10 item sheets) moved with the alerts
  // to the Alerts tab, and carry the On demand gate (aplite has no On demand).
  const odSheets = schema.tabs.find((t) => t.id === 'alerts').sections.filter((s) => s.sheetOnly);
  assert.deepEqual(odSheets.map((s) => s.sheetId),
    ['odLists', 'odBattery', 'odBluetooth', 'odQuiet', 'odSleep',
      'alertRain', 'alertGust', 'alertUv', 'alertAqi', 'alertPollen', 'alertWind']);
  odSheets.forEach((s) => {
    assert.deepEqual(s.showWhen, { env: 'onDemand' }, s.sheetId + ' is On demand-gated');
    assert.equal(showWhen.isVisible(s, { radarMode: 'graph', healthMode: 'all',
      env: platform.computeEnv({ platform: 'aplite' }) }), false, s.sheetId + ' hidden on aplite');
  });
  const threshSections = sheets.filter((s) => /^thresh/.test(s.sheetId));
  threshSections.forEach((sec, i) =>
    assert.deepEqual(sec.showWhen, { env: 'thresholds' },
      'threshold sheet ' + i + ' (' + sec.title + ') carries the platform gate'));

  const aplite = { env: platform.computeEnv({ platform: 'aplite' }) };
  const basalt = { env: platform.computeEnv({ platform: 'basalt' }) };
  const diorite = { env: platform.computeEnv({ platform: 'diorite' }) };
  threshSections.forEach((sec) => {
    assert.equal(showWhen.isVisible(sec, aplite), false,
      (sec.title || 'intro') + ' hidden on aplite');
    assert.equal(showWhen.isVisible(sec, basalt), true,
      (sec.title || 'intro') + ' still shown on basalt');
    assert.equal(showWhen.isVisible(sec, diorite), true,
      (sec.title || 'intro') + ' still shown on diorite (B&W but capable)');
  });

  // Composition check: the health kinds' slider keeps the health gate (showWhen);
  // the slider is never muted by the highlight toggle (the warn level also sets the
  // day-max hold) — and the color pickers keep COLOR + non-B&W-theme, unchanged.
  assert.deepEqual(byKey('threshStepsWarn').showWhen,
    { all: [{ env: 'health' }, { key: 'healthMode', ne: 'off' }] },
    'health kinds keep the health/healthMode item gate');
  assert.equal(byKey('threshAqiWarn').showWhen, undefined,
    'weather kinds carry no item gate — the section gate is what hides them on aplite');
  assert.equal(byKey('threshAqiWarn').disabledWhen, undefined,
    'the slider stays live while the highlight is off');
  THRESH_COLOR_KEYS.forEach((k) => {
    assert.deepEqual(byKey(k).capabilities, ['COLOR'], k + ' keeps the COLOR capability');
    assert.equal(showWhen.isVisible(byKey(k), { env: platform.computeEnv({ platform: 'basalt' }), theme: 'bw', healthMode: 'status' }), false,
      k + ' still hidden by a B&W theme');
  });
});

// The phone-battery slot's Bold sheet. Unlike every other bold-only sheet this ONE
// section serves TWO catalog items and TWO wire kinds: 'phoneBattery' (icon + NN%,
// kind 18) and 'phoneBatteryPlain' (NN%, no icon, kind 19). The no-icon variant needs
// its own wire kind so it can't fall through to City's bold row (the pressure-slot bug,
// d22581f/0a05a7a), but both KINDS entries carry key 'PhoneBattery', so the resolver
// lands both pencils on this one sheet and the packer writes the one mode into both
// cells. If someone ever splits them into two keys, this test is what says the sheet
// list has to grow with them.
test('the Phone battery sheet exists once and BOTH phone-battery slot codes resolve to it', () => {
  const watch = schema.tabs.find((t) => t.id === 'watch');
  const sheets = watch.sections.filter((s) => s.sheetId === 'threshPhoneBattery');
  assert.equal(sheets.length, 1, 'exactly one Phone battery sheet, shared by both kinds');
  const sheet = sheets[0];
  assert.equal(sheet.title, 'Phone battery slot');
  assert.equal(sheet.sheetOnly, true, 'opened from a slot pencil, never rendered as a card');
  assert.deepEqual(sheet.showWhen, { env: 'thresholds' },
    'aplite compiles the highlight machinery out, so the sheet must not exist there');
  // Bold is its whole sheet: no thresholds, no levels, no extra rows.
  assert.deepEqual(sheet.items.map((i) => i.messageKey), ['threshPhoneBatteryBoldMode'],
    'one Bold row and nothing else — the slot has no levels to threshold');
  const bold = sheet.items[0];
  assert.equal(bold.type, 'segmented');
  assert.equal(bold.defaultValue, 'off');
  assert.deepEqual(bold.options, [['Off', 'off'], ['Always', 'always']]);

  // ...and the pencil actually gets here. The slot resolver walks the threshold
  // contract's KINDS and returns 'thresh' + key, so this is the end-to-end proof that
  // the shared key really does collapse two codes onto one sheet.
  const resolve = PConf.sheetResolvers.get('statusSlotEditSheet');
  assert.ok(resolve, 'blocks.js registered statusSlotEditSheet');
  ['phoneBattery', 'phoneBatteryPlain'].forEach((code) => {
    assert.equal(
      resolve({ statusForecastLeft: code }, { thresholds: true }, { messageKey: 'statusForecastLeft' }),
      'threshPhoneBattery', code + ' opens the shared Phone battery sheet');
  });
  // The gate is the same env flag the section carries — no pencil on aplite.
  assert.equal(
    resolve({ statusForecastLeft: 'phoneBattery' },
      platform.computeEnv({ platform: 'aplite' }), { messageKey: 'statusForecastLeft' }),
    null, 'no edit pencil on aplite, which has no threshold machinery');
});

test('threshold config lives in per-slot edit sheets: pencils + sheet on basalt, nothing on aplite', () => {
  // End-to-end through the real renderer: no platform renders threshold CARDS any more —
  // capable platforms get a pencil next to slots holding a threshold value, which opens
  // the sheetOnly section in the shared dialog; aplite gets neither pencil nor sheet.
  const eng = require('../src/pkjs/config-ui/lib/engine.js');
  function watchCx(platformName, openEdit) {
    // statusTopLeft defaults to 'aqi' (a threshold kind) on the narrow platforms.
    const S = Object.assign(eng.hydrate(schema, {}), { healthMode: 'status' });
    const ENV = platform.computeEnv({ platform: platformName });
    return {
      S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
      openEdit: openEdit || null, selectQuery: '', collapsed: {},
      evalCtx: Object.assign({}, S, { env: ENV }),
    };
  }
  function watchBody(platformName) {
    return eng.renderBody(schema, 'watch', watchCx(platformName));
  }
  const apliteBody = watchBody('aplite');
  const basaltBody = watchBody('basalt');
  // No threshold cards or controls in ANY tab body.
  [apliteBody, basaltBody].forEach((body, i) => {
    const who = i === 0 ? 'aplite' : 'basalt';
    THRESH_KEYS.forEach((k) => assert.equal(body.indexOf('data-k="' + k + '"'), -1,
      k + ' has no in-body control on ' + who + ' (sheet-only now)'));
    assert.equal(body.indexOf('Set the warn and danger levels for this value'), -1,
      who + ' body has no Alert levels intro (it lives in the sheets)');
  });
  // The pencil, in the Watch bar's dialog (a tap on its name in Your status bars opens it):
  // basalt's default AQI slot, the bar's left, offers its sheet; aplite offers none.
  const barDialogs = (p) => ['top', 'forecast'].map((bar) => eng.renderEditModal(schema, watchCx(p, 'bar-' + bar)));
  assert.ok(barDialogs('basalt')[0].indexOf('data-edit-sheet="threshAqi"') !== -1,
    'basalt renders a pencil for the AQI slot on the Watch bar');
  [apliteBody].concat(barDialogs('aplite')).forEach((html) => assert.equal(html.indexOf('data-edit-sheet="thresh'), -1,
    'aplite renders no pencil anywhere (env.thresholds is false)'));
  // The sheet itself: full on basalt (Bold row + Highlight switch + the pointer;
  // behavior covered in config-thresholds.test.js), empty on aplite even if forced
  // open. The slot sheet holds the slot rows — its Highlight switch included — and
  // points at the alert sheet on the Alerts tab (a nav row that opens it, summarising
  // the levels), which holds the levels (an alert kind's one home for them).
  const basaltSheet = eng.renderEditModal(schema, watchCx('basalt', 'threshAqi'));
  ['data-k="threshAqiBoldMode"', 'data-k="threshAqiOn"', 'Air quality (AQI) slot']
    .forEach((frag) => assert.ok(basaltSheet.indexOf(frag) !== -1, 'basalt slot sheet carries ' + frag));
  assert.match(basaltSheet, new RegExp('<div class="row nav" data-edit-sheet="alertAqi" role="button" tabindex="0"'
    + ' style="cursor:pointer"><div class="lft"><div class="lbl">Alert levels and colors</div>'
    + '<div class="hint">Warn \\d+ · Danger \\d+</div></div><div class="rgt"><span class="nav-note">Alerts</span>'
    + '<span class="chev nav" aria-hidden="true">&#8250;</span></div></div>'), 'basalt slot sheet opens the alert sheet, its levels summarised');
  assert.equal(basaltSheet.indexOf('Alert levels and colors are set in the'), -1, 'the old pointer box is gone');
  assert.equal(basaltSheet.indexOf('data-range="threshAqiWarn"'), -1, 'no levels in the slot sheet');
  const alertSheet = eng.renderEditModal(schema, watchCx('basalt', 'alertAqi'));
  ['data-k="alertAqiDisplay"', 'Set the warn and danger levels', 'Alert levels', 'Air quality (AQI) alert',
    'data-range="threshAqiWarn"'].forEach((frag) =>
    assert.ok(alertSheet.indexOf(frag) !== -1, 'basalt alert sheet carries ' + frag));
  assert.equal(alertSheet.indexOf('data-k="threshAqiOn"'), -1, 'no highlight switch in the alert sheet');
  assert.ok(!/class="row stack[^"]*\bdis\b/.test(alertSheet),
    'the slider renders live');
  assert.equal(eng.renderEditModal(schema, watchCx('aplite', 'threshAqi')), '',
    'aplite renders an empty sheet even when forced open');
  // The rest of the Status bars tab is untouched on aplite. (Time/Calendar live
  // in the Watchface tab now, so probe an always-shown Watch-Status-Bar toggle.)
  assert.ok(barDialogs('aplite')[0].indexOf('data-k="showQt"') !== -1,
    'aplite keeps the Watch bar toggles, in its dialog');
});

// The wind-direction arrow is a per-kind display option of the wind/gust slots (the
// phone bakes a trailing sentinel byte into the slot text), so it belongs on those two
// slots' own edit sheets — the same place Temp's display-mode row lives.
// A slot sheet's own rows: everything above its first sub-header (the alert kinds' Alert
// highlighting card, the goal kinds' Goals card), the whole sheet where it has none.
const slotRowsOf = (sheet) => {
  const hdr = sheet.items.findIndex((i) => i.type === 'subheader');
  return hdr === -1 ? sheet.items : sheet.items.slice(0, hdr);
};

test('the wind and gust sheets carry the direction toggle', () => {
  const sheets = schema.tabs.find((t) => t.id === 'watch').sections.filter((s) => s.sheetOnly);
  ['threshWind', 'threshGust'].forEach((id) => {
    const sheet = sheets.find((s) => s.sheetId === id);
    assert.ok(sheet, 'no sheet ' + id);
    const key = id === 'threshWind' ? 'windSlotDirection' : 'gustSlotDirection';
    const item = sheet.items.find((i) => i.messageKey === key);
    assert.ok(item, id + ' is missing ' + key);
    assert.equal(item.type, 'toggle');
    // Wind ships ON, gusts OFF — the pair sits side by side in the Radar row's
    // defaults and shares one bearing, so arrowing both would draw it twice.
    assert.equal(item.defaultValue, id === 'threshWind',
      key + (id === 'threshWind' ? ' must ship on' : ' must ship off'));
    assert.equal(item.label, 'Show wind direction');
    // The description is the engine's `hint` (item.description renders nowhere), and it
    // must name the direction: the arrow flies downwind, not along the reported bearing.
    assert.match(String(item.hint), /arrow/i, key + ' explains what it draws');
    assert.match(String(item.hint), /blowing/i, key + ' says which way the arrow points');
    assert.match(String(item.hint), /No arrow is drawn while Day max shows a peak on its own\.$/, key + ' names the mode');
    // The extra row follows the Value selection group as a row of its own (a divider
    // above it), above the highlight group: it configures the slot, not the highlight.
    // Bold closes the slot's own rows; the Alert highlighting card closes the sheet.
    assert.equal(item.joinPrevious, undefined, key + ' is a row of its own');
    const own = slotRowsOf(sheet);
    assert.match(String(own[own.length - 1].messageKey), /BoldMode$/,
      id + ' must close its slot rows with Bold');
    assert.deepEqual(sheet.items.slice(own.length).map((i) => i.messageKey || i.text || i.sheetId),
      ['Alert highlighting', 'thresh' + id.slice(6) + 'On', 'alert' + id.slice(6)],
      id + ': the Alert highlighting card closes the sheet');
    const mark = sheet.items.findIndex((i) => /SlotNextDayMark$/.test(i.messageKey || ''));
    const highlight = sheet.items.findIndex((i) => /^thresh.*On$/.test(i.messageKey || ''));
    assert.ok(mark < sheet.items.indexOf(item) && sheet.items.indexOf(item) < own.length - 1
      && own.length - 1 < highlight,
      key + ' must sit between the Value selection group and Bold, above the highlight switch');
  });
});

test('no other slot sheet carries a direction toggle', () => {
  schema.tabs.find((t) => t.id === 'watch').sections
    .filter((s) => s.sheetOnly && s.sheetId !== 'threshWind' && s.sheetId !== 'threshGust')
    .forEach((s) => assert.ok(!s.items.some((i) => /SlotDirection$/.test(i.messageKey || '')),
      s.sheetId + ' must not offer a wind-direction toggle'));
});

// "Show unit": whether the slot prints its unit after the number. Only the six kinds
// whose text the PHONE bakes can offer it — the watch-formatted kinds (distance, heart
// rate, sleep, battery %) would need the flag on the wire. Each row lives on its kind's
// own edit sheet, beside the other per-kind display rows.
// `on`/`off` are the two renderings the hint has to name; `def` is the shipped state.
// `on`/`off` null = the kind's unit follows the Units tab (wind, gusts), so its hint
// deliberately names no example: quoting kph there reads as though the toggle also
// PICKS the unit, and the engine's value-dependent hint keys off the item's own value.
const UNIT_ROWS = [
  { sheetId: 'threshWind', key: 'windSlotUnit', on: null, off: null, def: false },
  { sheetId: 'threshGust', key: 'gustSlotUnit', on: null, off: null, def: false },
  { sheetId: 'threshPressure', key: 'pressureSlotUnit', on: '1013hPa', off: '1013', def: true },
  { sheetId: 'threshCountdown', key: 'countdownSlotUnit', on: '5d', off: '5', def: true },
  { sheetId: 'threshTemp', key: 'tempSlotUnit', on: '12°', off: '12', def: false },
  { sheetId: 'threshDew', key: 'dewSlotUnit', on: '12°', off: '12', def: false }
];
const sheetById = (id) => schema.tabs.find((t) => t.id === 'watch').sections
  .filter((s) => s.sheetOnly).find((s) => s.sheetId === id);

test('the Date sheet carries the two format pickers, wire-lockstep, Bold last', () => {
  const CODES = require('../src/pkjs/date-format.js');
  const sheet = sheetById('threshDate');
  assert.ok(sheet, 'no threshDate sheet');
  assert.match(String(sheet.items[sheet.items.length - 1].messageKey), /BoldMode$/,
    'Bold closes the sheet');
  const month = sheet.items.find((i) => i.messageKey === 'dateSlotMonthFormat');
  const full = sheet.items.find((i) => i.messageKey === 'dateSlotFullFormat');
  assert.ok(month && full, 'both pickers present');
  // Each picker says WHEN its string is on screen — the sheet's whole job is
  // explaining that the calendar decides which format applies.
  assert.equal(month.label, 'Date format with calendar');
  assert.equal(month.hint, 'Used when a calendar is on screen.');
  assert.equal(full.label, 'Date format without calendar');
  assert.equal(full.hint, 'Used when no calendar is on screen.');
  // The month list's values ARE the wire vocabulary (index = byte), lockstep with
  // date-format.js and through it the C enum; the full list resolves through
  // dateFullFormatOptions, pinned to the same rule in config-blocks.test.js.
  assert.equal(month.type, 'radio');
  assert.deepEqual(month.options.map((o) => o[1]), CODES.MONTH_FORMAT_CODES);
  assert.equal(month.defaultValue, 'auto');
  assert.equal(full.type, 'radio');
  assert.equal(full.optionsFrom.resolver, 'dateFullFormatOptions');
  assert.equal(full.defaultValue, 'auto');
});

test('the six phone-baked slot kinds each carry a Show unit toggle', () => {
  UNIT_ROWS.forEach((row) => {
    const sheet = sheetById(row.sheetId);
    assert.ok(sheet, 'no sheet ' + row.sheetId);
    const item = sheet.items.find((i) => i.messageKey === row.key);
    assert.ok(item, row.sheetId + ' is missing ' + row.key);
    assert.equal(item.type, 'toggle');
    assert.equal(item.label, 'Show unit');
    // The hint has to name the concrete effect for THIS kind — "shows the unit" alone
    // leaves the reader guessing what the slot will look like afterwards.
    if (row.on) {
      assert.ok(String(item.hint).indexOf(row.on) !== -1,
        row.key + ' hint must show the unit rendering (' + row.on + ')');
      assert.ok(new RegExp('instead of ' + row.off + '\\.').test(String(item.hint)),
        row.key + ' hint must show the bare rendering (' + row.off + ')');
    } else {
      assert.ok(!/kph|mph|\bkn\b/.test(String(item.hint)),
        row.key + ' hint must not name a wind unit the Units tab controls');
      assert.ok(String(item.hint).length > 20, row.key + ' still needs a real hint');
      // The unit gives way to the direction arrow in a narrow slot (status-lines.js
      // withUnit after the arrow byte), and the hint says so (settings audit #22).
      assert.equal(item.hint, 'Prints the unit after the value when it fits. In a narrow left or'
        + ' right slot, a pair plus the direction arrow leaves no room for it.', row.key);
    }
    // Bold closes every slot sheet's own rows (see the sheet-shape tests above), so the
    // extras sit above it — and on the two alert sheets the row configures the SLOT, not
    // the highlight, so it stays above the highlight group.
    const own = slotRowsOf(sheet);
    assert.match(String(own[own.length - 1].messageKey), /BoldMode$/,
      row.sheetId + ' must close its slot rows with Bold');
    assert.ok(own.indexOf(item) !== -1 && own.indexOf(item) < own.length - 1, row.key + ' sits above Bold');
    const highlight = sheet.items.findIndex((i) => /^thresh.*On$/.test(i.messageKey || ''));
    if (highlight !== -1) {
      assert.ok(sheet.items.indexOf(item) < highlight,
        row.key + ' must sit above the highlight group');
    }
    const hdr = sheet.items.findIndex((i) => i.type === 'subheader');
    if (hdr !== -1) {
      assert.ok(sheet.items.indexOf(item) < hdr,
        row.key + ' must sit above the Alert highlighting group header');
    }
  });
  // Temp is the one sheet with several display rows: the unit toggle follows the
  // Temp/Feels/Both picker's group, right above Bold.
  const temp = sheetById('threshTemp');
  assert.ok(temp.items.findIndex((i) => i.messageKey === 'tempSlotUnit') >
    temp.items.findIndex((i) => i.messageKey === 'tempSlotDisplay'),
    'tempSlotUnit follows the Value selection row');
});

// The load-bearing part of this feature: an upgrade must not move a single pixel. The
// four kinds that print a unit today ship ON, the two that never did ship OFF — so the
// defaults are deliberately NOT uniform, and a blanket true/false would be a regression
// for one half or the other.
test('the Show unit defaults: a fresh install\'s, and the legacy look an absent key keeps', () => {
  const catalog = require('../src/pkjs/status-line-catalog.js');
  UNIT_ROWS.forEach((row) => {
    assert.strictEqual(byKey(row.key).defaultValue, row.def,
      row.key + ' must ship ' + (row.def ? 'on' : 'off'));
  });
  assert.deepEqual(UNIT_ROWS.filter((r) => r.def).map((r) => r.key),
    ['pressureSlotUnit', 'countdownSlotUnit'],
    'pressure and the countdown print their unit out of the box');
  assert.deepEqual(UNIT_ROWS.filter((r) => !r.def).map((r) => r.key),
    ['windSlotUnit', 'gustSlotUnit', 'tempSlotUnit', 'dewSlotUnit'],
    'wind and gusts ship bare beside their Both pair (2.2.0); the degree kinds never printed one');
  // A blob without the key keeps the look from before the toggle existed: the four
  // kinds that printed a unit then still print it, so no upgrade rearranges a watch.
  assert.deepEqual(UNIT_ROWS.filter((r) => catalog.unitToggleAbsent(r.key)).map((r) => r.key),
    ['windSlotUnit', 'gustSlotUnit', 'pressureSlotUnit', 'countdownSlotUnit'],
    'exactly the four kinds that printed a unit before the toggles keep it while absent');
});

// The Watch tab's "Reset status bars to defaults" button covers the per-kind display
// rows too (their sheets carry no reset of their own — the threshold group's button is
// scoped to the thresholds). Because the six defaults are NOT uniform, a blanket
// reset-to-false would strip kph, hPa and the countdown's d from a bar the user only
// asked to put back to stock — so pin the reset against the schema, not against a
// hand-copied list.
test('resetStatusSlots restores each Show unit toggle to its schema default', () => {
  const PConf = global.PConf;
  const env = { thresholds: true, color: true, health: true };
  // The engine hands actions its defaultAsStored resolver; the tests rebuild the
  // same thing from the real schema, so the assertions stay end-to-end honest.
  const defaultOf = (key) => PConf.engine.resolveDefaultFrom(byKey(key), env);
  const S = {};
  // Start from the opposite of every default, so a reset that skipped a key or wrote a
  // blanket value would show up either way.
  UNIT_ROWS.forEach((row) => { S[row.key] = !row.def; });
  assert.equal(PConf.actions.resetStatusSlots(null, S, env, defaultOf), true,
    'the action returns true so the engine re-renders');
  UNIT_ROWS.forEach((row) => {
    assert.strictEqual(S[row.key], byKey(row.key).defaultValue,
      row.key + ' must come back as the schema ships it');
  });
});

// dateSlotFullFormat is the one reset key whose fresh-install value is COUNTRY-
// derived (the wizard writes mapCountry's pick), so the reset must land a US
// install back on 'slash' — the schema default 'auto' would hand it the dotted
// '09.07.26' no fresh US install ever shows. The month format has no country
// dependence and resets to the schema's 'auto' like every other key.
test('resetStatusSlots restores the date formats country-aware, like the wizard', () => {
  const PConf = global.PConf;
  const env = { thresholds: true, color: true, health: true };
  const defaultOf = (key) => PConf.engine.resolveDefaultFrom(byKey(key), env);
  const us = { holidayCountry: 'US', dateSlotFullFormat: 'iso', dateSlotMonthFormat: 'name' };
  PConf.actions.resetStatusSlots(null, us, env, defaultOf);
  assert.equal(us.dateSlotFullFormat, 'slash', 'US resets to the wizard-derived 9/7/26');
  assert.equal(us.dateSlotMonthFormat, 'auto', 'the month format resets to the schema default');
  const de = { holidayCountry: 'DE', dateSlotFullFormat: 'iso' };
  PConf.actions.resetStatusSlots(null, de, env, defaultOf);
  assert.equal(de.dateSlotFullFormat, 'auto', 'everyone else resets to Auto');
});

// Same drift guard for the two direction arrows: their defaults are NOT uniform
// either (wind ships on, gust ships off), and the reset once hardcoded false for
// both — written when false WAS wind's default, then left behind when the schema
// flipped it, so "back to stock" silently disabled a shipped-on arrow.
test('resetStatusSlots restores each direction arrow to its schema default', () => {
  const PConf = global.PConf;
  const env = { thresholds: true, color: true, health: true };
  const defaultOf = (key) => PConf.engine.resolveDefaultFrom(byKey(key), env);
  const S = { windSlotDirection: !byKey('windSlotDirection').defaultValue,
    gustSlotDirection: !byKey('gustSlotDirection').defaultValue };
  PConf.actions.resetStatusSlots(null, S, env, defaultOf);
  ['windSlotDirection', 'gustSlotDirection'].forEach((key) => {
    assert.strictEqual(S[key], byKey(key).defaultValue,
      key + ' must come back as the schema ships it');
  });
});

test('no other slot sheet carries a Show unit toggle', () => {
  const owners = UNIT_ROWS.map((r) => r.sheetId);
  schema.tabs.find((t) => t.id === 'watch').sections
    .filter((s) => s.sheetOnly && owners.indexOf(s.sheetId) === -1)
    .forEach((s) => assert.ok(!s.items.some((i) => /SlotUnit$/.test(i.messageKey || '')),
      s.sheetId + ' must not offer a unit toggle (the watch formats that kind)'));
});

// goalSlotSheet applies its sheet gate in one pass so a row added later cannot forget
// its gate line — but a row may bring its OWN showWhen, and the pass must not clobber
// it (boldSection's idiom). Only the gated sheets (the health kinds) have a gate to
// apply, and none of their rows brings a showWhen of its own today, so the guarantee
// is not observable from the built schema: check that goalSlotSheet goes through the
// shared pass at the source, and ask the pass itself (settings/schema-gates.js gateAll).
test('goalSlotSheet gates its slot rows without clobbering their own showWhen', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pkjs', 'settings', 'schema.js'), 'utf8');
  const body = src.slice(src.indexOf('function goalSlotSheet('),
    src.indexOf('function alertSlotSheet('));
  assert.ok(body.indexOf('gateAll(') !== -1,
    'goalSlotSheet must gate through the shared gateAll pass');
  const gateAll = require('../src/pkjs/settings/schema-gates.js').gateAll;
  const own = { key: 'a', eq: 'b' };
  const gate = { env: 'health' };
  const rows = gateAll([{ showWhen: own }, {}], gate);
  assert.equal(rows[0].showWhen, own, 'gateAll must keep a row\'s own showWhen');
  assert.equal(rows[1].showWhen, gate, 'gateAll must gate a row that has none');
  assert.deepEqual(gateAll([{}], null), [{}], 'a null gate gates nothing');
  // The shipped gated sheet still ends up gated: every VISIBLE row carries the health
  // gate (the two hidden companion rows are never drawn, so they never had one).
  const health = schema.tabs.find((t) => t.id === 'watch').sections
    .find((s) => s.sheetId === 'threshSteps');
  health.items.filter((i) => i.type !== 'hidden').forEach((i) =>
    assert.match(JSON.stringify(i.showWhen), /"env":"health"/,
      (i.messageKey || i.type) + ' lost the health gate'));
});

test('fourthLine offers Off + the metrics neither other line uses, feels and dew included', () => {
  // The resolver args come FROM the schema item, so a schema regression shows here.
  const args = byKey('fourthLine').optionsFrom.args;
  const opts = metricOptions({ secondaryLine: 'wind', thirdLine: 'uv' }, { platform: 'basalt' }, args);
  assert.deepEqual(opts.map(([, v]) => v), ['off', 'precip_prob', 'cloud', 'gust', 'pressure', 'feels', 'dew'],
    'Off + the remaining metrics, the temperature-axis ones included (own curve-inset byte)');
});

test('the Third and Fourth metric pickers offer feels and dew off aplite, and exclude sibling picks', () => {
  const siblings = {
    fourthLine: ['secondaryLine', 'thirdLine'],
    fifthLine: ['secondaryLine', 'thirdLine', 'fourthLine']
  };
  for (const key of ['fourthLine', 'fifthLine']) {
    const args = byKey(key).optionsFrom.args;
    assert.deepEqual(args.exclude, siblings[key], key + ' excludes the earlier lines');
    for (const platform of ['basalt', 'emery']) {
      const wide = metricOptions({ secondaryLine: 'precip_prob', thirdLine: 'off' }, { platform }, args)
        .map(([, v]) => v);
      assert.ok(wide.includes('feels'), `${key} offers feels on ${platform}`);
      assert.ok(wide.includes('dew'), `${key} offers dew on ${platform}`);
    }
    // aplite has no temperature-axis inset at all: never offered there.
    const aplite = metricOptions({ secondaryLine: 'precip_prob', thirdLine: 'off' }, { platform: 'aplite' }, args)
      .map(([, v]) => v);
    assert.ok(!aplite.includes('feels') && !aplite.includes('dew'), key + ' offers neither on aplite');
    // A sibling line's current pick is withheld — feels/dew included.
    const taken = { secondaryLine: 'feels', thirdLine: 'dew', fourthLine: 'wind' };
    const rest = metricOptions(taken, { platform: 'basalt' }, args).map(([, v]) => v);
    assert.ok(!rest.includes('feels'), key + ' withholds the main line\'s feels');
    assert.ok(!rest.includes('dew'), key + ' withholds the second line\'s dew');
    if (key === 'fifthLine') {
      assert.ok(!rest.includes('wind'), 'fifthLine withholds the third metric\'s wind');
    }
  }
});

test('the Third metric row and every line-style row hide behind the lineStyles capability, fail-open for unknown platforms', () => {
  // Row-level showWhen, not option-gating: a hidden row is never rendered, so
  // the engine's display-snap can't rewrite the stored value on a watch that
  // lacks the line. {env:'lineStyles'} is the WW_LINE_STYLE mirror
  // (config-ui/lib/platform.js — false only for aplite, true for unknown).
  const LINE_STYLES_GATE = { env: 'lineStyles' };
  assert.deepEqual(byKey('fourthLine').showWhen, LINE_STYLES_GATE);
  assert.equal(byKey('fourthLine').defaultValue, 'off', 'the third metric debuts off');
  // The picker is the Third metric dialog's Metric row; the dialog and the Lines card's
  // row that opens it carry the same gate, so neither shows on a watch without the line.
  assert.equal(byKey('fourthLine').label, 'Metric');
  const thirdSheet = lineSheetById('lineThird');
  assert.equal(thirdSheet.title, 'Third metric');
  assert.ok(thirdSheet.items.indexOf(byKey('fourthLine')) !== -1, 'the picker lives in the Third metric dialog');
  assert.deepEqual(thirdSheet.showWhen, LINE_STYLES_GATE);
  const linesCard = dialogCard(schema, 'Lines');
  assert.deepEqual(linesCard.items.find((i) => i.sheetId === 'lineThird').showWhen, LINE_STYLES_GATE);
  assert.equal(linesCard.items.find((i) => i.sheetId === 'lineThird').label, 'Third metric');
  assert.deepEqual(byKey('secondaryLineStyle').showWhen, { all: [LINE_STYLES_GATE] });
  assert.deepEqual(byKey('thirdLineStyle').showWhen,
    { all: [LINE_STYLES_GATE, { key: 'thirdLine', ne: 'off' }] });
  assert.deepEqual(byKey('fourthLineStyle').showWhen,
    { all: [LINE_STYLES_GATE, { key: 'fourthLine', ne: 'off' }] });
  // The capability itself exists in the platform SoT and folds exactly aplite.
  const platformLib = require('../src/pkjs/config-ui/lib/platform.js');
  // The rows that follow a metric (the graph scales, Visible values, Draw from) never
  // show under the Third or Fourth metric on a watch without the lines either, or a
  // re-paired incapable watch (its stored pick kept by the row-level hide above) would
  // render an orphaned row for a line it never draws.
  const followers = forecastItems(schema).filter((i) => i.messageKey === 'windScale'
    || i.messageKey === 'pressureScale' || i.label === 'Visible values' || i.label === 'Draw from');
  assert.equal(followers.length, 44, 'twelve wind scales, four pressure scales, twelve Visible values, sixteen Draw from');
  ['wind', 'gust', 'uv', 'pressure', 'precip_prob'].forEach((metric) => ['fourthLine', 'fifthLine'].forEach((line) => {
    const S = { secondaryLine: 'feels', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off', windUnits: 'kph' };
    S[line] = metric;
    const shown = (p) => followers.filter((i) =>
      showWhen.isVisible(i, Object.assign({ env: platformLib.computeEnv({ platform: p }) }, S)));
    assert.deepEqual(shown('aplite'), [], 'aplite ' + line + '=' + metric);
    assert.ok(shown('basalt').length > 0, 'basalt ' + line + '=' + metric);
  }));
  assert.equal(platformLib.computeEnv({ platform: 'aplite' }).lineStyles, false);
  assert.equal(platformLib.computeEnv({ platform: 'basalt' }).lineStyles, true);
  assert.equal(platformLib.computeEnv(null).lineStyles, true, 'unknown watch keeps the feature');
});

test('the line-style pickers offer thin/thick/dots/x/top/bottom with per-line defaults matching the wire', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  const OPTIONS = [['Thin line', 'line'], ['Thick line', 'bold'], ['Square dots', 'dots'],
    ['× marks', 'x'], ['Stripe at top', 'stripeTop'], ['Stripe at bottom', 'stripeBottom']];
  const styleOptions = global.PConf.optionsResolvers.get('lineStyleOptions');
  for (const lineKey of ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine']) {
    const key = lineKey + 'Style';
    const item = byKey(key);
    assert.equal(item.type, 'select', key + ' is a dropdown — six styles overflow a segmented row');
    assert.equal(item.options, undefined, key + ' options are derived, not static');
    assert.deepEqual(item.optionsFrom, { resolver: 'lineStyleOptions', args: { metricKey: lineKey } }, key);
    // Stripes only while this line's metric can be one (line-style.js metricAllowsStripe).
    lineStyle.GRAPH_METRICS.forEach((m) => {
      const opts = styleOptions({ [lineKey]: m }, STYLED_ENV, item.optionsFrom.args);
      assert.deepEqual(opts, lineStyle.metricAllowsStripe(m) ? OPTIONS : OPTIONS.slice(0, 4), key + ' ' + m);
    });
    assert.deepEqual(styleOptions({ secondaryLine: 'feels', [lineKey]: 'cloud' }, STYLED_ENV, item.optionsFrom.args),
      OPTIONS, key + ' reads its own line, not the main one');
    assert.equal(item.defaultValue, lineStyle.LINE_STYLE_DEFAULTS[key],
      key + ' schema default must match line-style.js’ wire default');
  }
});

// A stripe picked on an intensity metric lies DORMANT (the item's dormantValues) while
// the line tries a metric that cannot be one: the row shows the style the watch draws
// (line-style.js lineStyleValue) but the stored pick stays, so switching back to an
// intensity metric brings the stripe back instead of silently losing it.
test('a stored stripe on a metric that cannot be one shows the drawn style and survives a switch back', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  const env = STYLED_ENV;
  const LABELS = { line: 'Thin line', bold: 'Thick line', dots: 'Square dots', x: '× marks',
    stripeTop: 'Stripe at top', stripeBottom: 'Stripe at bottom' };
  // Each line's style row lives in that line's own dialog (Graphs › Forecast › Lines).
  let openEdit = null;
  const render = (S) => {
    const cx = { S, ENV: env, USERDATA: {}, openColor: null, openSelect: null, openDate: null, openEdit,
      selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env }) };
    const html = engineLib.renderEditModal(schema, cx);
    assert.ok(html.indexOf('id="esheet-ttl-' + openEdit + '"') !== -1, openEdit + ' renders');
    return html;
  };
  const shown = (html, key) => {
    const m = html.match(new RegExp('data-select="' + key + '" aria-label="Line style: ([^"]*)"'));
    return m ? m[1] : null;
  };
  LINE_KEYS.forEach((lineKey, n) => {
    const key = lineKey + 'Style';
    openEdit = LINE_SHEETS[n];
    assert.ok(lineSheetById(openEdit).items.indexOf(byKey(key)) !== -1, key + ' lives in ' + openEdit);
    assert.deepEqual(byKey(key).dormantValues, ['stripeTop', 'stripeBottom'], key);
    ['stripeTop', 'stripeBottom'].forEach((stripe) => {
      ['feels', 'dew', 'pressure'].forEach((m) => {
        const S = engineLib.hydrate(schema, { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off',
          fifthLine: 'off', [lineKey]: m, [key]: stripe }, env);
        const what = key + ' ' + stripe + ' on ' + m;
        const drawn = lineStyle.lineStyleValue({ [lineKey]: m, [key]: stripe }, key);
        assert.ok(!lineStyle.isStripeValue(drawn), what + ': the watch draws no stripe');
        assert.equal(shown(render(S), key), LABELS[drawn], what + ': the row shows the drawn style');
        assert.equal(S[key], stripe, what + ': the stored pick is kept');
        // Back on an intensity metric the stripe is offered, stored and shown again.
        S[lineKey] = 'cloud';
        assert.equal(shown(render(S), key), LABELS[stripe], what + ': the stripe returns with cloud');
        assert.equal(S[key], stripe, what + ': still stored');
      });
    });
  });
});

test('pressureScale shows for the main line, and for a later line only when no earlier line is pressure', () => {
  const scales = items.filter((i) => i.messageKey === 'pressureScale');
  const pickers = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
  const shown = (S, p) => scales.filter((s) =>
    showWhen.isVisible(s, Object.assign({ env: platform.computeEnv({ platform: p || 'basalt' }) }, S)));
  const none = { secondaryLine: 'cloud', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' };
  assert.deepEqual(shown(none), [], 'no pressure line: no scale');
  pickers.forEach((picker, p) => {
    const S = Object.assign({}, none, { [picker]: 'pressure' });
    assert.deepEqual(shown(S), [scales[p]], picker + ': its own copy');
    // A stored repeat on every later picker still shows the one copy, the first one.
    pickers.slice(p + 1).forEach((later) => { S[later] = 'pressure'; });
    assert.deepEqual(shown(S), [scales[p]], picker + ' and repeats after it');
    // The Third and Fourth metric lines are not drawn on aplite: no scale for them there.
    assert.deepEqual(shown(Object.assign({}, none, { [picker]: 'pressure' }), 'aplite'),
      p < 2 ? [scales[p]] : [], 'aplite ' + picker);
  });
});

// A hardcoded copy of the curve numbers here is the third copy (forecast-series.js and
// blocks.js.PRESSURE_CURVES are the other two, and blocks.js's is drift-tested already —
// see 'preview bands match forecast-series' in test/config-blocks.test.js). Assert
// against forecast-series.PRESSURE_SCALE_CURVE_HPA directly, not literal numbers, so a
// future curve change can't silently leave this copy stale even if someone re-hardcodes it.
test('pressureScale hint copy quotes the curve core (no drift)', () => {
  const { PRESSURE_SCALE_CURVE_HPA } = require('../src/pkjs/forecast-series.js');
  const scales = items.filter((i) => i.messageKey === 'pressureScale');
  for (const s of scales) {
    for (const scale of ['low', 'mid', 'high']) {
      const pts = PRESSURE_SCALE_CURVE_HPA[scale];
      assert.ok(s.hintByValue[scale].includes(pts[1][0] + '\u2013' + pts[2][0] + ' hPa'),
        `${scale} hint should quote its core (${pts[1][0]}-${pts[2][0]} hPa)`);
    }
  }
});

// --- Graph colors (Graphs tab, Forecast pane) -----------------------------------
// One card on the pane with one row that opens the Graph colors dialog; the dialog holds
// one row per graph metric plus the night band, each opening its own sheet. Every colour
// is a CONCRETE per-polarity value defaulting to the built-in line-style.js resolves
// today, so a picker opens with the colour the graph already draws highlighted — no Auto
// sentinel, no curated palette.
const graphCard = () => dialogCard(schema, '');
const graphColorsDialog = () => graphsTab().sections.find((s) => s.sheetId === 'graphColors');
const graphSheets = () => graphsTab().sections.filter((s) => s.sheetOnly && /^gc/.test(s.sheetId));
const gcSheetById = (id) => graphSheets().find((s) => s.sheetId === id);
// The ten rows in card order: the eight metrics as the metric pickers list them, then
// the full-height night band.
const GRAPH_ROW_SHEETS = ['gcPrecip', 'gcCloud', 'gcWind', 'gcGust', 'gcUv', 'gcPressure', 'gcFeels', 'gcDew', 'gcNight'];
const GRAPH_ROW_SCOPES = ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew', 'night'];
// Everything a live gate could read, so only the polarity gate is left to vary — the
// point being that no graph-colour row reads any of them.
const graphState = (over) => Object.assign({
  theme: 'dark', env: { color: true },
  secondaryLine: 'wind', secondaryLineFill: true, thirdLine: 'uv', dayNightShading: true
}, over || {});

test('a graph\'s dialog carries ONE Graph colors card, a row with no title above it', () => {
  const card = graphCard();
  assert.equal(dialogCards(schema).filter((c) => c.items.some((it) => it.sheetId === 'graphColors')).length, 1, 'one card');
  // Its row is visible without a tap; nothing in the dialog folds away but More options.
  assert.equal(graphDialog(schema).collapsible, undefined);
  // One nav row, labelled for what it opens: the Graph colors dialog, its rows counted; it carries
  // the theme gate, and a card with no row to show drops out (engine buildCards), so a B&W theme
  // leaves no empty card under the plain subheader.
  assert.deepEqual(card.items, [{ type: 'sheet', sheetId: 'graphColors', label: 'Graph colors',
    hint: 'Pick the colors of each metric and of the night shading.', navNote: '9', capabilities: ['COLOR'],
    showWhen: { key: 'theme', nin: ['bw', 'bw-light'] } }]);
  const dialog = graphColorsDialog();
  assert.equal(dialog.sheetOnly, true);
  assert.equal(dialog.title, 'Graph colors');
  assert.ok(dialog.intro, 'the dialog says what its rows are');
  assert.equal(dialog.pinBlock, 'forecastPreview', 'the forecast preview pinned atop it');
  assert.deepEqual(dialog.capabilities, ['COLOR']);
  assert.deepEqual(card.head, { type: 'subheader', text: '' });
  [card.items[0], dialog].forEach((sec) => {
    assert.deepEqual(sec.capabilities, ['COLOR']);
    assert.deepEqual(sec.showWhen, { key: 'theme', nin: ['bw', 'bw-light'] });
    // Both gates, evaluated: a B&W theme or a B&W watch hides the whole card, header
    // included (buildSectionBody runs before renderSection's open test).
    assert.equal(showWhen.isVisible(sec, { theme: 'dark', env: { color: true } }), true);
    assert.equal(showWhen.isVisible(sec, { theme: 'bw', env: { color: true } }), false);
    assert.equal(showWhen.isVisible(sec, { theme: 'bw-light', env: { color: true } }), false);
    assert.equal(showWhen.isVisible(sec, { theme: 'dark', env: { color: false } }), false);
  });
});

test('the Graph colors dialog is nine sheet rows in metric-picker order, each identified by its badge args', () => {
  const all = graphColorsDialog().items;
  // The nine rows, then one reset-all link — nothing else in the dialog.
  assert.equal(all.length, 10);
  assert.deepEqual(all[9], { type: 'button', style: 'link', action: 'resetAllGraphColors',
    label: 'Reset graph colors to defaults' });
  const rows = all.slice(0, 9);
  rows.forEach((row) => assert.equal(row.type, 'sheet'));
  assert.deepEqual(rows.map((r) => r.sheetId), GRAPH_ROW_SHEETS);
  // The eight metric rows carry the metric picker's own labels, in its own order, so the
  // two lists read as one vocabulary instead of drifting apart.
  assert.deepEqual(rows.slice(0, 8).map((r) => [r.label, r.editBadgeFrom.args.scope]),
    metricOptions({}, { platform: 'basalt' }, {}));
  assert.equal(rows[8].label, 'Night shading');
  rows.forEach((row, i) => {
    assert.equal(row.messageKey, undefined, row.sheetId + ' stores nothing of its own');
    // resolveEditBadge merges the item's messageKey UNDER editBadgeFrom.args, and a
    // `sheet` row has none — so the row's identity can only ride those args.
    assert.equal(row.editBadgeFrom.resolver, 'graphColorSwatch');
    assert.deepEqual(row.editBadgeFrom.args, { scope: GRAPH_ROW_SCOPES[i] });
    // No live gate: a metric's colours are configurable before it is selected.
    assert.equal(row.showWhen, undefined, row.sheetId + ' inherits the dialog gate only');
  });
});

test('each row has a sheetOnly section carrying BOTH gates, the forecast preview pinned, no inline block', () => {
  assert.equal(graphSheets().length, 9, 'nine sheets on the tab, one per row');
  GRAPH_ROW_SHEETS.forEach((id) => {
    const sec = gcSheetById(id);
    assert.ok(sec, 'missing sheet: ' + id);
    assert.equal(sec.sheetOnly, true);
    assert.equal(sec.collapsible, undefined, 'a sheet is a dialog body, not a card');
    // capabilities alone does not gate a SECTION — buildSectionBody and renderEditModal
    // test sec.showWhen first.
    assert.deepEqual(sec.showWhen, { key: 'theme', nin: ['bw', 'bw-light'] });
    assert.deepEqual(sec.capabilities, ['COLOR']);
    // No inline block heads these sheets; the forecast preview rides the dialog's own
    // pinned header (the dialog's pinBlock), like every forecast dialog's. That header lets
    // go while the 64-swatch palette is open, so on a narrow phone it never sits over the
    // grid (engine pinClass; src/pkjs/config-ui/test/disclosure.test.js).
    assert.equal(sec.block, undefined);
    assert.equal(sec.pinBlock, 'forecastPreview');
    const eng = require('../src/pkjs/config-ui/lib/engine.js');
    const S = eng.hydrate(schema, {}, emeryEnv);
    const colorKey = sec.items.filter((i) => i.type === 'color')[0].messageKey;
    const open = eng.renderEditModal(schema, { S: S, ENV: emeryEnv, USERDATA: {}, openEdit: id, openColor: colorKey,
      openSelect: null, openDate: null, selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env: emeryEnv }) });
    assert.ok(open.indexOf('<div class="pin dlg-pin loose">') !== -1, id + ': the preview scrolls away while the palette is open');
  });
});

test('every graph colour is a Dark/Light pair on one label, one visible at a time', () => {
  GRAPH_ROW_SHEETS.forEach((id, r) => {
    const scope = GRAPH_ROW_SCOPES[r];
    // The roles come from the renderer, so a sheet cannot offer a colour nothing paints
    // (feels is Line-only) or miss one it does.
    const roles = lineStyle.graphColorRoles(scope);
    const rows = gcSheetById(id).items.filter((i) => i.type === 'color');
    assert.equal(rows.length, roles.length * 2, id + ': one pair per role');
    roles.forEach((role, i) => {
      const dark = rows[i * 2];
      const light = rows[i * 2 + 1];
      assert.equal(dark.messageKey, lineStyle.graphColorKey(scope, role, 'Dark'));
      assert.equal(light.messageKey, lineStyle.graphColorKey(scope, role, 'Light'));
      assert.equal(dark.label, light.label, dark.messageKey + ' pair shares one label');
      [dark, light].forEach((row) => {
        assert.deepEqual(row.capabilities, ['COLOR']);
      });
      // The default is the built-in taken FROM the renderer, as an int (the
      // colorUSFederal shape) — never a hex transcribed into the schema.
      assert.equal(typeof dark.defaultValue, 'number');
      assert.equal(dark.defaultValue, lineStyle.graphColorDefault(scope, role, 'Dark', null));
      assert.equal(light.defaultValue, lineStyle.graphColorDefault(scope, role, 'Light', null));
      // Mutually exclusive on polarity, and nothing else gates them: the row shows
      // whether or not its metric is the one currently drawn.
      const inert = { secondaryLine: 'precip_prob', thirdLine: 'off', secondaryLineFill: false, dayNightShading: false };
      assert.equal(showWhen.isVisible(dark, graphState(inert)), true, dark.messageKey + ' shows on dark');
      assert.equal(showWhen.isVisible(light, graphState(inert)), false, light.messageKey + ' hides on dark');
      assert.equal(showWhen.isVisible(light, graphState(Object.assign({ theme: 'light' }, inert))), true);
      assert.equal(showWhen.isVisible(dark, graphState(Object.assign({ theme: 'light' }, inert))), false);
      ['bw', 'bw-light'].forEach((theme) => {
        assert.equal(showWhen.isVisible(dark, graphState({ theme })), false, dark.messageKey + ' hides on ' + theme);
        assert.equal(showWhen.isVisible(light, graphState({ theme })), false, light.messageKey + ' hides on ' + theme);
      });
      // A B&W watch never renders a colour: the COLOR capability hides both rows
      // whatever the stored theme says.
      assert.equal(showWhen.isVisible(dark, graphState({ env: { color: false } })), false);
      assert.equal(showWhen.isVisible(light, graphState({ theme: 'light', env: { color: false } })), false);
    });
  });
});

// The graph-colour card is a PURE EDITOR: every picker writes its own key and nothing
// else. It used to carry a hook copying a new fill colour into the metric's night-tint
// key, which made "did the user pick this tint?" unanswerable afterwards; the tint now
// follows the fill at RESOLVE time (line-style.js' graphNightTint) instead. The only
// residue is a display one — the Night rows PAINT the cascaded colour so their swatch
// is not stale, through the engine's displayFrom hook, while still storing under
// themselves.
test('no graph colour row writes a sibling key; exactly the Night rows paint a derived one', () => {
  const gcKeys = lineStyle.graphColorKeys();
  const gcItems = items.filter((i) => gcKeys.indexOf(i.messageKey) >= 0);
  assert.equal(gcItems.length, gcKeys.length, 'one row per graph colour key');
  assert.deepEqual(gcItems.filter((i) => i.onChange).map((i) => i.messageKey), [],
    'a colour pick has no side effect on any other key');

  const expected = [];
  GRAPH_ROW_SCOPES.forEach((scope) => {
    if (lineStyle.graphColorRoles(scope).indexOf('Night') === -1) { return; }
    ['Dark', 'Light'].forEach((suffix) => {
      expected.push(lineStyle.graphColorKey(scope, 'Night', suffix));
    });
  });
  assert.equal(expected.length, 12, 'six filling metrics x two polarities');
  const withDisplay = gcItems.filter((i) => i.displayFrom);
  assert.deepEqual(withDisplay.map((i) => i.messageKey).slice().sort(), expected.slice().sort());
  // Each row names its OWN scope and polarity, not the live theme: the pair's two rows
  // are tuned independently and only one of them is ever visible.
  withDisplay.forEach((row) => {
    assert.equal(row.displayFrom.resolver, 'graphNightTint');
    assert.equal(row.messageKey,
      lineStyle.graphColorKey(row.displayFrom.args.scope, 'Night', row.displayFrom.args.suffix),
      row.messageKey + ' resolves against itself');
  });
});

test('each sheet resets exactly its own keys, and the lists partition the key set', () => {
  let all = [];
  GRAPH_ROW_SHEETS.forEach((id) => {
    const sec = gcSheetById(id);
    const keys = sec.items.filter((i) => i.type === 'color').map((i) => i.messageKey);
    // The reset rides the SHEET, not a row inside it — renderEditModal seats a
    // section-level labelAction beside the title text. blocks.js takes the key list from
    // HERE through data-action-arg, so it keeps no copy that could drift. BOTH polarities
    // ride it: leaving the hidden one tuned would resurrect old picks on the next theme
    // switch.
    assert.deepEqual(sec.labelAction,
      { action: 'resetGraphColors', arg: keys.join(','), label: 'Reset to default' });
    // Pickers and nothing else — the sheet carries no chrome row of its own now that the
    // reset lives in the header (a 'Colors' sub-header under a "<Metric> colors" title
    // said the same word twice).
    assert.equal(sec.items.length, keys.length, id + ' holds its pickers and nothing else');
    assert.equal(sec.items.filter((i) => i.labelAction).length, 0,
      'no row carries a reset of its own');
    all = all.concat(keys);
  });
  // A partition of the renderer's key list: every key is resettable from exactly one
  // sheet, and no key is stranded without a reset.
  assert.equal(new Set(all).size, all.length, 'no key resets from two sheets');
  assert.deepEqual(all.slice().sort(), GRAPH_COLOR_KEYS.slice().sort());
});

test('the Weather tab is display-only: its own keys, blocks, and no watch coupling', () => {
  const tab = schema.tabs.find((t) => t.id === 'weather');
  assert.ok(tab, 'the weather tab exists');
  assert.equal(tab.label, 'Weather');
  assert.equal(schema.tabs.findIndex((t) => t.id === 'weather'), 0, 'leads the tab bar');
  // Leading the bar is not the same as opening the page: Watchface keeps that
  // until the user flips the Misc toggle.
  assert.deepEqual(tab.openWhen, { key: 'startOnWeatherTab', eq: true },
    'the Weather tab opens the page only on request');
  assert.equal(schema.tabs.find((t) => t.id === 'watchface').openDefault, true,
    'Watchface is the standing default');
  assert.equal(schema.tabs.filter((t) => t.openDefault).length, 1, 'exactly one standing default');
  // Layout: a collapsed Provider card leads (its header paints the current
  // pick), then chips + graphs merge into ONE card via a shared groupCard.
  const providerSec = tab.sections[0];
  assert.equal(providerSec.title, 'Provider');
  assert.equal(providerSec.collapsible, true, 'the provider card starts collapsed');
  assert.equal(providerSec.titleFrom.resolver, 'graphsProviderHeader',
    'the collapsed header shows the selected provider');
  assert.equal(providerSec.items[0].messageKey, 'graphsProvider');
  assert.equal(tab.sections[1].block, 'weatherLocations');
  assert.equal(tab.sections[2].block, 'weatherGraphs');
  assert.ok(tab.sections[1].groupCard && tab.sections[1].groupCard === tab.sections[2].groupCard,
    'chips and graphs share one card');

  const provider = byKey('graphsProvider');
  assert.equal(provider.defaultValue, 'auto');
  assert.equal(provider.optionsFrom.resolver, 'graphsProviderOptions');
  // A keyed pick with its API key momentarily empty is dormant, not invalid:
  // without this, one render while the key field is blank would snap the
  // stored pick to 'auto' and a Save would persist the erasure.
  assert.deepEqual(provider.dormantValues, ['openweathermap', 'tomorrowio']);

  assert.equal(byKey('graphsLocation').type, 'hidden');
  assert.equal(byKey('graphsLocation').defaultValue, 'current');
  ['savedLocation1', 'savedLocation2', 'savedLocation3'].forEach((k) => {
    assert.equal(byKey(k).type, 'hidden');
    assert.equal(byKey(k).defaultValue, '');
  });

  // The display-only contract: nothing in this tab carries the watch's own
  // provider/location keys — those stay in the Setup tab untouched.
  tab.sections.forEach((sec) => sec.items.forEach((i) => {
    assert.ok(['provider', 'location', 'locationMode', 'gpsCacheMin'].indexOf(i.messageKey) === -1,
      'the weather tab must not host watch key ' + i.messageKey);
  }));
});

test('every day-max Value selection row carries its by-value hints; AQI adds its source note', () => {
  // One sentence set per SELECTED mode, none for Now, pinned verbatim on each kind's
  // own noun and samples. AQI keeps a resolver (blocks.js dayMaxHint) for its source
  // note, which closes the row's own hintByValue entry (the engine's args.staticHint), so
  // its args carry the notes alone (one copy, no drift).
  const byKey = (k) => items.find((i) => i.messageKey === k);
  const never = ' Tomorrow\'s peak never triggers Alert highlighting.';
  const hints = (noun, sample) => ({
    max: 'Shows the highest ' + noun + ' left today while that peak is still ahead or happening now.'
      + ' After it, the slot shows tomorrow\'s peak with Tomorrow\'s peak mark, or the current reading'
      + ' if tomorrow\'s isn\'t known.' + never,
    both: 'Shows the ' + noun + ' now and the highest left today, like ' + sample + ', while that peak'
      + ' is still ahead or happening now. After it, tomorrow\'s peak takes its place with'
      + ' Tomorrow\'s peak mark, or the current reading shows alone if tomorrow\'s isn\'t known.' + never
  });
  assert.deepEqual(['uv', 'wind', 'gust', 'aqi'].map((p) => byKey(p + 'SlotDisplay').hintByValue), [
    hints('UV index', '3/7'), hints('wind', '12/30'), hints('gusts', '20/45'),
    hints('air quality index', '42/58')
  ]);
  assert.deepEqual(['uv', 'wind', 'gust'].map((p) => byKey(p + 'SlotDisplay').hintFrom),
    [undefined, undefined, undefined], 'no resolver where no note applies');
  assert.deepEqual(byKey('aqiSlotDisplay').hintFrom, {
    resolver: 'dayMaxHint',
    args: {
      notes: {
        key: 'aqiSource',
        fallback: 'waqi',
        byValue: {
          waqi: ' Your AQI provider (WAQI) has no forecast, so the current reading shows.',
          auto: ' Auto mostly reads WAQI, which has no forecast, so the current reading shows.'
        }
      }
    }
  });
});

test('the day-max sheets\' keys are exactly the catalog\'s dayMaxSettingKeys', () => {
  // Reset and renderSignature take their keys from the catalog; the sheets build theirs
  // in dayMaxRows. The two must never drift apart, or a new row would neither reset nor
  // re-bake.
  const catalog = require('../src/pkjs/status-line-catalog.js');
  const kinds = new RegExp('^(' + catalog.DAY_MAX_KINDS.join('|') + ')Slot');
  const fromSheets = items.map((i) => i.messageKey)
    .filter((k) => k && kinds.test(k) && !/Slot(Unit|Direction)$/.test(k));
  assert.deepEqual([...new Set(fromSheets)].sort(), catalog.dayMaxSettingKeys().slice().sort());
});

test('no searchSelect sits in an edit sheet: a select there expands inline, with no search box', () => {
  // Inside a sheetOnly section a `select` lists its options in place under its row
  // (config-ui engine renderInlineList). That list has no search field, and no select
  // modal opens over a sheet any more, so a searchSelect belongs in a tab body.
  const inSheets = [];
  schema.tabs.forEach((t) => t.sections.forEach((sec) => {
    if (sec.sheetOnly) { sec.items.forEach((it) => inSheets.push({ sheet: sec.sheetId, item: it })); }
  }));
  assert.deepEqual(inSheets.filter((e) => e.item.type === 'searchSelect')
    .map((e) => e.sheet + ':' + e.item.messageKey), []);
  // The rule has something to hold: the slot and alert sheets carry plain selects.
  const selects = inSheets.filter((e) => e.item.type === 'select').map((e) => e.item.messageKey);
  assert.ok(selects.indexOf('uvSlotSeparator') !== -1 && selects.indexOf('alertUvNextDayMark') !== -1,
    'the sheets hold selects that open inline');
});

test('no key is a colour in one item and another type in the next', () => {
  // The page keeps ONE expanded key for a colour's palette and a select's in-place list
  // (config-ui engine boot, `expanded`), and tells the two apart by the key's item type.
  // A key that were both would open the wrong one, and Escape would hand focus to a
  // trigger that is not there.
  const types = {};
  items.forEach((it) => {
    if (it.messageKey) { (types[it.messageKey] = types[it.messageKey] || new Set()).add(it.type); }
  });
  const mixed = Object.keys(types).filter((k) => types[k].has('color') && types[k].size > 1);
  assert.deepEqual(mixed, []);
  assert.ok(Object.keys(types).filter((k) => types[k].has('color')).length > 10, 'the rule has colours to hold');
});
