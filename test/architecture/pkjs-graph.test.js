// The phone app's and settings page's architecture (docs/adr/0005-architecture-rules.md),
// checked over the require() graph of src/pkjs: every file has a home (pkjs-homes.js), domain
// code touches no runtime, each role requires only what its rule allows, and there are no
// require cycles.
//
// Each allow-list holds what the code does today against a rule. Fix a file and remove its
// entry; the test fails until the list matches the code again. Adding an entry is a decision
// for review, since the lists are meant to shrink.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOMES, homeOf } = require('./pkjs-homes.js');
const { codeOf, withoutComments, relPath, listFiles, cyclesOf } = require('./source-tree.js');

const PKJS = path.resolve(__dirname, '..', '..', 'src', 'pkjs');

// Not source: each developer's own settings, and the settings page's built bundle.
const SKIPPED = ['dev-config.js', 'settings/page.generated.js'];

const RUNTIME = [
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['fetch', /(?<![\w$.])(?:globalThis\.)?fetch\s*\(/],
  ['localStorage', /\blocalStorage\b/],
  ['Pebble', /\bPebble\s*\./],
  ['navigator', /\bnavigator\s*\./],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date()', /\bnew\s+Date\b(?!\s*\(\s*[^)\s])/],
];

// Domain files that still reach the runtime (file: the globals they use).
const RUNTIME_IN_DOMAIN_ALLOWED = {
  'clay-payload.js': ['new Date()'],
  'key-result.js': ['localStorage'],
  'slot-text.js': ['new Date()'],
  'status-lines.js': ['Date.now', 'new Date()'],
  'weather/day-peaks.js': ['localStorage', 'Date.now'],
  'weather/radar-coverage.js': ['localStorage'],
};

// Which roles each role may require, and the requires today that break it ("from -> to").
const RULES = [
  { name: 'domain code requires only domain code and the shared library',
    from: ['domain'], to: ['domain', 'lib'], allowed: [
      'forecast-series.js -> config-ui/index.js',
      'forecast-series.js -> status-rebake.js',
      'holidays/holiday-mask.js -> holidays/nager-source.js',
      'status-lines.js -> phone-battery.js',
      'weather/graph-style-wire.js -> config-ui/index.js',
      'weather/graph-wire.js -> config-ui/index.js',
      'weather/radar-sky.js -> weather/provider.js',
      'weather/rain-tier.js -> config-ui/index.js',
    ] },
  { name: 'application code requires no adapter, shell or settings page',
    from: ['application'], to: ['application', 'domain', 'lib'], allowed: [
      'clay-migrations.js -> clay-settings.js',
      'provider-factory.js -> weather/dwd.js',
      'provider-factory.js -> weather/metno.js',
      'provider-factory.js -> weather/openmeteo.js',
      'provider-factory.js -> weather/openweathermap.js',
      'provider-factory.js -> weather/tomorrowio.js',
      'provider-factory.js -> weather/wunderground.js',
      'provider-factory.js -> weather/yandex.js',
      'status-rebake.js -> outbox.js',
      'telemetry-settings.js -> config-ui/index.js',
      'weather/provider.js -> outbox.js',
      'weather/provider.js -> weather/air-quality.js',
      'weather/provider.js -> weather/http.js',
      'weather/provider.js -> weather/location.js',
      'weather/provider.js -> weather/pollen.js',
      'weather/radar-factory.js -> weather/dwd-radar.js',
      'weather/radar-factory.js -> weather/metno-radar.js',
      'weather/radar-factory.js -> weather/rainbow-radar.js',
      'weather/radar-factory.js -> weather/tomorrowio-radar.js',
    ] },
  { name: 'adapters require no shell or settings page',
    from: ['adapter'], to: ['adapter', 'application', 'domain', 'lib'], allowed: [
      'clay-settings.js -> settings/index.js',
    ] },
  { name: 'the settings page requires no adapter or shell',
    from: ['page'], to: ['page', 'page-engine', 'domain', 'lib'], allowed: [
      'settings/weather-tab.js -> settings/weather-tab-data.js',
    ] },
  { name: 'the settings page engine requires only itself and the shared library',
    from: ['page-engine'], to: ['page-engine', 'lib'], allowed: [
      'config-ui/index.js -> config-ui/lib/platform.js',
    ] },
];

// Require cycles today, each as its sorted member list.
const CYCLES_ALLOWED = [
  ['config-ui/lib/range-control.js', 'config-ui/lib/rgb-control.js'],
  ['phone-battery.js', 'status-lines.js', 'status-rebake.js'],
  ['settings/graph-styles-page.js', 'settings/preview-status-bars.js', 'settings/preview-watch.js',
    'settings/screen-legend.js', 'settings/screens-page.js'],
];

/**
 * Where a relative require lands, the way Node resolves it: the path, the path plus .js, or
 * the folder's index.js.
 * @param {string} from absolute path of the requiring file
 * @param {string} spec the require's relative path
 * @returns {?string} absolute path, or null when it names nothing
 */
function resolveRequire(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  return [base, base + '.js', path.join(base, 'index.js')]
    .find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

/**
 * The src/pkjs files one file requires by a relative path.
 * @param {string} rel
 * @returns {string[]}
 */
function requiresOf(rel) {
  const file = path.join(PKJS, rel);
  const text = withoutComments(file);
  const out = new Set();
  const re = /\brequire\s*\(\s*['"](\.{1,2}(?:\/[^'"]*)?)['"]\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = resolveRequire(file, m[1]);
    const t = target && relPath(PKJS, target);
    if (t && !t.startsWith('..')) { out.add(t); }
  }
  return Array.from(out).sort();
}

// Every shipped JS file (tests, node_modules and SKIPPED left out).
const FILES = listFiles(PKJS, { name: /\.js$/, skipDirs: ['node_modules', 'test', 'tests'],
  skipFiles: SKIPPED });
const GRAPH = new Map(FILES.map((f) => [f, requiresOf(f).filter((t) => SKIPPED.indexOf(t) === -1)]));

/**
 * A file's role, or undefined when it has no home.
 * @param {string} f
 * @returns {string|undefined}
 */
function roleOf(f) {
  const home = homeOf(f);
  return home ? home.role : undefined;
}

test('every file has a home: a context and a role, or the shell or the shared library', () => {
  const homeless = FILES.filter((f) => !homeOf(f));
  assert.deepEqual(homeless, [],
    'add each to test/architecture/pkjs-homes.js, or place it where its path gives its home');
});

test('every file the homes table names exists', () => {
  const listed = [].concat(...Object.values(HOMES));
  assert.deepEqual(listed.filter((f) => !fs.existsSync(path.join(PKJS, f))), [],
    'remove the entry of a file that moved or was deleted');
});

test('domain code reaches the runtime only in the listed files', () => {
  const found = {};
  FILES.filter((f) => roleOf(f) === 'domain').forEach((f) => {
    const src = codeOf(path.join(PKJS, f));
    const used = RUNTIME.filter(([, re]) => re.test(src)).map(([name]) => name);
    if (used.length) { found[f] = used; }
  });
  assert.deepEqual(found, RUNTIME_IN_DOMAIN_ALLOWED,
    'a domain file reaches the runtime, or a listed one no longer does (then update the list)');
});

RULES.forEach((rule) => {
  test(`${rule.name}, except the listed requires`, () => {
    const broken = [];
    GRAPH.forEach((targets, f) => {
      if (rule.from.indexOf(roleOf(f)) === -1) { return; }
      targets.filter((t) => rule.to.indexOf(roleOf(t)) === -1).forEach((t) => broken.push(`${f} -> ${t}`));
    });
    assert.deepEqual(broken.sort(), rule.allowed,
      'a require breaks the rule, or a listed one is fixed (then remove it from the list)');
  });
});

test('the require graph has no cycles beyond the listed ones', () => {
  assert.deepEqual(cyclesOf(GRAPH), CYCLES_ALLOWED);
});
