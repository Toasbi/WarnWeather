const test = require('node:test');
const assert = require('node:assert/strict');
const COLORS = require('../src/pkjs/pebble-colors.js');
const { resolveInk } = require('../src/pkjs/resolve-ink.js');

test('light theme: exact white flips to black', () => {
  assert.equal(resolveInk(COLORS.GColorWhite, 'light'), COLORS.GColorBlack);
});

test('dark/bw theme: white passes through unchanged', () => {
  assert.equal(resolveInk(COLORS.GColorWhite, 'dark'), COLORS.GColorWhite);
  assert.equal(resolveInk(COLORS.GColorWhite, 'bw'), COLORS.GColorWhite);
});

test('non-white colors pass through unchanged in every theme (hues and grays untouched)', () => {
  assert.equal(resolveInk(COLORS.GColorLightGray, 'light'), COLORS.GColorLightGray);
  assert.equal(resolveInk(COLORS.GColorRed, 'light'), COLORS.GColorRed);
  assert.equal(resolveInk(COLORS.GColorBlack, 'light'), COLORS.GColorBlack);
});
