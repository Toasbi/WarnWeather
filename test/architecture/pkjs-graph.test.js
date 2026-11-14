// The phone app's and settings page's architecture (docs/adr/0005-architecture-rules.md),
// checked over the require() graph of src/pkjs: every file has a home; domain code touches no
// runtime and depends on no adapter, application or shell; the phone app never loads the
// settings page; the page's engine knows nothing of WarnWeather; no require cycles.
//
// The allow-lists below hold what the code does today against the rules. They only shrink:
// fix a file and remove its entry, and the test fails until the list matches again.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { homeOf } = require('./pkjs-homes.js');

const PKJS = path.resolve(__dirname, '..', '..', 'src', 'pkjs');

// Domain files that still reach the runtime (file: the globals they use).
const RUNTIME_IN_DOMAIN_ALLOWED = {
  'clay-payload.js': ['new Date()'],
  'slot-text.js': ['new Date()'],
  'status-lines.js': ['Date.now()', 'new Date()'],
};

// Domain files that still require an application or adapter module.
const DOMAIN_REACH_ALLOWED = [
  'forecast-series.js -> status-rebake.js (application)',
  'holidays/holiday-mask.js -> holidays/nager-source.js (adapter)',
  'status-lines.js -> phone-battery.js (adapter)',
  'weather/radar-sky.js -> weather/provider.js (application)',
];

// Require cycles today, each as its sorted member list.
const CYCLES_ALLOWED = [
  ['config-ui/lib/range-control.js', 'config-ui/lib/rgb-control.js'],
  ['phone-battery.js', 'status-lines.js', 'status-rebake.js'],
  ['settings/graph-styles-page.js', 'settings/preview-status-bars.js', 'settings/preview-watch.js',
    'settings/screen-legend.js', 'settings/screens-page.js'],
];

const RUNTIME = [
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['fetch', /(^|[^.\w])fetch\s*\(/],
  ['localStorage', /\blocalStorage\b/],
  ['Pebble.', /\bPebble\s*\./],
  ['navigator.', /\bnavigator\s*\./],
  ['Date.now()', /\bDate\s*\.\s*now\s*\(/],
  ['new Date()', /\bnew\s+Date\s*\(\s*\)/],
];

/**
 * Every shipped JS file under src/pkjs (tests and node_modules left out), relative, with
 * forward slashes.
 * @returns {string[]}
 */
function files() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if (e.name === 'node_modules' || e.name === 'test' || e.name === 'tests') { return; }
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); } else if (e.name.endsWith('.js')) {
        out.push(path.relative(PKJS, p).split(path.sep).join('/'));
      }
    });
  })(PKJS);
  return out.sort();
}

/**
 * A file's source with comments and string contents blanked, so prose is not code. Keeps
 * require() targets, which the graph reads separately.
 * @param {string} rel
 * @returns {string}
 */
function code(rel) {
  return fs.readFileSync(path.join(PKJS, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/**
 * The src/pkjs files one file requires by a relative path.
 * @param {string} rel
 * @returns {string[]}
 */
function requiresOf(rel) {
  const text = fs.readFileSync(path.join(PKJS, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1 ');
  const out = [];
  const re = /\brequire\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let target = path.resolve(path.dirname(path.join(PKJS, rel)), m[1]);
    if (!target.endsWith('.js')) { target += '.js'; }
    const t = path.relative(PKJS, target).split(path.sep).join('/');
    if (!t.startsWith('..') && fs.existsSync(target)) { out.push(t); }
  }
  return Array.from(new Set(out)).sort();
}

const FILES = files();
const GRAPH = new Map(FILES.map((f) => [f, requiresOf(f)]));
const HOME = new Map(FILES.map((f) => [f, homeOf(f)]));
const isPage = (f) => ['page', 'page-engine'].indexOf((HOME.get(f) || {}).role) !== -1;

test('every file has a home: a context and a role, or the shell or the shared library', () => {
  const homeless = FILES.filter((f) => !HOME.get(f));
  assert.deepEqual(homeless, [], 'add each to test/architecture/pkjs-homes.js, or place it in src/pkjs/<context>/<role>/');
});

test('domain code reaches the runtime only in the listed files', () => {
  const found = {};
  FILES.filter((f) => HOME.get(f) && HOME.get(f).role === 'domain').forEach((f) => {
    const src = code(f);
    const used = RUNTIME.filter(([, re]) => re.test(src)).map(([name]) => name);
    if (used.length) { found[f] = used; }
  });
  assert.deepEqual(found, RUNTIME_IN_DOMAIN_ALLOWED,
    'a domain file reaches the runtime, or a listed one no longer does (then update the list)');
});

test('domain code requires only domain code and the shared library', () => {
  const reach = [];
  GRAPH.forEach((targets, f) => {
    if (!HOME.get(f) || HOME.get(f).role !== 'domain') { return; }
    targets.forEach((t) => {
      const role = (HOME.get(t) || {}).role;
      if (role !== 'domain' && role !== 'lib') { reach.push(`${f} -> ${t} (${role})`); }
    });
  });
  assert.deepEqual(reach.sort(), DOMAIN_REACH_ALLOWED);
});

test('the phone app never requires the settings page', () => {
  const reach = [];
  GRAPH.forEach((targets, f) => {
    if (isPage(f)) { return; }
    targets.filter(isPage).forEach((t) => reach.push(`${f} -> ${t}`));
  });
  assert.deepEqual(reach, []);
});

test('the settings page engine requires only itself and the shared library', () => {
  const reach = [];
  GRAPH.forEach((targets, f) => {
    if ((HOME.get(f) || {}).role !== 'page-engine') { return; }
    targets.filter((t) => ['page-engine', 'lib'].indexOf((HOME.get(t) || {}).role) === -1).forEach((t) => reach.push(`${f} -> ${t}`));
  });
  assert.deepEqual(reach, []);
});

test('the require graph has no cycles beyond the listed ones', () => {
  // Tarjan's strongly connected components; a component of two or more files is a cycle.
  let index = 0;
  const idx = new Map(), low = new Map(), stack = [], on = new Set(), cycles = [];
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
