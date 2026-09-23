// test/config-page-polyfills.test.js — the settings page never loads
// src/pkjs/polyfills.js (it is a flat concatenated <script>, not a webpack
// bundle), yet AGENTS.md and the config-ui README call that file's methods safe
// in page code too. lib/shell.html's inline script, which runs before every lib
// and app file, has to carry the same set. Each case boots that script in a vm
// context stripped of the method — an old WebView — and checks it comes back.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { inlineScripts } = require('./helpers/es5-lint.js');

const ROOT = path.resolve(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'src', 'pkjs', 'config-ui', 'lib', 'shell.html'), 'utf8');
const POLYFILLS = fs.readFileSync(path.join(ROOT, 'src', 'pkjs', 'polyfills.js'), 'utf8');

/**
 * Every method polyfills.js installs, read off its `if (!X.y)` guards.
 * @returns {string[]} Dotted paths, e.g. 'Array.prototype.find'.
 */
function polyfilledPaths() {
  const out = [];
  const re = /if \(!((?:Object|Array|Math|String|Number)(?:\.prototype)?\.\w+)\)/g;
  let m;
  while ((m = re.exec(POLYFILLS)) !== null) out.push(m[1]);
  return out;
}

/**
 * Run shell.html's inline script in a fresh context with `paths` deleted first.
 * @param {string[]} paths Dotted paths to remove before the shell runs.
 * @returns {Object} The vm context, after the shell ran.
 */
function bootShellWithout(paths) {
  const ctx = vm.createContext({});
  vm.runInContext(paths.map((p) => 'delete ' + p + ';').join('\n'), ctx);
  paths.forEach((p) => assert.equal(vm.runInContext('typeof ' + p, ctx), 'undefined',
    'the stripped context must really lack ' + p));
  inlineScripts(SHELL).forEach((body) => vm.runInContext(body, ctx));
  return ctx;
}

test('polyfills.js still guards the set the docs promise (the lockstep below has something to check)', () => {
  const paths = polyfilledPaths();
  ['Object.assign', 'Math.trunc', 'Array.prototype.find', 'Array.prototype.findIndex',
    'Array.prototype.includes'].forEach((p) => assert.ok(paths.indexOf(p) !== -1, p));
});

test('the page shell installs every method polyfills.js does, on a runtime without them', () => {
  const paths = polyfilledPaths();
  const ctx = bootShellWithout(paths);
  paths.forEach((p) => assert.equal(vm.runInContext('typeof ' + p, ctx), 'function',
    p + ' is polyfilled for PKJS but missing in the settings page — shim it in lib/shell.html'));
});

test('the page shims behave like the natives (and stay out of for...in)', () => {
  const ctx = bootShellWithout(polyfilledPaths());
  const run = (src) => vm.runInContext(src, ctx);
  assert.equal(run('[1, 2, 3].find(function (x) { return x > 1; })'), 2);
  assert.equal(run('[1, 2, 3].find(function (x) { return x > 5; })'), undefined);
  assert.equal(run('[1, 2, 3].findIndex(function (x) { return x === 3; })'), 2);
  assert.equal(run('[1, 2, 3].findIndex(function (x) { return x === 9; })'), -1);
  assert.equal(run('[1, NaN].includes(NaN)'), true, 'SameValueZero, unlike indexOf');
  assert.equal(run('[1, 2].includes(3)'), false);
  assert.equal(run('Math.trunc(-4.7)'), -4);
  assert.equal(run('Math.trunc(4.7)'), 4);
  assert.equal(run('Object.assign({ a: 1 }, null, { b: 2 }).b'), 2);
  assert.equal(run('var ks = []; for (var k in [7]) { ks.push(k); } ks.join()'), '0',
    'shimmed Array methods must be non-enumerable');
});
