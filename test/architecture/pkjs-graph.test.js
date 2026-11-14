// The phone app's and settings page's architecture (docs/adr/0005-architecture-rules.md),
// checked over the require() graph of src/pkjs: every file has a home (pkjs-homes.js), domain
// code touches no runtime, each role requires only what its rule allows, and there are no
// require cycles.
//
// Each allow-list holds what the code does today against a rule. The lists only shrink: fix a
// file and remove its entry, and the test fails until the list matches the code again.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOMES, homeOf } = require('./pkjs-homes.js');
const { codeOf, withoutComments } = require('./source-text.js');

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
  'weather/domain/keys/key-result.js': ['localStorage'],
  'weather/domain/day-peaks.js': ['localStorage', 'Date.now'],
  'weather/domain/radar/radar-coverage.js': ['localStorage'],
};

// Which roles each role may require, and the requires today that break it ("from -> to").
const RULES = [
  { name: 'domain code requires only domain code and the shared library',
    from: ['domain'], to: ['domain', 'lib'], allowed: [
      'calendar/domain/holiday-mask.js -> calendar/adapter/nager-source.js',
      'weather/domain/radar/radar-sky.js -> weather/application/provider.js',
    ] },
  { name: 'application code requires no adapter, shell or settings page',
    from: ['application'], to: ['application', 'domain', 'lib'], allowed: [
      'settings/application/clay-migrations.js -> settings/adapter/clay-settings.js',
      'status-bars/application/status-rebake.js -> wire/adapter/outbox.js',
      'weather/application/provider.js -> weather/adapter/air-quality.js',
      'weather/application/provider.js -> weather/adapter/http.js',
      'weather/application/provider.js -> weather/adapter/location.js',
      'weather/application/provider.js -> weather/adapter/pollen.js',
      'weather/application/provider.js -> wire/adapter/outbox.js',
    ] },
  { name: 'adapters require no shell or settings page',
    from: ['adapter'], to: ['adapter', 'application', 'domain', 'lib'], allowed: [
      'settings/adapter/clay-settings.js -> page/settings/index.js',
    ] },
  { name: 'the settings page requires no adapter or shell',
    from: ['page'], to: ['page', 'page-engine', 'domain', 'lib'], allowed: [
      'page/weather/weather-tab/weather-tab.js -> weather/adapter/weather-tab-data.js',
    ] },
  { name: 'the settings page engine requires only itself and the shared library',
    from: ['page-engine'], to: ['page-engine', 'lib'], allowed: [
      'config-ui/index.js -> config-ui/lib/platform.js',
    ] },
];

// Require cycles today, each as its sorted member list.
const CYCLES_ALLOWED = [
  ['config-ui/lib/range-control.js', 'config-ui/lib/rgb-control.js'],
  ['page/forecast-graphs/graph-styles-page.js',
    'page/layout/preview-watch.js',
    'page/layout/screen-legend.js',
    'page/layout/screens-page.js',
    'page/status-bars/preview-status-bars.js'],
];

/**
 * Every shipped JS file under src/pkjs (tests, node_modules and SKIPPED left out), relative,
 * with forward slashes.
 * @returns {string[]}
 */
function files() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if (['node_modules', 'test', 'tests'].indexOf(e.name) !== -1) { return; }
      const p = path.join(dir, e.name);
      const rel = path.relative(PKJS, p).split(path.sep).join('/');
      if (e.isDirectory()) { walk(p); } else if (e.name.endsWith('.js') && SKIPPED.indexOf(rel) === -1) {
        out.push(rel);
      }
    });
  })(PKJS);
  return out.sort();
}

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
    const t = target && path.relative(PKJS, target).split(path.sep).join('/');
    if (t && !t.startsWith('..')) { out.add(t); }
  }
  return Array.from(out).sort();
}

const FILES = files();
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
  // Tarjan's strongly connected components; a component of two or more files is a cycle.
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const cycles = [];
  /**
   * Tarjan's visit: number v, walk its requires, and pop a component when v is its root.
   * @param {string} v
   */
  const connect = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    (GRAPH.get(v) || []).forEach((w) => {
      if (!idx.has(w)) { connect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) { low.set(v, Math.min(low.get(v), idx.get(w))); }
    });
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) { cycles.push(comp.sort()); }
    }
  };
  FILES.forEach((f) => { if (!idx.has(f)) { connect(f); } });
  assert.deepEqual(cycles.sort(), CYCLES_ALLOWED);
});
