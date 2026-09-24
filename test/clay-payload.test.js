const test = require('node:test');
const assert = require('node:assert/strict');

// holiday-mask → nager-source touches localStorage; install the mock before
// any watch module loads (see change-detector.test.js for the pattern).
global.localStorage = {
  getItem: function(k) { return null; },
  setItem: function(k, v) {},
  removeItem: function(k) {}
};

const { buildClayPayload, truncateUtf8Bytes } = require('../src/pkjs/clay-payload');
const holidayMask = require('../src/pkjs/holidays/holiday-mask');
const viewCycle = require('../src/pkjs/view-cycle');
const lineStyle = require('../src/pkjs/line-style');
const nightLight = require('../src/pkjs/night-light');

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

// The watch draws the previous week on top of EVERY 3-row view (config_n_today), not
// only the default one, and cell_is_holiday can never light a cell before the anchor.
// A custom layout may put the 3-row calendar (or a radar top, drawn as the 3-row
// calendar until radar data arrives) on a flick view, so the window has to anchor
// there too, or that view's top row never shows a holiday.
test('a 3-row calendar on a flick view anchors the holiday window on the previous week', () => {
  const anchorOf = (b) => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24));
  const MON_OCT_5 = new Date(2026, 9, 5, 12, 0, 0);
  const windowAt = (prevWeek) => holidayMask.build({ startMon: true, prevWeek: prevWeek,
    country: 'none', region: 'all', enabled: true }, MON_OCT_5).anchor;
  const custom = (top1, extra) => Object.assign(baseSettings(), {
    layoutPreset: 'custom', viewCount: '2', viewTop0: 'cal2', viewTop1: top1,
    firstWeek: 'prev', weekStartDay: 'mon', holidayCountry: 'DE'
  }, extra);
  const BASALT = { platform: 'basalt' };

  const flickCal3 = buildClayPayload(custom('cal3'), BASALT, MON_OCT_5);
  assert.equal(anchorOf(flickCal3.HOLIDAYS), windowAt(true),
    'the 3-row flick view starts on Mon 28 Sep, so the window must too');
  assert.equal(flickCal3.CLAY_TOP_VIEW_MODE, 1, 'the boot hint stays the default slot (compact)');

  const flickRadar = buildClayPayload(custom('radar', { radarMode: 'graph' }), BASALT, MON_OCT_5);
  assert.equal(anchorOf(flickRadar.HOLIDAYS), windowAt(true),
    'a radar top is FULL-tier: the watch draws it as the 3-row calendar without radar data');

  const firstWeekCurr = buildClayPayload(custom('cal3', { firstWeek: 'curr' }), BASALT, MON_OCT_5);
  assert.equal(anchorOf(firstWeekCurr.HOLIDAYS), windowAt(false), 'curr keeps the current week');

  const noFull = buildClayPayload(custom('cal2'), BASALT, MON_OCT_5);
  assert.equal(anchorOf(noFull.HOLIDAYS), windowAt(false),
    'with no 3-row view the window keeps its two weeks of headroom');
});

// index.js's holiday prefetch hands holidayWindowOpts to holidayMask.windowYears and
// nagerSource.ensure prunes every year outside that list, so the helper must describe
// exactly the window the HOLIDAYS tuple scans — for every layout shape, the aplite
// custom fold and the unknown-platform (null watchInfo) case included.
test('holidayWindowOpts is the window the HOLIDAYS tuple anchors on, for every layout shape', () => {
  const { holidayWindowOpts } = require('../src/pkjs/clay-payload');
  const daysFromCivil = require('../src/pkjs/holidays/serial-day');
  const anchorOf = (b) => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24));
  const serialOf = (d) => daysFromCivil(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const BASALT = { platform: 'basalt' };
  const APLITE = { platform: 'aplite' };
  const cal3Custom = { layoutPreset: 'custom', viewCount: '1', viewTop0: 'cal3' };
  const shapes = [
    ['compactCal', { layoutPreset: 'compactCal' }, BASALT],
    ['fullCal', { layoutPreset: 'fullCal' }, BASALT],
    ['noCal', { layoutPreset: 'noCal' }, BASALT],
    ['legacy topViewMode full on a compact preset', { layoutPreset: 'compactCal', topViewMode: 'full' }, BASALT],
    ['custom with a 3-row default view', cal3Custom, BASALT],
    ['custom with a 3-row flick view',
      { layoutPreset: 'custom', viewCount: '2', viewTop0: 'cal2', viewTop1: 'cal3' }, BASALT],
    ['custom, unknown platform', cal3Custom, null],
    ['aplite folds a dormant custom layout', cal3Custom, APLITE],
  ];
  // Around a year boundary, where a drifted window starts fetching the wrong year.
  const days = [new Date(2028, 11, 25), new Date(2029, 0, 1), new Date(2029, 0, 2),
    new Date(2029, 0, 7), new Date(2027, 0, 4), new Date(2026, 11, 29)];
  shapes.forEach(([label, over, wi]) => {
    ['prev', 'curr'].forEach((firstWeek) => {
      ['mon', 'sun'].forEach((weekStartDay) => {
        const s = Object.assign(baseSettings(), over, { firstWeek, weekStartDay });
        days.forEach((now) => {
          const opts = holidayWindowOpts(s, wi);
          const anchor = anchorOf(buildClayPayload(s, wi, now).HOLIDAYS);
          const cell0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 21);
          let first = null;
          for (let i = 0; i < 49 && first === null; i++) {
            const d = new Date(cell0.getFullYear(), cell0.getMonth(), cell0.getDate() + i);
            if (serialOf(d) === anchor) { first = d; }
          }
          const tag = label + ' ' + firstWeek + '/' + weekStartDay + ' ' + now.toDateString();
          assert.ok(first, tag + ': anchor not found');
          const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 27);
          const want = first.getFullYear() === last.getFullYear()
            ? [first.getFullYear()] : [first.getFullYear(), last.getFullYear()];
          assert.deepStrictEqual(holidayMask.windowYears(opts, now), want, tag);
        });
      });
    });
  });
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

test('swapClockStatus moves the compactCal forecast row to the lower slot in the packed cycle', () => {
  const s = baseSettings();
  s.layoutPreset = 'compactCal';
  s.radarMode = 'off';
  s.healthMode = 'off';
  s.swapClockStatus = true;
  const p = buildClayPayload(s, { platform: 'emery' }, NOW);
  const s0 = viewCycle.unpackSpec(p.CLAY_VIEW_0);
  assert.equal(s0.statusUpper, viewCycle.STATUS_SRC_NONE);
  assert.equal(s0.statusLower, viewCycle.STATUS_SRC_FORECAST);
});

test('configTheme is a settings-only key and never rides the Clay AppMessage', function() {
  const s = baseSettings();
  s.configTheme = 'light';
  const p = buildClayPayload(s, { platform: 'emery' }, NOW);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'configTheme'), false);
});

test('CLAY_HR_SCALE packs the hrScale pair as lo | (hi << 8)', function() {
  const s = baseSettings();
  s.healthMode = 'all';
  s.hrScale = '50-100';   // >= minSpan (50) apart, so the UI can actually produce it
  const p = buildClayPayload(s, { platform: 'diorite' }, NOW);
  assert.equal(p.CLAY_HR_SCALE, 50 | (100 << 8));
  // Both operands must survive the round trip as bytes.
  assert.equal(p.CLAY_HR_SCALE & 0xFF, 50);
  assert.equal((p.CLAY_HR_SCALE >> 8) & 0xFF, 100);
});

test('CLAY_NORAIN_TEXT packs the trimmed radarNoRainText', function() {
  const s = baseSettings();
  s.radarNoRainText = '  Dry skies today  ';
  const p = buildClayPayload(s, { platform: 'basalt' }, NOW);
  assert.equal(p.CLAY_NORAIN_TEXT, 'Dry skies today');
});

test('CLAY_NORAIN_TEXT sends an empty string for unset or whitespace-only text (watch falls back to its built-in)', function() {
  // Unset (pre-seed upgrade blob): the key must still ride so the watch can
  // clear a previously-stored custom text.
  assert.equal(buildClayPayload(baseSettings(), { platform: 'basalt' }, NOW).CLAY_NORAIN_TEXT, '');
  const s = baseSettings();
  s.radarNoRainText = '   ';
  assert.equal(buildClayPayload(s, { platform: 'basalt' }, NOW).CLAY_NORAIN_TEXT, '');
});

test('CLAY_NORAIN_TEXT truncates to 24 UTF-8 bytes, not 24 chars', function() {
  const s = baseSettings();
  s.radarNoRainText = 'ÄÄÄÄÄÄÄÄÄÄÄÄÄ';   // 13 chars x 2 bytes = 26 bytes
  const p = buildClayPayload(s, { platform: 'basalt' }, NOW);
  assert.equal(p.CLAY_NORAIN_TEXT, 'ÄÄÄÄÄÄÄÄÄÄÄÄ');   // 12 chars = 24 bytes
  assert.equal(Buffer.byteLength(p.CLAY_NORAIN_TEXT, 'utf8'), 24);
});

test('CLAY_NORAIN_TEXT never splits a multi-byte sequence at the 24-byte boundary', function() {
  const s = baseSettings();
  // 23 ASCII bytes + a 2-byte umlaut would land on 25 — the umlaut must be
  // dropped whole, never emitted as half a sequence.
  s.radarNoRainText = 'aaaaaaaaaaaaaaaaaaaaaaaü';
  const p = buildClayPayload(s, { platform: 'basalt' }, NOW);
  assert.equal(p.CLAY_NORAIN_TEXT, 'aaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(Buffer.byteLength(p.CLAY_NORAIN_TEXT, 'utf8'), 23);
});

test('CLAY_NORAIN_TEXT is omitted for a radar-less watch (aplite) but kept for unknown platforms', function() {
  const s = baseSettings();
  s.radarNoRainText = 'Dry';
  const aplite = buildClayPayload(s, { platform: 'aplite' }, NOW);
  assert.equal(Object.prototype.hasOwnProperty.call(aplite, 'CLAY_NORAIN_TEXT'), false);
  // Unknown watchInfo must never drop a real feature (computeEnv convention).
  const unknown = buildClayPayload(s, null, NOW);
  assert.equal(unknown.CLAY_NORAIN_TEXT, 'Dry');
});

test('truncateUtf8Bytes keeps or drops a surrogate pair whole (4-byte emoji)', function() {
  // 21 ASCII bytes + a 4-byte emoji = 25 bytes -> the emoji is dropped whole.
  const emoji = '🌧';   // 🌧 (U+1F327), 4 UTF-8 bytes
  const over = 'aaaaaaaaaaaaaaaaaaaaa' + emoji;
  assert.equal(truncateUtf8Bytes(over, 24), 'aaaaaaaaaaaaaaaaaaaaa');
  // 20 ASCII bytes + the emoji = 24 bytes -> fits exactly, pair intact.
  const fits = 'aaaaaaaaaaaaaaaaaaaa' + emoji;
  assert.equal(truncateUtf8Bytes(fits, 24), fits);
  assert.equal(Buffer.byteLength(truncateUtf8Bytes(fits, 24), 'utf8'), 24);
});

test('truncateUtf8Bytes passes short strings through untouched', function() {
  assert.equal(truncateUtf8Bytes('No rain ahead', 24), 'No rain ahead');
  assert.equal(truncateUtf8Bytes('', 24), '');
});

test('CLAY_CURVE_INSET_UINT8 sends the fixed [7,0,0,0,0] when feels is not selected', function() {
  // The inset is deliberately NOT a user setting — a fixed 7 px (the watch's
  // BOTTOM_VIEW_PRIMARY_LINE_INSET_Y), with the five per-series bytes (Series id
  // order: temp, main, second, third, fourth metric) only marking which metric
  // channel carries a temperature-axis metric.
  const p = buildClayPayload(baseSettings(), { platform: 'emery' }, NOW);
  assert.deepEqual(p.CLAY_CURVE_INSET_UINT8, [7, 0, 0, 0, 0]);
});

test('CLAY_CURVE_INSET_UINT8: feels on the secondary line shares the temp inset', function() {
  const s = baseSettings();
  s.secondaryLine = 'feels';
  s.thirdLine = 'uv';
  const p = buildClayPayload(s, { platform: 'basalt' }, NOW);
  assert.deepEqual(p.CLAY_CURVE_INSET_UINT8, [7, 7, 0, 0, 0]);
});

test('CLAY_CURVE_INSET_UINT8: feels on the third line shares the temp inset', function() {
  const s = baseSettings();
  s.secondaryLine = 'precip_prob';
  s.thirdLine = 'feels';
  const p = buildClayPayload(s, { platform: 'basalt' }, NOW);
  assert.deepEqual(p.CLAY_CURVE_INSET_UINT8, [7, 0, 7, 0, 0]);
});

test('CLAY_CURVE_INSET_UINT8: dew point shares the temp inset on either line', function() {
  const s = baseSettings();
  s.secondaryLine = 'dew';
  s.thirdLine = 'feels';
  assert.deepEqual(buildClayPayload(s, { platform: 'basalt' }, NOW).CLAY_CURVE_INSET_UINT8, [7, 7, 7, 0, 0]);
  s.secondaryLine = 'wind';
  s.thirdLine = 'dew';
  assert.deepEqual(buildClayPayload(s, { platform: 'basalt' }, NOW).CLAY_CURVE_INSET_UINT8, [7, 0, 7, 0, 0]);
});

test('CLAY_CURVE_INSET_UINT8: the third- and fourth-metric lines get an inset byte of their own', function() {
  const s = Object.assign(baseSettings(), { secondaryLine: 'feels', thirdLine: 'wind', fourthLine: 'dew' });
  assert.deepEqual(buildClayPayload(s, { platform: 'basalt' }, NOW).CLAY_CURVE_INSET_UINT8, [7, 7, 0, 7, 0]);
  const fifth = Object.assign(baseSettings(), { secondaryLine: 'precip_prob', thirdLine: 'uv', fifthLine: 'feels' });
  assert.deepEqual(buildClayPayload(fifth, { platform: 'emery' }, NOW).CLAY_CURVE_INSET_UINT8, [7, 0, 0, 0, 7]);
});

test('CLAY_CURVE_INSET_UINT8 reads the RAW settings: a duplicate pick still gets its byte', function() {
  // feels on the third AND the third-metric line: effectiveLineMetric turns the
  // later one off, so the watch never draws that series and never reads its byte.
  // The tuple does not resolve effective metrics — a byte nobody reads is harmless.
  const s = Object.assign(baseSettings(), { secondaryLine: 'wind', thirdLine: 'feels', fourthLine: 'feels' });
  assert.equal(lineStyle.effectiveLineMetric(s, 'fourthLine'), null, 'the duplicate line is not drawn');
  assert.deepEqual(buildClayPayload(s, { platform: 'basalt' }, NOW).CLAY_CURVE_INSET_UINT8, [7, 0, 7, 7, 0]);
});

test('CLAY_CURVE_INSET_UINT8 is omitted for aplite (WW_CURVE_INSET compiled out) but kept for unknown platforms', function() {
  const s = baseSettings();
  const aplite = buildClayPayload(s, { platform: 'aplite' }, NOW);
  assert.equal(Object.prototype.hasOwnProperty.call(aplite, 'CLAY_CURVE_INSET_UINT8'), false);
  // Even with every line on a temperature-axis metric, aplite never gets the tuple.
  const apliteAxis = buildClayPayload(Object.assign(baseSettings(),
    { secondaryLine: 'feels', thirdLine: 'dew', fourthLine: 'feels', fifthLine: 'dew' }), { platform: 'aplite' }, NOW);
  assert.equal(Object.prototype.hasOwnProperty.call(apliteAxis, 'CLAY_CURVE_INSET_UINT8'), false);
  // Unknown watchInfo must never drop a real feature (computeEnv convention).
  const unknown = buildClayPayload(s, null, NOW);
  assert.deepEqual(unknown.CLAY_CURVE_INSET_UINT8, [7, 0, 0, 0, 0]);
});

test('the Clay message carries the graph line styling', function() {
  const s = Object.assign(baseSettings(), {
    secondaryLine: 'wind', thirdLine: 'gust', theme: 'dark'
  });
  const p = buildClayPayload(s, { platform: 'emery' }, NOW);
  assert.ok(Array.isArray(p.CLAY_LINE_STYLE_UINT8));
  assert.equal(p.CLAY_LINE_STYLE_UINT8.length, 16);
  // Packed by the one resolver both the wire and the render read (line-style.js),
  // so the Clay tuple can't drift from what the graph builder assumes.
  assert.deepEqual(p.CLAY_LINE_STYLE_UINT8,
    lineStyle.buildLineStyleBytes(s, { platform: 'emery' }));
});

test('aplite gets the line styling too (it has the forecast graph)', function() {
  // Unlike the threshold blob / no-rain text / curve insets, nothing about the
  // graph's line colours is compiled out on aplite — it draws the same two metric
  // lines — so this tuple is NOT platform-gated. The full 16 bytes ship there too:
  // aplite parses [0..3] and ignores the tail blocks it has no arms for (the same
  // way pre-feature watches ignore bytes they postdate), which is cheaper than a
  // per-platform pack.
  const s = Object.assign(baseSettings(), {
    secondaryLine: 'wind', thirdLine: 'off', theme: 'dark'
  });
  assert.equal(buildClayPayload(s, { platform: 'aplite' }, NOW).CLAY_LINE_STYLE_UINT8.length, 16);
  // ... and an unknown watchInfo never drops it either.
  assert.equal(buildClayPayload(s, null, NOW).CLAY_LINE_STYLE_UINT8.length, 16);
});

test('CLAY_HR_SCALE falls back to 40-150 when unset or malformed', function() {
  const expected = 40 | (150 << 8);
  const s = baseSettings();
  assert.equal(buildClayPayload(s, { platform: 'diorite' }, NOW).CLAY_HR_SCALE, expected,
    'unset');
  s.hrScale = 'nonsense';
  assert.equal(buildClayPayload(s, { platform: 'diorite' }, NOW).CLAY_HR_SCALE, expected,
    'malformed');
  s.hrScale = '95-55';
  assert.equal(buildClayPayload(s, { platform: 'diorite' }, NOW).CLAY_HR_SCALE, expected,
    'inverted');
  s.hrScale = '300-400';
  assert.equal(buildClayPayload(s, { platform: 'diorite' }, NOW).CLAY_HR_SCALE, expected,
    'out of byte range');
});

// The schema ships the setting ON (schema.js), so the absent case here is not the
// shipped default -- it is what a settings blob that never carried the key sends.
test('CLAY_LARGE_GRAPH_FONT reflects the largeGraphFont setting (absent reads as off)', () => {
  assert.equal(buildClayPayload(baseSettings(), { platform: 'emery' }, NOW).CLAY_LARGE_GRAPH_FONT, false);
  const on = baseSettings();
  on.largeGraphFont = true;
  assert.equal(buildClayPayload(on, { platform: 'emery' }, NOW).CLAY_LARGE_GRAPH_FONT, true);
});

test('CLAY_LARGE_GRAPH_FONT rides every platform (only the WATCH gates it)', () => {
  // Unlike CLAY_NORAIN_TEXT / CLAY_CURVE_INSET_UINT8 / CLAY_THRESHOLDS_UINT8, this key is
  // NOT platform-gated on the phone: it is 11 B, every non-emery Clay bundle has room, and
  // sending it unconditionally means an emery watch can't be starved of the setting by a
  // watchInfo hiccup. The watch does the skipping -- config_wire.c only spends a dict_find
  // on it under PBL_PLATFORM_EMERY (config.h's field carries the same guard).
  const p = buildClayPayload(baseSettings(), { platform: 'aplite' }, NOW);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'CLAY_LARGE_GRAPH_FONT'), true);
});

// ── Dim backlight (CLAY_NIGHT_LIGHT_UINT8) ──────────────────────────

test('CLAY_NIGHT_LIGHT_UINT8 is the five bytes night-light.js packs', () => {
  const s = Object.assign(baseSettings(), {
    backlightDim: true, backlightDimMode: 'custom',
    backlightDimStartHour: '22', backlightDimEndHour: '6',
    backlightDimColor: '96,0,0'
  });
  const p = buildClayPayload(s, { platform: 'emery' }, NOW);
  assert.deepEqual(p.CLAY_NIGHT_LIGHT_UINT8, [96, 0, 0, 22, 6]);
  // Packed by the module, not re-derived here, so the tuple can't drift from the
  // resolution rules the settings page and telemetry read the same keys with.
  assert.deepEqual(p.CLAY_NIGHT_LIGHT_UINT8, nightLight.buildNightLightBytes(s));
  assert.equal(p.CLAY_NIGHT_LIGHT_UINT8.length, 5);
});

test('the Dim backlight window on the wire is the feature own hours, always', () => {
  // The battery saver's pair is a NEGATIVE control here: it disagrees at both ends,
  // so a reader that picked it up (this branch shipped exactly that for a while)
  // changes the bytes rather than passing by luck.
  const s = Object.assign(baseSettings(), {
    sleepStartHour: '1', sleepEndHour: '5',
    backlightDimStartHour: '22', backlightDimEndHour: '6',
    // Explicit, so this window test does not ride on whatever the colour default is.
    backlightDimColor: '96,0,0'
  });
  assert.deepEqual(buildClayPayload(s, { platform: 'emery' }, NOW).CLAY_NIGHT_LIGHT_UINT8,
    [96, 0, 0, 22, 6]);
  // A leftover backlightDimMode from a dev build of this branch decides nothing.
  ['custom', 'night', 'wat'].forEach((mode) => {
    const stale = Object.assign({}, s, { backlightDimMode: mode });
    assert.deepEqual(buildClayPayload(stale, { platform: 'emery' }, NOW).CLAY_NIGHT_LIGHT_UINT8,
      [96, 0, 0, 22, 6], 'stale backlightDimMode ' + mode + ' must not move the window');
  });
});

test('the Dim backlight switch OFF rides the wire as the zeroed tuple', () => {
  // start === end is the app's "never" window, so the watch needs no enabled flag.
  const s = Object.assign(baseSettings(), { backlightDim: false, backlightDimColor: '1,2,3' });
  assert.deepEqual(buildClayPayload(s, { platform: 'emery' }, NOW).CLAY_NIGHT_LIGHT_UINT8,
    [0, 0, 0, 0, 0]);
});

test('CLAY_NIGHT_LIGHT_UINT8 rides every platform (only the WATCH gates it)', () => {
  // The LED is emery-only, but computeEnv reports colorBacklight FALSE for an unknown
  // platform, so gating the key would starve a real emery watch of the setting over a
  // watchInfo hiccup -- CLAY_LARGE_GRAPH_FONT's reasoning above. Sending it everywhere
  // is harmless: light_set_color_rgb888() is a documented no-op without the LED.
  [{ platform: 'aplite' }, { platform: 'basalt' }, { platform: 'chalk' }, null]
    .forEach((watchInfo) => {
      const p = buildClayPayload(baseSettings(), watchInfo, NOW);
      assert.equal(p.CLAY_NIGHT_LIGHT_UINT8.length, 5,
        'dropped for ' + JSON.stringify(watchInfo));
    });
});

test('every Dim backlight key moves the Clay payload (so the outbox re-sends it)', () => {
  // outbox.sendClay keys its one change-detector category on the whole payload, so a
  // setting that leaves every byte alone is a setting the watch never hears about.
  function base() {
    return Object.assign(baseSettings(), {
      backlightDim: true,
      backlightDimStartHour: '22', backlightDimEndHour: '6',
      backlightDimColor: '10,20,30'
    });
  }
  const packed = JSON.stringify(buildClayPayload(base(), { platform: 'emery' }, NOW));
  const edits = {
    backlightDim: false, backlightDimStartHour: '21',
    backlightDimEndHour: '5', backlightDimColor: '11,20,30'
  };
  Object.keys(edits).forEach((key) => {
    const s = base();
    s[key] = edits[key];
    assert.notEqual(JSON.stringify(buildClayPayload(s, { platform: 'emery' }, NOW)), packed,
      key + ' must dirty the Clay payload');
  });
  // ...and the mirror image: a key the Nighttime card no longer has must leave the
  // payload byte-identical, or a stale value in storage buys a needless send.
  ['backlightDimMode', 'sleepNightMode', 'sleepNightStartHour', 'sleepNightEndHour']
    .forEach((key) => {
      const s = base();
      s[key] = 'custom';
      assert.equal(JSON.stringify(buildClayPayload(s, { platform: 'emery' }, NOW)), packed,
        key + ' is retired and must not dirty the Clay payload');
    });
});

// ── Custom layout wire branch ──────────────────────────────────────────────

test('layoutPreset custom compiles the per-view keys onto CLAY_VIEW_*', () => {
  const s = Object.assign(baseSettings(), {
    layoutPreset: 'custom', healthMode: 'off', radarMode: 'off',
    viewCount: '2',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'none', viewBody1: 'forecast', viewUpper1: 'off', viewLower1: 'off', viewOrder1: 'CTAB',
    viewClockOff1: true, viewStripOff1: true,
  });
  const p = buildClayPayload(s, { platform: 'basalt' }, NOW);
  const want = viewCycle.buildCustomCycle(s).map(viewCycle.packSpec);
  assert.deepStrictEqual([p.CLAY_VIEW_0, p.CLAY_VIEW_1, p.CLAY_VIEW_2], [want[0], want[1], 0]);
  assert.equal(p.CLAY_VIEW_1 & 0xC00, 0xC00, 'flick carries clockOff+stripOff');
  assert.equal(p.CLAY_VIEW_1 >> 12, viewCycle.orderCode('CTAB'), 'order code rides bits 12-15');
});

test('an aplite watch folds custom to the EXPLICIT compactCal preset cycle', () => {
  const s = Object.assign(baseSettings(), {
    layoutPreset: 'custom', healthMode: 'off', radarMode: 'off',
    // Legacy residue that must NOT redirect the fold:
    topViewMode: 'full',
    viewCount: '2', viewTop0: 'none', viewOrder0: 'ABCT',
  });
  const p = buildClayPayload(s, { platform: 'aplite' }, NOW);
  const compact = viewCycle.buildViewCycle('compactCal', 'off', 'off', false).map(viewCycle.packSpec);
  assert.deepStrictEqual([p.CLAY_VIEW_0, p.CLAY_VIEW_1, p.CLAY_VIEW_2],
    [compact[0], compact[1] || 0, compact[2] || 0]);
  assert.equal(p.CLAY_VIEW_0 & 0xFC00, 0, 'no custom bits reach an aplite watch');
});

test('an UNKNOWN platform is treated as custom-capable (missing watchInfo never folds)', () => {
  const s = Object.assign(baseSettings(), {
    layoutPreset: 'custom', healthMode: 'off', radarMode: 'off',
    viewCount: '1', viewTop0: 'none', viewBody0: 'forecast',
    viewUpper0: 'off', viewLower0: 'off', viewOrder0: 'TACB',
  });
  const p = buildClayPayload(s, null, NOW);
  assert.deepStrictEqual(p.CLAY_VIEW_0,
    viewCycle.buildCustomCycle(s).map(viewCycle.packSpec)[0]);
});

// --- the auto theme switch, end to end over the blob the phone really stores -------
// index.js builds the Clay payload from themeSchedule.effectiveSettings(app.settings,
// isNight); app.settings holds colour keys as 0xRRGGBB ints (parseResponse /
// seedDefaults). A colour platform: on B&W hardware theme_pick() ignores the colour and
// would hide the bug.
{
  const themeSchedule = require('../src/pkjs/theme-schedule');
  const settingsLib = require('../src/pkjs/settings');
  const claySettings = require('../src/pkjs/clay-settings');
  const pebbleColors = require('../src/pkjs/pebble-colors');
  const statusThresholds = require('../src/pkjs/status-thresholds');
  const BASALT = { platform: 'basalt', model: 'pebble_time_black' };
  const savedBlob = (pageState) =>
    settingsLib.parseResponse(encodeURIComponent(JSON.stringify(pageState)));

  test('auto theme, light day / dark night: CLAY_COLOR_TIME is white (an int) at night', () => {
    const blob = savedBlob({ themeAuto: true, theme: 'light', themeNight: 'dark', colorTime: '#000000' });
    const day = buildClayPayload(themeSchedule.effectiveSettings(blob, false), BASALT, NOW);
    const night = buildClayPayload(themeSchedule.effectiveSettings(blob, true), BASALT, NOW);
    assert.strictEqual(day.CLAY_THEME, 1);
    assert.strictEqual(day.CLAY_COLOR_TIME, 0x000000);
    assert.strictEqual(night.CLAY_THEME, 0);
    assert.strictEqual(night.CLAY_COLOR_TIME, 0xFFFFFF);
  });

  test('auto theme, seeded dark day / light night: CLAY_COLOR_TIME is black at night', () => {
    const blob = claySettings.getDefaults({ white: pebbleColors.GColorWhite,
      folly: pebbleColors.GColorFolly, holiday: pebbleColors.GColorBlueMoon });
    blob.themeAuto = true; blob.themeNight = 'light';
    const night = buildClayPayload(themeSchedule.effectiveSettings(blob, true), BASALT, NOW);
    assert.strictEqual(night.CLAY_THEME, 1);
    assert.strictEqual(night.CLAY_COLOR_TIME, 0x000000);
  });

  test('auto theme, light day / dark night: an auto threshold danger colour packs white', () => {
    const blob = savedBlob({ themeAuto: true, theme: 'light', themeNight: 'dark',
      threshWindWarn: '20', threshWindDanger: '40', threshWindDangerColor: '#000000' });
    const night = buildClayPayload(themeSchedule.effectiveSettings(blob, true), BASALT, NOW);
    const wind = statusThresholds.KINDS.map((k) => k.key).indexOf('Wind');
    assert.strictEqual(
      night.CLAY_THRESHOLDS_UINT8[statusThresholds.COLORS_OFFSET + 2 * wind + 1], 0xFF,
      'GColorWhite (argb 0xFF), not the day face\'s black (0xC0)');
  });
}
