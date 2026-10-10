// test/helpers/c-source.js — the C sources as the JS↔C lockstep tests read them: a
// source's text, the value of one of its #defines, and whether a line sits on the emery
// side of its platform guards. One #define reader, so every pinned constant parses the same
// way: decimal or hex, the name matched whole, and a missing name failing its assert.
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * A C source's text.
 * @param {string} rel Its path from the repo root.
 * @returns {string} The file's text.
 */
function readC(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * The integer a `#define NAME value` line gives, decimal or hex. The name is matched whole
 * (FOO_1 never reads FOO_10's line), and so is the value (a suffixed 12u fails the assert
 * rather than reading as 12).
 * @param {string} src C source text.
 * @param {string} name The macro's name.
 * @returns {number} Its value.
 */
function cDefine(src, name) {
  const m = new RegExp('#define\\s+' + name + '\\s+(0x[0-9A-Fa-f]+|\\d+)\\b').exec(src);
  assert.ok(m, 'no numeric #define ' + name);
  return Number(m[1]);
}

/**
 * Whether every line of a C source holding `needle` sits inside an
 * `#if defined(PBL_PLATFORM_EMERY)` (or `#ifdef PBL_PLATFORM_EMERY`) branch, not its #else.
 * @param {string} src C source text.
 * @param {string} needle The text to find.
 * @returns {number} how many lines hold it (each one checked)
 */
function onlyUnderEmery(src, needle) {
  const stack = [];
  let hits = 0;
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (/^#\s*if/.test(t)) {
      stack.push(/^#\s*if\s+defined\s*\(\s*PBL_PLATFORM_EMERY\s*\)\s*$|^#\s*ifdef\s+PBL_PLATFORM_EMERY\s*$/.test(t));
    } else if (/^#\s*(else|elif)/.test(t)) {
      stack[stack.length - 1] = false;
    } else if (/^#\s*endif/.test(t)) {
      stack.pop();
    } else if (line.indexOf(needle) !== -1) {
      hits += 1;
      assert.ok(stack.indexOf(true) !== -1, needle + ' outside an emery branch at line ' + (i + 1) + ': ' + t);
    }
  });
  return hits;
}

module.exports = { readC, cDefine, onlyUnderEmery };
