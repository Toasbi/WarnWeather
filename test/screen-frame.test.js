'use strict';
// The frame every screen picture sits in (src/pkjs/page/layout/screen-frame.js): the Watchface
// tab's views and pictures (preview-watch.js) and the setup wizard's screens and forecast graph
// (wizard.js, wizard-forecast.js) all draw through it.
const test = require('node:test');
const assert = require('node:assert');
const frame = require('../src/pkjs/page/layout/screen-frame.js');

test('the margin is about 6 % of the drawing\'s width: 9 on the 144 px screens, 12 on emery\'s 200', () => {
  assert.equal(frame.margin(144), 9);
  assert.equal(frame.margin(200), 12);
  assert.equal(frame.margin(320), 20, 'any other width: its 6.25 %');
});

test('a picture\'s ground: the frame svg drew it in, without the drawing; none for markup svg did not draw', () => {
  const drawn = frame.svg(200, 107, '#FFFFFF', '<circle id="a"></circle>', 'wiz-graph-scr');
  assert.equal(frame.ground(drawn), frame.svg(200, 107, '#FFFFFF', '', 'wiz-graph-scr'));
  assert.equal(frame.ground('<svg viewBox="0 0 1 1"><circle></circle></svg>'), '');
});

test('a framed drawing is its ground all round it, then the drawing in its own coordinates', () => {
  assert.equal(frame.svg(144, 168, '#000000', '<circle></circle>', 'wpv-scr'),
    '<svg class="wpv-scr" viewBox="-9 -9 162 186" aria-hidden="true" focusable="false">'
    + '<rect x="-9" y="-9" width="162" height="186" fill="#000000"></rect><circle></circle></svg>');
  assert.match(frame.svg(200, 128, '#FFFFFF', ''), /^<svg viewBox="-12 -12 224 152" [^>]*><rect x="-12" y="-12" width="224" height="152" fill="#FFFFFF">/,
    'no class without one');
});
