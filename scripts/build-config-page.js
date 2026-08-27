// scripts/build-config-page.js — repo-root wrapper: builds WarnWeather's config page.
// Calls the generic library builder with WarnWeather's app files + out path.
'use strict';
var path = require('path');
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

var ROOT = path.join(__dirname, '..');
var OUT  = path.join(ROOT, 'src/pkjs/settings/page.generated.js');
var APP_FILES = [
  // view-cycle.js must precede preview-layout.js and status-line-catalog.js must
  // precede blocks.js: their VC / statusLineCatalog fallbacks (used when this page is a
  // flat concatenated <script>, not a Node module) read their declarations directly from
  // this shared top-level scope.
  // country-defaults.js is the same shape (COUNTRY_DEFAULTS global) and must precede its
  // consumers blocks.js (recommend resolvers) and wizard.js (fresh-install derivation).
  path.join(ROOT, 'src/pkjs/settings/country-defaults.js'),
  path.join(ROOT, 'src/pkjs/view-cycle.js'),
  path.join(ROOT, 'src/pkjs/status-line-catalog.js'),
  path.join(ROOT, 'src/pkjs/settings/tomorrowio-budget.js'),
  // The graph-colour resolver the forecast preview draws from, plus its two deps.
  // ORDER IS LOAD-BEARING and stricter than the globals above: each of these reads the
  // previous one's window global while its OWN top-level body runs (resolve-ink needs
  // window.PebbleColors for the white-flip constant, line-style builds LINE_COLORS /
  // FILL_COLORS from both at load), so a wrong order throws at page boot rather than
  // degrading. Omitting any of them instead leaves window.LineStyle undefined, which
  // preview-forecast.js would hit only when the forecast preview renders — on a real
  // phone, while every Node test still passes through the require() branch.
  // test/config-page-bundle.test.js pins all three into the generated page.
  path.join(ROOT, 'src/pkjs/pebble-colors.js'),
  path.join(ROOT, 'src/pkjs/resolve-ink.js'),
  path.join(ROOT, 'src/pkjs/line-style.js'),
  // The five preview blocks, split by concern. Same load-bearing order rule as the
  // three above: preview-svg.js publishes window.PreviewSvg and preview-rain.js
  // window.PreviewRain, and the four block files read them while their OWN top-level
  // bodies run, so the two libraries come first. Dropping any one of these silently
  // unregisters its block on a real phone (an unregistered id renders nothing and only
  // warns) while every Node test still passes through the require() branch —
  // test/config-page-bundle.test.js pins each of them into the generated page.
  path.join(ROOT, 'src/pkjs/settings/preview-svg.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-rain.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-forecast.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-radar.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-diagnostics.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-layout.js'),
  path.join(ROOT, 'src/pkjs/settings/blocks.js'),
  // wizard-screenshots.generated.js assigns PConf.screenshots; must precede wizard.js, which reads it.
  path.join(ROOT, 'src/pkjs/settings/wizard-screenshots.generated.js'),
  // defaults-policy.js assigns window.DefaultsPolicy and must precede wizard.js, which
  // resolves the rule table on the wizard's finish button. Omitting it does not throw --
  // the wizard degrades to applying nothing -- so the whole feature would silently be a
  // no-op on a real phone while every Node test passed (those take the require() branch).
  // test/config-page-bundle.test.js pins every rule id into the generated page for exactly
  // that reason.
  path.join(ROOT, 'src/pkjs/settings/defaults-policy.js'),
  path.join(ROOT, 'src/pkjs/settings/wizard.js'),
  path.join(ROOT, 'src/pkjs/settings/onbuild.js'),
  // key-test.js must precede its two consumers (window.KeyTest factory).
  path.join(ROOT, 'src/pkjs/settings/key-test.js'),
  path.join(ROOT, 'src/pkjs/settings/owm-key-test.js'),
  path.join(ROOT, 'src/pkjs/settings/tomorrowio-key-test.js'),
  path.join(ROOT, 'src/pkjs/settings/news-protocol.js'),
  path.join(ROOT, 'src/pkjs/settings/news.js'),
  path.join(ROOT, 'src/pkjs/settings/theme-convert.js'),
  path.join(ROOT, 'src/pkjs/settings/reset-status-defaults.js'),
  // status-thresholds.js: the flat page has no require(), so blocks.js/onbuild.js
  // read window.StatusThresholds from it — lazily (at render/boot time), so its
  // position here only has to be somewhere in the bundle.
  path.join(ROOT, 'src/pkjs/status-thresholds.js'),
  path.join(ROOT, 'src/pkjs/settings/notices-panel.js')
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
