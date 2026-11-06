'use strict';
// The frame every screen picture sits in (src/pkjs/settings/screen-frame.js): the Watchface
// tab's views and pictures (preview-watch.js) and the setup wizard's screenshots and forecast
// graph (wizard.js, wizard-forecast.js) all draw through it.
const test = require('node:test');
const assert = require('node:assert');
const frame = require('../src/pkjs/settings/screen-frame.js');

test('the margin is about 6 % of the drawing\'s width: 9 on the 144 px screens, 12 on emery\'s 200', () => {
  assert.equal(frame.margin(144), 9);
  assert.equal(frame.margin(200), 12);
  assert.equal(frame.margin(320), 20, 'any other width: its 6.25 %');
});

test('a framed drawing is its ground all round it, then the drawing in its own coordinates', () => {
  assert.equal(frame.svg(144, 168, '#000000', '<circle></circle>', 'wpv-scr'),
    '<svg class="wpv-scr" viewBox="-9 -9 162 186" aria-hidden="true" focusable="false">'
    + '<rect x="-9" y="-9" width="162" height="186" fill="#000000"></rect><circle></circle></svg>');
  assert.match(frame.svg(200, 128, '#FFFFFF', ''), /^<svg viewBox="-12 -12 224 152" [^>]*><rect x="-12" y="-12" width="224" height="152" fill="#FFFFFF">/,
    'no class without one');
});

test('a screenshot fills the screen at its own size, square pixels, in both href forms', () => {
  const img = frame.image(144, 168, 'data:image/png;base64,AAAA', 'class="wiz-shot"');
  assert.equal(img, '<image class="wiz-shot" x="0" y="0" width="144" height="168" preserveAspectRatio="none"'
    + ' image-rendering="optimizeSpeed" href="data:image/png;base64,AAAA" xlink:href="data:image/png;base64,AAAA"></image>');
});

test('a shot and its ground change in place', () => {
  const attrs = {};
  const ns = [];
  const el = { setAttribute: (k, v) => { attrs[k] = v; }, setAttributeNS: (uri, k, v) => { ns.push([uri, k, v]); } };
  frame.setImage(el, 'data:b');
  assert.equal(attrs.href, 'data:b');
  assert.deepEqual(ns, [['http://www.w3.org/1999/xlink', 'xlink:href', 'data:b']]);
  frame.setImage({ setAttribute: (k, v) => { attrs[k] = v; } }, 'data:c');
  assert.equal(attrs.href, 'data:c', 'a host without setAttributeNS still gets the plain href');
  const rect = { fill: null, setAttribute(k, v) { this[k] = v; } };
  frame.setGround({ querySelector: (sel) => (sel === 'rect' ? rect : null) }, '#FFFFFF');
  assert.equal(rect.fill, '#FFFFFF', 'the frame\'s first rect is its ground');
  frame.setGround(null, '#000000');
});
