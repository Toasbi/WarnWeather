#!/usr/bin/env node
'use strict';

// Showcase fixtures: eight static scenes (no scrolling) demonstrating different layouts
// and functions — five on the Berlin base, three Miami scenes backed by fixtures of their
// own (`fixture`). Duplicated in spirit from gen-timelapse-fixtures.js but far simpler —
// each scene is one frame, defined by claySettings overrides + a crafted rain-radar
// segment (for the countdown scenes) + how many wrist-flicks capture-showcase.sh must
// send to reach the intended view. The TABLE ORDER is the showcase and reel order; ids
// only name the frames (scene_<id>.png), so a frame keeps its id when scenes move.
// Health numbers come from the compile-time health_fixture.c twin (WW_HEALTH_FIXTURE),
// not from these files.

const fs = require('fs');
const path = require('path');

const BASE_PATH = path.join('fixtures', 'berlin.json');

/**
 * A scene's settings after switching its theme, as the settings page would switch it.
 * Picking a theme there runs the themeConvert hook, which flips every polarity-dependent
 * colour still on the old theme's default (the white clock -> black, the bar colour
 * modes, ...). A fixture sets `theme` directly and would skip that — a Light scene
 * would keep the white clock on a white face. So run the same conversion
 * (theme-flip.js) over the settings the watch would hold (the defaults, then the
 * fixture), and keep what it changed.
 * @param {Object} clay The fixture's claySettings, without the scene's theme.
 * @param {string} newTheme The scene's theme.
 * @returns {Object} claySettings with the theme and the flipped colours.
 */
function withTheme(clay, newTheme) {
  const claySettings = require('../src/pkjs/clay-settings.js');
  const pebbleColors = require('../src/pkjs/pebble-colors.js');
  const themeFlip = require('../src/pkjs/theme-flip.js');
  const defaults = claySettings.getDefaults({ white: pebbleColors.GColorWhite,
    folly: pebbleColors.GColorFolly, holiday: pebbleColors.GColorBlueMoon });
  const S = { ...defaults, ...clay };
  const before = { ...S };
  themeFlip.applyThemeConvert(S, before.theme || 'dark', newTheme);
  const out = { ...clay, theme: newTheme };
  for (const k of Object.keys(S)) {
    if (S[k] !== before[k]) { out[k] = S[k]; }
  }
  return out;
}

// A round watch.now (minute 0). The forecast/radar anchor is the base startHour, so a
// minute-0 now lands the rain-countdown's now_slot exactly at radar slot 0 — the crafted
// segment below is then read starting "now".
const NOW_OVERRIDE = { minute: 0, second: 0 };

const RADAR_SLOTS = 24;   // rain_countdown.c RC_NUM_SLOTS (5-min slots)

/**
 * Build a RADAR_SLOTS-long mm series with `mm` at slots [start, start+len), else 0.
 *
 * @param {number} start First slot (0 == now) that carries rain.
 * @param {number} len Number of consecutive rainy slots.
 * @param {number} mm Rain rate in mm/h for those slots.
 * @returns {number[]} The radar series.
 */
function segment(start, len, mm) {
  const a = new Array(RADAR_SLOTS).fill(0);
  for (let i = start; i < start + len && i < RADAR_SLOTS; i++) {
    a[i] = mm;
  }
  return a;
}

// Rain (~1.5 mm/h → tier 3 = "rain") arriving in 15 min (slot 3) for 20 min (4 slots).
const RAIN_APPROACH_EXACT = segment(3, 4, 1.5);
const RAIN_APPROACH_AREA = segment(2, 6, 1.8);
// Rain (~1.5 mm/h → tier 3 = "rain") falling now (slot 0) for 20 min (4 slots).
const RAIN_NOW_EXACT = segment(0, 4, 1.5);
const RAIN_NOW_AREA = segment(0, 5, 1.8);

// Health-status-row slot pins for the emery variant. emery (Pebble Time 2) is the only HR
// platform in the showcase set; the others (aplite/basalt/flint) have no HR sensor. The
// scenes don't pin the health-row slots, so packLine bakes the *base* health-right default
// (walked distance) on every platform — so a plain capture shows distance, not the heart
// rate a real Pebble Time 2 renders. Scenes needing per-platform slots declare a
// `variants: {<platform>: clayOverrides}` map (mirroring gen-reel-fixtures.js): each
// variant writes its own showcase-<id>-<platform>.json layered on the scene clay, and
// capture-showcase.sh shoots that platform from it while the rest use the base fixture.
const HR_EMERY = { statusHealthMid: 'sleep', statusHealthRight: 'hr' };

// The platforms the showcase is captured on, and the colour ones among them. A scene
// with `platforms` is captured, shown and put in the reel intro only there.
const SHOWCASE_PLATFORMS = ['aplite', 'basalt', 'flint', 'emery'];
const COLOUR_PLATFORMS = ['basalt', 'flint', 'emery'];

/**
 * Target date for scene 4's date-countdown slot, 21 days out from TODAY.
 * The countdown TEXT is formatted phone-side against the real clock (status-lines.js
 * packLine → formatCountdown(new Date())), not the fixture's watch.now — so the target
 * has to move with the generation day for the capture to render "21d".
 * @returns {string} YYYY-MM-DD
 */
function countdownTarget() {
  const t = new Date(Date.now() + 21 * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}

// Scene table. `clay` overrides the Berlin base claySettings; `flicks` is how many wrist
// flicks capture-showcase.sh sends before the screenshot to reach the intended view;
// `radar` (when set) replaces the base radar series so the rain countdown reads a
// specific state.
/**
 * Feels-like weather override for scene 4 (the temp slot's actual|feels pair). The Berlin base carries no feels data, so
 * derive it from the base temps: a wind-chill-style drop of wind/4 °F (the fixture's
 * internal unit), which puts the current 75 °F / 24 °C at 70 °F / 21 °C.
 * @param {Object} weather The base fixture's weather block.
 * @returns {{feelsTemps: number[], currentFeels: number}} Fields merged into the frame.
 */
function feelsFrom(weather) {
  const drop = (i) => Math.round((weather.windKmh[i] || 0) / 4);
  return {
    feelsTemps: weather.temps.map((t, i) => t - drop(i)),
    currentFeels: weather.currentTemp - drop(0),
  };
}
// Clock fonts (user call): 1+2 roboto, 4 leco, 5+6 bitham; the Miami scenes (7-9)
// keep the default roboto. Roboto and Bitham draw from the anti-aliased glyph strips on
// basalt/emery; leco stays on the system font. The reel intro previews all three.
const SCENES = [
  {
    // Full top view (classic 3-row calendar) with a quiet top strip: calendar week
    // left, date mid, the watch battery right. Weather status row temp / city /
    // sunrise-sunset. Graph: temp + filled precip line, multicolour rain bars, no
    // third/fourth line. No rain countdown (radar off) so the top strip shows its slots.
    // largeGraphFont off (emery-only toggle, default on): the smaller axis labels
    // match the status bar's font in this dense layout.
    id: 1, flicks: 0,
    clay: {
      layoutPreset: 'fullCal', healthMode: 'off',
      secondaryLine: 'precip_prob', secondaryLineFill: true, secondaryLineStyle: 'line',
      thirdLine: 'off', fourthLine: 'off',
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'disabled', rainCountdownHorizon: '0',
      timeFont: 'roboto', largeGraphFont: false,
      statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'battery',
      statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun',
    },
    radar: null,
  },
  {
    // Compact-DENSE: weather & health status shown together by default (no flick needed),
    // with a different-looking forecast (filled wind + dotted gust, no rain bars) and
    // a "Rain in 15'" countdown over the top strip's left/mid, sunset on the right.
    // The countdown is baked (countdown block) and flicks stay 0, so the radar view
    // never shows. largeGraphFont off (emery-only toggle): the smaller axis labels
    // match the dense status rows.
    // No threshold highlighting here (user call: too busy for the intro scenes);
    // the left slot stays wind to match the scene's wind+gust graph.
    // Captured only (inShowcase: false): out of the GIF and the reel since 1.23.0, which
    // show 1, the Miami scenes and 6 (user call: too many pictures).
    id: 2, flicks: 0, variants: { emery: HR_EMERY }, inShowcase: false,
    clay: {
      layoutPreset: 'compactDense', healthMode: 'status',
      secondaryLine: 'wind', secondaryLineFill: true, thirdLine: 'gust', barSource: 'off',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
      timeFont: 'roboto', largeGraphFont: false,
      statusTopRight: 'sun',
      statusForecastLeft: 'wind', statusForecastRight: 'gust',
    },
    radar: { exact: RAIN_APPROACH_EXACT, area: RAIN_APPROACH_AREA },
    countdown: { text: "Rain in 15'", tier: 3 },
  },
  // Miami, from the fixtures of the same name (live OpenWeatherMap data, pinned): UV as
  // dots, cloud cover and rain chance as top stripes, feels-like as a curve. Colour
  // watches only — aplite has no stripes, fourth line, radar or custom layout. Ids 7-9
  // are new; the table ORDER (not the id) is the showcase and reel order.
  { id: 7, flicks: 0, fixture: 'miami-stripes-cal', platforms: COLOUR_PLATFORMS },
  // The custom flick view: no top bar, a 3-row radar with the no-rain text and sky rows.
  { id: 8, flicks: 1, fixture: 'miami-radar-flick', platforms: COLOUR_PLATFORMS },
  { id: 9, flicks: 0, fixture: 'miami-stripes', platforms: COLOUR_PLATFORMS },
  {
    // Compact 2-row calendar with every status slot bold (mirrors the user's real-watch
    // look): a bold date in the top-mid — flanked by a date-countdown ("21d") and steps
    // on emery, narrow week/UV elsewhere — over a temp / city / AQI forecast bar whose
    // temp slot shows actual|feels-like ("24|21", tempSlotDisplay 'both'; the feels
    // numbers come from feelsFrom). The radar series feeds the graph's rain bar, but
    // the rain countdown stays off (horizon '0') so the top strip shows its slots.
    // Captured only (inShowcase: false) since 1.23.0 — see scene 2.
    id: 4, flicks: 0, inShowcase: false,
    clay: {
      layoutPreset: 'compactCal', healthMode: 'status',
      secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv',
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0',
      timeFont: 'leco',
      // Clock directly under the calendar, weather status row between clock and
      // graph (user call, matches the real-watch photo): cal → clock → status → graph.
      swapClockStatus: true,
      statusBoldAll: 'all',
      statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi',
      tempSlotDisplay: 'both',
      // Base = the 144px platforms (aplite/basalt/flint): the bold date needs narrow
      // side slots or it gets cut off (user call) — calendar week left, UV right.
      statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'uv',
    },
    // emery's wider strip carries the real-watch look: date-countdown / date / steps.
    variants: {
      emery: { statusTopLeft: 'countdown', statusTopLeftCountdown: countdownTarget(),
               statusTopRight: 'steps' },
    },
    weather: feelsFrom,
    radar: { exact: RAIN_APPROACH_EXACT, area: RAIN_APPROACH_AREA },
  },
  {
    // No-calendar layout with the HEALTH graph (healthMode 'all'): a flick swaps the
    // full-screen forecast for the hourly health graph — step bars + step-count scale, a
    // sleep band, and the heart-rate line — with the health status line above. Radar off
    // so the single flick lands on the graph. The graph's numbers come from the
    // health_fixture.c twin, whose HR curve spans 54–85 bpm: hrScale '50-100' (the
    // setting's 50-bpm minimum span) makes the line use the plot instead of hugging
    // the floor of the 40–150 default.
    // reelIntro: false — the reel intro reuses the showcase scenes in THIS table's
    // order (gen-reel-fixtures.js derives its INTRO_SCENES from here); this one is
    // skipped there (flick-gated). Not on aplite, which has no health graph.
    // Captured only (inShowcase: false) since 1.23.0 — see scene 2.
    id: 5, flicks: 1, reelIntro: false, variants: { emery: HR_EMERY }, platforms: COLOUR_PLATFORMS,
    inShowcase: false,
    clay: {
      layoutPreset: 'noCal', healthMode: 'all',
      secondaryLine: 'precip_prob', barSource: 'off',
      radarProvider: 'disabled', rainCountdownHorizon: '0',
      timeFont: 'bitham',
      hrScale: '50-100',
    },
    radar: null,
  },
  {
    // NONE mode with a rain-now countdown ("Rain for X"): full-date strip, big clock,
    // full-screen forecast. Three metric lines: filled precip, wind and gust as x marks
    // in their default colours (wind yellow, gust white), multicolour rain bars.
    // aplite has no fourth line or style picker and keeps its classic look.
    id: 6, flicks: 0,
    clay: {
      layoutPreset: 'noCal', healthMode: 'off',
      secondaryLine: 'precip_prob', secondaryLineFill: true, secondaryLineStyle: 'line',
      thirdLine: 'wind', thirdLineStyle: 'x',
      fourthLine: 'gust', fourthLineStyle: 'x',
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
      timeFont: 'bitham',
    },
    radar: { exact: RAIN_NOW_EXACT, area: RAIN_NOW_AREA },
    countdown: { text: "Rain for 20'", tier: 3 },
  },
  // The Miami scenes again in the Light theme: captured with the showcase (for the store
  // and the README) but left out of the GIF and the reel intro (inShowcase: false).
  { id: 10, flicks: 0, fixture: 'miami-stripes-cal', clay: { theme: 'light' },
    platforms: COLOUR_PLATFORMS, inShowcase: false },
  { id: 11, flicks: 1, fixture: 'miami-radar-flick', clay: { theme: 'light' },
    platforms: COLOUR_PLATFORMS, inShowcase: false },
  { id: 12, flicks: 0, fixture: 'miami-stripes', clay: { theme: 'light' },
    platforms: COLOUR_PLATFORMS, inShowcase: false },
];

/**
 * Build the showcase scene fixtures from the Berlin base and write them to disk.
 *
 * @param {Object} [opts] Options.
 * @param {string} [opts.outDir="fixtures"] Directory to write scene fixtures into.
 * @param {string} [opts.basePath=BASE_PATH] Base fixture layered under each scene.
 * @returns {string[]} Written fixture paths.
 */
function generateShowcaseFixtures(opts = {}) {
  const outDir = opts.outDir ?? 'fixtures';
  const basePath = opts.basePath ?? BASE_PATH;
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  // Clear any showcase fixtures from a prior run so the on-disk set matches this run's
  // scene list (a shorter list would otherwise leave stale higher-numbered fixtures).
  // Matches both the base `showcase-N.json` and platform variants `showcase-N-<platform>.json`.
  for (const name of fs.readdirSync(outDir)) {
    if (/^showcase-\d+(-[a-z]+)?\.json$/.test(name)) {
      fs.unlinkSync(path.join(outDir, name));
    }
  }

  // Build one scene frame: the Berlin base + minute-0 now + scene clay (with any extra clay
  // overrides merged last) + the scene's radar series and build-only countdown block.
  function buildFrame(scene, extraClay) {
    const frame = JSON.parse(JSON.stringify(base));
    frame.watch.now = { ...frame.watch.now, ...NOW_OVERRIDE };
    frame.claySettings = { ...base.claySettings, ...scene.clay, ...extraClay };
    if (scene.weather) {
      Object.assign(frame.weather, scene.weather(base.weather));
    }
    if (scene.radar) {
      frame.weather.rainRadarExactMm = scene.radar.exact.slice();
      frame.weather.rainRadarAreaMm = scene.radar.area.slice();
    }
    // Build-only metadata (ignored by the phone pipeline): the wscript reads it to bake
    // the deterministic rain-countdown strip via rain_countdown_fixture.c.
    if (scene.countdown) {
      frame.countdown = { ...scene.countdown };
    }
    return frame;
  }

  const written = [];
  for (const scene of SCENES) {
    const outPath = path.join(outDir, 'showcase-' + scene.id + '.json');
    if (scene.fixture) {
      // A scene backed by a whole fixture of its own (its data, clock and settings
      // are the scene), no Berlin base; `clay` (e.g. a theme) layers on its settings.
      const src = path.join(path.dirname(basePath), scene.fixture + '.json');
      const own = JSON.parse(fs.readFileSync(src, 'utf8'));
      const { theme, ...rest } = scene.clay || {};
      own.claySettings = { ...own.claySettings, ...rest };
      if (theme && theme !== (own.claySettings.theme || 'dark')) {
        own.claySettings = withTheme(own.claySettings, theme);
      }
      fs.writeFileSync(outPath, JSON.stringify(own, null, 2) + '\n');
      written.push(outPath);
      continue;
    }
    fs.writeFileSync(outPath, JSON.stringify(buildFrame(scene), null, 2) + '\n');
    written.push(outPath);
    // Per-platform variants (e.g. emery pinning the HR slot it alone can render, aplite
    // falling back off health slots) layer their overrides on the scene clay.
    for (const plat of Object.keys(scene.variants || {})) {
      const vPath = path.join(outDir, 'showcase-' + scene.id + '-' + plat + '.json');
      fs.writeFileSync(vPath, JSON.stringify(buildFrame(scene, scene.variants[plat]), null, 2) + '\n');
      written.push(vPath);
    }
  }
  return written;
}

/**
 * The platforms a scene is captured and shown on.
 * @param {Object} scene A SCENES entry.
 * @returns {string[]} Platform names.
 */
function scenePlatforms(scene) {
  return scene.platforms || SHOWCASE_PLATFORMS;
}

/**
 * The scene ids a platform's showcase GIF shows, in table order. Capture-only scenes
 * (`inShowcase: false`) are captured but never shown.
 * @param {string} platform Platform name.
 * @returns {number[]} Scene ids.
 */
function sceneIdsFor(platform) {
  return SCENES.filter((s) => s.inShowcase !== false && scenePlatforms(s).includes(platform))
    .map((s) => s.id);
}

if (require.main === module) {
  const written = generateShowcaseFixtures();
  console.log('Wrote ' + written.length + ' showcase fixtures: '
    + written.map((p) => path.basename(p)).join(', '));
}

module.exports = { generateShowcaseFixtures, SCENES, BASE_PATH, RADAR_SLOTS, SHOWCASE_PLATFORMS,
  COLOUR_PLATFORMS, scenePlatforms, sceneIdsFor };
