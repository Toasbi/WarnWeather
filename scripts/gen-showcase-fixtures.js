#!/usr/bin/env node
'use strict';

// Showcase fixtures: four static scenes (no scrolling) demonstrating different layouts
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

// Scene table. `clay` overrides the Berlin base claySettings; `flicks` is how many wrist
// flicks capture-showcase.sh sends before the screenshot to reach the intended view;
// `radar` (when set) replaces the base radar series so the rain countdown reads a
// specific state.
const SCENES = [
  {
    // Full top view (classic 3-row calendar) with a "Rain in X" countdown up top.
    id: 1, flicks: 0,
    clay: {
      layoutPreset: 'fullCal', healthMode: 'off',
      secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv',
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
    },
    radar: { exact: RAIN_APPROACH_EXACT, area: RAIN_APPROACH_AREA },
    countdown: { text: "Rain in 15'", tier: 3 },
  },
  {
    // Compact-DENSE: weather & health status shown together by default (no flick needed),
    // with a different-looking forecast (wind + dotted gust). Radar off — the dense
    // preset's off-radar cycle is a single view, so there's nothing to flick to anyway.
    id: 2, flicks: 0,
    clay: {
      layoutPreset: 'compactDense', healthMode: 'status',
      secondaryLine: 'wind', thirdLine: 'gust', barSource: 'off',
      radarProvider: 'disabled', rainCountdownHorizon: '0',
    },
    radar: null,
  },
  {
    // Compact + single status showing the weather status, drizzle approaching in the top bar.
    id: 3, flicks: 0,
    clay: {
      layoutPreset: 'compactCal', healthMode: 'status',
      secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv',
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
    },
    radar: { exact: DRIZZLE_EXACT, area: DRIZZLE_AREA },
    countdown: { text: "Drizzle in 15'", tier: 2 },
  },
  {
    // No-calendar layout with the HEALTH graph (healthMode 'all'): a flick swaps the
    // full-screen forecast for the hourly health graph — step bars + step-count scale, a
    // sleep band, and the heart-rate line — with the health status line above. Radar off
    // so the single flick lands on the graph. The graph's numbers come from the
    // health_fixture.c twin.
    id: 4, flicks: 1,
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
    id: 5, flicks: 0,
    clay: {
      layoutPreset: 'noCal', healthMode: 'off',
      secondaryLine: 'precip_prob', secondaryLineFill: true,
      barSource: 'rain', rainBarColor: 'multicolor',
      radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60',
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
  for (const name of fs.readdirSync(outDir)) {
    if (/^showcase-\d+\.json$/.test(name)) {
      fs.unlinkSync(path.join(outDir, name));
    }
  }

  const written = [];
  for (const scene of SCENES) {
    const frame = JSON.parse(JSON.stringify(base));
    frame.watch.now = { ...frame.watch.now, ...NOW_OVERRIDE };
    frame.claySettings = { ...base.claySettings, ...scene.clay };
    if (scene.radar) {
      frame.weather.rainRadarExactMm = scene.radar.exact.slice();
      frame.weather.rainRadarAreaMm = scene.radar.area.slice();
    }
    // Build-only metadata (ignored by the phone pipeline): the wscript reads it to bake
    // the deterministic rain-countdown strip via rain_countdown_fixture.c.
    if (scene.countdown) {
      frame.countdown = { ...scene.countdown };
    }
    const outPath = path.join(outDir, 'showcase-' + scene.id + '.json');
    fs.writeFileSync(outPath, JSON.stringify(frame, null, 2) + '\n');
    written.push(outPath);
  }
  return written;
}

if (require.main === module) {
  const written = generateShowcaseFixtures();
  console.log('Wrote ' + written.length + ' showcase fixtures: '
    + written.map((p) => path.basename(p)).join(', '));
}

module.exports = { generateShowcaseFixtures, SCENES, BASE_PATH, RADAR_SLOTS };
