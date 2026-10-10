// test/helpers/c-source.js — the C sources as the JS↔C lockstep tests read them: a
// source's text and the value of one of its #defines. One #define reader, so every pinned
// constant parses the same way: decimal or hex, the name matched whole, and a missing name
// failing its assert.
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

module.exports = { readC, cDefine };
