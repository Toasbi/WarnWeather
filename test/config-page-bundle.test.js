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

// on-demand.js reads window.VIEW_CYCLE while its own body runs and status-thresholds.js
// binds window.OnDemand while ITS body runs: out of order, the first status-bar summary,
// checklist or bake that reads the contract throws on a real phone, while every Node test
// passes through require().
test('the On demand contract is bundled after view-cycle and before status-thresholds', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/view-cycle.js') < idx('pkjs/on-demand.js'),
    'view-cycle.js must precede on-demand.js');
  assert.ok(idx('pkjs/on-demand.js') < idx('pkjs/status-thresholds.js'),
    'on-demand.js must precede status-thresholds.js');
  assert.ok(page().indexOf('window.OnDemand = api') !== -1,
    'nothing assigns window.OnDemand in the generated page');
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
// its one consumer, the Edit button's [data-action] dispatch, guards its absence, so
// dropping view-editor.js from APP_FILES keeps every Node test green while the shipped
// page's Edit button does nothing. Pin the ASSIGNMENT, not the bare name — the schema
// itself never enters the page (build-page concatenates shell.html + APP_FILES only;
// the schema is injected at runtime), but blocks.js mentions 'openViewEditor' in a
// comment, so a bare-name search would stay green with the editor gutted.
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

// line-alert.js binds window.StatusThresholds and window.LineStyle while its own body
// runs, and forecast-hints.js and preview-forecast.js bind window.LineAlert while theirs do: out
// of order, the Show row's hint and the preview of an Alert line throw on a real phone
// while every Node test passes through require().
test('the Show [All | Alert] module is bundled after its deps and before its readers', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/status-thresholds.js') < idx('pkjs/line-alert.js'),
    'status-thresholds.js must precede line-alert.js');
  assert.ok(idx('pkjs/line-style.js') < idx('pkjs/line-alert.js'),
    'line-style.js must precede line-alert.js');
  assert.ok(idx('pkjs/line-alert.js') < idx('settings/preview-forecast.js'),
    'line-alert.js must precede preview-forecast.js');
  assert.ok(idx('pkjs/line-alert.js') < idx('settings/forecast-hints.js'),
    'line-alert.js must precede forecast-hints.js');
  const src = page();
  assert.ok(src.indexOf('window.LineAlert = api') !== -1,
    'nothing assigns window.LineAlert in the generated page');
  assert.ok(src.indexOf("PConf.hintResolvers.register('lineShowHint'") !== -1,
    'nothing registers the Show row\'s hint in the generated page');
});

// draw-from.js (window.DrawFrom) binds window.LineStyle while its own body runs, and
// preview-forecast.js, preview-radar.js and forecast-hints.js bind window.DrawFrom while theirs
// do: out of order, the Draw from row's hint, the previews and the page's boot throw on
// a real phone while every Node test passes through require().
test('the Draw from module is bundled after line-style.js and before its readers', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/line-style.js') < idx('pkjs/draw-from.js'), 'line-style.js must precede draw-from.js');
  ['settings/preview-forecast.js', 'settings/preview-radar.js', 'settings/forecast-hints.js']
    .forEach((reader) => {
      assert.ok(idx('pkjs/draw-from.js') < idx(reader), 'draw-from.js must precede ' + reader);
    });
  const src = page();
  assert.ok(src.indexOf('window.DrawFrom = api') !== -1, 'nothing assigns window.DrawFrom in the generated page');
  assert.ok(src.indexOf("PConf.hintResolvers.register('lineFromHint'") !== -1,
    'nothing registers the Draw from row\'s hint in the generated page');
});

// forecast-axis.js (window.ForecastAxis, the forecast's left axis options, BETA) binds
// window.LineStyle while its own body runs, and preview-forecast.js and when-resolvers.js bind
// window.ForecastAxis while theirs do: out of order, the forecast preview and the Left axis
// card's gate throw on a real phone while every Node test passes through require().
test('the left axis module is bundled after line-style.js and before its readers', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/line-style.js') < idx('pkjs/forecast-axis.js'),
    'line-style.js must precede forecast-axis.js');
  ['settings/preview-forecast.js', 'settings/when-resolvers.js'].forEach((reader) => {
    assert.ok(idx('pkjs/forecast-axis.js') < idx(reader), 'forecast-axis.js must precede ' + reader);
  });
  const src = page();
  assert.ok(src.indexOf('window.ForecastAxis = api') !== -1,
    'nothing assigns window.ForecastAxis in the generated page');
});

// forecast-span-hours.js (window.ForecastSpanHours, the long time span's whole hours) binds
// window.ForecastAxis and window.VIEW_CYCLE while its own body runs, and forecast-hints.js binds
// window.ForecastSpanHours while its own does: out of order, the page throws at boot on a real
// phone while every Node test passes through require(). Its resolver, forecastSpanOptions,
// is the Time span row's, registered by forecast-hints.js's own part of the page.
test('the span hours module is bundled after view-cycle.js and forecast-axis.js, before forecast-hints.js', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/forecast-axis.js') < idx('pkjs/forecast-span-hours.js'),
    'forecast-axis.js must precede forecast-span-hours.js');
  assert.ok(idx('pkjs/view-cycle.js') < idx('pkjs/forecast-span-hours.js'),
    'view-cycle.js must precede forecast-span-hours.js');
  assert.ok(idx('pkjs/forecast-span-hours.js') < idx('settings/forecast-hints.js'),
    'forecast-span-hours.js must precede forecast-hints.js');
  const src = page();
  assert.ok(src.indexOf('window.ForecastSpanHours = api') !== -1,
    'nothing assigns window.ForecastSpanHours in the generated page');
  const from = src.indexOf('/* app: forecast-hints.js */');
  const part = src.slice(from, src.indexOf('/* app: ', from + 1));
  assert.ok(part.indexOf("PConf.optionsResolvers.register('forecastSpanOptions'") !== -1,
    'forecast-hints.js does not register the forecastSpanOptions resolver in the generated page');
});

// The forecast preview and its axis mirrors (preview-axis.js, window.PreviewAxis), each with the
// window globals it binds while its own body runs. Each must be assigned earlier in the page:
// out of order, the forecast preview throws on a real phone while every Node test passes
// through require().
const BINDS_AT_LOAD = {
  'preview-axis.js': ['window.ForecastSpanHours'],
  'preview-forecast.js': ['window.PreviewSvg', 'window.PreviewRain', 'window.LineStyle', 'window.LineAlert',
    'window.StripeLevels', 'window.DrawFrom', 'window.ForecastAxis', 'window.PreviewAxis', 'window.ResolveInk',
    'window.PreviewStripe']
};

test('the forecast preview and its axis mirrors are bundled after every global they bind at load', () => {
  const src = page();
  Object.keys(BINDS_AT_LOAD).forEach((file) => {
    const at = src.indexOf('/* app: ' + file + ' */');
    assert.notEqual(at, -1, file + ' is not in the generated page');
    BINDS_AT_LOAD[file].forEach((global) => {
      const set = src.indexOf(global + ' = ');
      assert.notEqual(set, -1, 'nothing assigns ' + global + ' in the generated page');
      assert.ok(set < at, global + ' must be assigned before ' + file + ' runs');
    });
  });
});

// when-resolvers.js answers the schema's { when } leaves. It binds window.LineStyle,
// window.DrawFrom, window.OnDemand, window.ForecastAxis and VIEW_CYCLE while its own body
// runs, so it follows all five. Out of the page, nothing throws: an unregistered leaf reads false, so the
// rows that ask it would silently never show (or always, under a `not`) on a real phone
// while every Node test passes through blocks.js' require().
test('the when resolvers are bundled after the modules they ask', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  ['pkjs/line-style.js', 'pkjs/draw-from.js', 'pkjs/on-demand.js', 'pkjs/view-cycle.js',
    'pkjs/forecast-axis.js'].forEach((dep) =>
    assert.ok(idx(dep) < idx('settings/when-resolvers.js'), dep + ' must precede when-resolvers.js'));
  const src = page();
  ['lineRow', 'onDemandPlaced', 'defaultViewLacksOnDemand', 'tempAxisLineDrawn'].forEach((id) =>
    assert.ok(src.indexOf("PConf.whenResolvers.register('" + id + "'") !== -1,
      'nothing registers the ' + id + ' when resolver in the generated page'));
});

// forecast-hints.js holds the Forecast tab's line resolvers: the metric and style pickers'
// options and the hints of the rows under them. It binds window.LineStyle, window.LineAlert,
// window.DrawFrom and window.StripeLevels while its own body runs (the stripe hints are
// written at load), so it follows all four. Out of the page, nothing throws: the pickers
// offer no options and those rows lose their hints on a real phone, while every Node test
// passes through blocks.js' require(). The ids come from the schema: every resolver the
// forecast lines' rows name (each line's dialog on the Graphs tab, its colours row aside —
// that one is blocks.js's), each registered by forecast-hints.js's own part of the page.
test('the forecast line resolvers are bundled after the line modules they read', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  ['pkjs/line-style.js', 'pkjs/line-alert.js', 'pkjs/draw-from.js', 'pkjs/stripe-levels.js'].forEach((dep) =>
    assert.ok(idx(dep) < idx('settings/forecast-hints.js'), dep + ' must precede forecast-hints.js'));
  const lines = require('../src/pkjs/settings/schema.js').tabs.find((t) => t.id === 'graphs').sections
    .filter((sec) => /^line(Main|Second|Third|Fourth)$/.test(sec.sheetId))
    .map((sec) => sec.items.filter((item) => item.label !== 'Colors'));
  assert.equal(lines.length, 4, 'one dialog per forecast line');
  const ids = new Set();
  (function collect(node) {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (!node || typeof node !== 'object') { return; }
    if (typeof node.resolver === 'string') { ids.add(node.resolver); }
    Object.keys(node).forEach((k) => collect(node[k]));
  })(lines);
  assert.deepEqual([...ids].sort(), ['forecastMetric', 'forecastMetricHint', 'lineFromHint', 'lineShowHint',
    'lineStyleHint', 'lineStyleOptions', 'windScaleHint'], 'the resolvers the forecast lines\' rows name');
  const src = page();
  const from = src.indexOf('/* app: forecast-hints.js */');
  assert.notEqual(from, -1, 'forecast-hints.js is not in the generated page');
  const part = src.slice(from, src.indexOf('/* app: ', from + 1));
  ids.forEach((id) => assert.ok(part.indexOf("Resolvers.register('" + id + "'") !== -1,
    'forecast-hints.js does not register the ' + id + ' resolver in the generated page'));
});

// alerts-page.js holds the Alerts tab's resolvers. It binds PConf.thresholdLevels, which
// blocks.js publishes while its own body runs, so it follows blocks.js; before it, the page
// throws at boot. Out of the page, nothing throws: the Alert settings card's rows, the Shows
// on grids and the bars' Alerts rows silently lose what those resolvers answer on a real
// phone, while every Node test passes through blocks.js' require(). The ids come from the
// schema: every resolver the Alerts tab's sections and a bar's Alerts row name.
test('the Alerts tab\'s resolvers are bundled after blocks.js, which they read', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('settings/blocks.js') < idx('settings/alerts-page.js'),
    'blocks.js must precede alerts-page.js, which reads PConf.thresholdLevels at load');
  const alerts = require('../src/pkjs/settings/alerts-schema.js');
  const ids = new Set();
  (function collect(node) {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (!node || typeof node !== 'object') { return; }
    if (typeof node.resolver === 'string') { ids.add(node.resolver); }
    Object.keys(node).forEach((k) => collect(node[k]));
  })([alerts.cardSections(), alerts.sheetSections(), alerts.onDemandRow('statusTop', null)]);
  ['alertLevelBadge', 'alertLevelsHint', 'rainAlertHint', 'onDemandBars', 'onDemandBarIcons',
    'onDemandSleepText'].forEach((id) => assert.ok(ids.has(id), 'the Alerts schema names ' + id));
  const src = page();
  const published = src.indexOf('PConf.thresholdLevels = ');
  assert.notEqual(published, -1, 'nothing publishes PConf.thresholdLevels in the generated page');
  ids.forEach((id) => {
    const at = src.indexOf(".register('" + id + "'");
    assert.notEqual(at, -1, 'nothing registers the ' + id + ' resolver in the generated page');
  });
  ['alertLevelBadge', 'onDemandBars', 'onDemandSleepText'].forEach((id) =>
    assert.ok(src.indexOf(".register('" + id + "'") > published,
      id + ' must register after blocks.js publishes PConf.thresholdLevels'));
});

// stripe-levels.js (window.StripeLevels) is the table the bake shades every stripe by;
// preview-forecast.js, preview-radar.js and forecast-hints.js bind it while their own bodies
// run (forecast-hints.js writes its stripe hints from it at load). Out of the page, or after
// them, the forecast and radar previews and the page's boot throw on a real phone while
// every Node test passes through require().
test('the stripe scales are bundled before the previews and the forecast hints that read them', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  ['settings/preview-forecast.js', 'settings/preview-radar.js', 'settings/forecast-hints.js'].forEach((reader) => {
    assert.ok(idx('pkjs/stripe-levels.js') < idx(reader), 'stripe-levels.js must precede ' + reader);
  });
  assert.ok(page().indexOf('window.StripeLevels = api') !== -1,
    'nothing assigns window.StripeLevels in the generated page');
});

// The key status under a keyed weather provider: key-status.js reads window.KeySources (each
// picker's keyed sources; the rows carry no table in their args), window.KeyFingerprint and
// window.KeyResult (the phone's answers to each key) while its own body runs, and blocks.js
// registers tomorrow.io's usage line into PConf.keyStatus while ITS body runs. Out of the
// page, the Edit button, its summary line, the missing-key note, the tab's dot and the Save
// dialog all quietly vanish (or throw) on a real phone while every Node test passes through
// require().
test('the key status, its tables, its fingerprint and the key results are bundled before blocks.js and the key tests', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('settings/key-sources.js') < idx('settings/key-status.js'),
    'key-sources.js must precede key-status.js');
  assert.ok(idx('pkjs/key-fingerprint.js') < idx('settings/key-status.js'),
    'key-fingerprint.js must precede key-status.js');
  assert.ok(idx('pkjs/key-result.js') < idx('settings/key-status.js'),
    'key-result.js must precede key-status.js');
  assert.ok(idx('settings/key-status.js') < idx('settings/blocks.js'),
    'key-status.js must precede blocks.js');
  assert.ok(idx('settings/key-status.js') < idx('settings/key-test.js'),
    'key-status.js must precede key-test.js');
  const src = page();
  ['window.KeySources = api', 'window.KeyFingerprint = api', 'window.KeyResult = api',
    "PConf.attentionResolvers.register('keyAttention'", "PConf.hintResolvers.register('keyRowSummary'",
    "PConf.hintResolvers.register('keyMissingNote'",
    "keyStatus.registerUsage('tomorrowio'"].forEach((s) =>
    assert.ok(src.indexOf(s) !== -1, 'the generated page lacks ' + s));
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
  'settings/preview-diagnostics.js', 'settings/preview-layout.js', 'settings/preview-health.js'];

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
  ['forecastPreview', 'radarPreview', 'devStats', 'lastFetch', 'layoutPreviewCombined', 'statusBarsPreview',
    'healthPreview']
    .forEach((id) => {
      assert.ok(src.indexOf("PConf.blocks.register('" + id + "'") !== -1,
        'nothing registers the ' + id + ' block — its file is probably missing from ' +
        'APP_FILES in scripts/build-config-page.js, which drops the block from the page ' +
        'on a real phone while every Node test passes');
    });
});

// The two page files the six-tab layout added. Neither throws when dropped: the Status
// bars tab would lose its pinned preview (an unregistered block renders nothing), and the
// Watchface tab's Night hours would open on undefined and write nothing, while every Node
// test still passes through require(). preview-status-bars.js reads window.StatusLineCatalog,
// window.OnDemand, window.PreviewSvg, VIEW_CYCLE and the slot-text chain (window.Utf8,
// window.StatusPair, window.SlotText — each reading the ones before it — and
// window.DateFormat) at IIFE time, so it must follow all of them.
test('the Status bars preview and the Night hours reach the page, in dependency order', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/status-line-catalog.js') < idx('settings/preview-status-bars.js'));
  assert.ok(idx('pkjs/on-demand.js') < idx('settings/preview-status-bars.js'));
  assert.ok(idx('settings/preview-svg.js') < idx('settings/preview-status-bars.js'),
    'preview-status-bars.js reads window.PreviewSvg (the theme ink) at IIFE time');
  assert.ok(idx('pkjs/view-cycle.js') < idx('settings/preview-status-bars.js'));
  assert.ok(idx('pkjs/status-line-catalog.js') < idx('pkjs/status-pair.js'));
  assert.ok(idx('pkjs/utf8.js') < idx('pkjs/status-pair.js'), 'status-pair.js reads window.Utf8');
  assert.ok(idx('pkjs/status-pair.js') < idx('pkjs/slot-text.js'), 'slot-text.js reads window.StatusPair');
  assert.ok(idx('pkjs/slot-text.js') < idx('settings/preview-status-bars.js'));
  assert.ok(idx('pkjs/date-format.js') < idx('settings/preview-status-bars.js'));
  idx('settings/night-hours.js');
  const src = page();
  ["PConf.displayResolvers.register('nightHoursValue'", "PConf.displayResolvers.register('nightHoursSeparate'",
    "PConf.onChange.register('nightHoursSync'", "PConf.onChange.register('nightHoursMode'",
    "PConf.hintResolvers.register('nightHoursHint'", "PConf.hintResolvers.register('nightFeatureHint'",
    'PConf.hooks.onSubmit(onSubmit)'].forEach((needle) =>
    assert.ok(src.indexOf(needle) !== -1, 'the generated page lacks ' + needle));
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

// The status-slot row glyphs are the quietest omission of all: an item.icon naming an
// unregistered id prints nothing, by design, so a status-slot-icons.js dropped from
// APP_FILES would just leave the rows bare on a real phone. Pin the file and each of its
// register() calls into the generated page.
test('status-slot-icons.js reaches the generated page and registers all ten glyphs', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const at = appFiles.findIndex((f) => f.endsWith('settings/status-slot-icons.js'));
  assert.notEqual(at, -1, 'status-slot-icons.js is not in APP_FILES');
  const src = page();
  ['rain', 'uv', 'wind', 'gust', 'aqi', 'pollen', 'battery', 'bluetooth', 'quiet', 'snooze'].forEach((id) => {
    assert.ok(src.indexOf("icons.register('" + id + "'") !== -1,
      'no register(\'' + id + '\' in page.generated.js — status-slot-icons.js did not reach the page');
  });
  // And what it registers is what the module exports (the map the tests read).
  const icons = require('../src/pkjs/settings/status-slot-icons.js');
  assert.deepEqual(Object.keys(icons).sort(),
    ['aqi', 'battery', 'bluetooth', 'gust', 'pollen', 'quiet', 'rain', 'snooze', 'uv', 'wind']);
});

// The update-interval budget modules are the same silent-no-op shape: blocks.js and
// onbuild.js read PConf.tomorrowioBudget / rainbowBudget / intervalBudget, and
// rainbow-budget.js and interval-budget.js read their predecessors WHILE THEIR OWN IIFE
// RUNS — so a missing or misordered file throws at page boot (or leaves the Update
// interval row without options) on a real phone while every Node test passes.
test('the budget modules reach the generated page in dependency order, ahead of blocks.js', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('settings/tomorrowio-budget.js') < idx('settings/rainbow-budget.js'),
    'tomorrowio-budget.js must precede rainbow-budget.js, which reads PConf.tomorrowioBudget at IIFE time');
  assert.ok(idx('settings/rainbow-budget.js') < idx('settings/interval-budget.js'),
    'rainbow-budget.js must precede interval-budget.js, which reads PConf.rainbowBudget at IIFE time');
  assert.ok(idx('settings/interval-budget.js') < idx('settings/blocks.js'),
    'interval-budget.js must precede blocks.js, which reads PConf.intervalBudget at IIFE time');

  // ...and the generated page really carries them, in that order.
  const src = page();
  const at = (needle) => {
    const i = src.indexOf(needle);
    assert.notEqual(i, -1, needle + ' is not in page.generated.js');
    return i;
  };
  const tioAt = at('PConf.tomorrowioBudget = api');
  const rbAt = at('PConf.rainbowBudget = api');
  const ibAt = at('PConf.intervalBudget = api');
  const blockAt = at('register(\'rainbowBudget\'');
  assert.ok(tioAt < rbAt && rbAt < ibAt && ibAt < blockAt,
    'the page must define tomorrowio-budget, then rainbow-budget, then interval-budget, then blocks.js');
  assert.ok(src.indexOf('PConf.intervalBudget') !== -1, 'blocks.js / onbuild.js read PConf.intervalBudget');
});

// The Rainbow key Test button is another silent no-op hazard: rainbow-key-test.js reads
// window.KeyTest WHILE ITS IIFE RUNS (a throw at page boot if key-test.js comes later), and
// without the file in APP_FILES the Test button's action is simply never registered — the
// button does nothing on a real phone while every Node test passes.
test('the Rainbow key Test reaches the generated page after key-test.js', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('settings/key-test.js') < idx('settings/rainbow-key-test.js'),
    'key-test.js must precede rainbow-key-test.js, which reads window.KeyTest at IIFE time');
  const src = page();
  assert.ok(src.indexOf("action: 'testRainbowKey'") !== -1,
    'rainbow-key-test.js does not register testRainbowKey in the page');
  assert.ok(src.indexOf('window.KeyTest = api') < src.indexOf("action: 'testRainbowKey'"),
    'the page must define window.KeyTest before rainbow-key-test.js runs');
});

// The threshold contract is bound ONCE, at load: preview-radar.js, blocks.js and
// onbuild.js each read window.StatusThresholds while their own IIFE body runs (no lazy
// lookup, no no-contract fallback), and the contract itself reads window.ResolveInk
// while its own runs. Concatenated out of that order, a binding is undefined and the
// first sheet, badge, hint or radar preview that reads it throws on a real phone while
// every Node test passes through require().
test('the threshold contract reaches the generated page between resolve-ink and every file that binds it', () => {
  const appFiles = require('../scripts/build-config-page.js').APP_FILES;
  const idx = (suffix) => {
    const at = appFiles.findIndex((f) => f.endsWith(suffix));
    assert.notEqual(at, -1, suffix + ' is not in APP_FILES at all');
    return at;
  };
  assert.ok(idx('pkjs/resolve-ink.js') < idx('pkjs/status-thresholds.js'),
    'resolve-ink.js must precede status-thresholds.js, which reads window.ResolveInk at IIFE time');
  ['settings/preview-radar.js', 'settings/blocks.js', 'settings/onbuild.js'].forEach((file) => {
    assert.ok(idx('pkjs/status-thresholds.js') < idx(file),
      'status-thresholds.js must precede ' + file + ', which reads window.StatusThresholds at IIFE time');
  });
  const src = page();
  const defined = src.indexOf('window.StatusThresholds = api');
  assert.notEqual(defined, -1, 'nothing assigns window.StatusThresholds in the page');
  assert.ok(defined < src.indexOf("register('thresholdRange'"),
    'the page must define window.StatusThresholds before blocks.js runs');
});
