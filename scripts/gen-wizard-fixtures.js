#!/usr/bin/env node
'use strict';
// Wizard screenshot fixtures: one static scene per selectable option (3 layout presets, 3 health
// modes, 1 radar view), layered on the Berlin base. Mirrors gen-showcase-fixtures.js. `flicks` reaches
// the intended view: the watch boots on the calendar, so the health-graph and radar views each need a
// flick (flicks:1) — see capture-screenshots.sh's radar_fixtures default. Confirm counts visually when capturing.
const fs = require('fs');
const path = require('path');
const BASE_PATH = path.join('fixtures', 'berlin.json');
const NOW_OVERRIDE = { minute: 0, second: 0 };
const RADAR_SLOTS = 24;
function segment(start, len, mm) {
  const a = new Array(RADAR_SLOTS).fill(0);
  for (let i = start; i < start + len && i < RADAR_SLOTS; i++) { a[i] = mm; }
  return a;
}
const RAIN_EXACT = segment(3, 4, 1.5);
const RAIN_AREA = segment(2, 6, 1.8);
// Common forecast look for the layout shots.
const FORECAST = { secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv', barSource: 'rain', rainBarColor: 'multicolor' };
// Which platforms each shot is captured on (space-separated; consumed by capture-wizard-screenshots.sh
// per fixture and by gen-wizard-screenshots.js to key the module). Facts from config-ui/lib/platform.js:
//   basalt, emery — color, health, radar        flint — B&W, health, radar
//   aplite — B&W, no health, no radar            (diorite ≈ flint; wizard maps diorite→flint, not captured)
// Layout + dark/light theme show on every watch; health/radar only where the platform has them (not
// aplite); bw / bw-light are color-watch-only theme options (flint + aplite are B&W → dark/light only).
const ALL = 'basalt flint emery aplite';
const HEALTH_RADAR = 'basalt flint emery';   // exclude aplite (no PBL_HEALTH / no WW_RAIN_RADAR)
const COLOR = 'basalt emery';                // flint + aplite are B&W → they never show bw/bw-light cards
// slug → fixture; group/val/platforms are consumed by gen-wizard-screenshots.js to key the module.
const SHOTS = [
  { slug: 'layout-fullcal',    group: 'layoutPreset', val: 'fullCal',    flicks: 0, platforms: ALL,          clay: Object.assign({ layoutPreset: 'fullCal',    healthMode: 'off', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'layout-compactcal', group: 'layoutPreset', val: 'compactCal', flicks: 0, platforms: ALL,          clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'layout-nocal',      group: 'layoutPreset', val: 'noCal',      flicks: 0, platforms: ALL,          clay: Object.assign({ layoutPreset: 'noCal',      healthMode: 'off', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'health-off',        group: 'healthMode',   val: 'off',        flicks: 0, platforms: HEALTH_RADAR, clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'health-status',     group: 'healthMode',   val: 'status',     flicks: 0, platforms: HEALTH_RADAR, clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'status', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'health-all',        group: 'healthMode',   val: 'all',        flicks: 1, platforms: HEALTH_RADAR, clay: Object.assign({ layoutPreset: 'noCal',      healthMode: 'all', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'radar',             group: 'radar',        val: '_',          flicks: 1, platforms: HEALTH_RADAR, clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'dwd', radarColor: 'multicolor', rainCountdownHorizon: '60' }, FORECAST),
    radar: { exact: RAIN_EXACT, area: RAIN_AREA }, countdown: { text: "Rain in 15'", tier: 3 } },
  { slug: 'theme-dark',     group: 'theme', val: 'dark',     flicks: 0, platforms: ALL,   clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'dark' }, FORECAST) },
  { slug: 'theme-light',    group: 'theme', val: 'light',    flicks: 0, platforms: ALL,   clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'light' }, FORECAST) },
  { slug: 'theme-bw',       group: 'theme', val: 'bw',       flicks: 0, platforms: COLOR, clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'bw' }, FORECAST) },
  { slug: 'theme-bw-light', group: 'theme', val: 'bw-light', flicks: 0, platforms: COLOR, clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'bw-light' }, FORECAST) }
];
function generate(opts = {}) {
  const outDir = opts.outDir ?? 'fixtures';
  const base = JSON.parse(fs.readFileSync(opts.basePath ?? BASE_PATH, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(outDir)) { if (/^wizard-.+\.json$/.test(name)) { fs.unlinkSync(path.join(outDir, name)); } }
  const written = [];
  for (const s of SHOTS) {
    const frame = JSON.parse(JSON.stringify(base));
    frame.watch.now = { ...frame.watch.now, ...NOW_OVERRIDE };
    frame.claySettings = { ...base.claySettings, ...s.clay };
    if (s.radar) { frame.weather.rainRadarExactMm = s.radar.exact.slice(); frame.weather.rainRadarAreaMm = s.radar.area.slice(); }
    if (s.countdown) { frame.countdown = { ...s.countdown }; }
    const outPath = path.join(outDir, 'wizard-' + s.slug + '.json');
    fs.writeFileSync(outPath, JSON.stringify(frame, null, 2) + '\n');
    written.push(outPath);
  }
  return written;
}
if (require.main === module) { const w = generate(); console.log('Wrote ' + w.length + ' wizard fixtures.'); }
module.exports = { generate, SHOTS, BASE_PATH, RADAR_SLOTS };
