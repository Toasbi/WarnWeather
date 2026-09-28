'use strict';
// test/config-schema-golden.test.js — pins the settings page's schema, byte for byte, to
// test/config-schema.golden.json, and what the level rows' resolvers make of it on every
// platform. The schema is plain data built once at load, so a refactor of its builders
// (schema.js levelsGroup / thresholdSection and friends) can prove it changed nothing the
// page sees. How the golden is built, and how to rewrite it after a deliberate change:
// test/helpers/config-schema-golden.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const golden = require('./helpers/config-schema-golden.js');

const GOLDEN = require(golden.GOLDEN_PATH);
const SNAPSHOT = golden.buildSnapshot();

/**
 * Assert two JSON texts are identical, naming the first line that differs (a plain
 * string assert on ~400 KB of JSON prints nothing readable).
 * @param {string} actual The text built from the current source.
 * @param {string} expected The golden's text.
 * @param {string} what Which part, for the message.
 */
function assertSameText(actual, expected, what) {
  if (actual === expected) { return; }
  const a = actual.split('\n');
  const e = expected.split('\n');
  let i = 0;
  while (i < a.length && i < e.length && a[i] === e[i]) { i++; }
  const from = Math.max(0, i - 3);
  assert.fail(what + ' differs from test/config-schema.golden.json at line ' + (i + 1) + ':\n'
    + '--- golden\n' + e.slice(from, i + 3).join('\n') + '\n'
    + '+++ current\n' + a.slice(from, i + 3).join('\n') + '\n'
    + 'If the change is deliberate, rewrite the golden with '
    + '`node test/helpers/config-schema-golden.js` and review its diff.');
}

test('the schema the page receives matches the golden byte for byte', () => {
  assertSameText(golden.stringify(SNAPSHOT.schema), golden.stringify(GOLDEN.schema), 'The schema');
});

test('the level rows resolve on every platform exactly as the golden records', () => {
  assert.deepEqual(Object.keys(GOLDEN.levelRows), golden.PLATFORMS);
  assertSameText(golden.stringify(SNAPSHOT.levelRows), golden.stringify(GOLDEN.levelRows),
    'The resolved level rows');
});

test('the golden covers every level kind: a slider and a warn look each, on every platform', () => {
  // A kind that stopped reaching the resolvers (a lost rangeFrom or hintFrom) would
  // otherwise shrink both sides of the byte check alike on the next rewrite.
  const stems = ['Steps', 'Sleep', 'Distance', 'Uv', 'Wind', 'Gust', 'Aqi', 'Pollen'];
  golden.PLATFORMS.forEach((p) => {
    assert.deepEqual(Object.keys(SNAPSHOT.levelRows[p]).sort(),
      stems.reduce((all, s) => all.concat(['thresh' + s + 'Warn', 'thresh' + s + 'WarnLook']), []).sort(), p);
  });
});
