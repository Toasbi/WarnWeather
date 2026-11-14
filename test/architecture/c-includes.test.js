// The watchface's layering (docs/adr/0005-architecture-rules.md, section 4), checked over its
// #include graph: windows -> layers -> appendix and services, never upward; no include cycles;
// HealthService only in services/health.c; minute ticks only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'c');

// Higher includes lower. watchface.c is the app's entry point.
const RANK = { 'watchface.c': 4, windows: 3, layers: 2, appendix: 1, services: 1 };

// Upward includes the code has today. The list only shrinks: a fixed one is removed here.
const UPWARD_ALLOWED = [
  'appendix/on_demand.h -> layers/status_row_layout.h',
  'layers/status_bar.c -> windows/layout.h',
  'layers/status_bar.h -> windows/layout.h',
  'layers/status_row.c -> windows/layout.h',
  'layers/status_row_aplite.c -> windows/layout.h',
];

/**
 * Every C source and header under src/c, as paths relative to it.
 * @returns {string[]}
 */
function sources() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); } else if (/\.[ch]$/.test(e.name)) { out.push(path.relative(SRC, p)); }
    });
  })(SRC);
  return out.sort();
}

/**
 * The quoted includes of one file, resolved to paths relative to src/c (system headers and
 * build-generated ones, which are not under src/c, are left out).
 * @param {string} rel
 * @returns {string[]}
 */
function includesOf(rel) {
  const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const out = [];
  const re = /^\s*#\s*include\s+"([^"]+)"/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = path.relative(SRC, path.resolve(path.dirname(path.join(SRC, rel)), m[1]));
    if (!target.startsWith('..') && fs.existsSync(path.join(SRC, target))) { out.push(target); }
  }
  return out;
}

/**
 * A file's rank: its top folder's, or its own name's at the root.
 * @param {string} rel
 * @returns {number|undefined}
 */
function rankOf(rel) {
  return RANK[rel.split(path.sep)[0]];
}

/**
 * The source with comments and string literals blanked, so a mention in prose is not a call.
 * @param {string} rel
 * @returns {string}
 */
function code(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

const FILES = sources();
const GRAPH = new Map(FILES.map((f) => [f, includesOf(f)]));

test('every file under src/c sits in a ranked folder', () => {
  FILES.forEach((f) => {
    if (f === 'hidden_visibility.h') { return; }   // force-included by wscript into every file
    assert.notEqual(rankOf(f), undefined, `${f}: not in windows/, layers/, appendix/ or services/`);
  });
});

test('no file includes one from a higher layer, except the listed ones', () => {
  const upward = [];
  GRAPH.forEach((targets, f) => {
    targets.forEach((t) => {
      if (rankOf(t) > rankOf(f)) { upward.push(`${f} -> ${t}`); }
    });
  });
  assert.deepEqual(upward.sort(), UPWARD_ALLOWED,
    'an upward include appeared, or a listed one is fixed (then remove it from UPWARD_ALLOWED)');
});

test('the include graph has no cycles', () => {
  const state = new Map();   // undefined: unseen, 1: on the stack, 2: done
  const cycles = [];
  const visit = (f, stack) => {
    state.set(f, 1);
    (GRAPH.get(f) || []).forEach((t) => {
      if (state.get(t) === 1) { cycles.push(stack.slice(stack.indexOf(t)).concat(t).join(' -> ')); }
      else if (!state.get(t)) { visit(t, stack.concat(t)); }
    });
    state.set(f, 2);
  };
  FILES.forEach((f) => { if (!state.get(f)) { visit(f, [f]); } });
  assert.deepEqual(cycles, []);
});

test('HealthService is called from services/health.c only', () => {
  const callers = FILES.filter((f) => /\bhealth_service_\w+\s*\(/.test(code(f)));
  assert.deepEqual(callers, [path.join('services', 'health.c')]);
});

test('the watchface ticks by the minute (and the day), never by the second', () => {
  FILES.forEach((f) => {
    assert.ok(!/\bSECOND_UNIT\b/.test(code(f)), `${f} subscribes to SECOND_UNIT`);
  });
});
