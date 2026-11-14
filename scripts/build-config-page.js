// scripts/build-config-page.js — repo-root wrapper: builds WarnWeather's config page.
// Calls the generic library builder with WarnWeather's app files + out path.
'use strict';
var path = require('path');
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

var ROOT = path.join(__dirname, '..');
var OUT  = path.join(ROOT, 'src/pkjs/settings/page.generated.js');
var APP_FILES = [
  // view-cycle.js must precede preview-watch.js and status-line-catalog.js must
  // precede blocks.js: their VC / statusLineCatalog fallbacks (used when this page is a
  // flat concatenated <script>, not a Node module) read their declarations directly from
  // this shared top-level scope.
  // country-defaults.js is the same shape (COUNTRY_DEFAULTS global) and must precede its
  // consumers blocks.js (recommend resolvers) and wizard.js (fresh-install derivation).
  path.join(ROOT, 'src/pkjs/page/settings/country-defaults.js'),
  path.join(ROOT, 'src/pkjs/layout/domain/view-cycle.js'),
  path.join(ROOT, 'src/pkjs/status-bars/domain/status-line-catalog.js'),
  // The On demand contract (window.OnDemand). It reads window.VIEW_CYCLE (the radar and
  // health row modes) while its own body runs, and status-thresholds.js binds it while
  // THAT body runs, so it sits after view-cycle.js and before status-thresholds.js —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/status-bars/domain/on-demand.js'),
  // The screens as lists (window.Screens): reads VIEW_CYCLE, window.StatusLineCatalog and
  // window.OnDemand while its body runs, so it follows all three.
  path.join(ROOT, 'src/pkjs/layout/domain/screens.js'),
  // The screens Add screen offers after Blank (window.ScreenPresets). It reads nothing at load;
  // screens-page.js and wizard-screens.js bind it while their bodies run, so it precedes both —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/page/layout/screen-presets.js'),
  path.join(ROOT, 'src/pkjs/page/weather/budgets/tomorrowio-budget.js'),
  // rainbow-budget.js reads PConf.tomorrowioBudget (ladder + night-pause rule) at load, and
  // interval-budget.js reads both; blocks.js reads all three at load — keep this order.
  path.join(ROOT, 'src/pkjs/page/weather/budgets/rainbow-budget.js'),
  path.join(ROOT, 'src/pkjs/page/weather/budgets/interval-budget.js'),
  // The key status under a keyed provider (page/weather/keys/key-status.js), the keyed sources it
  // reads by the row's picker (window.KeySources, key-sources.js: each picker's table; the
  // rows' args carry none), the key fingerprint it compares
  // (window.KeyFingerprint) and the reader of the phone's answers to each key
  // (window.KeyResult, key-result.js: what a status says about a key, and the
  // userData.keyResults record), all three read while key-status.js's own body runs, so
  // they come first. blocks.js registers tomorrow.io's usage line into PConf.keyStatus
  // while ITS body runs, so all four precede it; key-test.js reads PConf.keyStatus only
  // when a test answers. Every Node test takes the require() branch, so neither a dropped
  // file (no key row, key summary, missing-key note, tab dot or Save dialog — or,
  // without the tables, the fingerprint or the key results, a throw at the first keyed
  // provider's render) nor a wrong order shows there: test/page/settings/config-page-bundle.test.js pins
  // all four into the generated page.
  path.join(ROOT, 'src/pkjs/page/weather/keys/key-sources.js'),
  path.join(ROOT, 'src/pkjs/weather/domain/keys/key-fingerprint.js'),
  path.join(ROOT, 'src/pkjs/weather/domain/keys/key-result.js'),
  path.join(ROOT, 'src/pkjs/page/weather/keys/key-status.js'),
  // The regional radar sources' areas (window.RadarCoverage): blocks.js's note under the
  // Radar provider row reads it when it renders, after the missing-key note above.
  path.join(ROOT, 'src/pkjs/weather/domain/radar/radar-coverage.js'),
  // The graph-colour resolver the forecast preview draws from, plus its two deps.
  // ORDER IS LOAD-BEARING and stricter than the globals above: each of these reads the
  // previous one's window global while its OWN top-level body runs (resolve-ink needs
  // window.PebbleColors for the white-flip constant, line-style builds LINE_COLORS /
  // FILL_COLORS from both at load), so a wrong order throws at page boot rather than
  // degrading. Omitting any of them instead leaves window.LineStyle undefined, which
  // preview-forecast.js would hit only when the forecast preview renders — on a real
  // phone, while every Node test still passes through the require() branch.
  // test/page/settings/config-page-bundle.test.js pins all three into the generated page.
  path.join(ROOT, 'src/pkjs/theme/domain/pebble-colors.js'),
  path.join(ROOT, 'src/pkjs/theme/domain/resolve-ink.js'),
  // The threshold contract (window.StatusThresholds). Same load-bearing order on both
  // sides: it reads window.ResolveInk (the text colour's polarity) while its own
  // top-level body runs, and preview-radar.js, blocks.js and onbuild.js each bind it
  // while THEIRS run, so it sits between resolve-ink.js and all three. Out of order a
  // binding is undefined and the first sheet, badge or preview that reads it throws on
  // a real phone while every Node test still passes through require() —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/alerts/domain/status-thresholds.js'),
  // theme-flip.js publishes window.ThemeFlip (the polarity-flip rules);
  // theme-convert.js reads it at IIFE time to register the onChange hooks.
  path.join(ROOT, 'src/pkjs/theme/domain/theme-flip.js'),
  path.join(ROOT, 'src/pkjs/forecast-graphs/domain/line-style.js'),
  // The wind, gust and UV lines' Show [All | Alert] (window.LineAlert): the band the
  // bake scales such a line over, for forecast-hints.js' hints and the forecast preview. It
  // binds window.StatusThresholds and window.LineStyle while its own body runs, so it
  // follows both, and its two readers bind it while theirs run, so it precedes them —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/alerts/domain/line-alert.js'),
  // Draw from / Bars from [Bottom | Top] (window.DrawFrom): which lines and bars hang
  // from the top, for forecast-hints.js' hints and the forecast and radar previews. It binds
  // window.LineStyle while its own body runs, so it follows line-style.js, and its
  // readers bind it while theirs run, so it precedes them —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/forecast-graphs/domain/draw-from.js'),
  // The forecast's left axis options (window.ForecastAxis): the numbers' place and the
  // scale option, for the forecast preview and the Left axis card's when-resolver. It binds
  // window.LineStyle while its own body runs, so it follows line-style.js, and
  // preview-forecast.js and when-resolvers.js bind it while theirs run, so it precedes them —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/forecast-graphs/domain/forecast-axis.js'),
  // The long Forecast length's whole hours (window.ForecastSpanHours): that row's label,
  // by forecast-hints.js' forecastSpanOptions resolver, and the span option the forecast
  // preview's hour axis reads (preview-axis.js). It binds window.ForecastAxis while its own
  // body runs, so it follows forecast-axis.js, and forecast-hints.js and preview-axis.js bind
  // it while theirs run, so it precedes them — test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/weather/domain/forecast-span-hours.js'),
  // Graph styles (window.GraphStyles, the model) reads VIEW_CYCLE, LineStyle, LineAlert, DrawFrom
  // and ForecastAxis while its body runs; its page module (window.GraphStylesPage) reads it,
  // window.Screens and window.ForecastSpanHours, and forecast-hints.js and screens-page.js bind
  // the page module while THEIRS run, so both sit here, ahead of all of those.
  path.join(ROOT, 'src/pkjs/forecast-graphs/domain/graph-styles.js'),
  // The forecast metrics' names (window.ForecastMetrics: a metric as its pickers name it and as
  // a sentence does). It reads nothing at load; graph-styles-page.js, forecast-hints.js,
  // blocks.js and wizard-forecast.js bind it while their bodies run, so it precedes all four.
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/forecast-metrics.js'),
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/graph-styles-page.js'),
  // A stripe cell's level on its metric's own scale (window.StripeLevels): the table the
  // bake shades every stripe by, which the forecast and radar previews shade their cells
  // by and forecast-hints.js' stripe hints are written from. It reads nothing at load, and its
  // three readers bind it while their own bodies run, so it precedes them —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/forecast-graphs/domain/stripe-levels.js'),
  // The five preview blocks, split by concern. Same load-bearing order rule as the
  // three above: preview-svg.js publishes window.PreviewSvg and preview-rain.js
  // window.PreviewRain, and the four block files read them while their OWN top-level
  // bodies run, so the two libraries come first. Dropping any one of these silently
  // unregisters its block on a real phone (an unregistered id renders nothing and only
  // warns) while every Node test still passes through the require() branch —
  // test/page/settings/config-page-bundle.test.js pins each of them into the generated page.
  path.join(ROOT, 'src/pkjs/page/settings/preview-svg.js'),
  // The screen pictures' shared frame: ahead of preview-watch.js and wizard.js, which bind
  // window.ScreenFrame while their bodies run.
  path.join(ROOT, 'src/pkjs/page/layout/screen-frame.js'),
  // The watch's Gothic text fonts (window.WatchFonts, generated by
  // scripts/gen-watch-fonts-page.js) and the line drawer over them (window.WatchText), which
  // the screen pictures draw their text with: ahead of preview-forecast.js and
  // preview-watch.js, which bind window.WatchText while their bodies run.
  path.join(ROOT, 'src/pkjs/page/layout/watch-fonts.generated.js'),
  path.join(ROOT, 'src/pkjs/page/layout/watch-text.js'),
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/preview-rain.js'),
  // preview-stripe.js publishes window.PreviewStripe (the stripe cell look), read by
  // the forecast and radar previews below.
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/preview-stripe.js'),
  // preview-axis.js publishes window.PreviewAxis (the watch's temperature axis and hour
  // marks, mirrored), read by the forecast preview below. It binds window.ForecastSpanHours
  // while its own body runs, so it follows forecast-span-hours.js —
  // test/page/settings/config-page-bundle.test.js pins the order.
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/preview-axis.js'),
  // The setup wizard's sample weather (window.ForecastSample, a leaf): the hours its forecast
  // previews draw (forecastPreview's `sample`). wizard.js reads it when that step renders.
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/forecast-sample.js'),
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/preview-forecast.js'),
  path.join(ROOT, 'src/pkjs/page/weather/preview-radar.js'),
  path.join(ROOT, 'src/pkjs/page/telemetry/preview-diagnostics.js'),
  // The slot-text chain the watch-runtime bake prints every phone-baked slot through
  // (window.Utf8 -> window.StatusPair -> window.SlotText, each reading the ones before
  // it, and StatusLineCatalog, at IIFE time) and the date slot's formats
  // (window.DateFormat), so the Status bars tab's preview prints its samples exactly
  // as the watch prints the real readings.
  path.join(ROOT, 'src/pkjs/lib/utf8.js'),
  path.join(ROOT, 'src/pkjs/status-bars/domain/status-pair.js'),
  path.join(ROOT, 'src/pkjs/status-bars/domain/slot-text.js'),
  path.join(ROOT, 'src/pkjs/calendar/domain/date-format.js'),
  // The Status bars tab's pinned preview (reads StatusLineCatalog, OnDemand, VIEW_CYCLE,
  // PreviewSvg and the slot-text chain above at render).
  path.join(ROOT, 'src/pkjs/page/status-bars/preview-status-bars.js'),
  // The Graphs tab's Health pane preview (reads PreviewSvg and ResolveInk).
  path.join(ROOT, 'src/pkjs/page/health/preview-health.js'),
  // The status-slot row glyphs, registered into PConf.icons at IIFE time. It reads
  // nothing but PConf.icons (engine.js, a lib file, already ran), so any slot after
  // the lib files would do; it sits with the other page-only registrars, ahead of
  // blocks.js, and is only looked up at render time. Dropping it throws nothing —
  // an unregistered icon id just prints no glyph — so
  // test/page/settings/config-page-bundle.test.js pins its register() calls into the page.
  // The weather condition glyphs' outlines (window.ConditionGlyphs), which status-slot-icons.js
  // reads while its body runs.
  path.join(ROOT, 'src/pkjs/settings/condition-glyphs.generated.js'),
  // The weather condition icons as the watch draws them (window.ConditionPixels, from
  // scripts/pixel-icons/gen_watch_icons.js), which blocks.js's conditionList draws the condition
  // slot's list of conditions with, at render time.
  path.join(ROOT, 'src/pkjs/settings/condition-pixels.generated.js'),
  path.join(ROOT, 'src/pkjs/page/status-bars/status-slot-icons.js'),
  // The tab bar's glyphs (tab.icon), into the same registry.
  path.join(ROOT, 'src/pkjs/page/settings/tab-icons.js'),
  // The Watchface tab's watch: every view as the watch draws it, from the layout's seats
  // (view-cycle.js), the status bars' slots and the graph previews above.
  // The watch's clock digits (window.ClockGlyphs, generated by scripts/gen-clock-glyphs-page.js),
  // which preview-watch.js draws its clocks with.
  path.join(ROOT, 'src/pkjs/page/layout/clock-glyphs.generated.js'),
  path.join(ROOT, 'src/pkjs/page/layout/preview-watch.js'),
  // Add a screen's legend of what a screen's graphs draw: it binds window.PreviewWatch,
  // GraphStylesPage, PreviewForecast, PreviewHealth, PreviewRadar, ForecastMetrics and PreviewSvg
  // while its body runs, so it follows them all, and screens-page.js binds window.ScreenLegend
  // while its own runs, so it precedes that.
  path.join(ROOT, 'src/pkjs/page/layout/screen-legend.js'),
  // The schema's when resolvers (PConf.whenResolvers: lineRow, onDemandPlaced,
  // defaultViewLacksOnDemand). They bind window.LineStyle, window.DrawFrom,
  // window.OnDemand and VIEW_CYCLE while their own body runs, so they follow all four;
  // they register while it runs and are asked at render time. Dropping the file throws
  // nothing: an unregistered when-leaf reads false, so every Draw from, Visible values and
  // graph-scale row would silently never show on a real phone (and the Alerts notes and
  // the Bold row's middle option would read every item as placed nowhere) while every
  // Node test passed through blocks.js' require() — test/page/settings/config-page-bundle.test.js pins
  // its register() calls into the page.
  path.join(ROOT, 'src/pkjs/page/settings/when-resolvers.js'),
  // The Forecast tab's line resolvers (the metric and style pickers' options, and the
  // hints of the scale, Visible values, Wind graph scale and Draw from rows). They bind
  // window.LineStyle, window.LineAlert, window.DrawFrom and window.StripeLevels while
  // their own body runs (the stripe hints are written at load), so they follow all four;
  // they read nothing of blocks.js. Dropped, nothing throws: the metric and style pickers
  // silently offer no options and those rows lose their hints on a real phone, while every
  // Node test passes through blocks.js' require() — test/page/settings/config-page-bundle.test.js pins
  // the order and its registrations into the page.
  path.join(ROOT, 'src/pkjs/page/forecast-graphs/forecast-hints.js'),
  path.join(ROOT, 'src/pkjs/page/settings/blocks.js'),
  // The Alerts tab's resolvers (its rows' summaries and badges, the Shows on
  // grids' rows, a bar's Alerts row). They bind PConf.thresholdLevels, which blocks.js
  // publishes while ITS body runs, so they follow it; before it, the page throws at boot.
  // Dropped, nothing throws: the card's rows and the grids silently lose everything these
  // resolvers answer, while every Node test passes through blocks.js' require() —
  // test/page/settings/config-page-bundle.test.js pins the file after blocks.js and its registrations
  // into the page.
  path.join(ROOT, 'src/pkjs/page/alerts/alerts-page.js'),
  // The Watchface tab's shared Night hours (its resolvers, onChange hooks and onSubmit).
  path.join(ROOT, 'src/pkjs/page/theme/night-hours.js'),
  // defaults-policy.js assigns window.DefaultsPolicy, which wizard-finish.js binds while its
  // own body runs, so it comes first. test/page/settings/config-page-bundle.test.js pins every rule id into
  // the generated page: a Node test takes the require() branch and would not notice it missing.
  path.join(ROOT, 'src/pkjs/page/settings/defaults-policy.js'),
  // The Watchface tab's screens (the Screens card, the screen editor overlay, Setup's Rain
  // radar picker, the modes worked out on Save). After screens.js and preview-watch.js
  // (reads window.Screens and window.PreviewWatch at load), and ahead of the wizard, which
  // writes its screens through it (window.ScreensPage) and shares its overlay pattern.
  path.join(ROOT, 'src/pkjs/page/layout/screens-page.js'),
  // The setup wizard's parts, each publishing a window global that wizard.js binds while its own
  // body runs (test/page/settings/config-page-bundle.test.js pins them ahead of it): its styles, the Screens
  // step's data (reads window.Screens), the forecast step (reads the line, Draw from, axis, ink,
  // theme-flip, span and sample modules and preview-forecast.js, all above), the finishing
  // defaults (reads DefaultsPolicy and StatusLineCatalog) and the Tomorrow.io card (reads
  // COUNTRY_DEFAULTS).
  path.join(ROOT, 'src/pkjs/page/settings/wizard/wizard-css.js'),
  path.join(ROOT, 'src/pkjs/page/settings/wizard/wizard-screens.js'),
  path.join(ROOT, 'src/pkjs/page/settings/wizard/wizard-forecast.js'),
  path.join(ROOT, 'src/pkjs/page/settings/wizard/wizard-finish.js'),
  path.join(ROOT, 'src/pkjs/page/settings/wizard/wizard-upsell.js'),
  path.join(ROOT, 'src/pkjs/page/settings/wizard/wizard.js'),
  path.join(ROOT, 'src/pkjs/page/settings/onbuild.js'),
  // key-test.js must precede its three consumers (window.KeyTest factory).
  path.join(ROOT, 'src/pkjs/page/weather/keys/key-test.js'),
  path.join(ROOT, 'src/pkjs/page/weather/keys/owm-key-test.js'),
  path.join(ROOT, 'src/pkjs/page/weather/keys/tomorrowio-key-test.js'),
  path.join(ROOT, 'src/pkjs/page/weather/keys/rainbow-key-test.js'),
  path.join(ROOT, 'src/pkjs/notices/domain/news-protocol.js'),
  path.join(ROOT, 'src/pkjs/page/notices/news.js'),
  // support.js must FOLLOW news.js: it appends its header button into the
  // .news-hdr-left group news.js builds.
  path.join(ROOT, 'src/pkjs/page/settings/support.js'),
  path.join(ROOT, 'src/pkjs/page/theme/theme-convert.js'),
  path.join(ROOT, 'src/pkjs/page/status-bars/reset-status-defaults.js'),
  path.join(ROOT, 'src/pkjs/page/notices/notices-panel.js'),
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
  path.join(ROOT, 'src/pkjs/page/theme/vendor-suncalc.js'),
  path.join(ROOT, 'src/pkjs/weather/domain/weather-tab-model.js'),
  path.join(ROOT, 'src/pkjs/weather/adapter/weather-tab-data.js'),
  path.join(ROOT, 'src/pkjs/page/weather/weather-tab/weather-tab-icons.js'),
  path.join(ROOT, 'src/pkjs/page/weather/weather-tab/weather-tab-readouts.js'),
  path.join(ROOT, 'src/pkjs/page/weather/weather-tab/weather-tab-charts.js'),
  path.join(ROOT, 'src/pkjs/page/weather/weather-tab/weather-tab-interact.js'),
  path.join(ROOT, 'src/pkjs/page/weather/weather-tab/weather-tab-css.js'),
  path.join(ROOT, 'src/pkjs/page/weather/weather-tab/weather-tab.js')
];

function run() {
  return build.writeGenerated({ out: OUT, appFiles: APP_FILES });
}

if (require.main === module) {
  console.log('wrote ' + run());
}

module.exports = { run: run, APP_FILES: APP_FILES };
