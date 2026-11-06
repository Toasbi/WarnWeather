#!/usr/bin/env node
'use strict';

// Store art fixtures: the watch screens of the appstore set that scripts/store-art.py builds
// (the showcase GIF and the five store screens, per platform). Each scene is one capture, a
// fixture of its own (art-<id>.json, plus art-<id>-<platform>.json for a platform variant),
// shot by scripts/capture-store-art.sh into screenshot/<version>/store-art/frames/<platform>/.
//
// Two kinds of scene:
// - 'full': the watchface as the watch draws it, clock and all (the GIF's opening, its views
//   and layouts, the store screens).
// - 'panel': the same, with the clock drawn in black (colorTime 0). On a colour watch its
//   band comes out empty, and store-art.py draws a settings row or a caption there while the
//   rest of the screen stays the watch's own pixels. A black and white watch ignores the
//   clock colour (theme_pick takes its black and white arm), so there the panel covers the
//   clock: diorite, flint and aplite share basalt's 144 x 168 layout, and store-art.py takes
//   the band from basalt's capture of the same scene.
//
// The TABLE ORDER is the capture order only; store-art.py owns the storyboard and picks
// scenes by id. `node scripts/gen-store-art-fixtures.js --manifest` prints the scenes, their
// kind, flicks and platforms as JSON, which is how store-art.py and capture-store-art.sh
// learn them: this table is the one list.
//
// The weather is the Berlin base (berlin.json), or windows of the 68-hour forecast-long.json
// (the forecast length scenes, and the UV slot's morning and evening), or stripes.json for
// the cloud cover stripe. Every scene keeps the base's On demand pin (the Watch Status Bar's
// right side ticks Battery alone; test/curated-fixtures-on-demand.test.js) except the one
// that shows the weather alerts on purpose (alerts-on). The rain alert and the health
// numbers are canned at build time (the countdown block, WW_HEALTH_FIXTURE=1).

const fs = require('fs');
const path = require('path');
const { withTheme } = require('./gen-showcase-fixtures');

const PLATFORMS = ['emery', 'basalt', 'diorite', 'flint', 'aplite'];
// Not aplite: the frozen lean variant has no Alerts, radar, health, third and fourth metric
// lines, line styles, Weather only or custom layouts (AGENTS.md, README).
const NOT_APLITE = ['emery', 'basalt', 'diorite', 'flint'];
// Pebble Time 2 alone has the forecast length and the left axis settings (schema.js).
const EMERY = ['emery'];

const BASES = {
  berlin: path.join('fixtures', 'berlin.json'),
  long: path.join('fixtures', 'forecast-long.json'),
  stripes: path.join('fixtures', 'stripes.json'),
};

// The series a window slices (any the base carries).
const SERIES = ['temps', 'precipPct', 'rainMm', 'uvIndex', 'pressureHpa', 'windKmh', 'gustKmh',
  'cloudPct', 'feelsTemps', 'dewTemps'];
// Berlin in June, as the bases have it (berlin.json, forecast-long.json).
const SUNRISE = { hour: 4, minute: 46 };
const SUNSET = { hour: 21, minute: 29 };

// Rain on its way in 15 minutes, behind the alerts scenes' rain alert (no scene shows the radar
// itself): a shower that builds to a downpour and tapers off over the next 75 minutes; the
// alert's text is canned to match (tier 3, "Rain in 15'": the wscript bakes it from the
// countdown block).
const RAIN_SOON = {
  exact: [0, 0, 0, 0.4, 0.9, 1.6, 2.4, 3.6, 4.8, 4.1, 3.2, 2.6, 1.9, 1.4, 1.0, 0.7, 0.5, 0.3, 0.2, 0.1, 0, 0, 0, 0],
  area: [0, 0, 0.2, 0.7, 1.3, 2.1, 3.0, 4.4, 5.6, 5.0, 4.0, 3.3, 2.5, 1.9, 1.4, 1.0, 0.7, 0.5, 0.3, 0.2, 0.1, 0, 0, 0],
};
const RAIN_SOON_ALERT = { mins: 15, raining: false, tier: 3 };

// What every scene shares: the dark theme, the Roboto clock, no radar, health or alerts
// unless the scene asks (the Watch Status Bar's right side pinned to Battery, as every curated
// fixture is: test/curated-fixtures-on-demand.test.js), and the forecast's own slots.
const COMMON = {
  theme: 'dark', timeFont: 'roboto', healthMode: 'off', radarProvider: 'disabled',
  rainCountdownHorizon: '0', layoutPreset: 'compactCal', dayNightShading: true, forecastHours: '24',
  statusTopOnDemandRightItems: 'battery',
  statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi',
};
// The forecast graph's lines, three looks: rain (the default look), wind, and the stripes.
const LINES_RAIN = {
  secondaryLine: 'precip_prob', secondaryLineFill: true, secondaryLineStyle: 'line',
  thirdLine: 'off', fourthLine: 'off', fifthLine: 'off', barSource: 'rain', rainBarColor: 'multicolor',
};
const LINES_WIND = {
  secondaryLine: 'wind', secondaryLineFill: true, secondaryLineStyle: 'line',
  thirdLine: 'gust', thirdLineStyle: 'x', fourthLine: 'off', fifthLine: 'off', barSource: 'off',
};
// stripes.json's data: rain chance and cloud cover as stripes along the top, UV as dots,
// wind as a line, white rain bars.
const LINES_MIX = {
  secondaryLine: 'precip_prob', secondaryLineFill: false, secondaryLineStyle: 'stripeTop',
  thirdLine: 'uv', thirdLineStyle: 'dots', fourthLine: 'wind', fourthLineStyle: 'line',
  fifthLine: 'cloud', fifthLineStyle: 'stripeTop', barSource: 'rain', rainBarColor: 'white',
  windScale: 'mid',
};
// A custom layout of one view, the clock under its top area (order T C A B); the scene names
// its top area, graph and status bars.
const CUSTOM_ONE = {
  layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '1', viewOrder0: 'TCAB',
  viewBodySize0: 'fill', viewAlign0: 'clock', viewStripOff0: false,
};
// The weather alerts: UV and gusts with their levels, shown as their value; rain on the left.
const ALERT_LEVELS = {
  threshUvOn: true, threshUvWarn: '5', threshUvDanger: '8',
  threshGustOn: true, threshGustWarn: '30', threshGustDanger: '60',
  alertUvDisplay: 'value', alertGustDisplay: 'value',
};

// Scene table. `base` names a BASES entry (berlin when absent) and `window` cuts hours from
// it: {start, hours}, start counting from the base's first hour. `mode` is 'full' or
// 'panel' (see the top); `flicks` the wrist flicks before the screenshot; `platforms` where
// it is captured (all five when absent); `variants` per-platform clay layered on the scene's.
const SCENES = [
  // The opening: the classic look. Compact calendar, the forecast with rain chance and the
  // rain bars, the Watch Status Bar's own slots.
  { id: 'hero', mode: 'full', clay: Object.assign({}, LINES_RAIN) },
  // Graph lines, on the no-calendar layout's bigger graph.
  { id: 'lines-rain', mode: 'panel', clay: Object.assign({ layoutPreset: 'noCal' }, LINES_RAIN) },
  { id: 'lines-wind', mode: 'panel', clay: Object.assign({ layoutPreset: 'noCal' }, LINES_WIND) },
  { id: 'lines-mix', mode: 'panel', base: 'stripes', platforms: NOT_APLITE,
    clay: Object.assign({ layoutPreset: 'noCal' }, LINES_MIX) },
  // Forecast length on 68 hours of data: 12 hours and the long span. The left axis is On
  // graph, so the long span shows its most hours (66, forecast-span-hours.js).
  { id: 'span-12', mode: 'panel', base: 'long', platforms: EMERY,
    clay: Object.assign({ layoutPreset: 'noCal', forecastHours: '12', forecastAxisNumbers: 'graph' }, LINES_RAIN) },
  { id: 'span-long', mode: 'panel', base: 'long', platforms: EMERY,
    clay: Object.assign({ layoutPreset: 'noCal', forecastHours: '48', forecastAxisNumbers: 'graph' }, LINES_RAIN) },
  // The left axis' values: on the axis, on the graph, off.
  { id: 'axis-axis', mode: 'panel', platforms: EMERY,
    clay: Object.assign({ layoutPreset: 'noCal', forecastAxisNumbers: 'axis' }, LINES_RAIN) },
  { id: 'axis-graph', mode: 'panel', platforms: EMERY,
    clay: Object.assign({ layoutPreset: 'noCal', forecastAxisNumbers: 'graph' }, LINES_RAIN) },
  { id: 'axis-off', mode: 'panel', platforms: EMERY,
    clay: Object.assign({ layoutPreset: 'noCal', forecastAxisNumbers: 'off' }, LINES_RAIN) },
  // Alerts. Calm: nothing reaches a warn level, the bar shows its slots. On: rain in 15
  // minutes on the left, UV and gusts past their warn levels on the right. Line: the UV line
  // drawn only where it reaches its warn level.
  { id: 'alerts-calm', mode: 'panel', platforms: NOT_APLITE,
    clay: Object.assign({}, LINES_RAIN, ALERT_LEVELS) },
  { id: 'alerts-on', mode: 'panel', platforms: NOT_APLITE,
    clay: Object.assign({}, LINES_RAIN, ALERT_LEVELS, {
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
      statusTopOnDemandRightItems: 'battery,uv,gust' }),
    radar: RAIN_SOON, countdown: RAIN_SOON_ALERT },
  { id: 'alerts-line', mode: 'panel', platforms: NOT_APLITE,
    clay: Object.assign({}, ALERT_LEVELS, {
      secondaryLine: 'uv', secondaryLineFill: true, secondaryLineStyle: 'line', uvLineShow: 'alert',
      thirdLine: 'off', fourthLine: 'off', fifthLine: 'off', barSource: 'off' }) },
  // The UV slot's value selection, at 08:00 (UV 3 now, 8 at noon) and at 20:00 (today's sun
  // is gone, tomorrow peaks at 7): Now, Day max, Both, and Both rolled on to tomorrow. On the
  // no-calendar layout, whose clock band holds the settings card on a 144 px watch too.
  { id: 'max-now', mode: 'panel', base: 'long', window: { start: 17, hours: 51 },
    clay: Object.assign({ layoutPreset: 'noCal' }, LINES_RAIN, { statusForecastRight: 'uv', uvSlotDisplay: 'current' }) },
  { id: 'max-day', mode: 'panel', base: 'long', window: { start: 17, hours: 51 },
    clay: Object.assign({ layoutPreset: 'noCal' }, LINES_RAIN, { statusForecastRight: 'uv', uvSlotDisplay: 'max' }) },
  { id: 'max-both', mode: 'panel', base: 'long', window: { start: 17, hours: 51 },
    clay: Object.assign({ layoutPreset: 'noCal' }, LINES_RAIN, { statusForecastRight: 'uv', uvSlotDisplay: 'both' }) },
  { id: 'max-tomorrow', mode: 'panel', base: 'long', window: { start: 29, hours: 39 },
    clay: Object.assign({ layoutPreset: 'noCal' }, LINES_RAIN, { statusForecastRight: 'uv', uvSlotDisplay: 'both' }) },
  // The three-week calendar.
  { id: 'calendar', mode: 'panel', clay: Object.assign({ layoutPreset: 'fullCal' }, LINES_RAIN) },
  // Views and layouts, whole: the health view (No calendar's health flick, set up as a custom
  // layout's first view: the same view with no flick to time), Weather only without the rain
  // radar (radar Off: the clock, the weather row and the big graph), and the Light theme.
  { id: 'view-health', mode: 'full', platforms: NOT_APLITE,
    clay: Object.assign({ healthMode: 'all', hrScale: '50-100' }, LINES_RAIN, CUSTOM_ONE, {
      viewTop0: 'none', viewBody0: 'health', viewUpper0: 'health', viewLower0: 'off' }),
    // Steps, sleep and the heart rate on Pebble Time 2; Pebble 2's own defaults would show its
    // heart rate too, as '--' (the emulator measures none), so it shows steps and sleep as the
    // watches without a heart rate sensor do.
    variants: { emery: { statusHealthMid: 'sleep', statusHealthRight: 'hr' },
      diorite: { statusHealthMid: 'empty', statusHealthRight: 'sleep' } } },
  { id: 'layout-weather', mode: 'full', platforms: NOT_APLITE,
    clay: Object.assign({ layoutPreset: 'weatherOnly', radarMode: 'off' }, LINES_WIND) },
  { id: 'layout-light', mode: 'full', platforms: NOT_APLITE, theme: 'light',
    clay: Object.assign({ layoutPreset: 'noCal' }, LINES_RAIN) },
  // aplite's own layouts: the three-week calendar and the big forecast, whole.
  { id: 'layout-full', mode: 'full', platforms: ['aplite'],
    clay: Object.assign({ layoutPreset: 'fullCal' }, LINES_RAIN) },
  { id: 'layout-nocal', mode: 'full', platforms: ['aplite'],
    clay: Object.assign({ layoutPreset: 'noCal' }, LINES_WIND) },
  // For the store screens, whole: the alerts as alerts-on shows them, and aplite's UV graph.
  { id: 'alerts-full', mode: 'full', platforms: NOT_APLITE,
    clay: Object.assign({}, LINES_RAIN, ALERT_LEVELS, {
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
      statusTopOnDemandRightItems: 'battery,uv,gust' }),
    radar: RAIN_SOON, countdown: RAIN_SOON_ALERT },
  { id: 'aplite-uv', mode: 'full', platforms: ['aplite'],
    clay: { layoutPreset: 'noCal', secondaryLine: 'uv', secondaryLineFill: true, barSource: 'off',
      statusForecastRight: 'uv', uvSlotDisplay: 'both' } },
];

/**
 * Deep-copy JSON data.
 * @param {*} value JSON-safe value.
 * @returns {*} A copy.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The next two sun events after a minute of the day, in the fixture's readable form.
 * @param {number} nowMin Minutes past midnight.
 * @returns {{type: string, dayOffset: number, hour: number, minute: number}[]} Two events.
 */
function nextSunEvents(nowMin) {
  const rise = (d) => ({ type: 'sunrise', dayOffset: d, hour: SUNRISE.hour, minute: SUNRISE.minute });
  const set = (d) => ({ type: 'sunset', dayOffset: d, hour: SUNSET.hour, minute: SUNSET.minute });
  if (nowMin < SUNRISE.hour * 60 + SUNRISE.minute) { return [rise(0), set(0)]; }
  if (nowMin < SUNSET.hour * 60 + SUNSET.minute) { return [set(0), rise(1)]; }
  return [rise(1), set(1)];
}

/**
 * A scene's weather from its base: the whole base at minute 0 of its hour, or a window of
 * it (`hours` hours from the base's `start`-th hour) with the clock, the current reading and
 * the sun events moved to the window's first hour.
 * @param {Object} base A parsed base fixture.
 * @param {?{start: number, hours: number}} window The window, or null for the whole base.
 * @returns {Object} The fixture, before the scene's settings.
 */
function weatherFrom(base, window) {
  const fx = clone(base);
  fx.watch.now = Object.assign({}, fx.watch.now, { minute: 0, second: 0 });
  if (!window) { return fx; }
  const w = fx.weather;
  const now = base.watch.now;
  const first = new Date(now.year, now.month - 1, now.day + (w.startDayOffset || 0), w.startHour + window.start);
  for (const key of SERIES) {
    if (!Array.isArray(w[key])) { continue; }
    if (w[key].length < window.start + window.hours) {
      throw new Error('the base\'s ' + key + ' ends before the window does');
    }
    w[key] = w[key].slice(window.start, window.start + window.hours);
  }
  fx.watch.now = { year: first.getFullYear(), month: first.getMonth() + 1, day: first.getDate(),
    hour: first.getHours(), minute: 0, second: 0 };
  w.startHour = first.getHours();
  delete w.startDayOffset;
  w.currentTemp = w.temps[0];
  if (Array.isArray(w.feelsTemps)) { w.currentFeels = w.feelsTemps[0]; }
  w.sunEvents = nextSunEvents(first.getHours() * 60);
  return fx;
}

/**
 * One scene's fixture for one platform (or its base fixture, without a variant).
 * @param {Object} scene A SCENES entry.
 * @param {Object} base The parsed base fixture.
 * @param {?Object} variantClay The platform variant's settings, or null.
 * @returns {Object} The fixture.
 */
function buildScene(scene, base, variantClay) {
  const fx = weatherFrom(base, scene.window || null);
  let clay = Object.assign({}, base.claySettings, COMMON, scene.clay, variantClay || {});
  if (scene.mode === 'panel') { clay.colorTime = 0; }
  if (scene.theme && scene.theme !== clay.theme) {
    delete clay.theme;
    clay = withTheme(Object.assign({ theme: 'dark' }, clay), scene.theme);
  }
  fx.claySettings = clay;
  if (scene.radar) {
    fx.weather.rainRadarExactMm = scene.radar.exact.slice();
    fx.weather.rainRadarAreaMm = scene.radar.area.slice();
  }
  // Build-only (the phone ignores it): the wscript bakes the rain alert from it.
  if (scene.countdown) { fx.countdown = Object.assign({}, scene.countdown); }
  return fx;
}

/**
 * The platforms a scene is captured on.
 * @param {Object} scene A SCENES entry.
 * @returns {string[]} Platform names.
 */
function scenePlatforms(scene) {
  return scene.platforms || PLATFORMS;
}

/**
 * The fixture slug a platform captures a scene from: its variant's, or the scene's own.
 * @param {Object} scene A SCENES entry.
 * @param {string} platform Platform name.
 * @returns {string} Fixture slug (fixtures/<slug>.json).
 */
function fixtureFor(scene, platform) {
  return (scene.variants && scene.variants[platform]) ? 'art-' + scene.id + '-' + platform : 'art-' + scene.id;
}

/**
 * Write every scene's fixtures (and their platform variants), clearing the old ones first.
 * @param {{outDir?: string}} [opts] Where to write (fixtures/ by default).
 * @returns {string[]} The written paths.
 */
function generateStoreArtFixtures(opts = {}) {
  const outDir = opts.outDir || 'fixtures';
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(outDir)) {
    if (/^art-.+\.json$/.test(name)) { fs.unlinkSync(path.join(outDir, name)); }
  }
  const bases = {};
  const written = [];
  for (const scene of SCENES) {
    const key = scene.base || 'berlin';
    if (!bases[key]) { bases[key] = JSON.parse(fs.readFileSync(BASES[key], 'utf8')); }
    const write = (slug, fx) => {
      const p = path.join(outDir, slug + '.json');
      fs.writeFileSync(p, JSON.stringify(fx, null, 2) + '\n');
      written.push(p);
    };
    write('art-' + scene.id, buildScene(scene, bases[key], null));
    for (const platform of Object.keys(scene.variants || {})) {
      write('art-' + scene.id + '-' + platform, buildScene(scene, bases[key], scene.variants[platform]));
    }
  }
  return written;
}

/**
 * The Forecast length options as the settings page names them for a scene's settings on a
 * Pebble Time 2 (forecast-span-hours.js spanOptions: the long span named by the hours it
 * shows), or null for a scene that doesn't set the length.
 * @param {Object} scene A SCENES entry.
 * @returns {?string[]} The option labels, e.g. ['12 h', '24 h', '66 h'].
 */
function spanLabels(scene) {
  if (!scene.clay.forecastHours) { return null; }
  const forecastSpanHours = require('../src/pkjs/forecast-span-hours.js');
  const key = scene.base || 'berlin';
  const base = JSON.parse(fs.readFileSync(BASES[key], 'utf8'));
  const settings = Object.assign({}, base.claySettings, COMMON, scene.clay);
  return forecastSpanHours.spanOptions(settings, { platform: 'emery', forecastSpan: true, color: true })
    .map((option) => option[0]);
}

/**
 * The scenes as capture-store-art.sh and store-art.py read them.
 * @returns {{id: string, mode: string, flicks: number, platforms: string[], fixtures: Object,
 *   spanLabels: ?string[]}[]} One entry per scene; `fixtures` maps each platform to the slug it
 *   captures from.
 */
function manifest() {
  return SCENES.map((scene) => {
    const fixtures = {};
    for (const platform of scenePlatforms(scene)) { fixtures[platform] = fixtureFor(scene, platform); }
    return { id: scene.id, mode: scene.mode, flicks: scene.flicks || 0, platforms: scenePlatforms(scene),
      fixtures, spanLabels: spanLabels(scene) };
  });
}

if (require.main === module) {
  if (process.argv.includes('--manifest')) {
    process.stdout.write(JSON.stringify(manifest(), null, 2) + '\n');
  } else {
    const written = generateStoreArtFixtures();
    console.log('Wrote ' + written.length + ' store art fixtures');
  }
}

module.exports = { generateStoreArtFixtures, manifest, SCENES, PLATFORMS, NOT_APLITE, EMERY, scenePlatforms,
  fixtureFor, weatherFrom, nextSunEvents };
