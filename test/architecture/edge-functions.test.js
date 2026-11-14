// The edge functions' seams (docs/adr/0005-architecture-rules.md, section 3): each function
// reaches Supabase through its store module and the network through the fetch its entry point
// passes in, so its rules take their inputs as arguments.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeOf } = require('./source-text.js');

const FUNCTIONS = path.resolve(__dirname, '..', '..', 'supabase', 'functions');

// Handlers that still query Supabase themselves. The list only shrinks.
const DIRECT_QUERY_ALLOWED = [
  'news/handler.ts',
  'telemetry-ingest/handler.ts',
];

/**
 * Every deployed module of every function, subfolders included (tests left out), relative to
 * supabase/functions with forward slashes.
 * @returns {string[]}
 */
function modules() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); return; }
      if (e.name.endsWith('.ts') && !/[_.]test\.ts$/.test(e.name)) {
        out.push(path.relative(FUNCTIONS, p).split(path.sep).join('/'));
      }
    });
  })(FUNCTIONS);
  return out.sort();
}

/**
 * A module's code with comments and string contents blanked.
 * @param {string} rel
 * @returns {string}
 */
function code(rel) {
  return codeOf(path.join(FUNCTIONS, rel));
}

const MODULES = modules();
/**
 * A module's file name.
 * @param {string} rel
 * @returns {string}
 */
const base = (rel) => path.basename(rel);

test('only an entry point creates the Supabase client', () => {
  MODULES.forEach((m) => {
    if (base(m) === 'index.ts') { return; }
    assert.ok(!/\bcreateClient\s*\(/.test(code(m)), `${m} creates a Supabase client`);
    const src = fs.readFileSync(path.join(FUNCTIONS, m), 'utf8');
    assert.ok(!/^import\s+(?!type\b)[^;]*["']@supabase\/supabase-js["']/m.test(src),
      `${m} imports supabase-js for more than its types`);
  });
});

test('Supabase is queried from the store modules only, except the listed handlers', () => {
  const direct = MODULES.filter((m) => base(m) !== 'supabase-store.ts'
    && /(?<!\bArray)\.(?:from|rpc)\s*\(/.test(code(m)));
  assert.deepEqual(direct, DIRECT_QUERY_ALLOWED,
    'a module queries Supabase directly, or a listed one moved to a store (then remove it)');
});

test('only an entry point calls the global fetch; the rest take it as an argument', () => {
  MODULES.forEach((m) => {
    if (base(m) === 'index.ts') { return; }
    assert.ok(!/(^|[^.\w])fetch\s*\(/.test(code(m)), `${m} calls the global fetch`);
  });
});
