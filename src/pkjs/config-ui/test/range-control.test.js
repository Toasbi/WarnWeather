// src/pkjs/config-ui/test/range-control.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const ITEM = { type: 'range', messageKey: 'hrScale', label: 'Heart-rate scale',
  defaultValue: '40-180', min: 30, max: 220, step: 5, minSpan: 50, unit: 'BPM' };

/** @param {string} v Stored value. @returns {string} Rendered control HTML. */
function render(v) { return E.renderControl(ITEM, { value: v }); }

// NOTE: every sample pair here must be at least `minSpan` (50) apart, or
// parseRange rejects it and falls back to the default — 50-100, not 55-95.

test('renderRange emits a track, two thumbs and a readout', () => {
  const h = render('50-100');
  assert.match(h, /data-range="hrScale"/);
  assert.match(h, /data-range-thumb="lo"/);
  assert.match(h, /data-range-thumb="hi"/);
  assert.match(h, /class="rng-fill"/);
});

test('renderRange shows both values with the unit, and the bound labels', () => {
  const h = render('50-100');
  // The dash is an HTML entity in the markup, not a literal en dash.
  assert.match(h, /50 &ndash; 100 BPM/);
  assert.match(h, />30</);
  assert.match(h, />220</);
});

test('renderRange positions the thumbs as a percentage of the track', () => {
  // min 30, max 220 -> span 190. lo 50 = 20/190 = 10.5%, hi 220 = 100%.
  const h = render('50-220');
  assert.match(h, /left:10\.5%/);
  assert.match(h, /left:100%/);
});

test('renderRange carries the current values as data attributes for the drag handler', () => {
  const h = render('50-100');
  assert.match(h, /data-lo="50"/);
  assert.match(h, /data-hi="100"/);
});

test('renderRange falls back to the default for a missing/broken value', () => {
  assert.match(render(undefined), /40 &ndash; 180 BPM/);
  assert.match(render('nope'), /40 &ndash; 180 BPM/);
});

test('a range row is stacked (full width), like text and radio', () => {
  const row = E.renderRow(ITEM, { value: '50-100' });
  assert.match(row, /class="row stack"/);
});
