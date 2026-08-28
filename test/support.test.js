'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const support = require('../src/pkjs/settings/support.js');

// --- renderCoffeeIconHtml ---

test('coffee icon is stroke-only line art, not a filled glyph', () => {
  const html = support.renderCoffeeIconHtml();
  assert.match(html, /<svg[^>]*class="bmc-cup"/);
  assert.match(html, new RegExp('viewBox="' + support.VIEW_BOX + '"'));
  // fill/stroke come from the injected CSS; the markup must not hardcode a fill.
  assert.doesNotMatch(html, /fill="(?!none)/);
});

test('coffee icon carries the steam group the animation targets', () => {
  const html = support.renderCoffeeIconHtml();
  // Dropping this group is the silent regression: the cup still renders, the
  // steam CSS just animates nothing.
  assert.match(html, /class="bmc-steam"/);
});

// A CSS transform on an SVG child is in USER UNITS, not screen px, so the rise
// is measured in viewBox units — and an svg clips to its viewport, so a viewBox
// with no headroom above the wisps lops their tips off every cycle. Nothing
// throws; the animation just looks wrong on a phone.
test('steam stays inside the viewBox at the top of its rise', () => {
  const box = support.VIEW_BOX.split(/\s+/).map(Number);
  const minY = box[1];
  support.STEAM_PATHS.forEach((d) => {
    // "M<x> <y>c…<dy>": the wisps rise monotonically, so the curve's end point
    // is its topmost ink.
    const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const topY = nums[1] + nums[nums.length - 1];
    const peak = topY - (support.STEAM_STROKE / 2) - support.STEAM_RISE_UNITS;
    assert.ok(peak >= minY,
      'wisp "' + d + '" reaches ' + peak + ' at the top of its rise, above the ' +
      'viewBox top (' + minY + ') — its tip gets clipped every cycle');
  });
});

test('coffee icon is hidden from screen readers behind a text label', () => {
  const html = support.renderCoffeeIconHtml();
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /class="sr-only">Support me</);
});

// --- renderSupportModalHtml ---

test('support modal is titled "Support me"', () => {
  assert.match(support.renderSupportModalHtml(), /<h2>Support me<\/h2>/);
});

test('support modal opens Buy Me a Coffee in the same window', () => {
  const html = support.renderSupportModalHtml();
  assert.match(html, /href="https:\/\/buymeacoffee\.com\/toaster2"/);
  // NOT target="_blank": a plain Android WebView without an onCreateWindow hook
  // drops _blank navigations on the floor, so the link would look clickable and
  // simply do nothing on a phone.
  assert.doesNotMatch(html, /target=/);
});

test('the Buy Me a Coffee link is inline in the sentence, not a separate button', () => {
  // The copy reads "…through this link: <url>", so the anchor shows the URL
  // itself rather than hiding it behind link text, and no trailing punctuation
  // rides along that someone could copy into the address bar.
  assert.match(support.renderSupportModalHtml(),
    /this link:\s*<a [^>]*>https:\/\/buymeacoffee\.com\/toaster2<\/a>\s*<\/p>/);
});

test('support modal escapes the "<3" so it cannot open a stray tag', () => {
  const html = support.renderSupportModalHtml();
  assert.match(html, /&lt;3/);
  assert.doesNotMatch(html, /<3/);
});

test('support modal closes with the personal sign-off', () => {
  const html = support.renderSupportModalHtml();
  assert.match(html, /Thank you/);
  assert.match(html, /Caffeinated greetings from Berlin,/);
  assert.match(html, /Tobi/);
});

test('support modal offers a close control', () => {
  assert.match(support.renderSupportModalHtml(), /data-bmc-close/);
});
