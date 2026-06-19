// test/wire-units.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { clampByte } = require('../src/pkjs/wire-units');

test('clampByte rounds then clamps to 0..255', () => {
  assert.equal(clampByte(0), 0);
  assert.equal(clampByte(12.4), 12);
  assert.equal(clampByte(12.5), 13);
  assert.equal(clampByte(-3), 0);
  assert.equal(clampByte(300), 255);
  assert.equal(clampByte(255), 255);
});

test('clampByte treats non-finite as 0', () => {
  assert.equal(clampByte(NaN), 0);
  assert.equal(clampByte(undefined), 0);
});
