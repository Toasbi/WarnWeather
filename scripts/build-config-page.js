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
  // The On demand contract (window.OnDemand). It reads window.VIEW_CYCLE (the radar and
  // health row modes) while its own body runs, and status-thresholds.js binds it while
  // THAT body runs, so it sits after view-cycle.js and before status-thresholds.js —
  // test/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/on-demand.js'),
  path.join(ROOT, 'src/pkjs/settings/tomorrowio-budget.js'),
  // The runtime's radar-source resolver (Rainbow + rainbowOwnKey -> 'rainbowkey'), which
  // rainbow-budget.js reads as PConf.radarSourceId at load and onbuild.js at its hooks
  // (the Radar tab's "Rainbow (own key)" fold).
  path.join(ROOT, 'src/pkjs/weather/radar-source-id.js'),
  // rainbow-budget.js reads PConf.tomorrowioBudget (ladder + night-pause rule) at load, and
  // interval-budget.js reads both; blocks.js reads all three at load — keep this order.
  path.join(ROOT, 'src/pkjs/settings/rainbow-budget.js'),
  path.join(ROOT, 'src/pkjs/settings/interval-budget.js'),
  // The key status under a keyed provider (settings/key-status.js) and the key fingerprint
  // it compares (window.KeyFingerprint, read while key-status.js's own body runs, so it
  // comes first). blocks.js registers tomorrow.io's usage line into PConf.keyStatus while
  // ITS body runs, so both precede it; key-test.js reads PConf.keyStatus only when a test
  // answers. Every Node test takes the require() branch, so neither a dropped file (no
  // Edit button, summary line, missing-key note, tab dot or Save dialog — or, without the
  // fingerprint, a throw at the first keyed provider's render) nor a wrong order shows
  // there: test/config-page-bundle.test.js pins both into the generated page.
  path.join(ROOT, 'src/pkjs/key-fingerprint.js'),
  path.join(ROOT, 'src/pkjs/settings/key-status.js'),
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
  // The threshold contract (window.StatusThresholds). Same load-bearing order on both
  // sides: it reads window.ResolveInk (the text colour's polarity) while its own
  // top-level body runs, and preview-radar.js, blocks.js and onbuild.js each bind it
  // while THEIRS run, so it sits between resolve-ink.js and all three. Out of order a
  // binding is undefined and the first sheet, badge or preview that reads it throws on
  // a real phone while every Node test still passes through require() —
  // test/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/status-thresholds.js'),
  // theme-flip.js publishes window.ThemeFlip (the polarity-flip rules);
  // theme-convert.js reads it at IIFE time to register the onChange hooks.
  path.join(ROOT, 'src/pkjs/theme-flip.js'),
  path.join(ROOT, 'src/pkjs/line-style.js'),
  // The wind, gust and UV lines' Show [All | Alert] (window.LineAlert): the band the
  // bake scales such a line over, for blocks.js' hints and the forecast preview, and
  // the reading onbuild.js heals the stored value with. It binds window.StatusThresholds
  // and window.LineStyle while its own body runs, so it follows both, and its three
  // readers bind it while theirs run, so it precedes them —
  // test/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/line-alert.js'),
  // The five preview blocks, split by concern. Same load-bearing order rule as the
  // three above: preview-svg.js publishes window.PreviewSvg and preview-rain.js
  // window.PreviewRain, and the four block files read them while their OWN top-level
  // bodies run, so the two libraries come first. Dropping any one of these silently
  // unregisters its block on a real phone (an unregistered id renders nothing and only
  // warns) while every Node test still passes through the require() branch —
  // test/config-page-bundle.test.js pins each of them into the generated page.
  path.join(ROOT, 'src/pkjs/settings/preview-svg.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-rain.js'),
  // preview-stripe.js publishes window.PreviewStripe (the stripe cell look), read by
  // the forecast and radar previews below.
  path.join(ROOT, 'src/pkjs/settings/preview-stripe.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-forecast.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-radar.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-diagnostics.js'),
  path.join(ROOT, 'src/pkjs/settings/preview-layout.js'),
  // The status-slot row glyphs, registered into PConf.icons at IIFE time. It reads
  // nothing but PConf.icons (engine.js, a lib file, already ran), so any slot after
  // the lib files would do; it sits with the other page-only registrars, ahead of
  // blocks.js, and is only looked up at render time. Dropping it throws nothing —
  // an unregistered icon id just prints no glyph — so
  // test/config-page-bundle.test.js pins its register() calls into the page.
  path.join(ROOT, 'src/pkjs/settings/status-slot-icons.js'),
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
  // The Custom-layout editor overlay. After view-cycle.js (reads window.VIEW_CYCLE
  // at load) and beside the wizard, whose overlay pattern it shares.
  path.join(ROOT, 'src/pkjs/settings/view-editor.js'),
  path.join(ROOT, 'src/pkjs/settings/onbuild.js'),
  // key-test.js must precede its three consumers (window.KeyTest factory).
  path.join(ROOT, 'src/pkjs/settings/key-test.js'),
  path.join(ROOT, 'src/pkjs/settings/owm-key-test.js'),
  path.join(ROOT, 'src/pkjs/settings/tomorrowio-key-test.js'),
  path.join(ROOT, 'src/pkjs/settings/rainbow-key-test.js'),
  path.join(ROOT, 'src/pkjs/settings/news-protocol.js'),
  path.join(ROOT, 'src/pkjs/settings/news.js'),
  // support.js must FOLLOW news.js: it appends its header button into the
  // .news-hdr-left group news.js builds.
  path.join(ROOT, 'src/pkjs/settings/support.js'),
  path.join(ROOT, 'src/pkjs/settings/theme-convert.js'),
  path.join(ROOT, 'src/pkjs/settings/reset-status-defaults.js'),
  path.join(ROOT, 'src/pkjs/settings/notices-panel.js'),
  // The Weather tab kit (live graphs / 5-day / saved locations), nine
  // files. Order is load-bearing within the group for all but
  // vendor-suncalc.js (window.SunCalc is read lazily at render time, so it
  // only has to be somewhere in the bundle): each of the others publishes a
  // window global its dependents read at IIFE time — weather-tab-model.js →
  // WeatherTabModel (read by data/readouts/charts); weather-tab-icons.js and
  // weather-tab-readouts.js → read by charts; weather-tab-interact.js →
  // WeatherTabInteract, whose settle curve weather-tab-css.js bakes into its
  // stylesheet string; and weather-tab.js reads five of them (Model, Data,
  // Charts, Css, Interact) while its own top-level body runs.
  path.join(ROOT, 'src/pkjs/settings/vendor-suncalc.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab-model.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab-data.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab-icons.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab-readouts.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab-charts.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab-interact.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab-css.js'),
  path.join(ROOT, 'src/pkjs/settings/weather-tab.js')
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
