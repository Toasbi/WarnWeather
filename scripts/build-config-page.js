// scripts/build-config-page.js — repo-root wrapper: builds WarnWeather's config page.
// Calls the generic library builder with WarnWeather's app files + out path.
'use strict';
var path = require('path');
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

var ROOT = path.join(__dirname, '..');
var OUT  = path.join(ROOT, 'src/pkjs/settings/page.generated.js');
var APP_FILES = [
  // view-cycle.js and status-line-catalog.js must precede blocks.js: blocks.js's VC /
  // statusLineCatalog fallbacks (used when this page is a flat concatenated <script>,
  // not a Node module) read their declarations directly from this shared top-level scope.
  path.join(ROOT, 'src/pkjs/view-cycle.js'),
  path.join(ROOT, 'src/pkjs/status-line-catalog.js'),
  path.join(ROOT, 'src/pkjs/settings/blocks.js'),
  // wizard-screenshots.generated.js assigns PConf.screenshots; must precede wizard.js, which reads it.
  path.join(ROOT, 'src/pkjs/settings/wizard-screenshots.generated.js'),
  path.join(ROOT, 'src/pkjs/settings/wizard.js'),
  path.join(ROOT, 'src/pkjs/settings/onbuild.js'),
  path.join(ROOT, 'src/pkjs/settings/theme-convert.js')
];

// Hard-fail if the wizard screenshots are missing/incomplete — the wizard has NO fallback. The
// required (platform, group, val) matrix is derived from gen-wizard-fixtures.js's SHOTS table, so it
// stays in lockstep with the capture automatically. Pass a module object to validate it directly (tests).
function assertScreenshots(mod) {
  if (!mod) {
    try { mod = require('../src/pkjs/settings/wizard-screenshots.generated.js'); }
    catch (e) { throw new Error('wizard screenshots missing — run `mise capture-wizard-screenshots` (on the Mac).'); }
  }
  var SHOTS = require('./gen-wizard-fixtures.js').SHOTS;
  function ok(v) { return typeof v === 'string' && v.indexOf('data:image/png;base64,') === 0; }
  var missing = [];
  SHOTS.forEach(function (s) {
    String(s.platforms || '').split(/\s+/).filter(Boolean).forEach(function (plat) {
      var g = mod[plat] || {};
      var got = (s.group === 'radar') ? g.radar : (g[s.group] && g[s.group][s.val]);
      if (!ok(got)) { missing.push(plat + '.' + s.group + (s.group === 'radar' ? '' : '.' + s.val)); }
    });
  });
  if (missing.length) { throw new Error('wizard screenshots incomplete: ' + missing.join(', ') + ' — run `mise capture-wizard-screenshots`.'); }
}

function run() {
  assertScreenshots();
  return build.writeGenerated({ out: OUT, appFiles: APP_FILES });
}

if (require.main === module) {
  console.log('wrote ' + run());
}

module.exports = { run: run, APP_FILES: APP_FILES, assertScreenshots: assertScreenshots };
