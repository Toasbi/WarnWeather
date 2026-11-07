#!/usr/bin/env node
'use strict';
// Wizard screenshot fixtures: one static scene per option of the Layout and Theme pickers (3 layout
// presets, 4 themes), layered on the Berlin base. Mirrors gen-showcase-fixtures.js. The Screens and
// forecast steps draw the watch's screens live (preview-watch.js), so they need no screenshots. Each
// shot is the Default view the watch boots on (flicks:0); capture-screenshots.sh still takes a flick
// count for a shot that needs one. Confirm visually when capturing.
const fs = require('fs');
const path = require('path');
const BASE_PATH = path.join('fixtures', 'berlin.json');
const NOW_OVERRIDE = { minute: 0, second: 0 };
// Common forecast look for the layout shots. rainBarColor is deliberately NOT here: its
// default depends on the theme's polarity, so the loop below derives it per shot.
const FORECAST = { secondaryLine: 'precip_prob', secondaryLineFill: true, thirdLine: 'uv', barSource: 'rain' };
const { barColorDefault } = require('../src/pkjs/resolve-ink.js');
// Which platforms each shot is captured on (space-separated; consumed by capture-wizard-screenshots.sh
// per fixture and by gen-wizard-screenshots.js to key the module). Facts from config-ui/lib/platform.js:
//   basalt, emery — color, health, radar        flint — B&W, health, radar
//   aplite — B&W, no health, no radar            (diorite ≈ flint; wizard maps diorite→flint, not captured)
// Layout shows on every watch. The theme step is gated on env.themePolarity (wizard.js buildSteps):
// aplite compiles WW_THEME_POLARITY out and renders classic white-on-black only, so it shows NO theme
// card at all — dark/light appear on the polarity platforms, bw / bw-light on color watches only.
const ALL = 'basalt flint emery aplite';
const THEME = 'basalt flint emery';          // WW_THEME_POLARITY platforms (dark/light); aplite has no theme step
const COLOR = 'basalt emery';                // flint + aplite are B&W → they never show bw/bw-light cards
// slug → fixture; group/val/platforms are consumed by gen-wizard-screenshots.js to key the module.
const SHOTS = [
  { slug: 'layout-fullcal',    group: 'layoutPreset', val: 'fullCal',    flicks: 0, platforms: ALL,          clay: Object.assign({ layoutPreset: 'fullCal',    healthMode: 'off', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'layout-compactcal', group: 'layoutPreset', val: 'compactCal', flicks: 0, platforms: ALL,          clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'layout-nocal',      group: 'layoutPreset', val: 'noCal',      flicks: 0, platforms: ALL,          clay: Object.assign({ layoutPreset: 'noCal',      healthMode: 'off', radarProvider: 'disabled' }, FORECAST) },
  { slug: 'theme-dark',     group: 'theme', val: 'dark',     flicks: 0, platforms: THEME, clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'dark' }, FORECAST) },
  // colorTime is normally flipped white→black by the config-UI 'themeConvert' hook on switching to
  // a light polarity; the fixture bypasses that, and clay-payload sends colorTime verbatim, so set it
  // black here — otherwise the default-white time is invisible on the light theme's white background.
  { slug: 'theme-light',    group: 'theme', val: 'light',    flicks: 0, platforms: THEME, clay: Object.assign({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'disabled', theme: 'light', colorTime: '#000000' }, FORECAST) },
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
    // The two bar-colour modes default per POLARITY (resolve-ink.js barColorDefault):
    // multicolor on dark, Solid on light, because the multicolor tiers are tuned against
    // black and the lightest of them wash out on white. The settings page applies that
    // through its themeConvert hook — which this fixture path bypasses entirely, the same
    // gap colorTime is hand-patched for in the theme-light shot above. Derive it here or
    // the light card advertises a rendering no light install actually gets. A shot naming
    // a mode itself still wins.
    const barDefault = barColorDefault(frame.claySettings.theme);
    if (!('rainBarColor' in s.clay)) { frame.claySettings.rainBarColor = barDefault; }
    if (!('radarColor' in s.clay)) { frame.claySettings.radarColor = barDefault; }
    const outPath = path.join(outDir, 'wizard-' + s.slug + '.json');
    fs.writeFileSync(outPath, JSON.stringify(frame, null, 2) + '\n');
    written.push(outPath);
  }
  return written;
}
if (require.main === module) { const w = generate(); console.log('Wrote ' + w.length + ' wizard fixtures.'); }
module.exports = { generate, SHOTS, BASE_PATH };
