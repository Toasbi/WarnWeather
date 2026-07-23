#!/usr/bin/env node
'use strict';
// Promo-reel fixtures + manifest. Self-contained beside the hero pipeline
// (gen-showcase-fixtures.js): defines the reel's chapter segments and text cards, writes
// per-scene fixtures (+ per-platform variant fixtures), and builds a per-platform ordered
// manifest {frame, hold, fade} consumed by assemble-reel.sh.
const fs = require('fs');
const path = require('path');

const BASE_PATH = path.join('fixtures', 'berlin.json');
const NOW_OVERRIDE = { minute: 0, second: 0 };
const RADAR_SLOTS = 24;

// Timing (seconds) — see plan Global Constraints. Chapter frames hold exactly as long as
// the intro scenes ("the first ones") so every screenshot stays visible the same length.
const INTRO_HOLD = 1.0;
const TIMING = {
  intro:   { hold: INTRO_HOLD, fade: 0.55 },
  card:    { hold: 1.8,        fade: 0.30 },
  chapter: { hold: INTRO_HOLD, fade: 0.30 },
};

function segment(start, len, mm) {
  const a = new Array(RADAR_SLOTS).fill(0);
  for (let i = start; i < start + len && i < RADAR_SLOTS; i++) { a[i] = mm; }
  return a;
}
const RAIN_EXACT = segment(3, 4, 1.5);
const RAIN_AREA = segment(2, 6, 1.8);
// Native DWD pollen display string (see POLLEN_DISPLAYS in weather/pollen.js) baked into
// the segments that show the pollen status slot (theme-bwlight, status-3).
const POLLEN_BAKED = '1-2';

const PLATFORM_CAPS = {
  emery:  { color: true,  themePolarity: true,  radar: true,  health: true,  hr: true },
  basalt: { color: true,  themePolarity: true,  radar: true,  health: true,  hr: false },
  flint:  { color: false, themePolarity: true,  radar: true,  health: true,  hr: false },
  aplite: { color: false, themePolarity: false, radar: false, health: false, hr: false },
};
const ALL_PLATFORMS = ['emery', 'basalt', 'flint', 'aplite'];

/** Ordered reel themes for a platform (sweep order dark→bw→light→bw-light, gated). */
function themesFor(platform) {
  const caps = PLATFORM_CAPS[platform];
  if (!caps || !caps.themePolarity) { return []; }
  return caps.color ? ['dark', 'bw', 'light', 'bw-light'] : ['dark', 'light'];
}

// Which preset each theme maps to (sweep order dark → light → bw → bw-light). dark and
// light both sit in compact mode; bw and bw-light progress to the denser/full presets.
const THEME_PRESET = { dark: 'compactCal', light: 'compactCal', bw: 'compactDense', 'bw-light': 'fullCal' };
// Forecast slots shown per theme step (advertises slot variety inside the theme sweep).
const THEME_SLOTS = {
  dark:       { statusForecastLeft: 'temp',   statusForecastMid: 'city', statusForecastRight: 'uv' },
  bw:         { statusForecastLeft: 'temp',   statusForecastMid: 'wind', statusForecastRight: 'gust' },
  light:      { statusForecastLeft: 'temp',   statusForecastMid: 'uv',   statusForecastRight: 'aqi' },
  'bw-light': { statusForecastLeft: 'pollen', statusForecastMid: 'date', statusForecastRight: 'aqi' },
};

// Build the theme SEGMENTS from themesFor(), so each theme is one segment with the right
// preset, colorTime, and platform set.
function themeSegments() {
  const segs = [];
  for (const theme of ['dark', 'light', 'bw', 'bw-light']) {
    const colorPlats = ALL_PLATFORMS.filter((p) => themesFor(p).includes(theme));
    if (!colorPlats.length) { continue; }
    const clay = Object.assign(
      // timeFont pinned to bitham across the whole theme chapter — the chapter is about
      // colour themes, so the clock font stays constant to avoid a second confounding
      // variable (leco previews in the intro, roboto in the status chapter).
      { theme, radarProvider: 'disabled', healthMode: 'off', timeFont: 'bitham' },
      THEME_SLOTS[theme],
      { layoutPreset: THEME_PRESET[theme] },
    );
    if (theme === 'light' || theme === 'bw-light') { clay.colorTime = '#000000'; }
    // bw-light's forecast-left slot is pollen (see THEME_SLOTS) — needs DWD, like status-3.
    if (theme === 'bw-light') { clay.radarProvider = 'dwd'; }
    segs.push({
      id: 'theme-' + (theme === 'bw-light' ? 'bwlight' : theme),
      group: 'theme', flicks: 0,
      platforms: colorPlats.join(' '),
      clay,
      pollen: theme === 'bw-light' ? POLLEN_BAKED : undefined,
    });
  }
  return segs;
}

// timeFont pinned to leco across the whole graph chapter (see the theme/status chapters'
// matching bitham/roboto pins — each chapter holds the font constant, intro previews all 3).
const GRAPH_SEGMENTS = [
  { id: 'graph-1', group: 'graph', flicks: 0, platforms: 'emery basalt flint aplite',
    clay: { layoutPreset: 'noCal', theme: 'dark', timeFont: 'leco',
      secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'gust',
      barSource: 'rain', rainBarColor: 'multicolor', radarProvider: 'disabled', healthMode: 'off',
      statusForecastRight: 'uv', statusTopLeft: 'aqi', statusTopRight: 'battery' } },
  { id: 'graph-2', group: 'graph', flicks: 0, platforms: 'emery basalt flint aplite',
    clay: { layoutPreset: 'noCal', theme: 'dark', timeFont: 'leco',
      secondaryLine: 'wind', thirdLine: 'gust', barSource: 'off', radarProvider: 'disabled', healthMode: 'off',
      statusForecastRight: 'gust', statusTopLeft: 'aqi' } },
  { id: 'graph-3', group: 'graph', flicks: 0, platforms: 'emery basalt flint aplite',
    clay: { layoutPreset: 'noCal', theme: 'dark', timeFont: 'leco',
      // secondaryLineFill: false overrides the base fixture's true (tuned for graph-1's
      // filled precip line) — UV renders as a plain line, no fill.
      secondaryLine: 'uv', secondaryLineFill: false, barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'disabled',
      // 'status' (not 'off') so the health summary cache actually ticks — statusTopRight:
      // 'steps' below is a LIVE health value that renders blank/zero while health is off.
      healthMode: 'status',
      statusForecastRight: 'uv', statusTopRight: 'steps' },
    // aplite has no health capability -> no steps; fall back to a weather metric.
    variants: { aplite: { statusTopRight: 'wind' } } },
  { id: 'graph-4', group: 'graph', flicks: 1, platforms: 'emery basalt flint',
    clay: { layoutPreset: 'noCal', theme: 'dark', timeFont: 'leco',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60', healthMode: 'off' },
    radar: { exact: RAIN_EXACT, area: RAIN_AREA }, countdown: { text: "Rain in 15'", tier: 3 } },
  { id: 'graph-5', group: 'graph', flicks: 1, platforms: 'emery basalt flint',
    clay: { layoutPreset: 'noCal', theme: 'dark', timeFont: 'leco', healthMode: 'all', radarProvider: 'disabled' },
    // emery only: HR needs the sensor; base (basalt/flint) keeps the plain health-graph frame.
    variants: { emery: { statusTopLeft: 'distance', statusTopMid: 'empty', statusTopRight: 'hr' } } },
];

// timeFont pinned to roboto across the whole status chapter (see GRAPH_SEGMENTS comment).
const STATUS_SEGMENTS = [
  { id: 'status-1', group: 'status', flicks: 0, platforms: 'emery basalt flint aplite',
    clay: { layoutPreset: 'compactCal', theme: 'dark', timeFont: 'roboto', radarProvider: 'disabled', healthMode: 'off',
      rainBarColor: 'solid',
      statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'uv',
      statusTopLeft: 'empty', statusTopRight: 'battery' } },
  { id: 'status-2', group: 'status', flicks: 0, platforms: 'emery basalt flint aplite',
    // healthMode 'status' (not 'off'): statusTopLeft/Right below are LIVE health values
    // (steps/sleep/hr) that render blank/zero while the health summary cache is off.
    clay: { layoutPreset: 'compactCal', theme: 'dark', timeFont: 'roboto', radarProvider: 'disabled', healthMode: 'status',
      rainBarColor: 'solid',
      statusForecastLeft: 'temp', statusForecastMid: 'wind', statusForecastRight: 'gust',
      statusTopLeft: 'steps', statusTopMid: 'empty', statusTopRight: 'sleep' },
    // emery has the HR sensor; aplite has no health at all -> weather-only top strip.
    variants: {
      emery:  { statusTopRight: 'hr' },
      aplite: { statusTopLeft: 'wind', statusTopRight: 'battery' },
    } },
  { id: 'status-3', group: 'status', flicks: 0, platforms: 'emery basalt flint aplite',
    // healthMode 'status' (not 'off'): statusTopRight below is a LIVE health value
    // (sleep/hr) that renders blank/zero while the health summary cache is off.
    clay: { layoutPreset: 'compactCal', theme: 'dark', timeFont: 'roboto', radarProvider: 'dwd', healthMode: 'status',
      rainBarColor: 'solid', btIcons: 'connected',
      statusForecastLeft: 'pollen', statusForecastMid: 'city', statusForecastRight: 'aqi',
      statusTopLeft: 'empty', statusTopRight: 'sleep' },
    pollen: POLLEN_BAKED,
    variants: {
      emery:  { statusTopRight: 'hr' },
      aplite: { statusTopRight: 'battery' },
    } },
  // Health row (compactDense). Base = non-HR (basalt/flint); emery variant pins HR. No aplite.
  { id: 'status-4', group: 'status', flicks: 0, platforms: 'basalt flint',
    clay: { layoutPreset: 'compactDense', theme: 'dark', timeFont: 'roboto', healthMode: 'status', radarProvider: 'dwd',
      statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep',
      statusTopLeft: 'uv', statusTopMid: 'pollen' },
    pollen: POLLEN_BAKED,
    variants: { emery: { statusHealthMid: 'sleep', statusHealthRight: 'hr' } } },
  // Compact top strip. Base (basalt/flint) = distance/--/steps; emery = uv/date/steps;
  // aplite (no health) = temp/--/battery. Forecast-right adds heart rate on emery. Mid
  // slot is empty on every non-emery platform; emery keeps date there.
  // healthMode 'status' (not 'off'): statusTopLeft/Right are LIVE health values that
  // render blank/zero while the health summary cache is off.
  { id: 'status-5', group: 'status', flicks: 0, platforms: 'basalt flint',
    clay: { layoutPreset: 'compactCal', theme: 'dark', timeFont: 'roboto', radarProvider: 'disabled', healthMode: 'status',
      statusTopLeft: 'distance', statusTopMid: 'empty', statusTopRight: 'steps',
      statusForecastRight: 'wind' },
    variants: {
      emery:  { statusTopLeft: 'uv',   statusTopMid: 'date', statusTopRight: 'steps', statusForecastRight: 'hr' },
      aplite: { statusTopLeft: 'temp', statusTopRight: 'battery' },
    } },
];

const SEGMENTS = [].concat(themeSegments(), GRAPH_SEGMENTS, STATUS_SEGMENTS);

const CARDS = [
  { id: 'themes', copy: (p) => ['Try ' + themesFor(p).length + ' themes'] },
  { id: 'graph',  copy: (p) => ['Build your own graph',
      PLATFORM_CAPS[p].radar ? 'precip · UV · temp · wind · gusts · radar · health'
                             : 'precip · UV · temp · wind · gusts'] },
  { id: 'status', copy: () => ['Status slots', 'track what matters'] },
];

function segmentPlatforms(seg) {
  const base = String(seg.platforms || '').split(/\s+/).filter(Boolean);
  const variantPlats = seg.variants ? Object.keys(seg.variants) : [];
  return Array.from(new Set(base.concat(variantPlats)));
}

/** Which fixture slug a platform captures a segment from (base or per-platform variant). */
function fixtureFor(seg, platform) {
  if (seg.variants && seg.variants[platform]) { return 'reel-' + seg.id + '-' + platform; }
  return 'reel-' + seg.id;
}

/**
 * Write the reel scene fixtures (base + per-platform variants) from the Berlin base.
 * @param {{outDir?:string, basePath?:string}} [opts]
 * @returns {string[]} written fixture paths
 */
function generateReelFixtures(opts = {}) {
  const outDir = opts.outDir ?? 'fixtures';
  const base = JSON.parse(fs.readFileSync(opts.basePath ?? BASE_PATH, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(outDir)) {
    if (/^reel-.+\.json$/.test(name)) { fs.unlinkSync(path.join(outDir, name)); }
  }

  function frameFor(seg, extraClay) {
    const frame = JSON.parse(JSON.stringify(base));
    frame.watch.now = { ...frame.watch.now, ...NOW_OVERRIDE };
    frame.claySettings = { ...base.claySettings, ...seg.clay, ...extraClay };
    if (seg.radar) {
      frame.weather.rainRadarExactMm = seg.radar.exact.slice();
      frame.weather.rainRadarAreaMm = seg.radar.area.slice();
    }
    if (seg.countdown) { frame.countdown = { ...seg.countdown }; }
    if (seg.pollen) { frame.weather.pollen = seg.pollen; }
    return frame;
  }

  const written = [];
  for (const seg of SEGMENTS) {
    const basePath = path.join(outDir, 'reel-' + seg.id + '.json');
    fs.writeFileSync(basePath, JSON.stringify(frameFor(seg), null, 2) + '\n');
    written.push(basePath);
    for (const plat of Object.keys(seg.variants || {})) {
      const vPath = path.join(outDir, 'reel-' + seg.id + '-' + plat + '.json');
      fs.writeFileSync(vPath, JSON.stringify(frameFor(seg, seg.variants[plat]), null, 2) + '\n');
      written.push(vPath);
    }
  }
  return written;
}

// Intro scenes reused from the hero capture (showcase/frames/<platform>/scene_N.png).
const INTRO_SCENES = [1, 2, 3, 5];

const CHAPTER_ORDER = ['theme', 'graph', 'status'];
const CARD_BY_GROUP = { theme: 'themes', graph: 'graph', status: 'status' };

/**
 * Ordered reel manifest for a platform.
 * @param {string} platform
 * @returns {Array<{kind:string, frame:string, group:string, hold:number, fade:number}>}
 */
function buildManifest(platform) {
  const out = [];
  for (const n of INTRO_SCENES) {
    out.push({ kind: 'scene', frame: 'scene_' + n + '.png', group: 'intro', ...TIMING.intro });
  }
  for (const group of CHAPTER_ORDER) {
    const segs = SEGMENTS.filter((s) => s.group === group && segmentPlatforms(s).includes(platform));
    if (!segs.length) { continue; }
    out.push({ kind: 'card', frame: 'card-' + CARD_BY_GROUP[group] + '.png', group, ...TIMING.card });
    for (const seg of segs) {
      out.push({ kind: 'scene', frame: seg.id + '.png', group, ...TIMING.chapter });
    }
  }
  return out;
}

/** Print `<repo-relative-path>|<hold>|<fade>` lines for assemble-reel.sh. */
function printManifest(platform, version) {
  const showcase = path.join('screenshot', version, 'showcase', 'frames', platform);
  const promo = path.join('screenshot', version, 'promo', 'frames', platform);
  for (const seg of buildManifest(platform)) {
    const dir = seg.group === 'intro' ? showcase : promo;
    process.stdout.write(path.join(dir, seg.frame) + '|' + seg.hold + '|' + seg.fade + '\n');
  }
}

module.exports = {
  PLATFORM_CAPS, ALL_PLATFORMS, TIMING, themesFor, SEGMENTS, CARDS,
  segmentPlatforms, fixtureFor, generateReelFixtures,
  buildManifest, printManifest,
};

if (require.main === module) {
  const [cmd, platform, version] = process.argv.slice(2);
  if (cmd === 'manifest') {
    if (!platform || !version) { console.error('usage: gen-reel-fixtures.js manifest <platform> <version>'); process.exit(2); }
    printManifest(platform, version);
  } else {
    const written = generateReelFixtures();
    console.log('Wrote ' + written.length + ' reel fixtures: ' + written.map((p) => path.basename(p)).join(', '));
  }
}
