// src/pkjs/config-ui/test/rgb-control.test.js — the three-channel colour control
// (type: 'rgb'). Mirrors range-value/range-control: the numeric rules first (they
// are pure and need no DOM), then the renderer, then the in-place drag repaint.
const test = require('node:test');
const assert = require('node:assert/strict');
// Shared dual-use modules must populate global.PConf before engine.js reads them.
require('../lib/schema-walk.js');
require('../lib/color.js');
require('../lib/show-when.js');
const E = require('../lib/engine.js');

const ITEM = { type: 'rgb', messageKey: 'backlightColor', label: 'Backlight colour',
  defaultValue: '96,0,0' };

/** @param {*} v Stored value. @returns {string} Rendered control HTML. */
function render(v) { return E.renderControl(ITEM, { value: v }); }

// --- value helpers: parse / serialize "r,g,b" -------------------------------

test('parseRgb reads an r,g,b string', () => {
  assert.deepEqual(E.parseRgb('96,0,0', ITEM), { r: 96, g: 0, b: 0 });
  assert.deepEqual(E.parseRgb('255,128,7', ITEM), { r: 255, g: 128, b: 7 });
});

test('parseRgb tolerates whitespace around the channels', () => {
  assert.deepEqual(E.parseRgb(' 12 , 34 ,56 ', ITEM), { r: 12, g: 34, b: 56 });
});

test('parseRgb clamps an out-of-range channel instead of rejecting the value', () => {
  // 0-255 is fixed by the hardware byte, so an out-of-range channel is a bruised
  // value, not a stale one — keep the user's intent (bright red) rather than
  // dropping the whole colour back to the default.
  assert.deepEqual(E.parseRgb('300,-5,20', ITEM), { r: 255, g: 0, b: 20 });
});

test('parseRgb rejects garbage and falls back to the item default', () => {
  assert.deepEqual(E.parseRgb(undefined, ITEM), { r: 96, g: 0, b: 0 });
  assert.deepEqual(E.parseRgb('', ITEM), { r: 96, g: 0, b: 0 });
  assert.deepEqual(E.parseRgb('nope', ITEM), { r: 96, g: 0, b: 0 });
  assert.deepEqual(E.parseRgb('#FF0000', ITEM), { r: 96, g: 0, b: 0 }, 'a hex string is not r,g,b');
  assert.deepEqual(E.parseRgb('12,34', ITEM), { r: 96, g: 0, b: 0 }, 'two channels is not a colour');
  assert.deepEqual(E.parseRgb('1,2,3,4', ITEM), { r: 96, g: 0, b: 0 }, 'four channels is not a colour');
  assert.deepEqual(E.parseRgb('1,2,x', ITEM), { r: 96, g: 0, b: 0 }, 'one bad channel rejects the value');
  assert.deepEqual(E.parseRgb('1.5,2,3', ITEM), { r: 96, g: 0, b: 0 }, 'channels are integers');
});

test('parseRgb falls back to black when the default is broken or absent', () => {
  // One level of fallback only (parseRange's rule) — a broken default must not recurse.
  assert.deepEqual(E.parseRgb('nope', { type: 'rgb', defaultValue: 'also nope' }), { r: 0, g: 0, b: 0 });
  assert.deepEqual(E.parseRgb('nope', { type: 'rgb' }), { r: 0, g: 0, b: 0 });
  assert.deepEqual(E.parseRgb('nope'), { r: 0, g: 0, b: 0 }, 'no item at all');
});

test('formatRgb round-trips parseRgb', () => {
  assert.equal(E.formatRgb({ r: 96, g: 0, b: 0 }), '96,0,0');
  assert.deepEqual(E.parseRgb(E.formatRgb({ r: 7, g: 200, b: 255 }), ITEM), { r: 7, g: 200, b: 255 });
});

test('rgbHex resolves the colour, zero-padded and uppercase', () => {
  assert.equal(E.rgbHex({ r: 96, g: 0, b: 0 }), '#600000');
  assert.equal(E.rgbHex({ r: 255, g: 255, b: 255 }), '#FFFFFF');
  assert.equal(E.rgbHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(E.rgbHex({ r: 1, g: 10, b: 171 }), '#010AAB', 'single hex digits pad to two');
});

// --- moving one channel -----------------------------------------------------

test('setRgbChannel moves one channel and leaves the others alone', () => {
  assert.deepEqual(E.setRgbChannel({ r: 96, g: 0, b: 0 }, 'g', 128, ITEM), { r: 96, g: 128, b: 0 });
  assert.deepEqual(E.setRgbChannel({ r: 96, g: 0, b: 0 }, 'b', 12, ITEM), { r: 96, g: 0, b: 12 });
});

test('setRgbChannel clamps to 0-255 and rounds to whole channels', () => {
  assert.deepEqual(E.setRgbChannel({ r: 96, g: 0, b: 0 }, 'r', 999, ITEM), { r: 255, g: 0, b: 0 });
  assert.deepEqual(E.setRgbChannel({ r: 96, g: 0, b: 0 }, 'r', -40, ITEM), { r: 0, g: 0, b: 0 });
  assert.deepEqual(E.setRgbChannel({ r: 96, g: 0, b: 0 }, 'r', 128.6, ITEM), { r: 129, g: 0, b: 0 });
});

test('setRgbChannel honours an item step, and ignores an unknown channel', () => {
  const stepped = { type: 'rgb', messageKey: 'k', step: 16 };
  assert.deepEqual(E.setRgbChannel({ r: 0, g: 0, b: 0 }, 'r', 40, stepped), { r: 48, g: 0, b: 0 });
  assert.deepEqual(E.setRgbChannel({ r: 96, g: 0, b: 0 }, 'lo', 200, ITEM), { r: 96, g: 0, b: 0 },
    'a slider thumb name is not a channel');
  assert.deepEqual(E.setRgbChannel({ r: 96, g: 0, b: 0 }, 'constructor', 200, ITEM),
    { r: 96, g: 0, b: 0 }, 'an inherited property name is not a channel either');
});

test('setRgbChannel does not mutate its input', () => {
  const before = { r: 96, g: 0, b: 0 };
  E.setRgbChannel(before, 'g', 200, ITEM);
  assert.deepEqual(before, { r: 96, g: 0, b: 0 });
});

// --- render -----------------------------------------------------------------

test('renderRgb emits one track and one thumb per channel under ONE key', () => {
  const h = render('96,0,0');
  assert.match(h, /data-range="backlightColor"/);
  assert.match(h, /data-range-thumb="r"/);
  assert.match(h, /data-range-thumb="g"/);
  assert.match(h, /data-range-thumb="b"/);
  assert.equal((h.match(/class="rng-track"/g) || []).length, 3);
  assert.equal((h.match(/class="rng-fill"/g) || []).length, 3);
});

test('renderRgb paints the resolved colour in the swatch and the hex readout', () => {
  const h = render('96,0,0');
  assert.match(h, /data-rgb-swatch style="background:#600000"/);
  assert.match(h, /<span data-rgb-hex>#600000<\/span>/);
});

test('renderRgb shows each channel value and positions its thumb as a percentage', () => {
  // 96/255 = 37.6%, 255 = 100%, 0 = 0%.
  const h = render('96,255,0');
  assert.match(h, /data-range-thumb="r" style="left:37\.6%"/);
  assert.match(h, /data-range-thumb="g" style="left:100%"/);
  assert.match(h, /data-range-thumb="b" style="left:0%"/);
  assert.match(h, /data-rgb-val="r">96</);
  assert.match(h, /data-rgb-val="g">255</);
  assert.match(h, /data-rgb-val="b">0</);
});

test('renderRgb gives every thumb an aria-label naming its channel, plus slider values', () => {
  const h = render('96,0,0');
  assert.match(h, /aria-label="Backlight colour red"/);
  assert.match(h, /aria-label="Backlight colour green"/);
  assert.match(h, /aria-label="Backlight colour blue"/);
  assert.equal((h.match(/role="slider"/g) || []).length, 3);
  assert.equal((h.match(/aria-valuemin="0" aria-valuemax="255"/g) || []).length, 3);
  assert.match(h, /aria-valuenow="96"/);
});

test('renderRgb carries the channels as data attributes for the drag handler', () => {
  const h = render('96,12,34');
  assert.match(h, /data-r="96"/);
  assert.match(h, /data-g="12"/);
  assert.match(h, /data-b="34"/);
});

test('renderRgb falls back to the default for a missing/broken value', () => {
  assert.match(render(undefined), /#600000/);
  assert.match(render('nope'), /#600000/);
});

test('renderControl dispatches the rgb type (the CONTROLS table is closed)', () => {
  // A type missing from engine.js CONTROLS renders as an EMPTY row, silently.
  assert.notEqual(render('96,0,0'), '');
  assert.equal(E.renderControl({ type: 'notAType', messageKey: 'x' }, { value: '1' }), '');
});

test('an rgb row is stacked (full width), like text, radio and range', () => {
  assert.match(E.renderRow(ITEM, { value: '96,0,0' }), /class="row stack"/);
});

test('a disabled rgb row carries the .dis modifier the slider handlers guard on', () => {
  assert.match(E.renderRow(ITEM, { value: '96,0,0', disabled: true }), /class="row stack dis"/);
});

// --- in-place repaint (drag / keyboard nudge, no re-render) -----------------

/** Minimal stand-in for the .rng element paintRgb mutates. @returns {Object} Fake root. */
function fakeRgbRoot() {
  const el = () => ({ style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const nodes = {
    '[data-rgb-swatch]': el(), '[data-rgb-hex]': el(),
    '[data-rgb-fill=r]': el(), '[data-rgb-fill=g]': el(), '[data-rgb-fill=b]': el(),
    '[data-range-thumb=r]': el(), '[data-range-thumb=g]': el(), '[data-range-thumb=b]': el(),
    '[data-rgb-val=r]': el(), '[data-rgb-val=g]': el(), '[data-rgb-val=b]': el()
  };
  return {
    attrs: {}, nodes,
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector(sel) { return nodes[sel]; }
  };
}

test('paintRgb repaints the swatch, the readout and every channel in place', () => {
  const root = fakeRgbRoot();
  E.paintRgb(root, ITEM, { r: 96, g: 255, b: 0 });
  assert.equal(root.nodes['[data-rgb-swatch]'].style.background, '#60FF00');
  assert.equal(root.nodes['[data-rgb-hex]'].textContent, '#60FF00');
  assert.equal(root.nodes['[data-range-thumb=r]'].style.left, '37.6%');
  assert.equal(root.nodes['[data-rgb-fill=r]'].style.right, '62.4%');
  assert.equal(root.nodes['[data-range-thumb=g]'].style.left, '100%');
  assert.equal(root.nodes['[data-rgb-val=b]'].textContent, 0);
  assert.equal(root.nodes['[data-range-thumb=b]'].attrs['aria-valuenow'], 0);
});

test('paintRgb writes back the data-r/g/b state the pointer handler reads', () => {
  const root = fakeRgbRoot();
  E.paintRgb(root, ITEM, { r: 1, g: 2, b: 3 });
  assert.equal(root.attrs['data-r'], 1);
  assert.equal(root.attrs['data-g'], 2);
  assert.equal(root.attrs['data-b'], 3);
});

test('the drag repaint agrees with the initial render, swatch and thumb alike', () => {
  // The threshold slider grew a second, drifting copy of its chip wording exactly
  // this way — pin the two paths together.
  const root = fakeRgbRoot();
  E.paintRgb(root, ITEM, { r: 96, g: 12, b: 34 });
  const html = E.renderControl(ITEM, { value: '96,12,34' });
  assert.match(html, new RegExp('background:' + root.nodes['[data-rgb-swatch]'].style.background));
  assert.match(html, new RegExp('>' + root.nodes['[data-rgb-hex]'].textContent + '<'));
  assert.match(html,
    new RegExp('left:' + root.nodes['[data-range-thumb=r]'].style.left.replace('.', '\\.')));
});
