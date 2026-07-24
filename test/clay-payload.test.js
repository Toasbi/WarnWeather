const test = require('node:test');
const assert = require('node:assert/strict');

// holiday-mask → nager-source touches localStorage; install the mock before
// any watch module loads (see change-detector.test.js for the pattern).
global.localStorage = {
  getItem: function(k) { return null; },
  setItem: function(k, v) {},
  removeItem: function(k) {}
};

const { buildClayPayload } = require('../src/pkjs/clay-payload');
const holidayMask = require('../src/pkjs/holidays/holiday-mask');

const NOW = new Date('2026-06-26T00:00:00Z');

function baseSettings() {
  return {
    temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '24h',
    weekStartDay: 'mon', firstWeek: 'curr', timeFont: 'leco', showQt: true,
    btIcons: 'connected', vibe: false, timeShowAmPm: false,
    dayNightShading: true, fetchIntervalMin: '30',
    holidayCountry: 'US', holidaysEnabled: true,
    rainBarColor: 'multicolor', radarColor: 'multicolor',
  };
}

test('buildClayPayload maps settings to CLAY_ keys', function() {
  const p = buildClayPayload(baseSettings(), { platform: 'emery' }, NOW);
  assert.equal(p.CLAY_CELSIUS, true);
  assert.equal(p.CLAY_AXIS_12H, false);
  assert.equal(p.CLAY_TIME_FONT, 1);            // ['roboto','leco','bitham'].indexOf('leco')
  assert.equal(p.CLAY_FETCH_INTERVAL_MIN, 30);
  assert.equal(p.CLAY_START_MON, true);
});

test('countdown target dates are phone-only and never ride the Clay AppMessage', () => {
  const s = baseSettings();
  s.statusForecastLeftCountdown = '2030-04-05';
  const p = buildClayPayload(s, { platform: 'emery' }, NOW);
  assert.equal(Object.prototype.hasOwnProperty.call(
    p, 'statusForecastLeftCountdown'), false);
  assert.equal(Object.keys(p).some((key) => /Countdown$/.test(key)), false);
});

test('buildClayPayload packs the holiday window as an 8-byte array', function() {
  const p = buildClayPayload(baseSettings(), { platform: 'emery' }, NOW);
  assert.ok(Array.isArray(p.HOLIDAYS));
  assert.equal(p.HOLIDAYS.length, 8);
});

test('HOLIDAYS reads the flat holidayRegion key, not the obsolete per-country holidayRegion<CC>', function() {
  // Regression: the schema stores a single `holidayRegion` (a one-time migration collapsed the
  // per-country holidayRegion<CC> keys into it), but clay-payload used to read
  // settings['holidayRegion' + country], which no longer exists — silently forcing region 'all'.
  const s = baseSettings();
  s.holidayCountry = 'DE';
  s.holidayRegion = 'BY';                 // Bavaria — a real ISO-3166-2 subdivision
  const origBuild = holidayMask.build;
  let seenRegion = null;
  holidayMask.build = function(opts, now) { seenRegion = opts.region; return origBuild(opts, now); };
  try {
    buildClayPayload(s, { platform: 'emery' }, NOW);
  } finally {
    holidayMask.build = origBuild;
  }
  assert.equal(seenRegion, 'BY');
});

test('CLAY_BATTERY_LOW_ONLY reflects the batteryLowOnly setting (default false)', () => {
  assert.equal(buildClayPayload(baseSettings(), { platform: 'basalt' }, NOW).CLAY_BATTERY_LOW_ONLY, false);
  const s = baseSettings();
  s.batteryLowOnly = true;
  assert.equal(buildClayPayload(s, { platform: 'basalt' }, NOW).CLAY_BATTERY_LOW_ONLY, true);
});

test('buildClayPayload includes the rain/radar palette tuples', function() {
  const p = buildClayPayload(baseSettings(), { platform: 'emery' }, NOW);
  assert.ok(Array.isArray(p.BAR_PALETTE_UINT8));
  assert.ok(Array.isArray(p.RADAR_PALETTE_UINT8));
  assert.equal(p.BAR_PALETTE_UINT8.length, 15);   // multicolor → 5 stops
});

test('buildClayPayload palette reflects rainBarColor', function() {
  const s = baseSettings(); s.rainBarColor = 'white';
  const p = buildClayPayload(s, { platform: 'emery' }, NOW);
  assert.equal(p.BAR_PALETTE_UINT8.length, 3);    // white → single stop
});

test('maps healthMode to CLAY_HEALTH_MODE', () => {
    assert.strictEqual(buildClayPayload({ healthMode: 'all' }, null, new Date()).CLAY_HEALTH_MODE, 2);
    assert.strictEqual(buildClayPayload({ healthMode: 'status' }, null, new Date()).CLAY_HEALTH_MODE, 1);
    assert.strictEqual(buildClayPayload({ healthMode: 'off' }, null, new Date()).CLAY_HEALTH_MODE, 0);
    assert.strictEqual(buildClayPayload({}, null, new Date()).CLAY_HEALTH_MODE, 0); // default off when unset
    assert.strictEqual(buildClayPayload({ healthMode: 'slot' }, null, new Date()).CLAY_HEALTH_MODE, 3);
});

test('CLAY_DUAL_STATUS is no longer emitted (dual/single now folded into the packed view cycle)', () => {
    const p = buildClayPayload({ healthMode: 'status' }, null, new Date());
    assert.strictEqual(Object.prototype.hasOwnProperty.call(p, 'CLAY_DUAL_STATUS'), false);
});

test('maps rainCountdownHorizon to CLAY_RAIN_COUNTDOWN_HORIZON', () => {
  const base = baseSettings();
  base.radarMode = 'graph';
  // explicit value
  base.rainCountdownHorizon = '30';
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 30);
  // off (0) is preserved, not coerced to the default
  base.rainCountdownHorizon = '0';
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 0);
  // unset → default 60
  delete base.rainCountdownHorizon;
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 60);
  // radar off forces 0 even if a horizon is set
  base.radarMode = 'off';
  base.rainCountdownHorizon = '120';
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 0);
  // countdown mode keeps the horizon (only 'off' zeroes it)
  base.radarMode = 'countdown';
  base.rainCountdownHorizon = '120';
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 120);
});

test('maps topViewMode to CLAY_TOP_VIEW_MODE int (full=0, compact=1, none=2), default compact', () => {
  assert.strictEqual(buildClayPayload(baseSettings(), null, NOW).CLAY_TOP_VIEW_MODE, 1); // unset → compact
  const full = baseSettings(); full.topViewMode = 'full';
  assert.strictEqual(buildClayPayload(full, null, NOW).CLAY_TOP_VIEW_MODE, 0);
  const none = baseSettings(); none.topViewMode = 'none';
  assert.strictEqual(buildClayPayload(none, null, NOW).CLAY_TOP_VIEW_MODE, 2);
});

test('compact top view anchors the holiday window to the current week (prevWeek forced false)', () => {
  const anchorOf = (b) => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24));
  const s = baseSettings();
  s.firstWeek = 'prev';          // would normally anchor a week earlier
  s.holidayCountry = 'US';
  s.topViewMode = 'compact';
  const got = anchorOf(buildClayPayload(s, null, NOW).HOLIDAYS);
  const expectCurrent = holidayMask.build(
    { startMon: s.weekStartDay === 'mon', prevWeek: false, country: 'US', region: 'all', enabled: true }, NOW).anchor;
  const prevAnchor = holidayMask.build(
    { startMon: s.weekStartDay === 'mon', prevWeek: true, country: 'US', region: 'all', enabled: true }, NOW).anchor;
  assert.strictEqual(got, expectCurrent);        // aligned to current-week-first
  assert.notStrictEqual(got, prevAnchor);        // the override actually changed the anchor
});

test('maps theme to CLAY_THEME', () => {
  assert.strictEqual(buildClayPayload({ theme: 'light' }, null, NOW).CLAY_THEME, 1);
  assert.strictEqual(buildClayPayload({ theme: 'bw' }, null, NOW).CLAY_THEME, 2);
  assert.strictEqual(buildClayPayload({ theme: 'bw-light' }, null, NOW).CLAY_THEME, 3);
  assert.strictEqual(buildClayPayload({}, null, NOW).CLAY_THEME, 0, 'defaults to dark (0) when unset');
});

test('CLAY_COLOR_TIME default is theme-aware: white in dark/bw, black in light/bw-light', () => {
  assert.strictEqual(buildClayPayload({ theme: 'dark' }, null, NOW).CLAY_COLOR_TIME, 0xFFFFFF);
  assert.strictEqual(buildClayPayload({ theme: 'bw' }, null, NOW).CLAY_COLOR_TIME, 0xFFFFFF);
  assert.strictEqual(buildClayPayload({ theme: 'light' }, null, NOW).CLAY_COLOR_TIME, 0x000000);
  assert.strictEqual(buildClayPayload({ theme: 'bw-light' }, null, NOW).CLAY_COLOR_TIME, 0x000000);
});

test('CLAY_COLOR_TIME an explicit colorTime setting is never overridden by theme', () => {
  const p = buildClayPayload({ theme: 'light', colorTime: 0xFF0000 }, null, NOW);
  assert.strictEqual(p.CLAY_COLOR_TIME, 0xFF0000);
});

test('configTheme is a settings-only key and never rides the Clay AppMessage', function() {
  const s = baseSettings();
  s.configTheme = 'light';
  const p = buildClayPayload(s, { platform: 'emery' }, NOW);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'configTheme'), false);
});
