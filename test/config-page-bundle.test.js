// The settings page ships as ONE flat concatenated <script> with no require(), so a module
// that is missing from scripts/build-config-page.js's APP_FILES simply does not exist in the
// webview. Consumers written defensively (window.X || fallback) then degrade to doing nothing
// instead of throwing, which makes an omission invisible: every Node test still passes,
// because Node takes the require() branch. That is exactly how the wizard's defaults policy
// shipped as a production no-op once. These tests read the GENERATED page and assert the
// behaviour-carrying strings are actually in it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GENERATED = path.join(ROOT, 'src/pkjs/settings/page.generated.js');

/**
 * @returns {string} the generated flat settings page
 */
function page() {
  assert.ok(fs.existsSync(GENERATED),
    'page.generated.js is missing — run `node scripts/build-config-page.js` (mise test does this for you)');
  return fs.readFileSync(GENERATED, 'utf8');
}

test('every defaults-policy rule id reaches the generated settings page', () => {
  const policy = require('../src/pkjs/settings/defaults-policy.js');
  const src = page();
  assert.ok(policy.RULES.length > 0, 'the rule table is empty — nothing to pin');
  policy.RULES.forEach((rule) => {
    assert.ok(src.indexOf(rule.id) !== -1,
      'rule "' + rule.id + '" is not in page.generated.js: defaults-policy.js is probably ' +
      'missing from APP_FILES in scripts/build-config-page.js, which makes the wizard\'s ' +
      'defaults a silent no-op on a real phone');
  });
});

test('the generated page installs the DefaultsPolicy global the wizard reads', () => {
  const src = page();
  assert.ok(src.indexOf('window.DefaultsPolicy') !== -1,
    'nothing assigns window.DefaultsPolicy — the wizard would resolve undefined and apply nothing');
});

test('defaults-policy is bundled BEFORE the wizard that consumes it', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => appFiles.findIndex((f) => f.endsWith(suffix));
  const policyAt = idx('settings/defaults-policy.js');
  const wizardAt = idx('settings/wizard.js');
  assert.notEqual(policyAt, -1, 'defaults-policy.js is not in APP_FILES at all');
  assert.notEqual(wizardAt, -1, 'wizard.js is not in APP_FILES at all');
  assert.ok(policyAt < wizardAt,
    'defaults-policy.js must be concatenated before wizard.js so the global exists when read');
});

// The custom-layout editor is the same silent-no-op shape as the defaults policy:
// BOTH consumers guard its absence (the Edit button's [data-action] dispatch and the
// layoutPresetChanged hook's `if (PConf.actions.openViewEditor)`), so dropping
// view-editor.js from APP_FILES keeps every Node test green while the shipped page's
// Edit button does nothing. Pin the ASSIGNMENT, not the bare name — blocks.js's guard
// keeps the string 'openViewEditor' in the page even with the editor gutted.
test('the custom-layout editor reaches the generated page, after view-cycle', () => {
  const src = page();
  assert.ok(src.indexOf('PConf.actions.openViewEditor =') !== -1,
    'nothing assigns PConf.actions.openViewEditor — picking Custom would seed keys and render a dead Edit button');
  assert.ok(src.indexOf('data-ve-save') !== -1,
    'the editor overlay markup is missing from the page');
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => appFiles.findIndex((f) => f.endsWith(suffix));
  const vcAt = idx('pkjs/view-cycle.js');
  const veAt = idx('settings/view-editor.js');
  assert.notEqual(veAt, -1, 'view-editor.js is not in APP_FILES at all');
  assert.ok(vcAt !== -1 && vcAt < veAt,
    'view-cycle.js must precede view-editor.js — the editor binds window.VIEW_CYCLE while its IIFE runs');
});

// The forecast preview resolves every graph colour through line-style.js (and its two
// deps) instead of re-implementing the colour model. Same silent-no-op hazard as the
// defaults policy above, one step worse: these three must also be in the RIGHT ORDER,
// because each reads the previous one's window global while its own top-level body runs.
test('the graph-colour resolver and its deps reach the generated settings page', () => {
  const src = page();
  ['window.PebbleColors', 'window.ResolveInk', 'window.LineStyle',
    'window.PreviewSvg', 'window.PreviewRain'].forEach((global) => {
    assert.ok(src.indexOf(global) !== -1,
      'nothing assigns ' + global + ' — it is probably missing from APP_FILES in ' +
      'scripts/build-config-page.js, which leaves the forecast preview unable to resolve ' +
      'its colours on a real phone while every Node test passes');
  });
});

// Every preview block is its own file, and each of them reads a window global that a
// file earlier in APP_FILES publishes. Dropping one does not throw: an unregistered
// block id renders nothing and only warns, so the block would silently vanish from a
// real phone's settings page while every Node test still passed through require().
const PREVIEW_BLOCK_FILES = ['settings/preview-forecast.js', 'settings/preview-radar.js',
  'settings/preview-diagnostics.js', 'settings/preview-layout.js'];

test('the graph-colour modules and the preview kit are bundled in dependency order', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  // resolve-ink reads window.PebbleColors and line-style reads both, each at load time,
  // so a wrong order throws at page boot rather than degrading quietly.
  assert.ok(idx('pkjs/pebble-colors.js') < idx('pkjs/resolve-ink.js'),
    'pebble-colors.js must precede resolve-ink.js');
  assert.ok(idx('pkjs/resolve-ink.js') < idx('pkjs/line-style.js'),
    'resolve-ink.js must precede line-style.js');
  assert.ok(idx('pkjs/resolve-ink.js') < idx('settings/preview-svg.js'),
    'resolve-ink.js must precede preview-svg.js, which reads window.ResolveInk at IIFE time');
  // theme-flip.js reads window.ResolveInk at IIFE time (barColorDefault /
  // BAR_COLOR_KEYS), and theme-convert.js reads window.ThemeFlip at IIFE time to
  // register the onChange hooks. These orderings fail WORSE than the others: the
  // page still boots (the read just binds undefined) and only dies when someone
  // flips the Theme control, which no Node test exercises because those take the
  // require() branch.
  assert.ok(idx('pkjs/resolve-ink.js') < idx('pkjs/theme-flip.js'),
    'resolve-ink.js must precede theme-flip.js, which reads window.ResolveInk at IIFE time');
  assert.ok(idx('pkjs/theme-flip.js') < idx('settings/theme-convert.js'),
    'theme-flip.js must precede theme-convert.js, which reads window.ThemeFlip at IIFE time');
  assert.ok(idx('settings/preview-svg.js') < idx('settings/preview-rain.js'),
    'preview-svg.js must precede preview-rain.js, which reads window.PreviewSvg at IIFE time');
  PREVIEW_BLOCK_FILES.forEach((file) => {
    assert.ok(idx('pkjs/line-style.js') < idx(file) &&
      idx('settings/preview-svg.js') < idx(file) &&
      idx('settings/preview-rain.js') < idx(file),
      file + ' must follow line-style.js, preview-svg.js and preview-rain.js — it reads ' +
      'their window globals while its own IIFE body runs');
  });
});

// blocks.js reads window.LineStyle while its own IIFE body runs, so a wrong order leaves
// it undefined and every resolver built on it throws on a real phone with every Node test
// still green. The night tint is the one that would fail silently in the other direction:
// its badge dot and its picker swatch both paint the CASCADED colour through
// line-style's graphNightTint, so a rename that only Node sees would show a stale swatch.
test('the night-tint display rule reaches the generated page, after line-style', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/line-style.js') < idx('settings/blocks.js'),
    'line-style.js must precede blocks.js, which reads window.LineStyle at IIFE time');
  const src = page();
  assert.ok(src.indexOf("PConf.displayResolvers.register('graphNightTint'") !== -1,
    'nothing registers the night-tint display resolver — the tint picker would show the ' +
    'untouched key while the graph paints the fill colour');
  assert.ok(src.indexOf('graphNightTint:') !== -1,
    'line-style.js reaches the page without the cascade both surfaces call');
});

test('every preview block reaches the generated settings page', () => {
  const src = page();
  ['forecastPreview', 'radarPreview', 'devStats', 'lastFetch', 'layoutPreviewCombined']
    .forEach((id) => {
      assert.ok(src.indexOf("PConf.blocks.register('" + id + "'") !== -1,
        'nothing registers the ' + id + ' block — its file is probably missing from ' +
        'APP_FILES in scripts/build-config-page.js, which drops the block from the page ' +
        'on a real phone while every Node test passes');
    });
});

// support.js is the quietest omission of the lot: nothing else in the page references it,
// so leaving it out of APP_FILES just means the coffee mug never appears — no throw, no
// warning, and every Node test still green through the require() branch.
test('the support mug reaches the generated page, after news.js', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('settings/news.js') < idx('settings/support.js'),
    'news.js must precede support.js, which appends its button into the .news-hdr-left ' +
    'header group news.js builds');
  const src = page();
  assert.ok(src.indexOf('buymeacoffee.com/toaster2') !== -1,
    'the support popup\'s Buy Me a Coffee link is not in page.generated.js — support.js is ' +
    'probably missing from APP_FILES in scripts/build-config-page.js');
  assert.ok(src.indexOf('bmc-steam-rise') !== -1,
    'the steam keyframes are not in page.generated.js — the mug would render without its ' +
    'animation');
});

// APP_FILES is SHARED — build-config-page.js ships the page and
// preview-config-page.js requires that same array to render `mise
// preview-config`, so the two can no longer drift. test/preview-config-page.js's
// last test pins that it stays one array rather than becoming a copy again.

// The Weather tab is nine files, each reading a window global a file earlier
// in APP_FILES publishes (SunCalc / WeatherTabModel / WeatherTabData /
// WeatherTabIcons / WeatherTabReadouts / WeatherTabCharts / WeatherTabCss /
// WeatherTabInteract) while its own IIFE body runs. Same silent-no-op hazard
// as the preview kit: an unregistered block renders nothing and only warns.
// Pin the ASSIGNMENT, not the bare name — every consumer's `: window.X;`
// fallback read keeps the bare string in the page even with the publisher
// dropped from APP_FILES.
test('the Weather tab kit reaches the generated page in dependency order', () => {
  const src = page();
  ['window.SunCalc', 'window.WeatherTabModel =', 'window.WeatherTabData =',
    'window.WeatherTabIcons =', 'window.WeatherTabReadouts =',
    'window.WeatherTabCharts =', 'window.WeatherTabCss =',
    'window.WeatherTabInteract ='].forEach((g) => {
    assert.ok(src.indexOf(g) !== -1,
      'nothing assigns ' + g + ' — probably missing from APP_FILES in scripts/build-config-page.js');
  });
  assert.ok(src.indexOf("register('weatherGraphs'") !== -1,
    'weather-tab.js does not register the weatherGraphs block in the page');
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('settings/weather-tab-model.js') < idx('settings/weather-tab-data.js'),
    'weather-tab-model.js must precede weather-tab-data.js (reads window.WeatherTabModel at IIFE time)');
  assert.ok(idx('settings/weather-tab-model.js') < idx('settings/weather-tab-charts.js'),
    'weather-tab-model.js must precede weather-tab-charts.js');
  assert.ok(idx('settings/weather-tab-icons.js') < idx('settings/weather-tab-charts.js'),
    'weather-tab-icons.js must precede weather-tab-charts.js (reads window.WeatherTabIcons at IIFE time)');
  assert.ok(idx('settings/weather-tab-readouts.js') < idx('settings/weather-tab-charts.js'),
    'weather-tab-readouts.js must precede weather-tab-charts.js (aliases its helpers at IIFE time)');
  assert.ok(idx('settings/weather-tab-model.js') < idx('settings/weather-tab-readouts.js'),
    'weather-tab-model.js must precede weather-tab-readouts.js');
  // The one that cannot be caught by running the suite: in Node,
  // weather-tab-css.js takes its require() branch, so every test passes with
  // the fatal order. In the flat page it reads window.WeatherTabInteract at
  // IIFE time to bake the pan's settle curve into its stylesheet, and the
  // whole bundle is ONE <script> ending in boot() — so a throw here leaves
  // the entire settings page blank, not merely an unstyled Weather tab.
  assert.ok(idx('settings/weather-tab-interact.js') < idx('settings/weather-tab-css.js'),
    'weather-tab-interact.js must precede weather-tab-css.js (SETTLE_CSS at IIFE time)');
  ['settings/vendor-suncalc.js', 'settings/weather-tab-model.js',
    'settings/weather-tab-data.js', 'settings/weather-tab-icons.js',
    'settings/weather-tab-readouts.js', 'settings/weather-tab-charts.js',
    'settings/weather-tab-css.js', 'settings/weather-tab-interact.js'].forEach((dep) => {
    assert.ok(idx(dep) < idx('settings/weather-tab.js'),
      dep + ' must precede weather-tab.js, which reads its window global at IIFE time');
  });
});
