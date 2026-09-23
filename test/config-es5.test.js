'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { es5Violations, inlineScripts } = require('./helpers/es5-lint.js');

const ROOT = path.resolve(__dirname, '..');
const PKJS = path.join(ROOT, 'src', 'pkjs');

// Every hand-authored shipped file must be ES5: the aplite JavaScriptCore that
// runs PKJS is pre-ES6, the SDK does no babel transpilation, and failures are
// invisible on other platforms (the v1.1.0 Object.assign crash) — and the
// settings page's webview code (config-ui/lib, settings/) is held to the same
// rule for ancient Android WebViews. Walk src/pkjs/** so new files are covered
// automatically — the previous hardcoded 12-file list silently left
// forecast-series/outbox/weather/* etc. unguarded. The walk also collects every
// .html file, whose inline <script> bodies are scanned: shell.html's is the
// first code the settings page runs, and it opens the page-wide "use strict"
// <script> every lib/app file is concatenated into. Exclusions:
//  - *.test.js            : run on Node, not shipped
//  - *.generated.js       : machine-generated; page.generated.js is an HTML/JS
//                           STRING (webview code, never parsed by the watch) and
//                           active-fixture.generated.js is data only. Fixes for
//                           either live in the generator.
//  - dev-config.js        : gitignored, dev-only, may be absent
//  - test/ , tests/ dirs  : co-located library test suites (config-ui/test)
function walk(dir) {
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'test' || ent.name === 'tests') return;
      out = out.concat(walk(full));
      return;
    }
    if (!ent.name.endsWith('.js') && !ent.name.endsWith('.html')) return;
    if (ent.name.endsWith('.test.js')) return;
    if (ent.name.endsWith('.generated.js')) return;
    if (ent.name === 'dev-config.js') return;
    out.push(full);
  });
  return out;
}

const SHIPPED = walk(PKJS);
const FILES = SHIPPED.filter((f) => f.endsWith('.js'));
const HTML_FILES = SHIPPED.filter((f) => f.endsWith('.html'));
// suncalc is the one npm dependency webpack bundles into PKJS (require('suncalc')
// in index.js and weather/provider.js). package-lock.json pins it, so this is a
// tripwire for a lockfile bump, scanned only where `npm install` has run.
const SUNCALC = path.join(ROOT, 'node_modules', 'suncalc', 'suncalc.js');

/**
 * One violation as a readable line for the failure diff.
 * @param {{line: number, message: string}} v Violation.
 * @returns {string} 'line N: message'.
 */
function fmt(v) {
  return 'line ' + v.line + ': ' + v.message;
}

test('every shipped pkjs file is scanned (guard covers the whole runtime)', () => {
  assert.ok(FILES.length >= 40, 'expected the walk to find the full runtime set, got ' + FILES.length);
});

test('shipped pkjs files contain no ES6 syntax or unpolyfilled built-ins', () => {
  FILES.forEach((file) => {
    const found = es5Violations(fs.readFileSync(file, 'utf8')).map(fmt);
    assert.deepEqual(found, [], path.relative(ROOT, file) + ' is not ES5');
  });
});

test('the settings shell is scanned: shell.html carries an inline <script>', () => {
  const shell = HTML_FILES.find((f) => f.endsWith(path.join('config-ui', 'lib', 'shell.html')));
  assert.ok(shell, 'walk must collect src/pkjs/config-ui/lib/shell.html');
  assert.ok(inlineScripts(fs.readFileSync(shell, 'utf8')).length >= 1,
    'shell.html has no inline <script> to scan — did the markers move?');
});

test('inline <script> bodies of shipped .html files are ES5', () => {
  HTML_FILES.forEach((file) => {
    inlineScripts(fs.readFileSync(file, 'utf8')).forEach((body, i) => {
      assert.deepEqual(es5Violations(body).map(fmt), [],
        path.relative(ROOT, file) + ' <script> #' + (i + 1) + ' is not ES5 (script-relative lines)');
    });
  });
});

test('the bundled suncalc dependency is ES5', { skip: !fs.existsSync(SUNCALC) && 'suncalc not installed' }, () => {
  assert.deepEqual(es5Violations(fs.readFileSync(SUNCALC, 'utf8')).map(fmt), []);
});

// The guard's own contract, so a regression in the linter cannot turn it into a
// silent no-op. Every snippet below is a SyntaxError (or, for the built-ins, an
// "undefined is not a function") on aplite's pre-ES6 JavaScriptCore; the first
// block is the set the previous regex list let through.
const ES6_FORMS = [
  ['var a = b?.c;', 'optional chaining'],
  ['var a = b ?? c;', 'nullish coalescing'],
  ['f(...args);', 'spread/rest'],
  ['var a = [...xs];', 'spread/rest'],
  ['function f(...rest) {}', 'spread/rest'],
  ['var {a, b} = o;', 'destructuring declaration'],
  ['var [a, b] = xs;', 'destructuring declaration'],
  ['function f(a, b = 1) {}', 'default parameter'],
  ['function f({a}) {}', 'destructuring parameter'],
  ['var o = {a, b};', 'shorthand property'],
  ['var o = {f() { return 1; }};', 'shorthand method'],
  ['var o = {get() { return 1; }};', 'shorthand method'],
  ['var o = {[k]: v};', 'computed property key'],
  ['var o = {*g() {}};', 'generator method'],
  ['var a = 2 ** 3;', 'exponent operator'],
  ['function* g() {}', 'generator function'],
  ['async function f() {}', 'async function'],
  ['var a = 0b101;', 'binary/octal literal'],
  ['var a = 0o17;', 'binary/octal literal'],
  ['var r = /a/u;', 'regex flag'],
  ['var r = /a./s;', 'regex flag'],
  ['var r = /(?<=a)b/;', 'regex lookbehind'],
  ['var r = /(?<y>\\d+)/;', 'regex named group'],
  ['var a = 1_000;', 'numeric separator'],
  ['var a = 10n;', 'BigInt literal'],
  ['a ||= b;', 'logical assignment'],
  ['f(a, b,);', 'trailing comma'],
  ['function f(a, b,) {}', 'trailing comma'],
  ['var s = "\\u{1F600}";', 'unicode code point escape'],
  ['import x from "y";', 'import'],
  ['export var a = 1;', 'export'],
  ['function F() { return new.target; }', 'new.target'],
  ['Number.isNaN(x);', 'Number.isNaN'],
  ['Number.isFinite(x);', 'Number.isFinite'],
  ['Number.isInteger(x);', 'Number.isInteger'],
  ['Array.of(1);', 'Array.of'],
  ['xs.fill(0);', '.fill()'],
  ['xs.flat();', '.flat()'],
  ['Object.is(a, b);', 'Object.is'],
  ['Object.fromEntries(xs);', 'Object.fromEntries'],
  ['var s = Symbol("x");', 'Symbol'],
  ['var m = new WeakMap();', 'new WeakMap'],
  ['Math.sign(x);', 'Math.sign'],
  ['Math.log10(x);', 'Math.log10'],
  ['s.codePointAt(0);', '.codePointAt()'],
  ['String.fromCodePoint(65);', 'String.fromCodePoint'],
  ['s.trimStart();', '.trimStart()'],
  ['fetch(url);', 'fetch()'],
  ['var q = new URLSearchParams(s);', 'new URLSearchParams'],
  ['xs.keys();', '.keys()'],
  // ...and the set the regex list already caught, kept caught.
  ['var f = function (x) { return x => x; };', 'arrow function'],
  ['const a = 1;', 'const'],
  ['let a = 1;', 'let'],
  ['var s = `x`;', 'template literal'],
  ['class A {}', 'class'],
  ['for (var x of xs) {}', 'for…of'],
  ['s.padStart(2, "0");', '.padStart()'],
  ['s.padEnd(2);', '.padEnd()'],
  ['Object.values(o);', 'Object.values'],
  ['Object.entries(o);', 'Object.entries'],
  ['Array.from(xs);', 'Array.from'],
  ['var m = new Map();', 'new Map'],
  ['var m = new Set();', 'new Set'],
  ['Promise.resolve(1);', 'Promise'],
  ['s.startsWith("a");', '.startsWith()'],
  ['s.endsWith("a");', '.endsWith()'],
  ['s.repeat(2);', '.repeat()'],
];

test('the guard catches every ES2015+ form it claims to (it is not a silent no-op)', () => {
  ES6_FORMS.forEach(([snippet, expected]) => {
    const found = es5Violations(snippet).map((v) => v.message);
    assert.ok(found.some((m) => m.indexOf(expected) !== -1),
      JSON.stringify(snippet) + ' should report "' + expected + '", got ' + JSON.stringify(found));
  });
});

// Valid ES5 the shipped code relies on — each a false positive the tokenizer has
// to get right (regex vs division, reserved words as property names, accessors,
// case blocks, polyfilled built-ins, look-alikes inside strings and comments).
const ES5_IDIOMS = [
  'var o = { get x() { return 1; }, set x(v) {}, "a-b": 1, 2: 3, class: 1, default: 2 };',
  'var r = a / b / c; var q = s.split(/,\\s*/g); var re = /[/]/; var re2 = /\\//;',
  'var t = c ? .5 : 1; var v = a ? { b: 1 } : { c: [1, { d: 2 }] };',
  'var n = obj.class + obj.let + obj.import + obj.default + obj.new;',
  'switch (x) { case 1: { break; } default: { f({ a: 1 }); } }',
  'outer: for (var i = 0, n = xs.length; i < n; i++) { continue outer; }',
  'for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { f(k); } }',
  'var ks = Object.keys(o); var a = Object.assign({}, o); var t = Math.trunc(1.5);',
  'xs.find(f); xs.findIndex(f); xs.includes(1);',
  'if (typeof Promise !== "undefined" && typeof Symbol === "function") {}',
  'var s = "it\'s => `nope` ?. ?? ... const let class"; // const x = () => `t`;',
  '/* const x = () => 1; var {a} = b; */ var y = 1;',
  'function fetch(p) {} fetch(1);',
  'var o = { fill: 1, keys: 2 }; var f = o.fill + o.keys;',
  'var arr = [1, 2, 3,]; var obj = { a: 1, };',
  'nav.getBattery().then(function (m) {});',
  'do { x++; } while (x < 3); try { a(); } catch (e) { b(); } finally { c(); }',
  'if (a) { b(); } else { c(); }',
  'var s2 = x.replace(/\\{(\\w+)\\}/g, fn); var n = 0x1F + 1e3 + .5 + 1.5e-3;',
  'function f() { return { a: 1, b: function () { return [{ c: 2 }]; } }; }',
  'var p = (function () { return 1; }()); var q = !{ a: 1 }.a;',
];

test('the guard leaves valid ES5 alone', () => {
  ES5_IDIOMS.forEach((snippet) => {
    assert.deepEqual(es5Violations(snippet).map(fmt), [], JSON.stringify(snippet));
  });
});
