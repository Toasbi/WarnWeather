// test/config-schema.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { REGION_OPTIONS } = require('../src/pkjs/settings/holiday-data.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');

function allItems(s) { const out = []; s.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((it) => out.push(it)))); return out; }
const items = allItems(schema);
const byKey = (k) => items.filter((i) => i.messageKey === k)[0];
function forecastItems(s) { return s.tabs.find((t) => t.id === 'forecast').sections[0].items; }

const EXPECTED_KEYS = [
  'theme',
  'timeLeadingZero','timeShowAmPm','axisTimeFormat','timeFont','colorTime',
  'weekStartDay','firstWeek','colorToday','colorSunday','colorSaturday','holidaysEnabled','colorUSFederal',
  'holidayCountry','holidayRegion',
  'fetchIntervalMin','gpsCacheMin','sleepNightEnabled','sleepStartHour','sleepEndHour','fetch','fetchNoticeAck','locationMode','location',
  'temperatureUnits','aqiSource','aqiScale','windUnits','distanceUnits','dayNightShading','healthMode','secondaryLine','secondaryLineFill','windScale','thirdLine',
  'barSource','rainBarColor','provider','owmApiKey','yandexApiKey','tomorrowioApiKey','tomorrowioFitBudget','radarProvider','radarColor','rainCountdownHorizon',
  'layoutPreset','viewResetMin','configTheme','showQt','vibe','btIcons','telemetryEnabled','onboardingDone','devStatsEnabled','devStatsClear','reset',
  'statusForecastLeft','statusForecastLeftCountdown','statusForecastMid','statusForecastMidCountdown','statusForecastRight','statusForecastRightCountdown',
  'statusRadarLeft','statusRadarLeftCountdown','statusRadarMid','statusRadarMidCountdown','statusRadarRight','statusRadarRightCountdown',
  'statusTopLeft','statusTopLeftCountdown','statusTopMid','statusTopMidCountdown','statusTopRight','statusTopRightCountdown',
  'batteryLowOnly','statusHealthLeft','statusHealthLeftCountdown','statusHealthMid','statusHealthMidCountdown','statusHealthRight','statusHealthRightCountdown'
];

test('every Clay messageKey present; theme/windScale/colorUSFederal are the only duplicates (contextual slots)', () => {
  EXPECTED_KEYS.forEach((k) => assert.ok(byKey(k), 'missing messageKey: ' + k));
  const seen = items.filter((i) => i.messageKey).map((i) => i.messageKey);
  const counts = {};
  seen.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  const dups = Object.keys(counts).filter((k) => counts[k] > 1);
  // windScale: solid-line slot vs. dotted-line slot. theme: color-env (4 options) vs.
  // B&W-env (2 options). colorUSFederal: dark-exclude-white vs. light-exclude-black.
  // tomorrowioApiKey/tomorrowioFitBudget: General tab (weather provider) vs. Radar tab
  // (radar-only) — mutually-exclusive showWhen, so only one instance ever renders.
  assert.deepEqual(dups.sort(),
    ['colorUSFederal', 'theme', 'tomorrowioApiKey', 'tomorrowioFitBudget', 'windScale'],
    'unexpected duplicates: ' + dups.join(','));
  assert.equal(counts.windScale, 6, 'windScale appears in six slots (2 contexts × 3 units)');
  assert.equal(counts.theme, 2, 'theme appears in exactly two slots');
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
  assert.deepEqual(colorTypeKeys, ['colorSaturday','colorSunday','colorTime','colorToday','colorUSFederal']);
});

test('B/W bar-scale hints are staticText, gated to effective non-color + the picker condition', () => {
  const hints = items.filter((i) => i.type === 'staticText' && i.showWhen && i.showWhen.all);
  // Effective color: real B&W hardware OR the Black & White theme (bw/bw-light) on a color watch.
  const isBwGated = (h, cond) =>
    JSON.stringify(h.showWhen.all) === JSON.stringify([{ not: { all: [{ env: 'color' }, { key: 'theme', nin: ['bw', 'bw-light'] }] } }, cond]);
  assert.ok(hints.some((h) => isBwGated(h, { key: 'barSource', eq: 'rain' })), 'forecast B/W hint missing');
  assert.ok(hints.some((h) => isBwGated(h, { key: 'radarProvider', ne: 'disabled' })), 'radar B/W hint missing');
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
  assert.equal(byKey('secondaryLineFill').showWhen, undefined); // fill now available for every metric
  assert.deepEqual(byKey('owmApiKey').showWhen, { key: 'provider', eq: 'openweathermap' });
  assert.deepEqual(byKey('devStatsClear').showWhen, { key: 'devStatsEnabled', eq: true });
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

test('radar tab is gated to radar-capable platforms', () => {
  // aplite compiles the rain-radar view out (WW_RAIN_RADAR undefined) to reclaim
  // boot heap, so hide the whole tab there instead of showing controls that do
  // nothing — mirrors the health tab.
  const radarTab = schema.tabs.find((t) => t.id === 'radar');
  assert.ok(radarTab, 'radar tab exists');
  assert.deepEqual(radarTab.showWhen, { env: 'radar' });
});

test('secondaryLine is a 4-metric dropdown with no Off', () => {
  const sec = byKey('secondaryLine');
  assert.equal(sec.type, 'select');
  assert.deepEqual(sec.options.map((o) => o[1]), ['precip_prob', 'wind', 'gust', 'uv']);
  assert.equal(sec.defaultValue, 'precip_prob');
});

test('thirdLine derives options from secondaryLine, excluding it, with Off + default UV', () => {
  const third = byKey('thirdLine');
  assert.equal(third.type, 'select');
  assert.equal(third.defaultValue, 'uv');
  assert.equal(third.optionsFrom.byKey, 'secondaryLine');
  const map = third.optionsFrom.map;
  // Every secondary metric maps to Off + the OTHER three (never itself).
  ['precip_prob', 'wind', 'gust', 'uv'].forEach((sec) => {
    const vals = map[sec].map((o) => o[1]);
    assert.equal(vals[0], 'off', sec + ' third options must start with off');
    assert.ok(!vals.includes(sec), sec + ' must be excluded from its own third-line options');
    assert.equal(vals.length, 4, sec + ' → off + 3 others');
  });
});

test('UV hint explains the fixed 0-11 scale (parallel to precip percentage)', () => {
  const hint = byKey('secondaryLine').hintByValue.uv;
  assert.match(hint, /UV 11/);
  assert.match(hint, /half-height/);
});

test('windScale has six contextual slots: two line-contexts × three wind units', () => {
  const slots = items.filter((i) => i.messageKey === 'windScale');
  assert.equal(slots.length, 6, 'six windScale slots');
  const secondary = slots.filter((s) => s.showWhen.all.some((c) => c.key === 'secondaryLine' && c.in));
  const third = slots.filter((s) => s.showWhen.all.some((c) => c.key === 'thirdLine'));
  assert.equal(secondary.length, 3, 'three secondary-line copies (one per unit)');
  assert.equal(third.length, 3, 'three third-line copies (one per unit)');
  const midShows = { kph: '50 kph', mph: '31 mph', knots: '27 kn' };
  ['kph', 'mph', 'knots'].forEach((unit) => {
    [secondary, third].forEach((group) => {
      const copy = group.find((s) => s.showWhen.all.some((c) => c.key === 'windUnits' && c.eq === unit));
      assert.ok(copy, unit + ' copy present in both contexts');
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
    ['temperatureUnits', 'aqiScale', 'windUnits', 'distanceUnits']);
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
  // The night battery saver moved OUT of this section, up into the first (top) section.
  assert.ok(keys.indexOf('sleepNightEnabled') === -1, 'night battery saver is not in Provider settings');
  const unitsSection = general.sections.find((s) => s.title === 'Units');
  assert.ok(!unitsSection.items.some((i) => i.messageKey === 'aqiSource'), 'aqiSource is not in Units');
});

test('night battery saver + From/To live in the top General card, above Provider settings', () => {
  const general = schema.tabs.find((t) => t.id === 'general');
  // sections[0] is the block-only notices panel; the top card (theme + night saver + location) is [1].
  const topCard = general.sections[1];
  const topKeys = topCard.items.map((i) => i.messageKey).filter(Boolean);
  ['sleepNightEnabled', 'sleepStartHour', 'sleepEndHour'].forEach((k) =>
    assert.ok(topKeys.indexOf(k) !== -1, k + ' lives in the top General card'));
  assert.ok(!topKeys.some((k) => k === 'fetchIntervalMin'), 'update interval is not in the top card');
  const psIndex = general.sections.findIndex((s) => s.title === 'Provider settings');
  const topIndex = general.sections.indexOf(topCard);
  assert.ok(psIndex === topIndex + 1, 'Provider settings is the section immediately below the top card');
});

test('night battery saver toggle is renamed and still gates the From/To sleep-hour selects', () => {
  assert.equal(byKey('sleepNightEnabled').label, 'Night battery saver');
  assert.deepEqual(byKey('sleepStartHour').showWhen, { key: 'sleepNightEnabled', eq: true });
  assert.deepEqual(byKey('sleepEndHour').showWhen, { key: 'sleepNightEnabled', eq: true });
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
  assert.deepEqual(byKey('secondaryLine').options, [
    ['Precipitation %', 'precip_prob'], ['Wind speed', 'wind'], ['Wind gusts', 'gust'], ['UV Index', 'uv']
  ]);
  const map = byKey('thirdLine').optionsFrom.map;
  const labelOf = (sec, val) => map[sec].find((o) => o[1] === val)[0];
  assert.equal(map.precip_prob[0][0], 'Off');
  assert.equal(labelOf('wind', 'precip_prob'), 'Precipitation %');
  assert.equal(labelOf('precip_prob', 'gust'), 'Wind gusts');
  assert.equal(labelOf('precip_prob', 'uv'), 'UV Index');
  assert.equal(labelOf('gust', 'wind'), 'Wind speed');
});

test('Second metric picker hints note that it is drawn as bar-aligned square dots', () => {
  const hints = byKey('thirdLine').hintByValue;
  ['precip_prob', 'wind', 'gust', 'uv'].forEach((m) => {
    assert.match(hints[m], /square dots.*rain bars/i, m + ' hint should mention bar-aligned square dots');
  });
  assert.match(hints.off, /No second metric/i);
});

test('forecast tab nests fill and wind scale under the line that enables them', () => {
  const keys = forecastItems(schema).map((i) => i.messageKey).filter(Boolean);
  const iSolid = keys.indexOf('secondaryLine');
  const iFill = keys.indexOf('secondaryLineFill');
  const iThird = keys.indexOf('thirdLine');
  assert.ok(iSolid >= 0 && iFill > iSolid && iThird > iFill,
    'order must be Main metric -> Fill area -> Second metric; got ' + keys.join(','));
  const windIdxs = keys.reduce((a, k, i) => (k === 'windScale' ? a.concat(i) : a), []);
  assert.equal(windIdxs.length, 6, 'six wind-scale slots (2 contexts × 3 units)');
  assert.ok(windIdxs.slice(0, 3).every((i) => i > iFill && i < iThird),
    'secondary-line wind-scale copies sit under the solid line');
  assert.ok(windIdxs.slice(3).every((i) => i > iThird),
    'third-line wind-scale copies sit under the dotted line');
});

test('onboardingDone is a hidden key and a startWizard button exists', () => {
  assert.equal(byKey('onboardingDone').type, 'hidden');
  assert.ok(items.some((it) => it.type === 'button' && it.action === 'startWizard'));
});

test('non-holiday selects stay plain select', () => {
  assert.equal(byKey('fetchIntervalMin').type, 'select');
  assert.equal(byKey('btIcons').type, 'select');
});

test('rainCountdownHorizon is a radar- and non-aplite-gated select with Off/30/60/120 and default 60', () => {
  const it = byKey('rainCountdownHorizon');
  assert.equal(it.type, 'select');
  assert.equal(it.defaultValue, '60');
  assert.deepEqual(it.options.map((o) => o[1]), ['0', '30', '60', '120']);
  // Shown only when a radar provider is enabled AND not on aplite (feature-frozen there).
  assert.deepEqual(it.showWhen, {
    all: [{ key: 'radarProvider', ne: 'disabled' }, { env: 'platform', ne: 'aplite' }],
  });
});

test('layoutPreset offers the four adaptive presets', () => {
  const t = byKey('layoutPreset');
  assert.ok(t, 'layoutPreset item exists');
  assert.equal(t.type, 'radio');
  assert.equal(t.defaultValue, 'compactCal');
  // Options derive from healthMode: Compact-dense is hidden when health is off (it only
  // differs from Compact when a status row shows), present otherwise. Order stays constant
  // so toggling health doesn't reshuffle the list.
  assert.equal(t.options, undefined, 'options must be derived, not static');
  assert.equal(t.optionsFrom.byKey, 'healthMode');
  assert.deepEqual(t.optionsFrom.map.off.map((o) => o[1]), ['fullCal', 'compactCal', 'noCal']);
  assert.deepEqual(t.optionsFrom.map.status.map((o) => o[1]), ['fullCal', 'compactCal', 'compactDense', 'noCal']);
  assert.deepEqual(t.optionsFrom.map.all.map((o) => o[1]), ['fullCal', 'compactCal', 'compactDense', 'noCal']);
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

test('Layout tab is one section: combined preview above the preset radio, reset segmented directly below', () => {
  const layout = schema.tabs.find((t) => t.id === 'layout');
  assert.equal(layout.sections.length, 1, 'single Layout section');
  const items = layout.sections[0].items;
  const presetIdx = items.findIndex((i) => i.messageKey === 'layoutPreset');
  const resetIdx = items.findIndex((i) => i.messageKey === 'viewResetMin');
  assert.ok(presetIdx >= 0, 'layoutPreset present');
  assert.equal(items[presetIdx].blockBefore, 'layoutPreviewCombined', 'combined preview hosted on the preset radio');
  assert.equal(items[presetIdx].blockBeforeSticky, true, 'preview sticky');
  assert.equal(resetIdx, presetIdx + 1, 'viewResetMin sits directly below the preset radio');
});

test('flick/positioning narrative lives only in the Layout tab, not Health/Radar copy', () => {
  const health = schema.tabs.find((t) => t.id === 'health');
  assert.ok(!/flick/i.test(health.sections[0].intro), 'health intro drops flick narrative');
  const mode = byKey('healthMode');
  Object.keys(mode.hintByValue).forEach((k) => assert.ok(!/flick/i.test(mode.hintByValue[k]), 'healthMode hint "' + k + '" drops flick'));
  const radar = schema.tabs.find((t) => t.id === 'radar');
  assert.ok(!/wrist flick/i.test(radar.sections[0].intro), 'radar intro drops the wrist-flick line');
});

test('radarProvider is a dropdown offering DWD/Met.no/Rainbow/Tomorrow.io/Off (short labels, scope in desc/why)', () => {
  const item = byKey('radarProvider');
  assert.equal(item.type, 'select', 'dropdown — five options no longer fit a segmented row');
  assert.deepEqual(item.options.map((o) => [o[0], o[1]]), [
    ['DWD', 'dwd'],
    ['Met.no', 'metno'],
    ['Rainbow', 'rainbow'],
    ['Tomorrow.io', 'tomorrowio'],
    ['Off', 'disabled']
  ]);
  assert.ok(item.hintByValue && item.hintByValue.rainbow, 'per-provider "why" lives in hintByValue on the picker');
  assert.equal(item.defaultValue, 'rainbow');
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
  ['dwd', 'metno', 'rainbow', 'tomorrowio', 'disabled'].forEach((v) => {
    assert.ok(typeof whyNote('radarProvider', v) === 'string' && whyNote('radarProvider', v).length > 0, v + ' radar why note');
  });
  // Content spot-checks: the note carries the real "why".
  assert.match(whyNote('provider', 'wunderground'), /crowd-sourced|250,000/i);
  assert.match(whyNote('provider', 'dwd'), /Germany/);
  assert.match(whyNote('radarProvider', 'tomorrowio'), /budget/i, 'radar Tomorrow.io keeps the key/budget caveat');
  // The old showWhen-gated staticText notes are gone — the hint is the only copy.
  assert.ok(!items.some((i) => i.type === 'staticText' && i.showWhen
    && (i.showWhen.key === 'provider' || i.showWhen.key === 'radarProvider')),
    'no leftover per-provider staticText notes');
});

test('every radar provider (except Off) carries a "best at" dropdown description', () => {
  const item = byKey('radarProvider');
  const desc = (v) => { const o = item.options.find((x) => x[1] === v); return o[2] && o[2].desc; };
  ['dwd', 'metno', 'rainbow', 'tomorrowio'].forEach((v) => {
    assert.ok(typeof desc(v) === 'string' && desc(v).length > 0, v + ' radar option should carry a meta.desc');
  });
  assert.match(desc('dwd'), /Germany/);
  assert.match(desc('metno'), /Nordics/);
  assert.match(desc('tomorrowio'), /precise/i, 'Tomorrow.io radar reads as precise');
  assert.equal(item.options.find((o) => o[1] === 'disabled').length, 2, 'Off stays a plain 2-tuple (no desc)');
});

test('provider/radar/health controls register their status cleanup handlers', () => {
  assert.equal(byKey('provider').onChange, 'clearPollenForProvider');
  assert.equal(byKey('radarProvider').onChange, 'resetStatusRadar');
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
  const themeItems = items.filter((i) => i.messageKey === 'theme');
  assert.equal(themeItems.length, 2);
  const colorItem = themeItems.find((i) => JSON.stringify(i.showWhen).indexOf('"color"') >= 0 || JSON.stringify(i.showWhen) === '{"env":"color"}');
  const bwItem = themeItems.find((i) => i !== colorItem);
  assert.deepEqual(colorItem.options.map((o) => o[1]), ['dark', 'light', 'bw', 'bw-light']);
  assert.deepEqual(colorItem.options.map((o) => o[0]), ['Dark', 'Light (Alpha)', 'B&W', 'B&W Inverted']);
  assert.deepEqual(bwItem.options.map((o) => o[1]), ['dark', 'light']);
  assert.deepEqual(bwItem.options.map((o) => o[0]), ['Dark', 'Light (Alpha)']);
  assert.ok(colorItem.hintByValue['bw-light'], 'color-env theme item has a bw-light hint');
  themeItems.forEach((i) => {
    assert.equal(i.type, 'select', 'theme is a dropdown, not segmented');
    assert.equal(i.defaultValue, 'dark');
    assert.equal(i.onChange, 'themeConvert');
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
  const stripKeys = strip.items.map((i) => i.messageKey).filter(Boolean);
  ['showQt', 'vibe', 'btIcons'].forEach((k) =>
    assert.ok(stripKeys.indexOf(k) !== -1, k + ' now in Watch Status Bar'));
  assert.ok(stripKeys.indexOf('statusTopRight') < stripKeys.indexOf('showQt'),
    'slot selects render above the icon toggles');
  assert.ok(stripKeys.indexOf('showQt') < stripKeys.indexOf('vibe'),
    'vibe sits directly below showQt');
  assert.ok(stripKeys.indexOf('vibe') < stripKeys.indexOf('btIcons'),
    'btIcons comes last');
  // The two bluetooth settings group together: btIcons joins vibe (no divider between them),
  // while a divider stays between showQt and vibe.
  assert.ok(!byKey('vibe').joinPrevious, 'vibe keeps its divider under showQt');
  assert.equal(byKey('btIcons').joinPrevious, true, 'btIcons joins vibe as one visual group');
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

test('Watch tab opens with a general status-bar intro, then the four bars in forecast/radar/health/top order', () => {
  const watch = schema.tabs.find((t) => t.id === 'watch');
  const intro = watch.sections[0];
  assert.equal(intro.title, undefined, 'first Watch section is a titleless intro');
  assert.ok(/status bar/i.test(intro.intro), 'general intro describes status bars once');
  const titles = watch.sections.map((s) => s.title).filter(Boolean);
  assert.deepEqual(titles.slice(0, 4),
    ['Forecast Status Bar', 'Radar Status Bar', 'Health Status Bar', 'Watch Status Bar'],
    'four status bars grouped at the top of the Watch tab in order');
  // Time and Calendar keep their spots below the bars.
  assert.deepEqual(titles.slice(4), ['Time', 'Calendar'], 'Time then Calendar follow the bars');
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

test('radar and health status-line slots hide when the feature is off or the platform lacks it', () => {
  // Moved to the always-shown Watch tab, so each slot carries the env guard the
  // Radar/Health tab used to provide, AND-ed with its feature-toggle check.
  ['statusRadarLeft', 'statusRadarMid', 'statusRadarRight'].forEach((k) =>
    assert.deepEqual(byKey(k).showWhen, {all: [{env: 'radar'}, {key: 'radarProvider', ne: 'disabled'}]}, k));
  ['statusHealthLeft', 'statusHealthMid', 'statusHealthRight'].forEach((k) =>
    assert.deepEqual(byKey(k).showWhen, {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]}, k));
});

test('the radar rain-horizon control is labelled "Rain Alert"', () => {
  assert.equal(byKey('rainCountdownHorizon').label, 'Rain Alert');
});
