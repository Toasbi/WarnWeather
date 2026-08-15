#!/usr/bin/env node
'use strict';

// Showcase fixtures: six static scenes (no scrolling) demonstrating different layouts
// and functions, all on the Berlin base. Duplicated in spirit from
// gen-timelapse-fixtures.js but far simpler — each scene is one frame, defined by
// claySettings overrides + a crafted rain-radar segment (for the countdown scenes) +
// how many wrist-flicks capture-showcase.sh must send to reach the intended view.
// Health numbers come from the compile-time health_fixture.c twin (WW_HEALTH_FIXTURE),
// not from these files.

const fs = require('fs');
const path = require('path');

const BASE_PATH = path.join('fixtures', 'berlin.json');

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

// Drizzle (~0.3 mm/h → tier 2 = "drizzle") arriving in 15 min (slot 3) for 15 min.
const DRIZZLE_EXACT = segment(3, 3, 0.3);
const DRIZZLE_AREA = segment(2, 5, 0.4);        // nearby rain a touch earlier/wider
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
const SCENES = [
  {
    // Full top view (classic 3-row calendar) with a "Rain in X" countdown up top.
    // timeFont 'leco' — reel intro (scenes 1/2/3/4/6) is all leco.
    id: 1, flicks: 0,
    clay: {
      layoutPreset: 'fullCal', healthMode: 'off',
      secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv',
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
      timeFont: 'leco',
    },
    radar: { exact: RAIN_APPROACH_EXACT, area: RAIN_APPROACH_AREA },
    countdown: { text: "Rain in 15'", tier: 3 },
  },
  {
    // Compact-DENSE: weather & health status shown together by default (no flick needed),
    // with a different-looking forecast (wind + dotted gust). Radar off — the dense
    // preset's off-radar cycle is a single view, so there's nothing to flick to anyway.
    // timeFont 'leco' — reel intro (scenes 1/2/3/4/6) is all leco.
    // No threshold highlighting here (user call: too busy for the intro scenes);
    // the left slot stays wind to match the scene's wind+gust graph.
    id: 2, flicks: 0, variants: { emery: HR_EMERY },
    clay: {
      layoutPreset: 'compactDense', healthMode: 'status',
      secondaryLine: 'wind', thirdLine: 'gust', barSource: 'off',
      radarProvider: 'disabled', rainCountdownHorizon: '0',
      timeFont: 'leco',
      statusForecastLeft: 'wind',
    },
    radar: null,
  },
  {
    // Compact + single status showing the weather status, with a health-flavoured top
    // strip — heart rate (emery) / date / steps, every value bold (user call: no drizzle
    // countdown up top; this frame is the bold + health-top-slot showcase). The
    // drizzle radar series stays for the graph's rain bar, but the countdown is off
    // (horizon '0', no baked strip) so the top strip shows the slots.
    // timeFont 'leco' — reel intro (scenes 1/2/3/4/6) is all leco.
    id: 3, flicks: 0,
    clay: {
      layoutPreset: 'compactCal', healthMode: 'status',
      secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv',
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '0',
      timeFont: 'leco',
      // All-bold showcase: the master Bold values override packs every slot kind's
      // bold cell as always at blob-build time.
      statusBoldAll: 'all',
      // Base = basalt/flint: their 144px strip can't fit bold side values next to
      // the bold date (user call) — leave left/right empty. emery pins the full
      // hr/date/steps look; aplite keeps its classic week/date/sun strip (its
      // narrower B/W font fits).
      statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'empty',
    },
    variants: {
      emery:  { statusTopLeft: 'hr', statusTopRight: 'steps' },
      aplite: { statusTopLeft: 'week', statusTopRight: 'sun' },
    },
    radar: { exact: DRIZZLE_EXACT, area: DRIZZLE_AREA },
  },
  {
    // Compact 2-row calendar with every status slot bold (mirrors the user's real-watch
    // look): a bold date in the top-mid — flanked by a date-countdown ("21d") and steps
    // on emery, narrow week/UV elsewhere — over the classic temp / city / AQI forecast
    // bar. The radar series feeds the graph's rain bar, but the rain countdown stays off
    // (horizon '0') so the top strip shows its slots.
    // timeFont 'leco' — reel intro (scenes 1/2/3/4/6) is all leco.
    id: 4, flicks: 0,
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
      // Base = the 144px platforms (aplite/basalt/flint): the bold date needs narrow
      // side slots or it gets cut off (user call) — calendar week left, UV right.
      statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'uv',
    },
    // emery's wider strip carries the real-watch look: date-countdown / date / steps.
    variants: {
      emery: { statusTopLeft: 'countdown', statusTopLeftCountdown: countdownTarget(),
               statusTopRight: 'steps' },
    },
    radar: { exact: RAIN_APPROACH_EXACT, area: RAIN_APPROACH_AREA },
  },
  {
    // No-calendar layout with the HEALTH graph (healthMode 'all'): a flick swaps the
    // full-screen forecast for the hourly health graph — step bars + step-count scale, a
    // sleep band, and the heart-rate line — with the health status line above. Radar off
    // so the single flick lands on the graph. The graph's numbers come from the
    // health_fixture.c twin.
    // reelIntro: false — the reel intro reuses the showcase scenes in THIS table's
    // order (gen-reel-fixtures.js derives its INTRO_SCENES from here); this one is
    // skipped there (flick-gated, and degraded on aplite).
    id: 5, flicks: 1, reelIntro: false, variants: { emery: HR_EMERY },
    clay: {
      layoutPreset: 'noCal', healthMode: 'all',
      secondaryLine: 'precip_prob', barSource: 'off',
      radarProvider: 'disabled', rainCountdownHorizon: '0',
    },
    radar: null,
  },
  {
    // NONE mode with a rain-now countdown ("Rain for X"): full-date strip, big clock,
    // full-screen forecast.
    // timeFont 'leco' — reel intro (scenes 1/2/3/4/6) is all leco.
    id: 6, flicks: 0,
    clay: {
      layoutPreset: 'noCal', healthMode: 'off',
      secondaryLine: 'precip_prob', secondaryLineFill: true,
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
      timeFont: 'leco',
    },
    radar: { exact: RAIN_NOW_EXACT, area: RAIN_NOW_AREA },
    countdown: { text: "Rain for 20'", tier: 3 },
  },
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

if (require.main === module) {
  const written = generateShowcaseFixtures();
  console.log('Wrote ' + written.length + ' showcase fixtures: '
    + written.map((p) => path.basename(p)).join(', '));
}

module.exports = { generateShowcaseFixtures, SCENES, BASE_PATH, RADAR_SLOTS };
