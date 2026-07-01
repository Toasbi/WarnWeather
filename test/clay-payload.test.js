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

test('buildClayPayload packs the holiday window as an 8-byte array', function() {
  const p = buildClayPayload(baseSettings(), { platform: 'emery' }, NOW);
  assert.ok(Array.isArray(p.HOLIDAYS));
  assert.equal(p.HOLIDAYS.length, 8);
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

test('maps healthEnabled to CLAY_HEALTH_ENABLED', () => {
    const payload = buildClayPayload({ healthEnabled: false }, null, new Date());
    assert.strictEqual(payload.CLAY_HEALTH_ENABLED, false);
    const dflt = buildClayPayload({}, null, new Date());
    assert.strictEqual(dflt.CLAY_HEALTH_ENABLED, true); // default-on when unset
});

test('maps rainCountdownHorizon to CLAY_RAIN_COUNTDOWN_HORIZON', () => {
  const base = baseSettings();
  base.radarProvider = 'dwd';
  // explicit value
  base.rainCountdownHorizon = '30';
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 30);
  // off (0) is preserved, not coerced to the default
  base.rainCountdownHorizon = '0';
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 0);
  // unset → default 60
  delete base.rainCountdownHorizon;
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 60);
  // radar disabled forces 0 even if a horizon is set
  base.radarProvider = 'disabled';
  base.rainCountdownHorizon = '120';
  assert.strictEqual(buildClayPayload(base, null, NOW).CLAY_RAIN_COUNTDOWN_HORIZON, 0);
});

test('maps compactTopView to CLAY_COMPACT_TOP_VIEW, default on', () => {
  assert.strictEqual(buildClayPayload(baseSettings(), null, NOW).CLAY_COMPACT_TOP_VIEW, true); // unset → on
  const s = baseSettings(); s.compactTopView = false;
  assert.strictEqual(buildClayPayload(s, null, NOW).CLAY_COMPACT_TOP_VIEW, false);
});

test('compact top view anchors the holiday window to the current week (prevWeek forced false)', () => {
  const anchorOf = (b) => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24));
  const s = baseSettings();
  s.firstWeek = 'prev';          // would normally anchor a week earlier
  s.holidayCountry = 'US';
  s.compactTopView = true;
  const got = anchorOf(buildClayPayload(s, null, NOW).HOLIDAYS);
  const expectCurrent = holidayMask.build(
    { startMon: s.weekStartDay === 'mon', prevWeek: false, country: 'US', region: 'all', enabled: true }, NOW).anchor;
  const prevAnchor = holidayMask.build(
    { startMon: s.weekStartDay === 'mon', prevWeek: true, country: 'US', region: 'all', enabled: true }, NOW).anchor;
  assert.strictEqual(got, expectCurrent);        // aligned to current-week-first
  assert.notStrictEqual(got, prevAnchor);        // the override actually changed the anchor
});
