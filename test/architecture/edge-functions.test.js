// The edge functions' seams (docs/adr/0005-architecture-rules.md, section 3): each function
// reaches Supabase through its store module and the network through the fetch its entry point
// passes in, so its rules take their inputs as arguments.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FUNCTIONS = path.resolve(__dirname, '..', '..', 'supabase', 'functions');

// Handlers that still query Supabase themselves. The list only shrinks.
const DIRECT_QUERY_ALLOWED = [
  'news/handler.ts',
  'telemetry-ingest/handler.ts',
];

/**
 * Every deployed module (tests left out), relative to supabase/functions.
 * @returns {string[]}
 */
function modules() {
  const out = [];
  fs.readdirSync(FUNCTIONS, { withFileTypes: true }).forEach((d) => {
    if (!d.isDirectory()) { return; }
    fs.readdirSync(path.join(FUNCTIONS, d.name)).forEach((f) => {
      if (f.endsWith('.ts') && !f.endsWith('_test.ts')) { out.push(`${d.name}/${f}`); }
    });
  });
  return out.sort();
}

/**
 * A module's source with comments and string contents blanked.
 * @param {string} rel
 * @returns {string}
 */
function code(rel) {
  return fs.readFileSync(path.join(FUNCTIONS, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const MODULES = modules();
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
    && /\.(?:from|rpc)\s*\(\s*["']/.test(code(m)));
  assert.deepEqual(direct, DIRECT_QUERY_ALLOWED,
    'a module queries Supabase directly, or a listed one moved to a store (then remove it)');
});

test('only an entry point calls the global fetch; the rest take it as an argument', () => {
  MODULES.forEach((m) => {
    if (base(m) === 'index.ts') { return; }
    assert.ok(!/(^|[^.\w])fetch\s*\(/.test(code(m)), `${m} calls the global fetch`);
  });
});
