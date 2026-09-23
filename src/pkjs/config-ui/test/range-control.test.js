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

// --- threshold slider: the drag repaint must keep the kind's own vocabulary ---
// Regression: paintThresholdRange() rebuilt the chip text from hardcoded
// 'Warn'/'Danger' while the initial render used item.warnLabel/dangerLabel, so
// the first drag on a GOAL kind flipped "Close 8000 / Goal 10000" to
// "Warn 8000 / Danger 10000" and it never came back until a full re-render.

const GOAL_ITEM = {
  type: 'range', messageKey: 'threshStepsWarn', dangerKey: 'threshStepsDanger',
  min: 0, max: 20000, step: 250, minSpan: 250, dir: 'above', unit: '',
  seedWarn: 8000, seedDanger: 10000,
  warnColor: '#55FF00', dangerColor: '#55FF00',
  warnGlow: 'rgba(85,255,0,0.35)', dangerGlow: 'rgba(85,255,0,0.35)',
  dangerText: '#20232A', warnLabel: 'Close', dangerLabel: 'Goal',
  rangeFrom: { resolver: 'x' }
};

/** Minimal stand-in for the .rng element paintThresholdRange mutates. */
function fakeRangeRoot() {
  const el = () => ({ style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const chips = [el(), el()];
  const nodes = {
    '[data-zone="warn"]': el(), '[data-zone="danger"]': el(),
    '[data-range-thumb=lo]': el(), '[data-range-thumb=hi]': el()
  };
  return {
    attrs: {}, chips, nodes,
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelectorAll(sel) { return sel === '.rng-chip' ? chips : []; },
    querySelector(sel) { return nodes[sel]; }
  };
}

test('the drag repaint keeps the goal kind\'s Close/Goal chip wording', () => {
  const root = fakeRangeRoot();
  E.paintThresholdRange(root, GOAL_ITEM, { lo: 8000, hi: 10000 });
  assert.equal(root.chips[0].textContent, 'Close 8000');
  assert.equal(root.chips[1].textContent, 'Goal 10000');
});

test('the drag repaint keeps Warn/Danger for the weather kinds, with the unit', () => {
  const root = fakeRangeRoot();
  const windItem = Object.assign({}, GOAL_ITEM, {
    unit: 'kph', warnLabel: 'Warn', dangerLabel: 'Danger'
  });
  E.paintThresholdRange(root, windItem, { lo: 40, hi: 60 });
  assert.equal(root.chips[0].textContent, 'Warn 40 kph');
  assert.equal(root.chips[1].textContent, 'Danger 60 kph');
});

test('the drag repaint agrees with the initial render, chip for chip', () => {
  // The bug was a second, drifting copy of the chip wording — pin them together.
  const root = fakeRangeRoot();
  E.paintThresholdRange(root, GOAL_ITEM, { lo: 8000, hi: 10000 });
  const html = E.renderControl(GOAL_ITEM, { value: '8000', dangerValue: '10000' });
  assert.match(html, new RegExp('>' + root.chips[0].textContent + '<'));
  assert.match(html, new RegExp('>' + root.chips[1].textContent + '<'));
});

// --- a stack pinned at a track end must stay separable ----------------------
// Both thumbs are 28px buttons and the danger one sits on top (z-index), while the
// pair only keeps minSpan (one step) apart. On a fine-grained track that is a few
// pixels — Steps' 250 of 20000 is ~4px on a phone — so a pair pinned at the max had
// the warn knob hidden under the danger knob, which can move neither way: every press
// grabbed the immovable thumb and the stack could never be pulled apart. pickThumb
// hands such a press to the sibling.
const RC = require('../lib/range-control.js');
const STEPS = { min: 0, max: 20000, step: 250, minSpan: 250 };

test('pickThumb: a thumb pinned at its track end hands the press to its sibling', () => {
  assert.equal(RC.pickThumb({ lo: 19750, hi: 20000 }, 'hi', STEPS), 'lo',
    'hi at the max with lo one span below cannot move: drag lo');
  assert.equal(RC.pickThumb({ lo: 0, hi: 250 }, 'lo', STEPS), 'hi',
    'lo at the min with hi one span above cannot move: drag hi');
});

test('pickThumb: a thumb that can still move keeps the press', () => {
  assert.equal(RC.pickThumb({ lo: 19750, hi: 20000 }, 'lo', STEPS), 'lo',
    'the sibling of a pinned thumb is itself free to move');
  assert.equal(RC.pickThumb({ lo: 10000, hi: 10250 }, 'hi', STEPS), 'hi',
    'a mid-track stack: the top thumb can still move right');
  assert.equal(RC.pickThumb({ lo: 10000, hi: 10250 }, 'lo', STEPS), 'lo');
  assert.equal(RC.pickThumb({ lo: 15000, hi: 20000 }, 'hi', STEPS), 'hi',
    'hi at the max but well clear of lo can still move left');
  assert.equal(RC.pickThumb({ lo: 0, hi: 5000 }, 'lo', STEPS), 'lo');
});

test('pickThumb: half-step kinds compare the span with float tolerance', () => {
  const sleep = { min: 0, max: 12, step: 0.5, minSpan: 0.5 };
  assert.equal(RC.pickThumb({ lo: 11.5, hi: 12 }, 'hi', sleep), 'lo');
  const km = { min: 0, max: 20, step: 0.5, minSpan: 0.5 };
  assert.equal(RC.pickThumb({ lo: 19.5, hi: 20 }, 'hi', km), 'lo', 'Distance pinned at 20 km');
  // 16.1 - 15.6 is 0.5000000000000018 in doubles: a strict compare would call this
  // pinned pair "wider than one span" and leave it stuck.
  assert.equal(RC.pickThumb({ lo: 15.6, hi: 16.1 }, 'hi', { min: 0, max: 16.1, minSpan: 0.5 }), 'lo',
    'float noise in the span must not hide a pinned pair');
  assert.equal(RC.pickThumb({ lo: 11, hi: 12 }, 'hi', sleep), 'hi');
});
