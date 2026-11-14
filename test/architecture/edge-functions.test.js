// The edge functions' seams (docs/adr/0005-architecture-rules.md, section 3): each function
// reaches Supabase through its store module and the network through the fetch its entry point
// passes in, so its rules take their inputs as arguments.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeOf, listFiles } = require('./source-tree.js');

const FUNCTIONS = path.resolve(__dirname, '..', '..', 'supabase', 'functions');

// Modules that query Supabase outside a store module. Empty: every function queries through
// its supabase-store.ts, and adding one is a decision for review.
const DIRECT_QUERY_ALLOWED = [];

/**
 * A module's code with comments and string contents blanked.
 * @param {string} rel
 * @returns {string}
 */
function code(rel) {
  return codeOf(path.join(FUNCTIONS, rel));
}

// Every deployed module of every function, subfolders included (tests left out).
const MODULES = listFiles(FUNCTIONS, { name: /\.ts$/ }).filter((m) => !/[_.]test\.ts$/.test(m));
/**
 * A module's file name.
 * @param {string} rel
 * @returns {string}
 */
const base = (rel) => path.basename(rel);

/**
 * Whether a module is a function's entry point, <function>/index.ts.
 * @param {string} rel
 * @returns {boolean}
 */
const isEntry = (rel) => /^[^/]+\/index\.ts$/.test(rel);

test('only an entry point creates the Supabase client', () => {
  MODULES.forEach((m) => {
    if (isEntry(m)) { return; }
    assert.ok(!/\bcreateClient\s*\(/.test(code(m)), `${m} creates a Supabase client`);
    const src = fs.readFileSync(path.join(FUNCTIONS, m), 'utf8');
    assert.ok(!/^import\s+(?!type\b)[^;]*["']@supabase\/supabase-js["']/m.test(src),
      `${m} imports supabase-js for more than its types`);
  });
});

test('Supabase is queried from the store modules only', () => {
  const direct = MODULES.filter((m) => base(m) !== 'supabase-store.ts'
    && /(?<!(?:Array|Buffer|Object))\.(?:from|rpc)\s*\(/.test(code(m)));
  assert.deepEqual(direct, DIRECT_QUERY_ALLOWED,
    'a module queries Supabase directly instead of through its store module');
});

test('only an entry point calls the global fetch; the rest take it as an argument', () => {
  MODULES.forEach((m) => {
    if (isEntry(m)) { return; }
    assert.ok(!/(?<![\w$.])(?:globalThis\.)?fetch\s*\(/.test(code(m)), `${m} calls the global fetch`);
  });
});
