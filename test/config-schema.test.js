// test/config-schema.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { REGION_OPTIONS } = require('../src/pkjs/settings/holiday-data.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
// Pulled in so PConf.optionsResolvers is populated (blocks.js registers layoutPresetOptions
// et al.) — needed to resolve layoutPreset's optionsFrom.resolver end-to-end below.
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');

function allItems(s) { const out = []; s.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((it) => out.push(it)))); return out; }
const items = allItems(schema);
const byKey = (k) => items.filter((i) => i.messageKey === k)[0];
function forecastItems(s) { return s.tabs.find((t) => t.id === 'forecast').sections[0].items; }

// Threshold highlighting adds six keys per kind (7 kinds: the toggle, the pair, the
// scale max, two colors), generated the same way schema.js's thresholdSection()
// generates them — listing 42 literals would just invite drift. THRESH_COLOR_KEYS is
// reused by the color-defaults assertion below.
const THRESH_STEMS = ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance', 'Uv'];
// The kinds with an Alerts-card row and a levels-only alert<Stem> sheet, in the card's
// row order (the goal kinds are not alerts).
const ALERT_STEMS = ['Uv', 'Wind', 'Gust', 'Aqi', 'Pollen'];
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
const THRESH_KEYS = threshKeys(['On', 'BoldMode', 'WarnOutlineOn', 'Warn', 'Danger', 'Max'])
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
  'tempSlotSeparator','tempSlotSeparatorCustom','tempSlotSeparatorSpaced','tempSlotOrder',
  'dateSlotMonthFormat','dateSlotFullFormat',
  'barSource','rainBarColor','provider','owmApiKey','yandexApiKey','tomorrowioApiKey','tomorrowioFitBudget','rainbowOwnKey','rainbowApiKey','rainbowFitBudget','radarMode','radarProvider','radarColor','radarSky','radarNoRainText','rainCountdownHorizon',
  'layoutPreset','largeGraphFont','viewResetMin','swapClockStatus','configTheme','showQt','vibe','btIcons','telemetryEnabled','onboardingDone','startOnWeatherTab','devStatsEnabled','devStatsClear','reset',
  // Custom-layout storage (sheetOnly section; see customViewItems in custom-layout-schema.js).
  'viewCount','customLayoutSeeded',
  'viewTop0','viewBody0','viewUpper0','viewLower0','viewOrder0','viewStripOff0',
  'viewTop1','viewBody1','viewUpper1','viewLower1','viewOrder1','viewClockOff1','viewStripOff1',
  'viewTop2','viewBody2','viewUpper2','viewLower2','viewOrder2','viewClockOff2','viewStripOff2',
  'viewTopSize0','viewBodySize0','viewAlign0',
  'viewTopSize1','viewBodySize1','viewAlign1',
  'viewTopSize2','viewBodySize2','viewAlign2',
  'statusBoldAll',
  'statusForecastLeft','statusForecastLeftCountdown','statusForecastMid','statusForecastMidCountdown','statusForecastRight','statusForecastRightCountdown',
  'statusRadarLeft','statusRadarLeftCountdown','statusRadarMid','statusRadarMidCountdown','statusRadarRight','statusRadarRightCountdown',
  'statusTopLeft','statusTopLeftCountdown','statusTopMid','statusTopMidCountdown','statusTopRight','statusTopRightCountdown',
  'batteryLowOnly','statusHealthLeft','statusHealthLeftCountdown','statusHealthMid','statusHealthMidCountdown','statusHealthRight','statusHealthRightCountdown'
].concat(THRESH_KEYS).concat(UNIT_KEYS).concat(GRAPH_COLOR_KEYS);

test('every Clay messageKey present; theme/windScale/colorUSFederal are the only duplicates (contextual slots)', () => {
  EXPECTED_KEYS.forEach((k) => assert.ok(byKey(k), 'missing messageKey: ' + k));
  const seen = items.filter((i) => i.messageKey).map((i) => i.messageKey);
  const counts = {};
  seen.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  const dups = Object.keys(counts).filter((k) => counts[k] > 1);
  // windScale: one slot per line context (main / second / third / fourth metric).
  // pressureScale: same four-way split. theme: color-env (4 options) vs. B&W-env
  // (2 options) — two slots, not four: the 'Day theme' pair is gone and the Theme
  // row is never renamed. themeNight is the same color/B&W split. colorUSFederal:
  // dark-exclude-white vs. light-exclude-black.
  // tomorrowioApiKey/tomorrowioFitBudget: General tab (weather provider) vs. Radar tab
  // (radar-only) — mutually-exclusive showWhen, so only one instance ever renders.
  // The five alert kinds' levels groups: embedded in the slot's pencil sheet
  // (thresh<Stem>) AND the Alerts card's levels-only sheet (alert<Stem>) — the
  // engine cannot open one sheet from another — as the SAME item objects, so each
  // key appears twice but the two copies cannot drift (asserted below).
  const alertLevelKeys = ALERT_STEMS.reduce((acc, stem) => acc.concat(
    ['On', 'Warn', 'Danger', 'Max', 'WarnOutlineOn', 'WarnColor', 'DangerColor']
      .map((suffix) => 'thresh' + stem + suffix)), []);
  assert.deepEqual(dups.sort(),
    ['colorUSFederal', 'pressureScale', 'theme', 'themeNight', 'tomorrowioApiKey', 'tomorrowioFitBudget', 'windScale']
      .concat(alertLevelKeys).sort(),
    'unexpected duplicates: ' + dups.join(','));
  alertLevelKeys.forEach((k) => {
    assert.equal(counts[k], 2, k + ' appears in the pencil sheet and the alert sheet');
    const both = items.filter((i) => i.messageKey === k);
    assert.ok(both[0] === both[1], k + ': the two sheets share one item object');
  });
  assert.equal(counts.windScale, 12, 'windScale appears in twelve slots (4 contexts × 3 units)');
  assert.equal(counts.pressureScale, 4, 'pressureScale appears in four slots (one per line context)');
  assert.equal(counts.theme, 2, 'theme appears in two slots (color / B&W env)');
  assert.equal(counts.themeNight, 2, 'themeNight appears in two slots (color / B&W env)');
  assert.equal(counts.colorUSFederal, 2, 'colorUSFederal appears in exactly two slots');
  assert.equal(counts.tomorrowioApiKey, 2, 'tomorrow.io key in the General + Radar tabs');
  assert.equal(counts.tomorrowioFitBudget, 2, 'tomorrow.io budget guard in the General + Radar tabs');
  assert.deepEqual(Object.keys(counts).sort(), EXPECTED_KEYS.slice().sort());
});

test('every status slot is immediately followed by its own conditional date control', () => {
  const slotKeys = [
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight',
    'statusTopLeft', 'statusTopMid', 'statusTopRight'
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
  assert.equal(items.filter((item) => item.type === 'date').length, 12);
});

test('location is a GPS/Manual picker; the text field is gated to Manual', () => {
  const mode = byKey('locationMode');
  assert.equal(mode.type, 'segmented');
  assert.equal(mode.defaultValue, 'gps');
  assert.deepEqual(mode.options.map((o) => o[1]), ['gps', 'manual']);
  assert.deepEqual(byKey('location').showWhen, { key: 'locationMode', eq: 'manual' });
});

test('providers include openmeteo, metno, yandex and tomorrowio as selectable options (alphabetical by name)', () => {
  assert.deepEqual(byKey('provider').options.map((o) => o[1]),
    ['dwd','metno','openmeteo','openweathermap','tomorrowio','wunderground','yandex']);
});

test('weather provider label matches the AQI provider label style', () => {
  assert.equal(byKey('provider').label, 'Weather provider');
  assert.equal(byKey('aqiSource').label, 'AQI provider');
});

test('defaults match Clay/clay-settings (not the prototype drift)', () => {
  assert.equal(byKey('provider').defaultValue, 'wunderground');
  assert.equal(byKey('radarProvider').defaultValue, 'rainbow');
  assert.equal(byKey('timeFont').defaultValue, 'roboto');
  assert.equal(byKey('sleepNightEnabled').defaultValue, true);
  assert.equal(byKey('fetchIntervalMin').defaultValue, '15');
});

test('color defaults are ints', () => {
  assert.equal(byKey('colorTime').defaultValue, 0xFFFFFF);
  assert.equal(byKey('colorToday').defaultValue, 0);
  assert.equal(byKey('colorSunday').defaultValue, 0xFF0055);
  // colorUSFederal now has two contextual slots (dark-exclude-white / light-exclude-black),
  // like windScale/theme — dedupe by messageKey to assert the SET of color-typed controls.
  const colorTypeKeys = Array.from(new Set(items.filter((i) => i.type === 'color').map((i) => i.messageKey))).sort();
  assert.deepEqual(colorTypeKeys,
    ['colorSaturday','colorSunday','colorTime','colorToday','colorUSFederal']
      .concat(THRESH_COLOR_KEYS).concat(GRAPH_COLOR_KEYS).sort());
});

test('B/W bar-scale hints are staticText, gated to effective non-color + the picker condition', () => {
  const hints = items.filter((i) => i.type === 'staticText' && i.showWhen && i.showWhen.all);
  // Effective color: real B&W hardware OR the Black & White theme (bw/bw-light) on a color watch.
  const isBwGated = (h, cond) =>
    JSON.stringify(h.showWhen.all) === JSON.stringify([{ not: { all: [{ env: 'color' }, { key: 'theme', nin: ['bw', 'bw-light'] }] } }, cond]);
  assert.ok(hints.some((h) => isBwGated(h, { key: 'barSource', eq: 'rain' })), 'forecast B/W hint missing');
  assert.ok(hints.some((h) => isBwGated(h, { key: 'radarMode', eq: 'graph' })), 'radar B/W hint missing');
  // No messageKey, so they never serialize into the settings blob.
  hints.forEach((h) => assert.equal(h.messageKey, undefined));
});

test('B/W bar-scale hints actually show for bw-light (not just bw) via the show-when evaluator', () => {
  const forecastHint = items.find((i) => i.type === 'staticText' && i.showWhen && i.showWhen.all
    && JSON.stringify(i.showWhen.all).indexOf('barSource') >= 0
    && JSON.stringify(i.showWhen.all).indexOf('"not"') >= 0);
  assert.ok(forecastHint, 'forecast B/W hint item found');
  assert.equal(showWhen.isVisible(forecastHint, { env: { color: true }, theme: 'bw-light', barSource: 'rain' }), true,
    'B/W legend shows for bw-light on a color env');
  assert.equal(showWhen.isVisible(forecastHint, { env: { color: true }, theme: 'dark', barSource: 'rain' }), false,
    'B/W legend hidden for dark on a color env');
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
  // The metric picker carries the hook that clears the stored value on the way in.
  assert.equal(byKey('secondaryLine').onChange, 'forecastMetricFill');
});

test('tomorrow.io key renders under whichever picker uses it: General (weather) or Radar (radar-only)', () => {
  const keys = items.filter((i) => i.messageKey === 'tomorrowioApiKey');
  assert.equal(keys.length, 2, 'one instance per context (mutually exclusive)');
  const whens = keys.map((k) => JSON.stringify(k.showWhen));
  assert.ok(whens.includes(JSON.stringify({ key: 'provider', eq: 'tomorrowio' })),
    'weather-provider instance (General tab)');
  assert.ok(whens.includes(JSON.stringify(
    { all: [{ key: 'radarProvider', eq: 'tomorrowio' }, { key: 'provider', ne: 'tomorrowio' }] })),
    'radar-only instance (Radar tab)');
  keys.forEach((k) => assert.equal(k.suffixAction, 'testTomorrowioKey'));
});

test('provider API-key rows join their picker loosely (grouped, but normal spacing)', () => {
  // The key/budget rows that hang off a provider picker use the roomy join (no divider, but
  // full padding) rather than the tight `true` grouping, so they do not read as cramped.
  ['owmApiKey', 'yandexApiKey', 'tomorrowioApiKey', 'tomorrowioFitBudget', 'rainbowOwnKey', 'rainbowApiKey', 'rainbowFitBudget'].forEach((key) => {
    const instances = items.filter((i) => i.messageKey === key);
    assert.ok(instances.length >= 1, 'missing ' + key);
    instances.forEach((item) => assert.equal(item.joinPrevious, 'loose', key + ' uses the loose join'));
  });
});

test('weather + radar provider dropdowns flag the country-recommended option via recommendFrom', () => {
  assert.equal(byKey('provider').recommendFrom, 'recommendedWeatherProvider');
  assert.equal(byKey('radarProvider').recommendFrom, 'recommendedRadarProvider');
});

test('tomorrow.io key hint offers the API-keys page as a copy button, not a (mobile-404) link', () => {
  const hint = byKey('tomorrowioApiKey').hint;
  // The keys URL is now a tap-to-copy control wired through the engine's [data-copy] handler...
  assert.ok(/data-copy="https:\/\/app\.tomorrow\.io\/development\/keys"/.test(hint),
    'API-keys page URL rides a data-copy button');
  assert.ok(/class="copybtn"/.test(hint), 'the copy control uses the .copybtn chip');
  // ...and is NOT a clickable <a href> anymore (tapping 404s on mobile).
  assert.ok(!/href=['"]https:\/\/app\.tomorrow\.io\/development\/keys/.test(hint),
    'the API-keys page is no longer a link');
  // The signup link stays a normal external link.
  assert.ok(/href=['"]https:\/\/app\.tomorrow\.io\/signup['"]/.test(hint), 'signup stays a link');
});

test('fetchIntervalMin derives its ladder from the budget resolver (no static options)', () => {
  const item = byKey('fetchIntervalMin');
  assert.equal(item.options, undefined);
  assert.deepEqual(item.optionsFrom, { resolver: 'fetchIntervalBudget' });
  assert.equal(item.defaultValue, '15');
});

test('budget toggle (both contexts) carries the info block above it', () => {
  const toggles = items.filter((i) => i.messageKey === 'tomorrowioFitBudget');
  assert.equal(toggles.length, 2, 'General (weather) + Radar (radar-only) instances');
  toggles.forEach((item) => {
    assert.equal(item.defaultValue, true);
    assert.equal(item.label, 'Fit update interval to rate limit');
    // blockBefore: the usage read-out sits between the API key field and the toggle,
    // joined into the same tomorrow.io group.
    assert.equal(item.blockBefore, 'tomorrowioBudget');
    assert.equal(item.block, undefined);
  });
  const whens = toggles.map((t) => JSON.stringify(t.showWhen));
  assert.ok(whens.includes(JSON.stringify({ key: 'provider', eq: 'tomorrowio' })));
  assert.ok(whens.includes(JSON.stringify(
    { all: [{ key: 'radarProvider', eq: 'tomorrowio' }, { key: 'provider', ne: 'tomorrowio' }] })));
});

test('health tab is gated to health-capable platforms, with a 3-state mode radio', () => {
  // aplite has no health sensors (PBL_HEALTH undefined), so the watch compiles
  // the view out entirely — hide the now-inert tab there instead of showing
  // a control that does nothing.
  const healthTab = schema.tabs.find((t) => t.id === 'health');
  assert.ok(healthTab, 'health tab exists');
  assert.deepEqual(healthTab.showWhen, { env: 'health' });
  const mode = byKey('healthMode');
  assert.equal(mode.type, 'radio');
  assert.equal(mode.defaultValue, 'all');
  assert.deepEqual(mode.options.map((o) => o[1]), ['off', 'slot', 'status', 'all']);
  assert.equal(mode.options[1][0], 'Status slots only');
});

test("Health Status Bar slots show only when a dedicated Health view is enabled", () => {
  const env = { env: { health: true } };
  ['statusHealthLeft', 'statusHealthMid', 'statusHealthRight'].forEach((k) => {
    const item = byKey(k);
    assert.equal(showWhen.isVisible(item, Object.assign({ healthMode: 'status' }, env)), true, k + ' visible for status');
    assert.equal(showWhen.isVisible(item, Object.assign({ healthMode: 'all' }, env)), true, k + ' visible for all');
    assert.equal(showWhen.isVisible(item, Object.assign({ healthMode: 'slot' }, env)), false, k + ' hidden for slot');
    assert.equal(showWhen.isVisible(item, Object.assign({ healthMode: 'off' }, env)), false, k + ' hidden for off');
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

test('radar tab is gated to radar-capable platforms', () => {
  // aplite compiles the rain-radar view out (WW_RAIN_RADAR undefined) to reclaim
  // boot heap, so hide the whole tab there instead of showing controls that do
  // nothing — mirrors the health tab.
  const radarTab = schema.tabs.find((t) => t.id === 'radar');
  assert.ok(radarTab, 'radar tab exists');
  assert.deepEqual(radarTab.showWhen, { env: 'radar' });
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
  const radarItems = schema.tabs.find((t) => t.id === 'radar').sections[0].items;
  const idx = radarItems.indexOf(item);
  assert.ok(idx !== -1, 'lives in the Radar tab');
  assert.equal(radarItems[idx - 1].messageKey, 'radarSky',
    'follows the radar appearance settings (colour, sky rows), not mid-provider-config');
  assert.equal(radarItems[idx - 2].messageKey, 'radarColor');
  // End-to-end through the real renderer: the maxlength attribute and the
  // visible default both land on the <input>.
  const eng = require('../src/pkjs/config-ui/lib/engine.js');
  const S = eng.hydrate(schema, {});
  const ENV = platform.computeEnv({ platform: 'basalt' });
  const body = eng.renderBody(schema, 'radar', {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
    openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: ENV }),
  });
  assert.match(body, /data-k="radarNoRainText" value="You(?:'|&#39;|&#x27;|&apos;)re good :\)" placeholder="" maxlength="24"/,
    'the rendered input carries the visible default and the 24 cap');

  // ...and it disappears in the modes with no graph to draw it in.
  ['status', 'countdown', 'off'].forEach((mode) => {
    const S2 = eng.hydrate(schema, {});
    S2.radarMode = mode;
    const html = eng.renderBody(schema, 'radar', {
      S: S2, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
      openEdit: null, selectQuery: '', collapsed: {},
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

test('thirdLine derives options from secondaryLine, excluding it, with Off + default UV', () => {
  const third = byKey('thirdLine');
  assert.equal(third.type, 'select');
  assert.equal(third.defaultValue, 'uv');
  assert.equal(third.optionsFrom.resolver, 'forecastMetric');
  assert.deepEqual(third.optionsFrom.args, { off: true, exclude: ['secondaryLine'] });
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

test('windScale has twelve contextual slots: four line-contexts × three wind units', () => {
  const slots = items.filter((i) => i.messageKey === 'windScale');
  assert.equal(slots.length, 12, 'twelve windScale slots');
  // Leaf conditions only: the fourth-line copies name the other two lines inside
  // {not: …} wrappers, which carry no .key, so each filter matches one context.
  const secondary = slots.filter((s) => s.showWhen.all.some((c) => c.key === 'secondaryLine' && c.in));
  const third = slots.filter((s) => s.showWhen.all.some((c) => c.key === 'thirdLine' && c.in));
  const fourth = slots.filter((s) => s.showWhen.all.some((c) => c.key === 'fourthLine' && c.in));
  assert.equal(secondary.length, 3, 'three secondary-line copies (one per unit)');
  assert.equal(third.length, 3, 'three third-line copies (one per unit)');
  assert.equal(fourth.length, 3, 'three fourth-line copies (one per unit)');
  const midShows = { kph: '50 kph', mph: '31 mph', knots: '27 kn' };
  ['kph', 'mph', 'knots'].forEach((unit) => {
    [secondary, third, fourth].forEach((group) => {
      const copy = group.find((s) => s.showWhen.all.some((c) => c.key === 'windUnits' && c.eq === unit));
      assert.ok(copy, unit + ' copy present in every context');
      assert.ok(copy.hintByValue.mid.indexOf(midShows[unit]) >= 0,
        unit + ' mid hint should show ' + midShows[unit] + '; got: ' + copy.hintByValue.mid);
    });
  });
  slots.forEach((s) => assert.equal(s.messageKey, 'windScale'));
});

test('Units section groups temperature, AQI scale, wind + distance units in the General tab', () => {
  const general = schema.tabs.find((t) => t.id === 'general');
  const unitsSection = general.sections.find((s) => s.title === 'Units');
  assert.ok(unitsSection, 'General tab has a titled "Units" section');
  assert.deepEqual(unitsSection.items.map((i) => i.messageKey).filter(Boolean),
    ['temperatureUnits', 'aqiScale', 'windUnits', 'distanceUnits', 'feelsFormula']);
  // sections[0] is the notices panel (block-only, ahead of the main section); the
  // main section carrying theme/provider/etc. is sections[1].
  const first = general.sections[1];
  assert.ok(!first.items.some((i) => i.messageKey === 'temperatureUnits'), 'temperatureUnits relocated');
  assert.ok(!first.items.some((i) => i.messageKey === 'aqiScale'), 'aqiScale relocated');
  assert.ok(!unitsSection.items.some((i) => i.messageKey === 'aqiSource'), 'aqiSource moved out of Units');
});

test('Provider-settings section leads with Update interval, then weather provider, then AQI provider', () => {
  const general = schema.tabs.find((t) => t.id === 'general');
  const ps = general.sections.find((s) => s.title === 'Provider settings');
  assert.ok(ps, 'General tab has a titled "Provider settings" section');
  const keys = ps.items.map((i) => i.messageKey).filter(Boolean);
  assert.equal(keys[0], 'fetchIntervalMin', 'update interval is the first setting in Provider settings');
  assert.ok(keys.indexOf('fetchIntervalMin') < keys.indexOf('provider'),
    'update interval precedes the weather provider selection');
  assert.ok(keys.indexOf('provider') < keys.indexOf('aqiSource'),
    'weather provider selection comes before the AQI provider selection');
  assert.ok(keys.indexOf('owmApiKey') < keys.indexOf('aqiSource'),
    'the weather-provider block (including its API key field) precedes the AQI provider selection');
  assert.ok(keys.indexOf('yandexApiKey') < keys.indexOf('aqiSource'),
    'the weather-provider block (including the Yandex API key field) precedes the AQI provider selection');
  // The battery saver moved OUT of this section, up into the Nighttime card.
  assert.ok(keys.indexOf('sleepNightEnabled') === -1, 'the battery saver is not in Provider settings');
  const unitsSection = general.sections.find((s) => s.title === 'Units');
  assert.ok(!unitsSection.items.some((i) => i.messageKey === 'aqiSource'), 'aqiSource is not in Units');
});

// The Nighttime card: one home for everything that changes after dark. Each group owns
// its hours outright — there is no card-level window and nothing to follow, so every
// key in the card still means exactly what it meant before the card existed.
const nightSection = () => schema.tabs.find((t) => t.id === 'general').sections
  .find((s) => s.title === 'Nighttime settings');
const basaltEnv = platform.computeEnv({ platform: 'basalt' });
const emeryEnv = platform.computeEnv({ platform: 'emery' });
const visIn = (env) => (item, S) => showWhen.isVisible(item, Object.assign({ env: env }, S));

test('the Nighttime card sits between the top General card and Provider settings', () => {
  const general = schema.tabs.find((t) => t.id === 'general');
  // sections[0] is the block-only notices panel; the top card (theme + location) is [1].
  const topCard = general.sections[1];
  const topKeys = topCard.items.map((i) => i.messageKey).filter(Boolean);
  assert.deepEqual(topKeys, ['theme', 'theme', 'locationMode', 'location', 'gpsCacheMin'],
    'the top card keeps the theme pickers and the location rows, and nothing nightly');
  // Cards only: a sheetOnly section is a dialog body, never drawn on the tab, so it
  // does not count as "between" two cards — the dim colour's sheet sits in the array
  // right below the card whose row opens it.
  const cards = general.sections.filter((s) => !s.sheetOnly);
  const nightIndex = cards.indexOf(nightSection());
  const psIndex = cards.findIndex((s) => s.title === 'Provider settings');
  assert.equal(nightIndex, cards.indexOf(topCard) + 1,
    'Nighttime is the card immediately below the top card');
  assert.equal(psIndex, nightIndex + 1, 'Provider settings follows Nighttime');
});

test('the Nighttime card groups dim backlight, theme switching and the battery saver, in that order', () => {
  // The dim colour's row maps to '>' + its sheetId, since a `sheet` row stores nothing
  // of its own — the rgb key it opens lives in the sheetOnly section below the card (see
  // test/config-night-color-sheet.test.js). Anything else without a key (a sub-header)
  // would show up as '#<text>'.
  // Each group is its switch, then its own hours: no card-level window heads the card
  // and only theme switching carries a mode row, because only it has a non-clock
  // alternative (the sun) to choose.
  assert.deepEqual(nightSection().items.map(
    (i) => i.messageKey || (i.sheetId ? '>' + i.sheetId : '#' + i.text)), [
    'backlightDim', 'backlightDimStartHour', 'backlightDimEndHour', '>backlightColor',
    'themeAuto', 'themeNight', 'themeNight', 'themeAutoMode',
    'themeAutoStartHour', 'themeAutoEndHour',
    'sleepNightEnabled', 'sleepStartHour', 'sleepEndHour'
  ]);
});

// The defect this restructure exists to prevent: a mode key whose runtime reader was
// never written silently disabled the feature the user had just configured. The card now
// offers exactly ONE mode key, and it is the one that predates this work.
test('themeAutoMode is the only mode key left in the Nighttime card', () => {
  const modes = nightSection().items.filter((i) => i.type === 'segmented');
  assert.deepEqual(modes.map((i) => i.messageKey), ['themeAutoMode']);
  ['sleepNightMode', 'sleepNightStartHour', 'sleepNightEndHour', 'backlightDimMode']
    .forEach((k) => assert.equal(byKey(k), undefined, k + ' is gone from the schema'));
});

// Each group opens on its own switch: a plain toggle row whose hint carries the group's
// copy — label, hint under it, switch beside it, like every other toggle row on the
// General tab. No sub-header heads a group: the heading + intro shape belongs to the
// threshold sheets, and its taller standoffs step a card out of the tab's row rhythm
// (the v1.18 regression the rhythm test below pins shut).
const GROUP_KEYS = ['backlightDim', 'themeAuto', 'sleepNightEnabled'];
test('each Nighttime group opens on its own switch row, which carries the copy', () => {
  const night = nightSection();
  assert.ok(!night.items.some((i) => i.type === 'subheader'), 'no sub-header in the Nighttime card');
  GROUP_KEYS.forEach((k) => {
    const toggle = byKey(k);
    assert.ok(night.items.indexOf(toggle) !== -1, k + ' lives in the Nighttime card');
    assert.equal(toggle.type, 'toggle', k + ' is the group\'s switch');
    assert.ok(toggle.hint, k + ' explains its group in its own hint');
  });
});

// --- the card's divider rule (owner review of the rendered page) ---
// BETWEEN groups: a line, there whether or not the group above it expanded. WITHIN a
// group: none — the rows a switch reveals belong to that switch (joinPrevious) and read
// as one block. These tests drive the real renderer to check it: every line in the card
// sits directly above a group's switch row, and every group but the first has one.
// Rendered, not read off the schema: which row draws a divider depends on what is
// actually VISIBLE, which no amount of schema-reading would show.
//
// A group OPENER is the row holding one of the GROUP_KEYS switches (found by its
// data-k), so the outline names each group without relying on how the row is classed.
const OPENER_RE = new RegExp('data-k="(?:' + GROUP_KEYS.join('|') + ')"');
const nightOutline = (state, env) => {
  const eng = require('../src/pkjs/config-ui/lib/engine.js');
  const S = Object.assign(eng.hydrate(schema, {}), state || {});
  const ENV = env || emeryEnv;
  const body = eng.renderBody(schema, 'general', {
    S: S, ENV: ENV, USERDATA: {}, openColor: null, openSelect: null,
    openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env: ENV }),
  });
  // The Nighttime card only: from its header to wherever the next card starts.
  const at = body.indexOf('>Nighttime settings<');
  const card = body.slice(at, (body.indexOf('<div class="card', at) + 1) || undefined);
  // Its chrome elements in order — rows, sub-headers, intros and blocks — as "<class>",
  // or "<class>:<title>" for a group opener (its .lbl), ignoring everything nested inside
  // them. ` wrap` is dropped: it only says the hint is long enough to wrap under the
  // label, which is copy, not a join or a line.
  const out = [];
  const re = /<div class="((?:row|static|subhdr|intro|blockrow)(?:\s[^"]*)?)"/g;
  let m;
  while ((m = re.exec(card))) {
    const own = card.slice(m.index + 1).split('<div class="row')[0];
    const lbl = OPENER_RE.test(own) && /class="lbl">([^<]*)</.exec(own);
    out.push(m[1].replace(/ wrap\b/, '') + (lbl ? ':' + lbl[1] : ''));
  }
  return out;
};
// An outline entry's class list, without the ":<title>" a group opener carries.
const clsOf = (entry) => entry.split(':')[0];
const titleOf = (entry) => entry.slice(entry.indexOf(':') + 1);
const isGroupOpener = (entry) => entry.indexOf(':') !== -1;
// A row with neither join class keeps its bottom border: it draws a line.
const drawsLine = (entry) => /^row\b/.test(entry) && !/\bnbl?\b/.test(clsOf(entry));
// Dim backlight and the battery saver have no mode row left, so their hours are on
// screen whenever their switch is: the only state left to vary is theme switching's
// mode, which is the one place a non-clock alternative still has to be chosen.
const NIGHT_STATES = {
  'everything off': { backlightDim: false, themeAuto: false, sleepNightEnabled: false },
  'defaults': {},
  'everything on': { backlightDim: true, themeAuto: true, sleepNightEnabled: true },
  'everything on, theme on custom hours': { backlightDim: true,
    themeAuto: true, themeAutoMode: 'manual', sleepNightEnabled: true },
};

test('Nighttime: every line in the card introduces a group, in every expansion state', () => {
  Object.keys(NIGHT_STATES).forEach((name) => {
    const outline = nightOutline(NIGHT_STATES[name]);
    assert.deepEqual(outline.filter(isGroupOpener).map(titleOf),
      ['Dim backlight', 'Theme switching', 'Battery saver'], name + ': three groups');
    // A row that keeps its divider (no nb/nbl) either ENDS the card — whose divider
    // .card .row:last-child removes anyway — or sits directly above a group's switch
    // row, where its line separates the two groups. So no line falls inside a group...
    outline.forEach((entry, i) => {
      if (!drawsLine(entry)) { return; }
      assert.ok(i === outline.length - 1 || isGroupOpener(outline[i + 1]),
        name + ': element ' + i + ' ("' + entry + '") draws a line inside a group');
    });
    // ...and every group but the first has one above it.
    outline.filter(isGroupOpener).slice(1).forEach((opener) => {
      const i = outline.indexOf(opener);
      assert.ok(drawsLine(outline[i - 1]),
        name + ': "' + outline[i - 1] + '" draws no line above ' + titleOf(opener));
    });
  });
});

test('Nighttime: a group is separated from the one above even when it is collapsed', () => {
  // The regression this rule exists for: with its switch off a group renders NOTHING
  // but its switch row, and a join from the group below must not take that row's line
  // away — or the two groups run together. Each collapsed switch row keeps its own
  // divider, and that divider is the line into the next group.
  const outline = nightOutline(NIGHT_STATES['everything off']);
  assert.deepEqual(outline, [
    'row:Dim backlight',
    'row:Theme switching',
    'row:Battery saver',
  ], 'three collapsed groups back to back, each only its switch row, each drawing its line');

  // ...and with every switch on, each group's rows sit between its own switch row and
  // the next one, joined tight, so the group reads as one block under its switch. Dim
  // backlight and the battery saver open straight onto their From/To pair — no mode row
  // stands between the switch and the hours it governs. Each switch row is `nb` (tight):
  // the first row it reveals joins it, as the saver's From/To always has. Only a group's
  // LAST row keeps its divider, and that is the line into the next group.
  assert.deepEqual(nightOutline(NIGHT_STATES['everything on, theme on custom hours']), [
    // The colour is one compact row — a swatch of the current value plus Edit — since
    // its three channel sliders moved into a bottom sheet. It joins the From/To above it
    // tight, matching the theme group's seams below, so the card steps evenly (see the
    // spacing test).
    'row nb:Dim backlight', 'row inline nb', 'row',
    'row nb:Theme switching', 'row nb', 'row nb', 'row inline',
    'row nb:Battery saver', 'row inline',
  ]);
});

test('Nighttime: a group the watch cannot offer takes its line with it', () => {
  // basalt has a colour screen but a white backlight, so the whole Dim backlight group
  // is gated away — switch and rows. The card simply opens on THEME switching, with no
  // stray line or empty row left where the dim group used to be.
  assert.deepEqual(nightOutline({}, basaltEnv), [
    'row:Theme switching',
    'row nb:Battery saver', 'row inline',
  ]);
});

// --- the card's SPACING rule (owner review of the rendered page) ---
// Dropping the divider is only half of "one block": the rows also have to step evenly.
// The engine has two join flavours and they space differently — a TIGHT join
// (joinPrevious: true) pulls 5px off each side of the seam via .row.nb / .row.nb + .row,
// a LOOSE one (joinPrevious: 'loose') drops only the line and leaves the standard 14px —
// so a group mixing them renders one gap at 10px and the next at 28px. That was the
// report: "Enabled hours, from and the color are not evenly spaced". Every join INSIDE a
// Nighttime group is tight — the switch row's own seam to the first row it reveals
// included — so the whole card keeps one rhythm.
//
// The two numbers are read out of shell.html rather than written here: change the CSS and
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

test('Nighttime: consecutive rows inside a group are evenly spaced, in every expansion state', () => {
  assert.notEqual(TIGHT_GAP, LOOSE_GAP, 'the two join flavours really do space differently');
  const seen = [];
  Object.keys(NIGHT_STATES).forEach((name) => {
    const outline = nightOutline(NIGHT_STATES[name]);
    // .row.slot would bring a third padding (8px) into the card and break the two-number
    // model above; nothing in this card uses it.
    outline.forEach((cls) => assert.ok(!/\bslot\b/.test(cls), name + ': no compact slot rows here'));
    // Split into groups at the switch rows; inside a group, measure every row-to-row seam,
    // starting with the switch row's own seam to the first row it reveals.
    let group = null;
    outline.forEach((entry, i) => {
      if (!/^row/.test(entry)) { return; }
      if (isGroupOpener(entry)) { group = titleOf(entry); }
      const next = outline[i + 1];
      // last row of its group: the card ends, or the next group's switch row follows
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
    + TIGHT_GAP + 'px — every join inside a Nighttime group is tight'));
});

// --- the card's RHYTHM against the rest of the General tab (the v1.18 regression) ---
// Even steps inside a group are not enough: the card also has to step like the cards
// around it. v1.18 opened every group with the threshold sheets' heading + intro chrome,
// whose own standoffs knocked every seam touching them off the tab's row rhythm. The
// invariant: the card is rows only, so every seam is a row seam sized by the same .row
// paddings as the rest of the tab (ROW_PAD / NB_*, read from shell.html above) — tight
// inside a group, one plain row divider between groups.
test('Nighttime: the card steps in the General tab\'s row rhythm, on every watch and in every state', () => {
  // Every platform, not a sample: the Night theme row has a colour copy and a B/W one
  // (diorite/flint), and only rendering both pins each copy's own join.
  const envs = {};
  ['aplite', 'basalt', 'chalk', 'diorite', 'emery', 'flint', 'gabbro'].forEach((p) => {
    envs[p] = platform.computeEnv({ platform: p });
  });
  let seams = 0;
  Object.keys(envs).forEach((envName) => {
    Object.keys(NIGHT_STATES).forEach((state) => {
      const name = envName + ' / ' + state;
      const outline = nightOutline(NIGHT_STATES[state], envs[envName]);
      // Rows only: no heading bar and no intro block anywhere in the card.
      outline.forEach((e) => assert.match(e, /^row\b/, name + ': "' + e + '" is not a row'));
      // It opens on a group's switch row, so the card title stands off it by one
      // ROW_PAD, like every other card's first row.
      assert.ok(isGroupOpener(outline[0]), name + ': the card opens on its first group\'s switch row');
      for (let i = 1; i < outline.length; i++) {
        const above = clsOf(outline[i - 1]);
        seams++;
        if (isGroupOpener(outline[i])) {
          // Into the next group: ROW_PAD, the row above's own 1px divider, ROW_PAD —
          // exactly two unjoined rows, like any other divider on the tab.
          assert.doesNotMatch(above, /\bnbl?\b/,
            name + ': "' + above + '" must draw the line into the group below');
          assert.equal(rowGap(above), LOOSE_GAP, name + ': groups sit a divider apart');
        } else {
          assert.equal(rowGap(above), TIGHT_GAP, name + ': "' + above + '" -> "' + outline[i]
            + '" steps ' + rowGap(above) + 'px, not a tight join\'s ' + TIGHT_GAP + 'px');
        }
      }
    });
  });
  assert.ok(seams >= 20, 'the watches and states above really do exercise the card\'s seams');
});

// There is no card-level window any more: nothing sits above the first group, and no
// item in the card is reachable without going through a group's switch.
test('the Nighttime card opens straight on its first group, with no shared window above it', () => {
  const night = nightSection();
  assert.equal(night.intro, undefined, 'the card carries no intro of its own');
  assert.equal(night.items[0].messageKey, 'backlightDim', 'the first group\'s switch heads the card');
  assert.ok(!night.items.some((i) => i.type === 'subheader'),
    'no sub-header in the card — nothing introduces a shared window');
  // No user-facing string in the card offers the removed shared window as a choice.
  assert.equal(JSON.stringify(night).indexOf('Night hours'), -1,
    'the phrase "Night hours" is gone from the Nighttime card');
});

// The saver no longer only stops weather FETCHES: with the phone-battery slot it also
// suppresses the status micro-send (level changes and charging transitions alike), so
// the copy has to describe sending rather than fetching or it under-promises what the
// toggle now turns off. The wording was dictated by the design
// (docs/superpowers/specs/2026-08-20-phone-battery-slot-design.md §3), not derived. It
// is the toggle's hint, and says "between the hours below" because the saver's own
// From/To sits right under it.
//
// sleepStartHour/sleepEndHour are the saver's original keys and never meant anything
// else: same keys, same options, same defaults, same gate. Nothing stored on any install
// changes meaning, so the restructure needs no migration.
test('the battery saver owns its hours outright and still talks about SENDING', () => {
  const on = byKey('sleepNightEnabled');
  assert.equal(on.label, 'Battery saver', 'the word "Night" moved up to the card title');
  assert.equal(on.defaultValue, true);
  assert.equal(on.hint,
    'Stop sending updates to your watch between the hours below to save battery.');

  const from = byKey('sleepStartHour'), to = byKey('sleepEndHour');
  assert.equal(from.label, 'From');
  assert.equal(to.label, 'To');
  assert.equal(from.defaultValue, '0', 'unchanged — no install moves its window');
  assert.equal(to.defaultValue, '7');
  assert.equal(from.options.length, 24, 'the shared HOURS ladder');
  assert.equal(from.inline, to.inline, 'rendered as one From/To row');
  // Gated on the saver alone, exactly as before the card existed: no mode row stands
  // between the switch and the hours.
  assert.deepEqual(from.showWhen, { key: 'sleepNightEnabled', eq: true });
  assert.deepEqual(to.showWhen, { key: 'sleepNightEnabled', eq: true });

  const vis = visIn(basaltEnv);
  assert.equal(vis(from, { sleepNightEnabled: false }), false, 'the hours follow the switch');
  assert.equal(vis(from, { sleepNightEnabled: true }), true);
  assert.equal(vis(to, { sleepNightEnabled: true }), true);
});

test('Dim backlight is emery-only, on by default, and carries a dim-red RGB colour', () => {
  const on = byKey('backlightDim');
  assert.equal(on.type, 'toggle');
  assert.equal(on.defaultValue, true);
  // The LED fact, NOT capabilities:['COLOR'] — that one means "colour screen" and is
  // true on basalt/chalk, which have a plain white backlight.
  assert.deepEqual(on.showWhen, { env: 'colorBacklight' });
  assert.equal(on.capabilities, undefined);

  // The dim window is the feature's ONLY window now — there is nothing left to fall
  // back to, so the pair renders straight under the switch. 0–7 stands: it is the
  // stretch where a full-brightness backlight actually hurts, and it is also
  // night-light.js's own fallback, so a never-configured install and the page agree.
  const from = byKey('backlightDimStartHour'), to = byKey('backlightDimEndHour');
  assert.equal(from.defaultValue, '0');
  assert.equal(to.defaultValue, '7');
  assert.equal(from.label, 'From');
  assert.equal(to.label, 'To');
  assert.equal(from.inline, to.inline, 'rendered as one From/To row');
  assert.equal(from.options.length, 24, 'the shared HOURS ladder');

  // The colour keeps its key, its "r,g,b" format and its default — only its SURFACE
  // moved: the sliders live in a bottom sheet now, gated by that section rather than
  // by the item (test/config-night-color-sheet.test.js owns the surface itself).
  const colour = byKey('backlightDimColor');
  assert.equal(colour.type, 'rgb', 'three channel sliders storing one "r,g,b" string');
  assert.equal(colour.defaultValue, '40,10,0', 'a dim red: the driver scales each channel by the watch brightness');

  const BACKLIGHT_KEYS = ['backlightDim', 'backlightDimStartHour', 'backlightDimEndHour'];
  const on_ = { backlightDim: true };
  BACKLIGHT_KEYS.forEach((k) => {
    assert.equal(visIn(emeryEnv)(byKey(k), on_), true, k + ' shows on emery');
    assert.equal(visIn(basaltEnv)(byKey(k), on_), false,
      k + ' hides on a colour screen with a white backlight');
  });
  const vis = visIn(emeryEnv);
  assert.equal(vis(from, { backlightDim: true }), true, 'switched on, the hours are right there');
  assert.equal(vis(to, { backlightDim: true }), true);
  assert.equal(vis(from, { backlightDim: false }), false,
    'switched off, only the switch row is left');
  assert.equal(vis(to, { backlightDim: false }), false);
});

// Decision: `theme` doubles as the day theme and the page never names it that way — a
// row the user sees renamed behind their back is worse than no name at all.
test('no user-facing string anywhere in the schema says "Day theme"', () => {
  assert.equal(JSON.stringify(schema).toLowerCase().indexOf('day theme'), -1,
    'the phrase "Day theme" is back in the settings copy');
});

test('windUnits is a segmented kph/mph/Knots picker defaulting to kph', () => {
  const w = byKey('windUnits');
  assert.equal(w.type, 'segmented');
  assert.equal(w.defaultValue, 'kph');
  assert.deepEqual(w.options, [['kph', 'kph'], ['mph', 'mph'], ['Knots', 'knots']]);
});

test('distanceUnits is a segmented Kilometres/Miles picker defaulting to metric', () => {
  const d = byKey('distanceUnits');
  assert.equal(d.type, 'segmented');
  assert.equal(d.defaultValue, 'metric');
  assert.deepEqual(d.options, [['Kilometres', 'metric'], ['Miles', 'imperial']]);
});

// The feels-like formula is a global Units pick (phone-side only: feels-like.js resolves
// it, no wire bytes). Its per-option hint is the user's only explanation of WHY the two
// differ: Provider is the service's own value (flat in mild weather on some services),
// Steadman is one formula everywhere.
test('feelsFormula is a segmented Provider/Steadman picker defaulting to provider, with a hint per option', () => {
  const f = byKey('feelsFormula');
  assert.equal(f.type, 'segmented');
  assert.equal(f.defaultValue, 'provider');
  assert.deepEqual(f.options, [['Provider', 'provider'], ['Steadman', 'steadman']]);
  assert.equal(f.hint, undefined, 'no single static hint — hintByValue drives the explanation instead');
  assert.deepEqual(Object.keys(f.hintByValue).sort(), ['provider', 'steadman'], 'one hint per option');
  assert.match(f.hintByValue.provider, /weather service reports/, 'says Provider is the service\'s own value');
  assert.match(f.hintByValue.provider, /mild weather/, 'explains the mild-weather gap that prompted the setting');
  assert.match(f.hintByValue.provider, /Steadman/, 'names the Steadman fallback for services without a value');
  assert.match(f.hintByValue.steadman, /humidity/, 'says what Steadman is computed from');
  assert.match(f.hintByValue.steadman, /every provider/, 'says Steadman is the same on every provider');
});

test('holiday country selector: searchSelect, default DE, None first, includes US/Sweden', () => {
  const c = byKey('holidayCountry');
  assert.equal(c.type, 'searchSelect');
  assert.equal(c.defaultValue, 'DE');
  assert.equal(c.options[0][1], 'none', "first option must be 'none'");
  const values = c.options.map((o) => o[1]);
  assert.ok(values.indexOf('SE') >= 0, 'Sweden (SE) missing');
  assert.ok(values.indexOf('US') >= 0, 'US missing');
  assert.equal(byKey('colorUSFederal').label, 'Holiday color');
});

test('holiday highlight toggle is the on/off switch; color picker excludes white', () => {
  const toggle = byKey('holidaysEnabled');
  assert.equal(toggle.type, 'toggle');
  assert.equal(toggle.label, 'Holiday highlight');
  assert.equal(toggle.defaultValue, true);
  // White is no longer an "off" flag, so it must not be selectable as a holiday color.
  const color = byKey('colorUSFederal');
  assert.ok(Array.isArray(color.excludeColors), 'colorUSFederal must declare excludeColors');
  assert.ok(color.excludeColors.indexOf('#FFFFFF') >= 0, 'white must be excluded from the holiday palette');
});

test('holiday region: one dynamic searchSelect keyed by country, gated to region countries + holidays', () => {
  const r = byKey('holidayRegion');
  assert.ok(r, 'missing holidayRegion');
  assert.equal(r.type, 'searchSelect');
  assert.equal(r.defaultValue, 'all');
  assert.equal(r.options, undefined, 'options must be derived, not static');
  assert.equal(r.optionsFrom.byKey, 'holidayCountry');
  assert.equal(r.optionsFrom.map, REGION_OPTIONS, 'map is the REGION_OPTIONS object');
  assert.deepEqual(r.showWhen, { all: [
    { key: 'holidayCountry', in: Object.keys(REGION_OPTIONS) },
    { key: 'holidaysEnabled', eq: true }
  ] });
});

test('gpsCacheMin: select, default 30, interval-derived options, GPS-only', () => {
  const g = byKey('gpsCacheMin');
  assert.equal(g.type, 'select');
  assert.equal(g.defaultValue, '30');
  assert.equal(g.options, undefined, 'options must be derived, not static');
  assert.deepEqual(g.optionsFrom, { interval: 'fetchIntervalMin', ladder: [30, 60, 120, 360, 720, 1440] });
  assert.deepEqual(g.showWhen, { key: 'locationMode', eq: 'gps' });
});

test('forecast line pickers use the new metric-oriented labels', () => {
  assert.equal(byKey('secondaryLine').label, 'Main metric');
  assert.equal(byKey('thirdLine').label, 'Second metric');
  assert.equal(byKey('secondaryLineFill').label, 'Fill area below the line');
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

// --- The forecast line hints (blocks.js 'forecastMetricHint' / 'lineStyleHint') ---
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
  precip_prob: 'Half height = 50% chance of rain, full height = 100%.',
  cloud: 'Half height = half the sky covered, full height = overcast.',
  wind: 'Scaled by the Wind graph scale setting.',
  gust: 'Scaled by the Wind graph scale setting.',
  uv: 'Half height = UV 5.5, full height = UV 11 (extreme).',
  pressure: 'Sea-level pressure, scaled by the pressure graph scale below.',
  feels: 'Drawn on the same scale as the temperature curve.',
  dew: 'Drawn on the same scale as the temperature curve.'
};
const STRIPE = {
  precip_prob: 'Half-strength colour = 50% chance of rain, full colour = 100%.',
  cloud: 'Half-strength colour = half the sky covered, full colour = overcast.',
  wind: 'Colour strength follows the Wind graph scale setting.',
  gust: 'Colour strength follows the Wind graph scale setting.',
  uv: 'Half-strength colour = UV 5.5, full colour = UV 11 (extreme).'
};
const NOTE = {
  cloud: 'Not available with Yandex.',
  gust: 'The hourly peak.',
  dew: 'The closer it runs to the temperature, the more humid it feels.'
};

test('metric pickers: a derived hint, one resolver for all four', () => {
  LINE_KEYS.forEach((key) => {
    assert.deepEqual(byKey(key).hintFrom, { resolver: 'forecastMetricHint' }, key);
    assert.equal(byKey(key).hintByValue, undefined, key + ' carries no static per-metric copy');
  });
});

test('metric pickers keep only the notes that hold whatever the style', () => {
  const expected = {
    precip_prob: '', cloud: 'Not available with Yandex.', wind: '', gust: 'The hourly peak.', uv: '',
    pressure: '', feels: '', dew: 'The closer it runs to the temperature, the more humid it feels.', off: ''
  };
  LINE_KEYS.forEach((key) => {
    Object.keys(expected).forEach((m) => {
      if (key === 'secondaryLine' && m === 'off') { return; }
      assert.equal(hintOf(key, { [key]: m }, STYLED_ENV), expected[m], key + '.' + m);
    });
  });
});

test('without style pickers (aplite) the metric picker keeps the height scale after its note', () => {
  const expected = {
    precip_prob: 'Half height = 50% chance of rain, full height = 100%.',
    cloud: 'Not available with Yandex. Half height = half the sky covered, full height = overcast.',
    wind: 'Scaled by the Wind graph scale setting.',
    gust: 'The hourly peak. Scaled by the Wind graph scale setting.',
    uv: 'Half height = UV 5.5, full height = UV 11 (extreme).',
    pressure: 'Sea-level pressure, scaled by the pressure graph scale below.',
    feels: 'Drawn on the same scale as the temperature curve.',
    dew: 'The closer it runs to the temperature, the more humid it feels. '
      + 'Drawn on the same scale as the temperature curve.'
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
  assert.deepEqual(Object.keys(require('../src/pkjs/settings/blocks.js').STRIPE_SCALE).sort(),
    lineStyle.STRIPE_METRIC_IDS.slice().sort(), 'blocks.js STRIPE_SCALE keys = STRIPE_METRIC_IDS');
  const expected = (m, st) => {
    if (st === 'line' || st === 'bold') { return HEIGHT[m]; }
    if (st === 'dots' || st === 'x') { return HEIGHT[m] + ' Aligned to the rain bars.'; }
    return STRIPE[m] + ' One cell per hour.'
      + (st === 'stripeBottom' ? ' Below the zero line, where bars and lines never cover it.' : '');
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
  assert.equal(hintOf('secondaryLineStyle', S, STYLED_ENV), 'Half-strength colour = 50% chance of rain, '
    + 'full colour = 100%. One cell per hour. Below the zero line, where bars and lines never cover it.');
  assert.equal(hintOf('secondaryLineStyle', { secondaryLine: 'uv', secondaryLineStyle: 'x' }, STYLED_ENV),
    'Half height = UV 5.5, full height = UV 11 (extreme). Aligned to the rain bars.');
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
    .includes('Sea-level'));
});

test('forecast tab nests style, fill and wind scale under the line that enables them', () => {
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
  assert.equal(windIdxs.length, 12, 'twelve wind-scale slots (4 contexts × 3 units)');
  assert.ok(windIdxs.slice(0, 3).every((i) => i > iFill && i < iThird),
    'secondary-line wind-scale copies sit under the solid line');
  assert.ok(windIdxs.slice(3, 6).every((i) => i > iThird && i < iFourth),
    'third-line wind-scale copies sit under the second metric');
  assert.ok(windIdxs.slice(6, 9).every((i) => i > iFourth && i < iFifth),
    'fourth-line wind-scale copies sit under the third metric');
  assert.ok(windIdxs.slice(9).every((i) => i > iFifth),
    'fifth-line wind-scale copies sit under the fourth metric');
});

test('startOnWeatherTab is a page-only toggle that defaults to General', () => {
  const item = byKey('startOnWeatherTab');
  assert.equal(item.type, 'toggle');
  assert.equal(item.defaultValue, false, 'General stays the opening tab out of the box');
  assert.ok(item.label && item.hint, 'it is a user-facing setting, labelled and explained');
  // Display-only, like the rest of the Weather tab: it picks a tab in the
  // settings page and is never read by the watch-side JS, so no payload
  // builder may so much as mention it.
  const fs = require('node:fs');
  const path = require('node:path');
  const pkjs = path.join(__dirname, '..', 'src', 'pkjs');
  const watchSide = fs.readdirSync(pkjs).filter((f) => f.slice(-3) === '.js');
  // Phone-side support for the settings page itself, which may read the page's own
  // keys: weather-tab-cache.js keeps the Weather tab's data only while the tab is in
  // use. It must never reach the watch — no AppMessage, no outbox.
  const PAGE_SUPPORT = ['weather-tab-cache.js'];
  PAGE_SUPPORT.forEach((f) => {
    const src = fs.readFileSync(path.join(pkjs, f), 'utf8');
    assert.ok(!/sendAppMessage|outbox|clay-payload/.test(src), f + ' must not talk to the watch');
  });
  watchSide.filter((f) => PAGE_SUPPORT.indexOf(f) === -1).forEach((f) => {
    const src = fs.readFileSync(path.join(pkjs, f), 'utf8');
    assert.equal(src.indexOf('startOnWeatherTab'), -1,
      'watch-side ' + f + ' must not read a page-only key');
  });
  // Guard the guard: the scan really does cover the payload builder, and
  // that builder really does carry watch settings.
  assert.ok(watchSide.indexOf('clay-payload.js') !== -1, 'the scan includes the Clay payload builder');
  assert.ok(fs.readFileSync(path.join(pkjs, 'clay-payload.js'), 'utf8').indexOf('settings.btIcons') !== -1,
    'and a key the watch DOES receive shows up in it');
});

test('onboardingDone is a hidden key and a startWizard button exists', () => {
  assert.equal(byKey('onboardingDone').type, 'hidden');
  assert.ok(items.some((it) => it.type === 'button' && it.action === 'startWizard'));
});

test('non-holiday selects stay plain select', () => {
  assert.equal(byKey('fetchIntervalMin').type, 'select');
  assert.equal(byKey('btIcons').type, 'select');
});

test('rainCountdownHorizon is a radarMode- and non-aplite-gated select with 30/60/120 and default 60 (no Off — the radarMode tier owns on/off)', () => {
  const it = byKey('rainCountdownHorizon');
  assert.equal(it.type, 'select');
  assert.equal(it.defaultValue, '60');
  assert.deepEqual(it.options.map((o) => o[1]), ['30', '60', '120']);
  // Shown only when radar isn't off AND not on aplite (feature-frozen there).
  assert.deepEqual(it.showWhen, {
    all: [{ key: 'radarMode', ne: 'off' }, { env: 'platform', ne: 'aplite' }],
  });
});

test('layoutPreset offers the four adaptive presets', () => {
  const t = byKey('layoutPreset');
  assert.ok(t, 'layoutPreset item exists');
  assert.equal(t.type, 'radio');
  assert.equal(t.defaultValue, 'compactCal');
  // Options derive from the layoutPresetOptions resolver (registered in blocks.js): Compact-dense
  // is hidden unless health OR radar shows a status row (it only differs from Compact then),
  // present otherwise. Order stays constant so toggling health/radar doesn't reshuffle the list.
  assert.equal(t.options, undefined, 'options must be derived, not static');
  assert.deepEqual(t.optionsFrom, { resolver: 'layoutPresetOptions' });
  const resolver = global.PConf.optionsResolvers.get(t.optionsFrom.resolver);
  assert.equal(typeof resolver, 'function', 'layoutPresetOptions resolver registered');
  const codes = (S) => resolver(S).map((o) => o[1]);
  assert.deepEqual(codes({ healthMode: 'off', radarMode: 'off' }), ['fullCal', 'compactCal', 'noCal', 'weatherOnly', 'custom']);
  assert.deepEqual(codes({ healthMode: 'status', radarMode: 'off' }), ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly', 'custom']);
  assert.deepEqual(codes({ healthMode: 'all', radarMode: 'off' }), ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly', 'custom']);
  // Weather only sits right after No calendar; aplite (no radar, no view without top
  // bar) never offers it, and a stored one lies dormant there.
  assert.deepEqual(resolver({ healthMode: 'off', radarMode: 'off' }, { platform: 'aplite' }).map((o) => o[1]),
    ['fullCal', 'compactCal', 'noCal']);
  assert.ok(t.dormantValues.indexOf('weatherOnly') >= 0);
  assert.ok(t.hintByValue.weatherOnly, 'Weather only has a hint');
  // compactDense must be reachable from radar alone — even with health off — since the
  // radar-status row also warrants the dense fold (bug #1/#2 fix; Task 9's whole point).
  assert.ok(codes({ healthMode: 'off', radarMode: 'status' }).indexOf('compactDense') >= 0,
    'compactDense offered for radarMode=status even with health off');
  // Lives in the Layout tab, with a sticky combined preview block above it.
  const layout = schema.tabs.find((tab) => tab.id === 'layout');
  assert.ok(layout, 'layout tab exists');
  const section = layout.sections.find((s) => s.items.some((i) => i.messageKey === 'layoutPreset'));
  assert.ok(section, 'in a Layout tab section');
  assert.equal(t.blockBefore, 'layoutPreviewCombined');
  assert.equal(t.blockBeforeSticky, true);
  // No longer lives in the More tab's Misc section.
  const more = schema.tabs.find((tab) => tab.id === 'more');
  const misc = more.sections.find((s) => s.title === 'Misc');
  assert.ok(!misc.items.some((i) => i.messageKey === 'layoutPreset'), 'not in the Misc section');
  // The preset now owns the 3-row-calendar decision, so "First week to display" is
  // always shown (it only matters for the fullCal preset, which is acceptable to
  // always expose rather than re-deriving preset membership here).
  assert.equal(byKey('firstWeek').showWhen, undefined);
});

// A hidden compactDense must lie DORMANT, not be migrated away: rendering the Layout tab
// while neither health nor radar shows a status row displays the compactCal fallback but
// leaves the stored choice untouched, so briefly disabling health+radar and saving does
// not lose the dense preset — it comes back when a status row re-enables it. (The wire
// compiles stored-dense-with-nothing-enabled to the identical compactCal cycle, swap
// included, so the watch always matches what the radio shows — pinned in the swap test
// below.) A truly invalid value still hard-snaps.
test('hidden compactDense renders the compactCal fallback but stays in state', () => {
  const eng = require('../src/pkjs/config-ui/lib/engine.js');
  const ENV = platform.computeEnv({ platform: 'basalt' });
  const cx = (S) => ({ S, ENV, USERDATA: {}, evalCtx: Object.assign({}, S, { env: ENV }) });

  const S = eng.hydrate(schema, {});
  S.layoutPreset = 'compactDense';
  S.healthMode = 'off';
  S.radarMode = 'off';   // dense hidden in this mode
  const html = eng.renderBody(schema, 'layout', cx(S));
  assert.equal(S.layoutPreset, 'compactDense', 'stored dense choice survives the render');
  assert.match(html, /class="on" data-k="layoutPreset" data-v="compactCal"/,
    'the radio shows compactCal selected as the display fallback');

  // The generic lockstep rule is untouched: an unknown value still snaps into state.
  S.layoutPreset = 'bogus';
  eng.renderBody(schema, 'layout', cx(S));
  assert.equal(S.layoutPreset, 'compactCal', 'invalid values still hard-snap');
});

test('viewResetMin is hidden on aplite and carries its explanation as its own hint', () => {
  const layout = schema.tabs.find((t) => t.id === 'layout');
  const layoutItems = layout.sections[0].items;
  const reset = layoutItems.find((i) => i.messageKey === 'viewResetMin');
  const nonAplite = { env: platform.computeEnv({ platform: 'basalt' }) };
  const aplite = { env: platform.computeEnv({ platform: 'aplite' }) };

  assert.equal(reset.type, 'segmented');
  assert.equal(reset.defaultValue, '2');
  assert.deepEqual(reset.options.map((o) => o[1]), ['0', '1', '2', '5', '10']);
  assert.deepEqual(reset.showWhen, { env: 'platform', ne: 'aplite' });
  assert.match(reset.hint, /return to the default view/);
  assert.equal(showWhen.isVisible(reset, nonAplite), true);
  assert.equal(showWhen.isVisible(reset, aplite), false);
});

test('swapClockStatus toggle exists, defaults ON, and is shown for compactCal on all platforms', () => {
  const it = byKey('swapClockStatus');
  assert.ok(it, 'swapClockStatus item exists');
  assert.equal(it.type, 'toggle');
  // A fresh install gets the swapped Compact layout: the status row reads better beside
  // the forecast than above the clock. Existing installs already store an explicit value,
  // so this only ever moves a NEW install (deliberately no migration).
  assert.equal(it.defaultValue, true);
  assert.match(it.hint, /status row below the clock/);
  // aplite supports the forecast-only swap too (its lean twin carries a single lower band), so
  // the toggle is offered on every platform for the compactCal preset — and hidden otherwise.
  const aplite = { env: platform.computeEnv({ platform: 'aplite' }), layoutPreset: 'compactCal' };
  const basalt = { env: platform.computeEnv({ platform: 'basalt' }), layoutPreset: 'compactCal' };
  const basaltOtherPreset = { env: platform.computeEnv({ platform: 'basalt' }), layoutPreset: 'fullCal' };
  assert.equal(showWhen.isVisible(it, aplite), true, 'shown on aplite when preset is compactCal');
  assert.equal(showWhen.isVisible(it, basalt), true, 'shown on basalt when preset is compactCal');
  assert.equal(showWhen.isVisible(it, basaltOtherPreset), false, 'hidden for other presets');
});

// The swap toggle follows the preset the radio DISPLAYS, and the wire follows the toggle.
// A dormant compactDense (no status row makes it dense) shows as Compact calendar; so does
// a stored 'custom' on aplite. Both must offer the swap AND apply it, or the display and
// the watch disagree — the toggle hidden while the watch shows the swapped layout, or a
// displayed Compact calendar that silently ignores its swap.
test('swapClockStatus is offered and applied exactly where the radio shows Compact calendar', () => {
  const vc = require('../src/pkjs/view-cycle.js');
  const resolver = global.PConf.optionsResolvers.get('layoutPresetOptions');
  const swap = byKey('swapClockStatus');
  ['basalt', 'aplite'].forEach((p) => {
    const env = platform.computeEnv({ platform: p });
    ['off', 'slot', 'status', 'all'].forEach((healthMode) => {
      ['off', 'countdown', 'status', 'graph'].forEach((radarMode) => {
        ['compactCal', 'compactDense', 'custom', 'fullCal', 'noCal', 'weatherOnly'].forEach((layoutPreset) => {
          const S = { layoutPreset, healthMode, radarMode };
          const offered = resolver(S, env).map((o) => o[1]);
          // What the radio shows: the stored value when offered, else the dormant fallback.
          const shown = offered.indexOf(layoutPreset) !== -1 ? layoutPreset : 'compactCal';
          const label = [p, layoutPreset, healthMode, radarMode].join('/');
          assert.equal(showWhen.isVisible(swap, Object.assign({ env }, S)), shown === 'compactCal',
            label + ': toggle visible iff the radio shows Compact calendar');
          if (layoutPreset === 'custom' && p !== 'aplite') { return; }   // compiles the custom keys
          // presetKeyFor = what the payload compiles (Weather only folds on aplite).
          const on = vc.buildViewCycle(vc.presetKeyFor(S, env), healthMode, radarMode, true);
          const off = vc.buildViewCycle(vc.presetKeyFor(S, env), healthMode, radarMode, false);
          const applied = JSON.stringify(on) !== JSON.stringify(off);
          if (shown !== 'compactCal') {
            assert.equal(applied, false, label + ': a hidden toggle changes nothing on the watch');
          } else {
            assert.deepEqual(on, vc.buildViewCycle('compactCal', healthMode, radarMode, true),
              label + ': shown as Compact calendar, compiled as Compact calendar, swap included');
          }
        });
      });
    });
  });
});

test('Layout tab leads with the arrangement section: combined preview above the preset radio, then the editor button, font toggle, swap toggle and reset segmented below', () => {
  const layout = schema.tabs.find((t) => t.id === 'layout');
  // Time and Calendar (moved from the Watch tab) follow the arrangement section,
  // plus the sheetOnly custom-layout storage section between them.
  assert.equal(layout.sections.length, 4, 'arrangement + custom storage + Time + Calendar');
  const items = layout.sections[0].items;
  const presetIdx = items.findIndex((i) => i.messageKey === 'layoutPreset');
  const editIdx = items.findIndex((i) => i.type === 'staticText'
    && String(i.text || '').indexOf('openViewEditor') !== -1);
  const fontIdx = items.findIndex((i) => i.messageKey === 'largeGraphFont');
  const resetIdx = items.findIndex((i) => i.messageKey === 'viewResetMin');
  const swapIdx = items.findIndex((i) => i.messageKey === 'swapClockStatus');
  assert.ok(presetIdx >= 0, 'layoutPreset present');
  assert.equal(items[presetIdx].blockBefore, 'layoutPreviewCombined', 'combined preview hosted on the preset radio');
  assert.equal(items[presetIdx].blockBeforeSticky, true, 'preview sticky');
  assert.equal(editIdx, presetIdx + 1, 'the Custom layout Edit row sits directly below the preset radio');
  assert.deepEqual(items[editIdx].showWhen,
    { all: [{ key: 'layoutPreset', eq: 'custom' }, { env: 'platform', ne: 'aplite' }] },
    'editor row only shows in custom mode, never on aplite (dormant stored custom)');
  assert.equal(fontIdx, editIdx + 1, 'largeGraphFont follows the editor row');
  assert.equal(swapIdx, fontIdx + 1, 'swapClockStatus sits directly below largeGraphFont');
  assert.equal(resetIdx, swapIdx + 1, 'viewResetMin sits directly below swapClockStatus');
  assert.equal(resetIdx, items.length - 1, 'and closes the section');
  // The custom storage section is sheetOnly (never rendered as a tab section).
  const storage = layout.sections.find((s) => s.sheetId === 'viewEditKeys');
  assert.ok(storage, 'custom-layout storage section exists');
  assert.equal(storage.sheetOnly, true);
});

// The custom-layout capability gates are BUILT from view-cycle.js's mode lists
// (custom-layout-schema.js) — assert the very same array instances, not equal
// copies, so a re-typed literal can never silently drift from buildCustomCycle.
test('custom-layout gates reference view-cycle.js\'s mode lists (single source)', () => {
  const vc = require('../src/pkjs/view-cycle.js');
  [0, 1, 2].forEach((i) => {
    const top = byKey('viewTop' + i);
    assert.strictEqual(top.optionDisabledWhen.radar.not.in, vc.RADAR_CHART_MODES,
      'viewTop' + i + ': the radar chart seat gates on RADAR_CHART_MODES');
    const body = byKey('viewBody' + i);
    assert.strictEqual(body.optionDisabledWhen.radar.not.in, vc.RADAR_CHART_MODES,
      'viewBody' + i + ': the radar body gates on RADAR_CHART_MODES');
    assert.strictEqual(body.optionDisabledWhen.health.not.in, vc.HEALTH_BODY_MODES,
      'viewBody' + i + ': the health body gates on HEALTH_BODY_MODES');
    [byKey('viewUpper' + i), byKey('viewLower' + i)].forEach((row) => {
      assert.strictEqual(row.optionDisabledWhen.radar.not.in, vc.RADAR_ROW_MODES,
        row.messageKey + ': the radar source gates on RADAR_ROW_MODES');
      assert.strictEqual(row.optionDisabledWhen.health.not.in, vc.HEALTH_ROW_MODES,
        row.messageKey + ': the health source gates on HEALTH_ROW_MODES');
    });
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

test('flick/positioning narrative lives only in the Layout tab, not Health/Radar copy', () => {
  const health = schema.tabs.find((t) => t.id === 'health');
  assert.ok(!/flick/i.test(health.sections[0].intro), 'health intro drops flick narrative');
  const mode = byKey('healthMode');
  Object.keys(mode.hintByValue).forEach((k) => assert.ok(!/flick/i.test(mode.hintByValue[k]), 'healthMode hint "' + k + '" drops flick'));
  const radar = schema.tabs.find((t) => t.id === 'radar');
  assert.ok(!/wrist flick/i.test(radar.sections[0].intro), 'radar intro drops the wrist-flick line');
});

// The radar picker's options as the page resolves them for a settings state (through the
// engine, so the wiring — resolver id + args — is exercised, not just the resolver).
const radarPickerOptions = (S) => require('../src/pkjs/config-ui/lib/engine.js')
  .resolveOptionsFrom(byKey('radarProvider'), S || {}, {});

test('radarProvider is a dropdown offering DWD/Met.no/Rainbow/Tomorrow.io (short labels, scope in desc/why; on/off now lives in radarMode)', () => {
  const item = byKey('radarProvider');
  assert.equal(item.type, 'select', 'dropdown — the options carry a desc line each');
  assert.equal(item.options, undefined, 'options are derived: the Rainbow label follows the own key');
  assert.equal(item.optionsFrom.resolver, 'radarProviderOptions');
  assert.deepEqual(radarPickerOptions({ rainbowOwnKey: true, rainbowApiKey: 'KEY' }).map((o) => [o[0], o[1]]), [
    ['DWD', 'dwd'],
    ['Met.no', 'metno'],
    ['Rainbow', 'rainbow'],
    ['Tomorrow.io', 'tomorrowio']
  ], 'ONE Rainbow option: the own key is a switch under the picker, not a second option');
  assert.deepEqual(radarPickerOptions({}).map((o) => [o[0], o[1]]), [
    ['DWD', 'dwd'],
    ['Met.no', 'metno'],
    ['Rainbow (limited)', 'rainbow'],
    ['Tomorrow.io', 'tomorrowio']
  ], 'on the shared key the same option reads "Rainbow (limited)"');
  assert.ok(item.hintByValue && item.hintByValue.rainbow, 'per-provider "why" lives in hintByValue on the picker');
  assert.equal(item.hintByValue.rainbowkey, undefined, 'no why note for a value the picker no longer offers');
  assert.equal(item.defaultValue, 'rainbow');
});

// The Radar tab's Rainbow rows, in order: the "Use your own key" switch right under the
// picker, then (switch on) the key field, the monthly read-out and the budget toggle.
const RAINBOW_WHEN = { all: [{ key: 'radarProvider', eq: 'rainbow' }, { key: 'radarMode', ne: 'off' }] };
const RAINBOW_OWN_KEY_WHEN = { all: [{ key: 'radarProvider', eq: 'rainbow' }, { key: 'radarMode', ne: 'off' },
  { key: 'rainbowOwnKey', eq: true }] };
const radarPickerSection = () => schema.tabs.reduce((found, t) => found
  || t.sections.find((sec) => sec.items.some((i) => i.messageKey === 'radarProvider')), null);

test('"Use your own key" is a toggle right under the radar picker, only while Rainbow drives a running radar', () => {
  const toggles = items.filter((i) => i.messageKey === 'rainbowOwnKey');
  assert.equal(toggles.length, 1, 'one instance: the Radar tab only');
  const item = toggles[0];
  assert.equal(item.type, 'toggle');
  assert.equal(item.label, 'Use your own key');
  assert.equal(item.defaultValue, false, 'the shared radar until the user opts in');
  assert.equal(item.joinPrevious, 'loose', 'grouped with the picker it belongs to');
  assert.equal(item.hint, 'Refreshes the radar at every update on your own Rainbow key instead of every 30 minutes. '
    + 'A key is free: Rainbow\'s free plan covers 5,000 calls a month.');
  assert.deepEqual(item.showWhen, RAINBOW_WHEN);
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'graph' }), true, 'shown for Rainbow');
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'countdown', rainbowOwnKey: true }), true,
    'and stays shown once on, so it can be turned off again');
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'off' }), false, 'hidden with radar off');
  ['dwd', 'metno', 'tomorrowio'].forEach((p) => {
    assert.equal(showWhen.isVisible(item, { radarProvider: p, radarMode: 'graph', rainbowOwnKey: true }), false,
      'hidden for ' + p);
  });

  const section = radarPickerSection();
  assert.ok(section, 'the radar picker section exists');
  const picker = section.items.findIndex((i) => i.messageKey === 'radarProvider');
  assert.equal(section.items.indexOf(item), picker + 1, 'directly under the picker');
});

test('Rainbow key field sits under "Use your own key", only while the switch is on', () => {
  const keyItems = items.filter((i) => i.messageKey === 'rainbowApiKey');
  assert.equal(keyItems.length, 1, 'one instance: the Radar tab only');
  const item = keyItems[0];
  assert.equal(item.type, 'text');
  assert.equal(item.label, 'Rainbow API key');
  assert.equal(item.defaultValue, '');
  assert.equal(item.suffixAction, 'testRainbowKey', 'the inline Test button (rainbow-key-test.js)');
  assert.equal(item.suffixLabel, 'Test');
  assert.deepEqual(item.showWhen, RAINBOW_OWN_KEY_WHEN);
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'graph', rainbowOwnKey: true }), true,
    'visible while Rainbow runs on the user\'s key');
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'graph', rainbowOwnKey: false }), false,
    'hidden for the shared Rainbow radar (the proxy needs no key)');
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'graph' }), false,
    'hidden with the switch never touched (its default is off)');
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'off', rainbowOwnKey: true }), false,
    'hidden with radar off (no Rainbow call is made)');
  assert.equal(showWhen.isVisible(item, { radarProvider: 'dwd', radarMode: 'graph', rainbowOwnKey: true }), false,
    'hidden for another radar source, whatever the switch says');

  // Same section as the picker: picker, switch, key, Rainbow budget toggle — then the
  // radar-only tomorrow.io pair, then the radar bar-scale note (the SCALE_NOTE staticText
  // carrying the radar preview).
  const section = radarPickerSection();
  const at = section.items.indexOf(item);
  assert.ok(at >= 0, 'the key field shares the radar picker\'s section');
  assert.equal(section.items[at - 1].messageKey, 'rainbowOwnKey', 'right after the "Use your own key" switch');
  assert.equal(section.items[at + 1].messageKey, 'rainbowFitBudget', 'then the Rainbow budget toggle');
  assert.equal(section.items[at + 2].messageKey, 'tomorrowioApiKey', 'then the radar-only tomorrow.io key');
  assert.equal(section.items[at + 3].messageKey, 'tomorrowioFitBudget', 'and its budget toggle');
  const scaleNote = section.items[at + 4];
  assert.equal(scaleNote.type, 'staticText');
  assert.equal(scaleNote.blockBefore, 'radarPreview');
  assert.match(scaleNote.text, /don't scale linearly/, 'right before the SCALE_NOTE staticText');

  assert.ok(item.hint.indexOf('https://developer.rainbow.ai/signup/') >= 0, 'the hint links the signup page');
  assert.ok(item.hint.indexOf('https://developer.rainbow.ai/profile') >= 0, 'the hint links the profile page');
  assert.equal(item.hint.indexOf('below'), -1, 'the hint points at nothing "below"');
  // Step-by-step, with the free-tier terms a user needs before signing up.
  assert.ok(item.hint.indexOf('<b>How to get a key:</b>') === 0, 'opens with the how-to heading');
  assert.match(item.hint, /1\. .*2\. .*3\. Tap Test\./, 'three numbered steps, ending in the Test button');
  assert.match(item.hint, /credit card/, 'says Rainbow asks for a card');
  assert.match(item.hint, /first 5,000 calls each month are free/, 'and that the first 5,000 a month are free');
  assert.ok(item.hint.indexOf('data-copy="https://developer.rainbow.ai/profile"') >= 0, 'a copy button for the profile link');
  assert.match(item.hint, /Fit update interval to rate limit/, 'names the budget toggle by its label');
  assert.match(item.hint, /on and the watch stays within the free 5,000 calls\.$/,
    'closes on what the toggle gets the user, not how it works');
});

test('Rainbow budget toggle follows the key field and carries the monthly read-out', () => {
  const toggles = items.filter((i) => i.messageKey === 'rainbowFitBudget');
  assert.equal(toggles.length, 1, 'one instance: the Radar tab only');
  const item = toggles[0];
  assert.equal(item.type, 'toggle');
  assert.equal(item.defaultValue, true);
  assert.equal(item.label, 'Fit update interval to rate limit');
  // blockBefore: the usage read-out sits between the key field and the toggle.
  assert.equal(item.blockBefore, 'rainbowBudget');
  assert.equal(item.block, undefined);
  assert.deepEqual(item.showWhen, byKey('rainbowApiKey').showWhen, 'the same RAINBOW_OWN_KEY_WHEN as the key');
  assert.deepEqual(item.showWhen, RAINBOW_OWN_KEY_WHEN);
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'status', rainbowOwnKey: true }), true);
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'off', rainbowOwnKey: true }), false);
  assert.equal(showWhen.isVisible(item, { radarProvider: 'rainbow', radarMode: 'graph', rainbowOwnKey: false }), false);

  const section = schema.tabs.reduce((found, t) => found
    || t.sections.find((sec) => sec.items.indexOf(item) !== -1), null);
  assert.ok(section, 'the toggle is in a section');
  const at = section.items.indexOf(item);
  assert.equal(section.items[at - 1].messageKey, 'rainbowApiKey', 'directly after the Rainbow key field');
  assert.equal(item.hint.indexOf('below'), -1, 'the hint points at nothing "below"');
  assert.match(item.hint, /5,000 calls a month/, 'the hint names the free allowance');
  assert.match(item.hint, /\$0\.10 per 1,000/, 'and what Rainbow bills past it');
});

test('radarMode is a four-step radio with per-mode hint copy', () => {
  const item = byKey('radarMode');
  assert.equal(item.type, 'radio');
  assert.equal(item.label, 'Radar view');
  assert.equal(item.defaultValue, 'graph');
  assert.deepEqual(item.options, [
    ['Off', 'off'],
    ['Countdown only', 'countdown'],
    ['Status bar', 'status'],
    ['Status + Graph', 'graph']
  ]);
  // Each mode's hint is SELF-CONTAINED — it states everything that mode shows,
  // rather than "also adds" deltas relative to the option above (user request).
  assert.deepEqual(item.hintByValue, {
    off: 'Radar is hidden.',
    countdown: 'Shows a “Rain in X′” countdown in the Watch Status Bar.',
    status: 'Adds the Radar Status Bar.',
    graph: 'Adds the Radar Status Bar and the full radar rain graph.'
  });
});

// Mode hints talk about the STATUS BAR and the GRAPH, never about views (where a status
// bar lands depends on the layout preset — flick view on most, folded into compactDense's
// default — so naming a view or a position would lie somewhere; user request). The
// status modes say the bar is added without saying where.
test('mode hints mention bar/graph only — no view claims, no positions', () => {
  const radar = byKey('radarMode').hintByValue;
  const health = byKey('healthMode').hintByValue;
  [radar, health].forEach((hints) => Object.keys(hints).forEach((k) => {
    assert.ok(!/\bview\b/i.test(hints[k]), k + ' hint must not mention a view');
  }));
  assert.ok(!/above the/i.test(radar.status) && !/above the/i.test(health.status),
    'status hints say the bar is added, not where');
  assert.equal(radar.status, 'Adds the Radar Status Bar.');
  assert.match(health.status, /^Adds the Health Status Bar/);
  assert.equal(radar.graph, 'Adds the Radar Status Bar and the full radar rain graph.');
  assert.match(health.all, /^Adds the Health Status Bar and a health graph/);
});

test('compactDense hint holds for every pairing (health OR radar), not just health', () => {
  const hint = byKey('layoutPreset').hintByValue.compactDense;
  // With health off/slot the dense pair is Radar + Forecast — the hint must not
  // promise the Health bar specifically.
  assert.ok(!/health and forecast/i.test(hint), 'must not hard-code the health pairing');
  assert.match(hint, /two status bars/i);
});

test('radar provider hides when off; preview and color require the graph mode', () => {
  assert.deepEqual(byKey('radarProvider').showWhen, { key: 'radarMode', ne: 'off' });

  const previewHosts = items.filter((item) => item.blockBefore === 'radarPreview');
  assert.equal(previewHosts.length, 2, 'color and B/W preview hosts');
  previewHosts.forEach((item) => {
    assert.ok(item.showWhen.all.some((condition) =>
      condition.key === 'radarMode' && condition.eq === 'graph'));
  });

  assert.ok(byKey('radarColor').showWhen.all.some((condition) =>
    condition.key === 'radarMode' && condition.eq === 'graph'));
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
  ['dwd', 'metno', 'rainbow', 'tomorrowio'].forEach((v) => {
    assert.ok(typeof whyNote('radarProvider', v) === 'string' && whyNote('radarProvider', v).length > 0, v + ' radar why note');
  });
  // Content spot-checks: the note carries the real "why".
  assert.match(whyNote('provider', 'wunderground'), /crowd-sourced|250,000/i);
  assert.match(whyNote('provider', 'dwd'), /Germany/);
  assert.match(whyNote('radarProvider', 'tomorrowio'), /budget/i, 'radar Tomorrow.io keeps the key/budget caveat');
  // Rainbow's note, verbatim: why the shared radar is limited, and the switch that lifts it.
  assert.equal(whyNote('radarProvider', 'rainbow'),
    'A worldwide nowcast blending satellite and radar. I pay for the Rainbow calls everyone shares, and with a '
    + 'growing number of users I can only provide a limited number of them, so the shared radar refreshes at most '
    + 'every 30 minutes. Turn on “Use your own key” for a refresh at every update — a key is free. Powered by '
    + '<a target=\'_blank\' href=\'https://rainbow.ai\'>Rainbow.ai</a>.');
  assert.match(whyNote('radarProvider', 'rainbow'), /growing number of users/, 'names why the calls are limited');
  assert.ok(whyNote('radarProvider', 'rainbow').indexOf('“' + byKey('rainbowOwnKey').label + '”') !== -1,
    'points at the switch by its label');
  // Rainbow's terms ask for a "Powered by Rainbow.ai" link.
  assert.match(whyNote('radarProvider', 'rainbow'), /Powered by <a target='_blank' href='https:\/\/rainbow\.ai'>Rainbow\.ai<\/a>\.$/);
  // The old showWhen-gated staticText notes are gone — the hint is the only copy.
  assert.ok(!items.some((i) => i.type === 'staticText' && i.showWhen
    && (i.showWhen.key === 'provider' || i.showWhen.key === 'radarProvider')),
    'no leftover per-provider staticText notes');
});

test('every radar provider carries a "best at" dropdown description', () => {
  [{}, { rainbowOwnKey: true, rainbowApiKey: 'KEY' }].forEach((S) => {
    const options = radarPickerOptions(S);
    const desc = (v) => { const o = options.find((x) => x[1] === v); return o[2] && o[2].desc; };
    ['dwd', 'metno', 'rainbow', 'tomorrowio'].forEach((v) => {
      assert.ok(typeof desc(v) === 'string' && desc(v).length > 0, v + ' radar option should carry a meta.desc');
    });
    assert.match(desc('dwd'), /Germany/);
    assert.match(desc('metno'), /Nordics/);
    assert.match(desc('tomorrowio'), /precise/i, 'Tomorrow.io radar reads as precise');
    assert.equal(desc('rainbow'), 'Worldwide satellite + radar nowcast', 'the same desc in both label states');
  });
});

test('provider/radar/health controls register their status cleanup handlers', () => {
  assert.equal(byKey('provider').onChange, 'clearPollenForProvider');
  // The reset fires on the enable-state flip (radarMode off <-> any other
  // mode), not on a provider-to-provider swap.
  assert.equal(byKey('radarMode').onChange, 'resetStatusRadar');
  assert.equal(byKey('radarProvider').onChange, undefined);
  assert.equal(byKey('healthMode').onChange, 'resetStatusHealth');
});

test('weather provider is a dropdown with short labels; DWD collapses to "DWD" in the trigger', () => {
  const item = byKey('provider');
  assert.equal(item.type, 'select', 'provider picker is a dropdown (too many options for a radio)');
  // Labels are short (no "(Nordics only)" scope) so the collapsed trigger doesn't overlap the field label.
  assert.ok(item.options.some((o) => o[0] === 'Met.no' && o[1] === 'metno'));
  const dwd = item.options.find((o) => o[1] === 'dwd');
  assert.equal(dwd[0], 'Deutscher Wetterdienst', 'bottom sheet keeps the full name');
  assert.equal(dwd[2].short, 'DWD', 'trigger collapses to a short label');
  assert.ok(item.hintByValue && item.hintByValue.dwd, 'per-provider "why" lives in hintByValue on the picker');
});

test('every weather provider option carries a "best at" dropdown description', () => {
  const item = byKey('provider');
  item.options.forEach((o) => {
    assert.ok(o[2] && typeof o[2].desc === 'string' && o[2].desc.length > 0,
      o[1] + ' option should carry a meta.desc line for the dropdown');
  });
  const desc = (v) => item.options.find((o) => o[1] === v)[2].desc;
  assert.match(desc('dwd'), /Best in Germany/);
  assert.doesNotMatch(desc('dwd'), /radar/i, 'radar belongs in the radar dropdown, not the weather picker');
  assert.match(desc('metno'), /Best in the Nordics/);
  assert.match(desc('wunderground'), /250,000\+ local stations/, 'WU highlights its local-station network + count');
  assert.match(desc('openmeteo'), /national model/i, 'Open-Meteo highlights automatic model selection');
  assert.match(desc('tomorrowio'), /key/i, 'key-provider descs flag the API key');
});

test('radar intro drops mechanics; provider positioning lives in the per-provider hints', () => {
  const radarTab = schema.tabs.find((t) => t.id === 'radar');
  const intro = radarTab.sections[0].intro;
  assert.ok(intro.indexOf('precise short-term rain forecast for your location') >= 0, 'core promise present');
  assert.ok(intro.indexOf('Layout tab') >= 0, 'placement pointer kept');
  assert.equal(intro.indexOf('radar images'), -1, 'mechanics dropped');
  assert.equal(intro.indexOf('5-minute frame'), -1, 'mechanics dropped');
  // Provider positioning was de-duplicated out of the intro into the per-provider "why" notes.
  assert.ok(whyNote('radarProvider', 'dwd').indexOf('2 km') >= 0, 'DWD nearby signal explained in its note');
  assert.ok(whyNote('radarProvider', 'rainbow').toLowerCase().indexOf('worldwide') >= 0, 'Rainbow positioned as worldwide in its note');
});

test('theme is a two-slot select dropdown (color env: 4 options; B&W env: 2), like windScale', () => {
  // Two slots, both always visible: the auto switch no longer swaps in a second,
  // renamed pair. `theme` simply doubles as the day theme while Theme switching is on.
  const themeItems = items.filter((i) => i.messageKey === 'theme');
  assert.equal(themeItems.length, 2);
  const colorItem = themeItems.find((i) => JSON.stringify(i.showWhen).indexOf('"not"') < 0);
  const bwItem = themeItems.find((i) => i !== colorItem);
  assert.deepEqual(colorItem.options.map((o) => o[1]), ['dark', 'light', 'bw', 'bw-light']);
  assert.deepEqual(colorItem.options.map((o) => o[0]), ['Dark', 'Light', 'B&W', 'B&W Inverted']);
  assert.deepEqual(bwItem.options.map((o) => o[1]), ['dark', 'light']);
  assert.deepEqual(bwItem.options.map((o) => o[0]), ['Dark', 'Light']);
  assert.ok(colorItem.hintByValue['bw-light'], 'color-env theme item has a bw-light hint');
  themeItems.forEach((i) => {
    assert.equal(i.label, 'Theme', 'never renamed, whatever the auto switch is doing');
    assert.equal(i.type, 'select', 'theme is a dropdown, not segmented');
    assert.equal(i.defaultValue, 'dark');
    assert.equal(i.onChange, 'themeConvert');
    assert.equal(JSON.stringify(i.showWhen).indexOf('themeAuto'), -1,
      'the Theme row is never gated on the auto switch');
  });
});

test('theme switching: toggle + Night theme + mode + custom hours, gated correctly', () => {
  const auto = byKey('themeAuto');
  assert.equal(auto.type, 'toggle');
  assert.equal(auto.label, 'Theme switching');
  assert.equal(auto.defaultValue, false, 'off by default');
  assert.equal(auto.onChange, 'themeAutoPreset', 'first enable seeds a night theme');
  assert.deepEqual(auto.showWhen, { env: 'themePolarity' }, 'hidden on aplite like the theme picker');
  assert.equal(byKey('themeAutoStartHour').label, 'From',
    'hour labels match the other Nighttime rows');
  assert.equal(byKey('themeAutoEndHour').label, 'To');

  const nightItems = items.filter((i) => i.messageKey === 'themeNight');
  assert.equal(nightItems.length, 2, 'a color and a B&W-polarity Night select');
  nightItems.forEach((i) => {
    assert.equal(i.defaultValue, 'dark');
    assert.equal(i.label, 'Night theme');
    assert.equal(i.onChange, undefined,
      'no themeConvert: stored colour defaults track the DAY polarity; the night flip converts a send-time scratch copy');
  });

  const mode = byKey('themeAutoMode');
  assert.equal(mode.type, 'segmented');
  assert.equal(mode.defaultValue, 'sun', 'enabling defaults to sunrise/sunset');
  // Two options, and this is the only mode row left in the card: the sun is a genuine
  // alternative to a clock window, so it has to be chosen somewhere. 'manual' is the
  // STORED value for custom hours — relabelled to "Custom", never renamed, so an install
  // that already picked fixed hours keeps them.
  assert.deepEqual(mode.options.map((o) => o[1]), ['sun', 'manual']);
  assert.deepEqual(mode.options.map((o) => o[0]), ['Sunrise/sunset', 'Custom']);
  // No hintByValue here, deliberately: the group's intro already says what the
  // switch does, and a per-value line under the segmented control wrapped badly on a
  // phone. The option labels carry the meaning instead.
  assert.equal(mode.hintByValue, undefined, 'the mode explains itself via its options');

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
  assert.equal(vis(byKey('themeAutoStartHour'), { themeAuto: true, themeAutoMode: 'sun' }), false,
    'following the sun hides the custom pair');
  assert.equal(vis(byKey('themeAutoStartHour'), { themeAuto: true, themeAutoMode: 'manual' }), true);
  [auto].concat(nightItems).forEach((i) => {
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

test('every capabilities:[COLOR] item additionally requires theme not in [bw, bw-light] (effective color)', () => {
  const colorGated = items.filter((i) => i.capabilities && i.capabilities.indexOf('COLOR') >= 0);
  assert.ok(colorGated.length > 0, 'expected at least one capabilities:[COLOR] item');
  colorGated.forEach((i) => {
    const asStr = JSON.stringify(i.showWhen || null);
    assert.ok(asStr.indexOf('"theme"') >= 0, i.messageKey + ' (label "' + i.label + '") is missing a theme gate: ' + asStr);
    // Every such gate must exclude bw-light too, not just bw (nin form, or an eq to
    // something other than bw/bw-light for the dark/light contextual slots).
    const isBwLightExcluded = asStr.indexOf('bw-light') >= 0
      || asStr.indexOf('"eq":"dark"') >= 0 || asStr.indexOf('"eq":"light"') >= 0;
    assert.ok(isBwLightExcluded, i.messageKey + ' (label "' + i.label + '") does not exclude bw-light: ' + asStr);
  });
});

test('bw-light hides every effective-color gate (color pickers, B/W legends, scale notes) via the show-when evaluator', () => {
  const colorGated = items.filter((i) => i.capabilities && i.capabilities.indexOf('COLOR') >= 0);
  colorGated.forEach((i) => {
    const visible = showWhen.isVisible(i, { env: { color: true }, theme: 'bw-light', barSource: 'rain', radarProvider: 'dwd', holidaysEnabled: true });
    assert.equal(visible, false, i.messageKey + ' (label "' + i.label + '") must be hidden when theme is bw-light');
  });
});

test('colorUSFederal splits into a dark-exclude-white / light-exclude-black pair (no bw item — bw hides it)', () => {
  const federalItems = items.filter((i) => i.messageKey === 'colorUSFederal');
  assert.equal(federalItems.length, 2);
  const darkItem = federalItems.find((i) => JSON.stringify(i.showWhen).indexOf('"dark"') >= 0);
  const lightItem = federalItems.find((i) => JSON.stringify(i.showWhen).indexOf('"light"') >= 0);
  assert.deepEqual(darkItem.excludeColors, ['#FFFFFF']);
  assert.deepEqual(lightItem.excludeColors, ['#000000']);
});

// The single-stop palette (rainBarColor/radarColor "white" option / value) renders as
// DarkGray in the light theme and white in dark (the watch resolves the polarity itself —
// see rain_tier.js buildPalette's colorMode==='white' branch). One item, one label
// ('Solid') regardless of theme; the stored VALUE stays 'white' for wire compatibility.
['rainBarColor', 'radarColor'].forEach((key) => {
  test(key + ' is a single Multicolor/Solid item (no per-theme label split), value stays "white", no bw item', () => {
    const slots = items.filter((i) => i.messageKey === key);
    assert.equal(slots.length, 1, key + ' must have exactly one item');
    const item = slots[0];
    assert.deepEqual(item.options.map((o) => o[0]), ['Multicolor', 'Solid']);
    assert.deepEqual(item.options.map((o) => o[1]), ['multicolor', 'white']);
    // Shown whenever theme isn't bw/bw-light (not just dark, not just light) — a nin
    // gate, never an eq match to a single theme value.
    const themeCond = item.showWhen.all.find((c) => c.key === 'theme');
    assert.deepEqual(themeCond, {key: 'theme', nin: ['bw', 'bw-light']});
  });
});

test('status slot dropdowns: resolver, defaultFrom, slot context args + dedupe onChange (no excludeKeys)', () => {
  const cases = [
    ['statusForecastLeft', 'left'],
    ['statusForecastMid', 'mid'],
    ['statusForecastRight', 'right'],
    ['statusRadarLeft', 'left'],
    ['statusRadarMid', 'mid'],
    ['statusRadarRight', 'right'],
    ['statusTopLeft', 'left'],
    ['statusTopMid', 'mid'],
    ['statusTopRight', 'right'],
    ['statusHealthLeft', 'left'],
    ['statusHealthMid', 'mid'],
    ['statusHealthRight', 'right']
  ];
  for (const [key, pos] of cases) {
    const item = byKey(key);
    assert.ok(item, key);
    // Status slots are plain selects (no search box) — the option list is short and
    // grouped, so the modal opens without a search field, like normal options.
    assert.equal(item.type, 'select', key);
    // Defaults are HR/platform-aware, so each slot resolves its default at hydrate
    // time via the statusSlotDefault resolver rather than a static defaultValue.
    assert.equal(item.defaultFrom.resolver, 'statusSlotDefault', key + ' defaultFrom resolver');
    assert.equal(item.defaultFrom.args.slotKey, key, key + ' defaultFrom slotKey');
    assert.equal(item.defaultValue, undefined, key + ' no static defaultValue');
    assert.equal(item.optionsFrom.resolver, 'statusSlot', key);
    assert.equal(item.optionsFrom.args.excludeKeys, undefined, key + ' no excludeKeys');
    assert.equal(item.optionsFrom.args.slotKey, key, key + ' slotKey');
    assert.equal(item.optionsFrom.args.position, pos, key + ' position');
    assert.equal(item.onChange, 'dedupeStatusSlot', key + ' dedupe onChange');
  }
});

test('top-strip middle is a selectable Date slot; the fixed label is gone', () => {
  const statics = allItems(schema)
    .filter(i => i.type === 'staticText')
    .map(i => i.text || '');
  assert.ok(!statics.some(t => t.indexOf('Date (fixed)') !== -1),
    'fixed-mid label removed');
  const topMid = byKey('statusTopMid');
  assert.ok(topMid, 'statusTopMid exists');
  assert.equal(topMid.type, 'select');
  assert.equal(topMid.defaultFrom.resolver, 'statusSlotDefault');
  assert.equal(topMid.defaultFrom.args.slotKey, 'statusTopMid');
});

test('Units section wording: the section title carries the noun, labels stay short', () => {
  assert.equal(byKey('temperatureUnits').label, 'Temperature');
  assert.equal(byKey('aqiSource').label, 'AQI provider');
  assert.equal(byKey('aqiScale').label, 'Air quality scale');
  assert.equal(byKey('aqiScale').hint,
    'Which air-quality index the Open-Meteo source reports. WAQI always uses the US EPA scale.');
  assert.equal(byKey('windUnits').hint, 'Unit for the wind and gust status items.');
});

test('watch status-bar icon controls live in the Watch Status Bar section, not Misc', () => {
  const more = schema.tabs.find((t) => t.id === 'more');
  const misc = more.sections.find((s) => s.title === 'Misc');
  const strip = schema.tabs.find((t) => t.id === 'watch')
    .sections.find((s) => s.title === 'Watch Status Bar');
  const miscKeys = misc.items.map((i) => i.messageKey).filter(Boolean);
  ['showQt', 'vibe', 'btIcons'].forEach((k) =>
    assert.ok(miscKeys.indexOf(k) === -1, k + ' moved out of Misc'));
  assert.ok(miscKeys.indexOf('telemetryEnabled') !== -1, 'telemetry stays in Misc');
  assert.ok(miscKeys.indexOf('onboardingDone') !== -1, 'onboardingDone stays in Misc');
  assert.ok(miscKeys.indexOf('startOnWeatherTab') !== -1, 'the opening-tab toggle lives in Misc');
  const stripKeys = strip.items.map((i) => i.messageKey).filter(Boolean);
  ['showQt', 'vibe', 'btIcons'].forEach((k) =>
    assert.ok(stripKeys.indexOf(k) !== -1, k + ' now in Watch Status Bar'));
  assert.ok(stripKeys.indexOf('statusTopRight') < stripKeys.indexOf('showQt'),
    'slot selects render above the icon toggles');
  assert.ok(stripKeys.indexOf('showQt') < stripKeys.indexOf('vibe'),
    'vibe sits directly below showQt');
  assert.ok(stripKeys.indexOf('vibe') < stripKeys.indexOf('btIcons'),
    'btIcons comes last');
  // The two bluetooth settings group together: btIcons joins vibe loosely (no divider between
  // them, but normal padding), while a divider stays between showQt and vibe.
  assert.ok(!byKey('vibe').joinPrevious, 'vibe keeps its divider under showQt');
  assert.equal(byKey('btIcons').joinPrevious, 'loose', 'btIcons joins vibe as one visual group');
});

test('batteryLowOnly toggle lives in Watch Status Bar, on by default', () => {
  const item = byKey('batteryLowOnly');
  assert.ok(item, 'batteryLowOnly exists');
  assert.equal(item.type, 'toggle');
  assert.equal(item.defaultValue, true);
  assert.equal(item.label, 'Show battery below 10%');
  assert.equal(item.hint, 'Replaces the top-right slot when your battery drops below 10%.');
  const strip = schema.tabs.find((t) => t.id === 'watch')
    .sections.find((s) => s.title === 'Watch Status Bar');
  const keys = strip.items.map((i) => i.messageKey).filter(Boolean);
  assert.ok(keys.indexOf('statusTopRight') < keys.indexOf('batteryLowOnly'),
    'toggle sits below the slot selects');
  assert.ok(keys.indexOf('batteryLowOnly') < keys.indexOf('showQt'),
    'toggle sits above the quiet-time toggle');
});

test('AQI provider is a dropdown whose explanation switches per selected value', () => {
  const src = byKey('aqiSource');
  assert.equal(src.type, 'select', 'AQI provider is a dropdown, like the radar provider');
  assert.equal(src.hint, undefined, 'no single static hint — hintByValue drives the explanation instead');
  assert.deepEqual(src.options.map((o) => o[1]), ['auto', 'waqi', 'openmeteo'],
    'Auto is offered above WAQI and Open-Meteo');
  assert.ok(src.hintByValue.auto.length > 0, 'Auto has its own hint');
  assert.ok(src.hintByValue.waqi.indexOf('WAQI (aqicn.org)') !== -1, 'WAQI hint carries the station explanation');
  assert.ok(src.hintByValue.openmeteo.length > 0, 'Open-Meteo has its own hint');
});

test('Status-slots tab (id watch) opens with a general status-bar intro, then the four bars in forecast/radar/health/top order', () => {
  const watch = schema.tabs.find((t) => t.id === 'watch');
  // The label was renamed with the Time/Calendar move; the id stays 'watch' —
  // deep links and this very lookup key on it.
  assert.equal(watch.label, 'Status slots', 'tab label renamed, id kept');
  const intro = watch.sections[0];
  assert.equal(intro.title, undefined, 'first Status-slots section is a titleless intro');
  assert.ok(/status bar/i.test(intro.intro), 'general intro describes status bars once');
  const titles = watch.sections.map((s) => s.title).filter(Boolean);
  assert.deepEqual(titles.slice(0, 4),
    ['Forecast Status Bar', 'Radar Status Bar', 'Health Status Bar', 'Watch Status Bar'],
    'four status bars grouped at the top of the Watch tab in order');
  // The per-slot edit sheets (sheetOnly, opened from a slot's Edit button — never
  // cards) sit between the bars and Time in the sections array (see
  // thresholdSection). Each is titled after the SLOT: it configures the slot's
  // bold mode as well as its thresholds/goals, so the goal-vs-threshold split
  // lives on the group header inside, not in the sheet title.
  assert.deepEqual(titles.slice(4, 12),
    ['Air quality (AQI) slot', 'Pollen slot', 'Wind speed slot',
      'Wind gusts slot', 'UV index slot', 'Steps slot', 'Sleep slot',
      'Walked distance slot'],
    'per-slot edit sheets follow the four status bars, in kind order');
  // The bold-only slot sheets (level-less kinds, one Bold row each) follow, in
  // the contract's wire-id order (KINDS 8..19). 'Phone battery slot' is last and
  // serves BOTH phone-battery kinds (18 and 19) — they share key 'PhoneBattery',
  // so there are eleven sheets for twelve bold-only kinds.
  assert.deepEqual(titles.slice(12, 23),
    ['Temperature slot', 'Air pressure (hPa) slot', 'Sunrise/sunset slot',
      'Date slot', 'Calendar week slot', 'City slot', 'Date countdown slot',
      'Heart rate slot', 'Battery percentage slot', 'Dew point slot',
      'Phone battery slot'],
    'bold-only slot sheets follow the threshold sheets, in wire-id order');
  // The Alerts card's levels-only sheets close the tab, in the card's row order:
  // a sheetOnly section between two watchStatus groupCard sections would split
  // the status card (renderBody merges only CONSECUTIVE groupCard sections).
  assert.deepEqual(titles.slice(23),
    ['UV index alert', 'Wind speed alert', 'Wind gusts alert',
      'Air quality (AQI) alert', 'Pollen alert'],
    'the five alert sheets close the tab, after the bold-only sheets');
  // Time and Calendar moved to the END of the Layout tab (order Time, Calendar) —
  // the Status-slots tab holds nothing but slot config now.
  const layoutTitles = schema.tabs.find((t) => t.id === 'layout')
    .sections.map((s) => s.title).filter(Boolean);
  assert.deepEqual(layoutTitles.slice(-2), ['Time', 'Calendar'],
    'the Layout tab ends with Time then Calendar');
  assert.equal(byKey('statusTopLeft').hint, undefined, 'left-slot hint removed');
  const wsb = watch.sections.find((s) => s.title === 'Watch Status Bar').items;
  const note = wsb.find((i) => i.type === 'staticText' && /incoming-rain alert/.test(i.text || ''));
  assert.ok(note, 'Watch bar keeps the incoming-rain alert note as a staticText');
  const rightIdx = wsb.findIndex((i) => i.messageKey === 'statusTopRight');
  const countdownIdx = wsb.findIndex((i) => i.messageKey === 'statusTopRightCountdown');
  const battIdx = wsb.findIndex((i) => i.messageKey === 'batteryLowOnly');
  assert.equal(countdownIdx, rightIdx + 1, 'top-right countdown date follows its slot');
  assert.equal(battIdx, countdownIdx + 1, 'battery toggle follows the slot date directly');
});

test('the Watch intro carries the reset-status-bars button, ungated', () => {
  const watch = schema.tabs.find((t) => t.id === 'watch');
  const intro = watch.sections[0];
  assert.ok(intro.intro.indexOf('data-action="resetStatusSlots"') !== -1,
    'the intro embeds the [data-action] button (blocks.js resetStatusSlots)');
  assert.ok(intro.intro.indexOf('class="txt-act-btn"') !== -1,
    'the button reuses the shared text-action chip style');
  assert.ok(intro.intro.indexOf('Reset status bars to defaults') !== -1,
    'the label covers slots + Bold and stays truthful on aplite');
  // The button resets slots too, which every platform has — so unlike the Bold
  // machinery it must NOT be thresholds-gated (the intro section stays ungated).
  assert.equal(intro.showWhen, undefined, 'the intro section carries no platform gate');
});

test('every threshold sheet is sheetOnly and gated off on aplite (which compiles the highlight out)', () => {
  // aplite paints its status rows from the lean status_row_aplite.c twin and has no
  // WW_THRESHOLD_HIGHLIGHT, so a threshold sheet there would silently do nothing. The
  // gate is section-level, and it composes with — not replaces — the per-item health
  // gate and the color pickers' COLOR-capability + non-B&W-theme rules.
  const watch = schema.tabs.find((t) => t.id === 'watch');
  const threshSections = watch.sections.filter((s) => s.sheetOnly);
  assert.equal(threshSections.length, 24,
    'one edit sheet per boldable slot kind (8 threshold + 11 bold-only) + 5 alert sheets');
  assert.deepEqual(threshSections.map((s) => s.sheetId),
    ['threshAqi', 'threshPollen', 'threshWind', 'threshGust', 'threshUv',
      'threshSteps', 'threshSleep', 'threshDistance',
      'threshTemp', 'threshPressure', 'threshSun', 'threshDate', 'threshWeek',
      'threshCity', 'threshCountdown', 'threshHr', 'threshBatteryPct',
      'threshDew', 'threshPhoneBattery',
      'alertUv', 'alertWind', 'alertGust', 'alertAqi', 'alertPollen'],
    'sheet ids follow the thresh<Stem> convention the slot resolver derives; the '
      + 'Alerts card\'s alert<Stem> sheets come last');
  // LAST in the whole tab, not merely after the other sheets: nothing may follow
  // them (a groupCard section after a sheetOnly one would split the status card).
  assert.deepEqual(watch.sections.slice(-5).map((s) => s.sheetId),
    ['alertUv', 'alertWind', 'alertGust', 'alertAqi', 'alertPollen'],
    'the alert sheets are the tab\'s last five sections');
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
    // statusForecastRight defaults to 'aqi' (a threshold kind) on every platform.
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
    assert.equal(body.indexOf('reaching warn'), -1,
      who + ' body has no Alert levels intro (it lives in the sheets)');
  });
  // The pencil: basalt's default AQI forecast slot offers its sheet; aplite offers none.
  assert.ok(basaltBody.indexOf('data-edit-sheet="threshAqi"') !== -1,
    'basalt renders a pencil for the AQI forecast slot');
  assert.equal(apliteBody.indexOf('data-edit-sheet'), -1,
    'aplite renders no pencil anywhere (env.thresholds is false)');
  // The sheet itself: full on basalt (Bold row + group header toggle + intro + a
  // LIVE slider even while the toggle is off — behavior covered in
  // config-thresholds.test.js), empty on aplite even if forced open.
  const basaltSheet = eng.renderEditModal(schema, watchCx('basalt', 'threshAqi'));
  ['data-k="threshAqiOn"', 'data-k="threshAqiBoldMode"', 'reaching warn', 'Alert levels',
    'Air quality (AQI) slot', 'data-range="threshAqiWarn"'].forEach((frag) =>
    assert.ok(basaltSheet.indexOf(frag) !== -1, 'basalt sheet carries ' + frag));
  assert.ok(!/class="row stack[^"]*\bdis\b/.test(basaltSheet),
    'the slider renders live while the highlight toggle is off');
  assert.equal(eng.renderEditModal(schema, watchCx('aplite', 'threshAqi')), '',
    'aplite renders an empty sheet even when forced open');
  // The rest of the Status-slots tab is untouched on aplite. (Time/Calendar live
  // in the Layout tab now, so probe an always-shown Watch-Status-Bar toggle.)
  assert.ok(apliteBody.indexOf('data-k="showQt"') !== -1,
    'aplite keeps the Watch Status Bar toggles');
});

// The wind-direction arrow is a per-kind display option of the wind/gust slots (the
// phone bakes a trailing sentinel byte into the slot text), so it belongs on those two
// slots' own edit sheets — the same place Temp's display-mode row lives.
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
    // Bold still leads the sheet, and the extra row sits above the Alert levels group:
    // it configures the slot, not the highlight.
    assert.match(String(sheet.items[0].messageKey), /BoldMode$/, id + ' must open with Bold');
    const hdr = sheet.items.findIndex((i) => i.type === 'subheader');
    assert.ok(sheet.items.indexOf(item) < hdr,
      key + ' must sit above the Alert levels group header');
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
  { sheetId: 'threshWind', key: 'windSlotUnit', on: null, off: null, def: true },
  { sheetId: 'threshGust', key: 'gustSlotUnit', on: null, off: null, def: true },
  { sheetId: 'threshPressure', key: 'pressureSlotUnit', on: '1013hPa', off: '1013', def: true },
  { sheetId: 'threshCountdown', key: 'countdownSlotUnit', on: '5d', off: '5', def: true },
  { sheetId: 'threshTemp', key: 'tempSlotUnit', on: '12°', off: '12', def: false },
  { sheetId: 'threshDew', key: 'dewSlotUnit', on: '12°', off: '12', def: false }
];
const sheetById = (id) => schema.tabs.find((t) => t.id === 'watch').sections
  .filter((s) => s.sheetOnly).find((s) => s.sheetId === id);

test('the Date sheet carries the two format pickers, wire-lockstep and Bold-led', () => {
  const CODES = require('../src/pkjs/date-format.js');
  const sheet = sheetById('threshDate');
  assert.ok(sheet, 'no threshDate sheet');
  assert.match(String(sheet.items[0].messageKey), /BoldMode$/, 'Bold still leads the sheet');
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
    }
    // Bold leads every slot sheet (see the sheet-shape tests above), so the extras
    // cannot lead — and on the two threshold sheets the row configures the SLOT, not
    // the highlight, so it stays above the Alert levels group header.
    assert.match(String(sheet.items[0].messageKey), /BoldMode$/,
      row.sheetId + ' must open with Bold');
    const hdr = sheet.items.findIndex((i) => i.type === 'subheader');
    if (hdr !== -1) {
      assert.ok(sheet.items.indexOf(item) < hdr,
        row.key + ' must sit above the Alert levels group header');
    }
  });
  // Temp is the one sheet with two display rows: the unit toggle follows the
  // Temp/Feels/Both picker rather than splitting it from Bold.
  const temp = sheetById('threshTemp');
  assert.ok(temp.items.findIndex((i) => i.messageKey === 'tempSlotUnit') >
    temp.items.findIndex((i) => i.messageKey === 'tempSlotDisplay'),
    'tempSlotUnit follows the temperature-selection row');
});

// The load-bearing part of this feature: an upgrade must not move a single pixel. The
// four kinds that print a unit today ship ON, the two that never did ship OFF — so the
// defaults are deliberately NOT uniform, and a blanket true/false would be a regression
// for one half or the other.
test('the Show unit defaults keep every existing watchface looking the same', () => {
  UNIT_ROWS.forEach((row) => {
    assert.strictEqual(byKey(row.key).defaultValue, row.def,
      row.key + ' must ship ' + (row.def ? 'on (it prints a unit today)'
        : 'off (that kind has never printed one)'));
  });
  assert.deepEqual(UNIT_ROWS.filter((r) => r.def).map((r) => r.key),
    ['windSlotUnit', 'gustSlotUnit', 'pressureSlotUnit', 'countdownSlotUnit'],
    'exactly the four kinds that already show a unit default on');
  assert.deepEqual(UNIT_ROWS.filter((r) => !r.def).map((r) => r.key),
    ['tempSlotUnit', 'dewSlotUnit'],
    'the two degree kinds, which show no unit today, default off');
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

// Temperature and dew point get the DEGREE SIGN ALONE. '°C'/'°F' would restate the
// global temperature-unit setting in every slot — and on a 3-slot status bar that is
// two wasted characters saying something the user already chose once.
test('the degree kinds offer the bare degree sign, not °C or °F', () => {
  ['tempSlotUnit', 'dewSlotUnit'].forEach((key) => {
    const hint = String(byKey(key).hint);
    assert.ok(hint.indexOf('°') !== -1, key + ' names the degree sign');
    assert.equal(hint.indexOf('°C'), -1, key + ' must not promise °C (the units row owns that)');
    assert.equal(hint.indexOf('°F'), -1, key + ' must not promise °F (the units row owns that)');
  });
});

test('no other slot sheet carries a Show unit toggle', () => {
  const owners = UNIT_ROWS.map((r) => r.sheetId);
  schema.tabs.find((t) => t.id === 'watch').sections
    .filter((s) => s.sheetOnly && owners.indexOf(s.sheetId) === -1)
    .forEach((s) => assert.ok(!s.items.some((i) => /SlotUnit$/.test(i.messageKey || '')),
      s.sheetId + ' must not offer a unit toggle (the watch formats that kind)'));
});

// thresholdSection applies its sub-section gate in one pass so a row added later cannot
// forget its gate line — but an extra row may bring its OWN showWhen, and the pass must
// not clobber it (boldSection's idiom). Only the gated sheets (the health kinds) have a
// gate to apply, and none of them carries an extra row today, so the guarantee is not
// observable from the built schema: guard the idiom at the source instead.
test('thresholdSection gates its extra rows without clobbering their own showWhen', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pkjs', 'settings', 'schema.js'), 'utf8');
  const body = src.slice(src.indexOf('function thresholdSection('),
    src.indexOf('function boldSection('));
  assert.ok(body.indexOf('gateAll(') !== -1,
    'thresholdSection must gate through the shared gateAll pass');
  const gateAllBody = src.slice(src.indexOf('function gateAll('),
    src.indexOf('function sheetOf('));
  assert.ok(gateAllBody.indexOf('item.showWhen = item.showWhen || gate') !== -1,
    'gateAll must keep the non-clobbering idiom (a row\'s own showWhen wins)');
  assert.equal(/item\.showWhen\s*=\s*gate\s*;/.test(gateAllBody), false,
    'gateAll must not overwrite an item\'s own showWhen with the gate');
  // The shipped gated sheet still ends up gated: every VISIBLE row carries the health
  // gate (the two hidden companion rows are never drawn, so they never had one).
  const health = schema.tabs.find((t) => t.id === 'watch').sections
    .find((s) => s.sheetId === 'threshSteps');
  health.items.filter((i) => i.type !== 'hidden').forEach((i) =>
    assert.match(JSON.stringify(i.showWhen), /"env":"health"/,
      (i.messageKey || i.type) + ' lost the health gate'));
});

test('the four status sections live in the Watch tab with named headers and no per-bar intros', () => {
  const watch = schema.tabs.find((t) => t.id === 'watch');
  ['Forecast Status Bar', 'Radar Status Bar', 'Health Status Bar', 'Watch Status Bar'].forEach((title) => {
    const section = watch.sections.find((s) => s.title === title);
    assert.ok(section, title + ' lives in the Watch tab');
    assert.equal(section.intro, undefined, title + ' has no per-bar intro (the general intro says it once)');
  });
  // The feature tabs keep their config but no longer carry a status-bar section.
  ['forecast', 'radar', 'health'].forEach((tabId) => {
    const tab = schema.tabs.find((t) => t.id === tabId);
    assert.ok(!tab.sections.some((s) => /Status Bar$/.test(s.title || '')),
      tabId + ' tab no longer has its own status-bar section');
  });
  assert.equal(byKey('statusForecastLeft').hint, undefined, 'forecast left-slot hint removed');
});

test('radar and health status-line slots hide unless the feature shows their bar (and the platform has it)', () => {
  // Moved to the always-shown Watch tab, so each slot carries the env guard the
  // Radar/Health tab used to provide, AND-ed with its bar-visible check. The Radar
  // Status Bar only exists in 'status'/'graph' modes — 'countdown' puts its alert in
  // the Watch bar and adds no radar bar — so the slots gate on those modes, mirroring
  // health's 'status'/'all' (not the mere on/off of the feature).
  ['statusRadarLeft', 'statusRadarMid', 'statusRadarRight'].forEach((k) =>
    assert.deepEqual(byKey(k).showWhen, {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]}, k));
  ['statusHealthLeft', 'statusHealthMid', 'statusHealthRight'].forEach((k) =>
    assert.deepEqual(byKey(k).showWhen, {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]}, k));
});

test('the radar rain-horizon control is labelled "Rain countdown"', () => {
  assert.equal(byKey('rainCountdownHorizon').label, 'Rain countdown');
});

test('secondaryLine offers cloud cover second, then pressure, feels-like and dew point last', () => {
  assert.deepEqual(metricOptions({}, { platform: 'basalt' }), [
    ['Precipitation %', 'precip_prob'], ['Cloud cover %', 'cloud'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'],
    ['UV Index', 'uv'], ['Air pressure (hPa)', 'pressure'], ['Feels-like temperature', 'feels'],
    ['Dew point', 'dew']
  ]);
});

test('thirdLine offers the seven metrics the main line is not using, for all eight', () => {
  for (const metric of ['cloud', 'dew', 'feels', 'gust', 'precip_prob', 'pressure', 'uv', 'wind']) {
    const opts = metricOptions({ secondaryLine: metric }, { platform: 'basalt' }, { off: true, exclude: ['secondaryLine'] });
    assert.equal(opts.length, 8, `${metric} should offer Off + 7 metrics`);
    assert.equal(opts[0][1], 'off');
    assert.ok(!opts.some(([, v]) => v === metric), `${metric} must not offer itself`);
  }
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
  assert.equal(byKey('fourthLine').label, 'Third metric');
  assert.deepEqual(byKey('secondaryLineStyle').showWhen, { all: [LINE_STYLES_GATE] });
  assert.deepEqual(byKey('thirdLineStyle').showWhen,
    { all: [LINE_STYLES_GATE, { key: 'thirdLine', ne: 'off' }] });
  assert.deepEqual(byKey('fourthLineStyle').showWhen,
    { all: [LINE_STYLES_GATE, { key: 'fourthLine', ne: 'off' }] });
  // The fourth-context wind-scale copies carry the same gate (via the
  // LINE_CONTEXTS cascade), or a re-paired incapable watch (stored fourthLine
  // preserved by the row-level hide above) would render an orphaned scale row
  // for a line it never draws. The pressure copy's gate is pinned in its own
  // showWhen test.
  const fourthWinds = items.filter((i) => i.messageKey === 'windScale'
    && i.showWhen.all.some((c) => c.key === 'fourthLine'));
  assert.equal(fourthWinds.length, 3, 'one fourth-context wind-scale copy per unit');
  fourthWinds.forEach((w) => assert.deepEqual(w.showWhen.all[0], LINE_STYLES_GATE));
  // The capability itself exists in the platform SoT and folds exactly aplite.
  const platformLib = require('../src/pkjs/config-ui/lib/platform.js');
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
  const tab = schema.tabs.find((t) => t.id === 'forecast');
  const env = STYLED_ENV;
  const LABELS = { line: 'Thin line', bold: 'Thick line', dots: 'Square dots', x: '× marks',
    stripeTop: 'Stripe at top', stripeBottom: 'Stripe at bottom' };
  const render = (S) => {
    const cx = { S, ENV: env, USERDATA: {}, openColor: null, openSelect: null, openDate: null, openEdit: null,
      selectQuery: '', collapsed: {}, evalCtx: Object.assign({}, S, { env }) };
    return engineLib.renderBody(schema, tab.id, cx);
  };
  const shown = (html, key) => {
    const m = html.match(new RegExp('data-select="' + key + '" aria-label="Line style: ([^"]*)"'));
    return m ? m[1] : null;
  };
  LINE_KEYS.forEach((lineKey) => {
    const key = lineKey + 'Style';
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

test('pressureScale is a Narrow/Mid/Wide control storing low/mid/high', () => {
  const scales = items.filter((i) => i.messageKey === 'pressureScale');
  assert.equal(scales.length, 4, 'one copy per line-context (secondary + third + fourth + fifth)');
  for (const s of scales) {
    assert.deepEqual(s.options, [['Narrow', 'low'], ['Mid', 'mid'], ['Wide', 'high']]);
    assert.equal(s.defaultValue, 'mid');
    assert.equal(s.label, 'Pressure graph scale');
    assert.ok(s.hintByValue.mid.includes('1005\u20131025 hPa'));
  }
});

test('pressureScale shows for the main line, and for a later line only when no earlier line is pressure', () => {
  const scales = items.filter((i) => i.messageKey === 'pressureScale');
  const sec = scales.find((s) => s.showWhen.key === 'secondaryLine');
  assert.deepEqual(sec.showWhen, { key: 'secondaryLine', eq: 'pressure' });
  const third = scales.find((s) => s.showWhen.all
    && s.showWhen.all.some((c) => c.key === 'thirdLine'));
  assert.deepEqual(third.showWhen, { all: [
    { key: 'thirdLine', eq: 'pressure' },
    { not: { key: 'secondaryLine', eq: 'pressure' } }
  ]});
  const fourth = scales.find((s) => s.showWhen.all
    && s.showWhen.all.some((c) => c.key === 'fourthLine'));
  // The fourth arm also carries the lineStyles capability gate: its line is
  // hidden on incapable watches with the stored value preserved, so the scale
  // row must never orphan there.
  assert.deepEqual(fourth.showWhen, { all: [
    { env: 'lineStyles' },
    { key: 'fourthLine', eq: 'pressure' },
    { not: { key: 'secondaryLine', eq: 'pressure' } },
    { not: { key: 'thirdLine', eq: 'pressure' } }
  ]});
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

test('the wind slot arrows by default, the gust slot beside it does not', () => {
  // Both sit in the Radar row's defaults and share one bearing, so arrowing both
  // would print the same arrow twice on one line. Fresh installs only: an existing
  // watch stores an explicit value and is untouched.
  assert.equal(byKey('windSlotDirection').defaultValue, true);
  assert.equal(byKey('gustSlotDirection').defaultValue, false);
});

// The wind-scale hints are DERIVED from forecast-series' WIND_SCALE_KMH through
// wire-units' display conversion; pin the rendered strings so a rounding change
// in either dependency cannot silently rewrite user-facing copy.
test('windScale hints derive from the graph ceilings, strings pinned', () => {
  const winds = items.filter((i) => i.messageKey === 'windScale');
  assert.equal(winds.length, 12, 'three units x four line-contexts');
  const hintFor = (unit) => winds.find((i) =>
    JSON.stringify(i.showWhen).indexOf('"' + unit + '"') >= 0).hintByValue;
  assert.equal(hintFor('kph').low, 'Tops out at 30 kph — emphasizes light, gentle winds.');
  assert.equal(hintFor('mph').low, 'Tops out at 19 mph — emphasizes light, gentle winds.');
  assert.equal(hintFor('mph').mid, 'Tops out at 31 mph — general use; gusts visible, typical winds sit mid-graph.');
  assert.equal(hintFor('mph').high, 'Tops out at 43 mph — keeps strong gusts from flattening against the top.');
  assert.equal(hintFor('knots').low, 'Tops out at 16 kn — emphasizes light, gentle winds.');
  assert.equal(hintFor('knots').mid, 'Tops out at 27 kn — general use; gusts visible, typical winds sit mid-graph.');
  assert.equal(hintFor('knots').high, 'Tops out at 38 kn — keeps strong gusts from flattening against the top.');
});

// --- the Graph-colors card (Forecast tab) ------------------------------------
// One card with one row per graph metric plus the night band; each row
// opens its own sheet. Every colour is a CONCRETE per-polarity value defaulting to the
// built-in line-style.js resolves today, so a picker opens with the colour the graph
// already draws highlighted — no Auto sentinel, no curated palette.
const forecastSections = () => schema.tabs.find((t) => t.id === 'forecast').sections;
const graphCard = () => forecastSections().find((s) => s.id === 'graphColors');
const graphSheets = () => forecastSections().filter((s) => s.sheetOnly);
const gcSheetById = (id) => graphSheets().find((s) => s.sheetId === id);
// The nine rows in card order: the eight metrics as the metric pickers list them, then
// the full-height night band.
const GRAPH_ROW_SHEETS = ['gcPrecip', 'gcCloud', 'gcWind', 'gcGust', 'gcUv', 'gcPressure', 'gcFeels', 'gcDew', 'gcNight'];
const GRAPH_ROW_SCOPES = ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew', 'night'];
// Everything a live gate could read, so only the polarity gate is left to vary — the
// point being that no graph-colour row reads any of them.
const graphState = (over) => Object.assign({
  theme: 'dark', env: { color: true },
  secondaryLine: 'wind', secondaryLineFill: true, thirdLine: 'uv', dayNightShading: true
}, over || {});

test('the Forecast tab carries ONE Graph colors card, always open, under an explicit id', () => {
  const card = graphCard();
  assert.ok(card, 'the card is on the Forecast tab');
  // Plain section: the rows are visible without a tap. Nothing on this tab collapses.
  assert.equal(card.collapsible, undefined, 'the Graph colors card is not expandable');
  assert.equal(forecastSections().filter((s) => s.collapsible).length, 0,
    'no collapsible section on the Forecast tab');
  assert.equal(card.id, 'graphColors');
  assert.equal(card.title, 'Graph colors');
  // A groupCard section renders through renderSectionGroup, which emits no card header
  // — this card's title would vanish silently.
  assert.equal(card.groupCard, undefined);
  assert.equal(card.sheetOnly, undefined, 'the card itself is a normal tab section');
  assert.ok(card.intro, 'the card says what its rows are');
  assert.deepEqual(card.capabilities, ['COLOR']);
  assert.deepEqual(card.showWhen, { key: 'theme', nin: ['bw', 'bw-light'] });
  // Both gates, evaluated: a B&W theme or a B&W watch hides the whole card, header
  // included (buildSectionBody runs before renderSection's open test).
  assert.equal(showWhen.isVisible(card, { theme: 'dark', env: { color: true } }), true);
  assert.equal(showWhen.isVisible(card, { theme: 'bw', env: { color: true } }), false);
  assert.equal(showWhen.isVisible(card, { theme: 'bw-light', env: { color: true } }), false);
  assert.equal(showWhen.isVisible(card, { theme: 'dark', env: { color: false } }), false);
});

test('the card is nine sheet rows in metric-picker order, each identified by its badge args', () => {
  const rows = graphCard().items;
  assert.equal(rows.length, 9, 'eight metrics plus the night band — nothing else in the card');
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
    assert.equal(row.showWhen, undefined, row.sheetId + ' inherits the card gate only');
  });
});

test('each row has a sheetOnly section carrying BOTH gates and no sticky preview', () => {
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
    // No forecast preview heads these sheets: being position:sticky it would occlude
    // the open 64-swatch palette at every scroll offset on a narrow phone.
    assert.equal(sec.block, undefined);
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

test('feels gets a Line pair only; the night band gets Hatch + Dusk/dawn', () => {
  // feels never fills (resolveGraphColors pins fillOn false for it), so a Fill or a
  // night-tint picker would offer a colour nothing can paint.
  assert.deepEqual(gcSheetById('gcFeels').items.filter((i) => i.type === 'color').map((i) => i.messageKey),
    ['gcFeelsLineDark', 'gcFeelsLineLight']);
  assert.deepEqual(gcSheetById('gcNight').items.filter((i) => i.type === 'color').map((i) => i.messageKey),
    ['gcNightHatchDark', 'gcNightHatchLight', 'gcNightBoundaryDark', 'gcNightBoundaryLight']);
});

test('each sheet resets exactly its own keys, and the eight lists partition the key set', () => {
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
  // Leading the bar is not the same as opening the page: General keeps that
  // until the user flips the Misc toggle.
  assert.deepEqual(tab.openWhen, { key: 'startOnWeatherTab', eq: true },
    'the Weather tab opens the page only on request');
  assert.equal(schema.tabs.find((t) => t.id === 'general').openDefault, true,
    'General is the standing default');
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
  // provider/location keys — those stay in the General tab untouched.
  tab.sections.forEach((sec) => sec.items.forEach((i) => {
    assert.ok(['provider', 'location', 'locationMode', 'gpsCacheMin'].indexOf(i.messageKey) === -1,
      'the weather tab must not host watch key ' + i.messageKey);
  }));
});

test('every day-max display row carries the live dayMaxHint', () => {
  // The pills' hint quotes the kind's warn level (blocks.js dayMaxHint); the args are
  // what the resolver interpolates around that number, so they are pinned verbatim.
  const byKey = (k) => items.find((i) => i.messageKey === k);
  assert.deepEqual(['uv', 'wind', 'gust', 'aqi'].map((p) => byKey(p + 'SlotDisplay').hintFrom), [
    { resolver: 'dayMaxHint', args: { keyStem: 'Uv', subject: 'UV is',
      lead: 'Show the UV index now, the highest it still gets today, or both.', coda: '' } },
    { resolver: 'dayMaxHint', args: { keyStem: 'Wind', subject: 'the wind is',
      lead: 'Show the wind speed now, the strongest it still gets today, or both.', coda: '' } },
    { resolver: 'dayMaxHint', args: { keyStem: 'Gust', subject: 'gusts are',
      lead: 'Show the gusts now, the strongest they still get today, or both.', coda: '' } },
    { resolver: 'dayMaxHint', args: { keyStem: 'Aqi', subject: 'the AQI is',
      lead: 'Show the air quality index now, the highest it still gets today, or both.',
      coda: ' The peak needs the Open-Meteo AQI provider (General tab); WAQI reports the current reading only.' } }
  ]);
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
