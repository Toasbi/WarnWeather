// test/config-schema.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { REGION_OPTIONS } = require('../src/pkjs/settings/holiday-data.js');

function allItems(s) { const out = []; s.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((it) => out.push(it)))); return out; }
const items = allItems(schema);
const byKey = (k) => items.filter((i) => i.messageKey === k)[0];
function forecastItems(s) { return s.tabs.find((t) => t.id === 'forecast').sections[0].items; }

const EXPECTED_KEYS = [
  'timeLeadingZero','timeShowAmPm','axisTimeFormat','timeFont','colorTime',
  'weekStartDay','firstWeek','colorToday','colorSunday','colorSaturday','holidaysEnabled','colorUSFederal',
  'holidayCountry','holidayRegion',
  'fetchIntervalMin','gpsCacheMin','sleepNightEnabled','sleepStartHour','sleepEndHour','fetch','locationMode','location',
  'temperatureUnits','dayNightShading','healthMode','secondaryLine','secondaryLineFill','windScale','thirdLine',
  'barSource','rainBarColor','provider','owmApiKey','radarProvider','radarColor','rainCountdownHorizon',
  'topViewMode','showQt','vibe','btIcons','telemetryEnabled','devStatsEnabled','devStatsClear'
];

test('every Clay messageKey present; only windScale is duplicated (two contextual slots)', () => {
  EXPECTED_KEYS.forEach((k) => assert.ok(byKey(k), 'missing messageKey: ' + k));
  const seen = items.filter((i) => i.messageKey).map((i) => i.messageKey);
  const counts = {};
  seen.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  const dups = Object.keys(counts).filter((k) => counts[k] > 1);
  // windScale lives in two mutually-exclusive slots: under the solid line and under the dotted line.
  assert.deepEqual(dups, ['windScale'], 'only windScale may repeat; got: ' + dups.join(','));
  assert.equal(counts.windScale, 2, 'windScale appears in exactly two slots');
  assert.deepEqual(Object.keys(counts).sort(), EXPECTED_KEYS.slice().sort());
});

test('location is a GPS/Manual picker; the text field is gated to Manual', () => {
  const mode = byKey('locationMode');
  assert.equal(mode.type, 'segmented');
  assert.equal(mode.defaultValue, 'gps');
  assert.deepEqual(mode.options.map((o) => o[1]), ['gps', 'manual']);
  assert.deepEqual(byKey('location').showWhen, { key: 'locationMode', eq: 'manual' });
});

test('providers include openmeteo as 4th selectable option', () => {
  assert.deepEqual(byKey('provider').options.map((o) => o[1]), ['wunderground','openweathermap','dwd','openmeteo']);
});

test('defaults match Clay/clay-settings (not the prototype drift)', () => {
  assert.equal(byKey('provider').defaultValue, 'wunderground');
  assert.equal(byKey('radarProvider').defaultValue, 'disabled');
  assert.equal(byKey('timeFont').defaultValue, 'roboto');
  assert.equal(byKey('sleepNightEnabled').defaultValue, false);
  assert.equal(byKey('fetchIntervalMin').defaultValue, '15');
});

test('color defaults are ints', () => {
  assert.equal(byKey('colorTime').defaultValue, 0xFFFFFF);
  assert.equal(byKey('colorToday').defaultValue, 0);
  assert.equal(byKey('colorSunday').defaultValue, 0xFF0055);
  const colorTypeKeys = items.filter((i) => i.type === 'color').map((i) => i.messageKey).sort();
  assert.deepEqual(colorTypeKeys, ['colorSaturday','colorSunday','colorTime','colorToday','colorUSFederal']);
});

test('B/W bar-scale hints are staticText, gated to non-color + the picker condition', () => {
  const hints = items.filter((i) => i.type === 'staticText' && i.showWhen && i.showWhen.all);
  const isBwGated = (h, cond) =>
    JSON.stringify(h.showWhen.all) === JSON.stringify([{ not: { env: 'color' } }, cond]);
  assert.ok(hints.some((h) => isBwGated(h, { key: 'barSource', eq: 'rain' })), 'forecast B/W hint missing');
  assert.ok(hints.some((h) => isBwGated(h, { key: 'radarProvider', ne: 'disabled' })), 'radar B/W hint missing');
  // No messageKey, so they never serialize into the settings blob.
  hints.forEach((h) => assert.equal(h.messageKey, undefined));
});

test('COLOR-capability + showWhen wiring', () => {
  ['rainBarColor','radarColor','colorTime'].forEach((k) => assert.ok(byKey(k).capabilities.indexOf('COLOR') >= 0));
  assert.equal(byKey('secondaryLineFill').showWhen, undefined); // fill now available for every metric
  assert.deepEqual(byKey('owmApiKey').showWhen, { key: 'provider', eq: 'openweathermap' });
  assert.deepEqual(byKey('devStatsClear').showWhen, { key: 'devStatsEnabled', eq: true });
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
  assert.equal(mode.defaultValue, 'off');
  assert.deepEqual(mode.options.map((o) => o[1]), ['off', 'status', 'all']);
});

test('secondaryLine is a 4-metric dropdown with no Off', () => {
  const sec = byKey('secondaryLine');
  assert.equal(sec.type, 'select');
  assert.deepEqual(sec.options.map((o) => o[1]), ['precip_prob', 'wind', 'gust', 'uv']);
  assert.equal(sec.defaultValue, 'precip_prob');
});

test('thirdLine derives options from secondaryLine, excluding it, with Off + default off', () => {
  const third = byKey('thirdLine');
  assert.equal(third.type, 'select');
  assert.equal(third.defaultValue, 'off');
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

test('windScale has two contextual slots gated to the line that enabled it', () => {
  const slots = items.filter((i) => i.messageKey === 'windScale');
  assert.equal(slots.length, 2, 'two windScale slots');
  const slotA = slots.find((s) => s.showWhen && s.showWhen.key === 'secondaryLine');
  const slotB = slots.find((s) => s.showWhen && s.showWhen.all);
  assert.deepEqual(slotA.showWhen, { key: 'secondaryLine', in: ['wind', 'gust'] });
  assert.deepEqual(slotB.showWhen, { all: [
    { key: 'thirdLine', in: ['wind', 'gust'] },
    { not: { key: 'secondaryLine', in: ['wind', 'gust'] } }
  ] });
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
  assert.equal(windIdxs.length, 2, 'two wind-scale slots');
  assert.ok(windIdxs[0] > iFill && windIdxs[0] < iThird, 'solid-line wind scale sits under the solid line');
  assert.ok(windIdxs[1] > iThird, 'dotted-line wind scale sits under the dotted line');
});

test('non-holiday selects stay plain select', () => {
  assert.equal(byKey('fetchIntervalMin').type, 'select');
  assert.equal(byKey('btIcons').type, 'select');
});

test('rainCountdownHorizon is a radar-gated select with Off/30/60/120 and default 60', () => {
  const it = byKey('rainCountdownHorizon');
  assert.equal(it.type, 'select');
  assert.equal(it.defaultValue, '60');
  assert.deepEqual(it.options.map((o) => o[1]), ['0', '30', '60', '120']);
  assert.deepEqual(it.showWhen, { key: 'radarProvider', ne: 'disabled' });
});

test('topViewMode is a Misc segmented control defaulting to compact, and gates firstWeek', () => {
  const t = byKey('topViewMode');
  assert.ok(t, 'topViewMode item exists');
  assert.equal(t.type, 'segmented');
  assert.equal(t.defaultValue, 'compact');
  assert.deepEqual(t.options.map((o) => o[1]), ['full', 'compact', 'none']);
  // Lives in the More tab's Misc section.
  const more = schema.tabs.find((tab) => tab.id === 'more');
  const misc = more.sections.find((s) => s.title === 'Misc');
  assert.ok(misc.items.some((i) => i.messageKey === 'topViewMode'), 'in Misc section');
  // "First week to display" shows only for the full 3-row calendar.
  assert.deepEqual(byKey('firstWeek').showWhen, { key: 'topViewMode', eq: 'full' });
});
