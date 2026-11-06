'use strict';
// The settings page carries its own font (build-page.js inlineFont): Inter's Latin variable face
// from lib/fonts as a data URI, its licence beside it. A page that fetched its font would need
// the font host in the app's permissions (manifest version 2 lets the app reach only what it
// declares) and would draw in the fallback font offline.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const build = require('../scripts/build-page.js');

const FONTS = path.join(__dirname, '..', 'lib', 'fonts');

test('the page bundles Inter and requests no font', () => {
  const page = build.buildPage({});
  const font = fs.readFileSync(path.join(FONTS, 'inter-latin-wght-normal.woff2'));
  assert.ok(page.indexOf("src: url(data:font/woff2;base64," + font.toString('base64') + ") format('woff2');") !== -1,
    'the vendored face, inlined whole');
  assert.match(page, /font-family: 'Inter';\s*font-style: normal;\s*font-weight: 100 900;/, 'one face for every weight');
  assert.doesNotMatch(page, /fonts\.(googleapis|gstatic)\.com/, 'no Google Fonts');
  assert.doesNotMatch(page, /<link[^>]+rel="(stylesheet|preconnect)"/, 'no external stylesheet or preconnect');
  assert.doesNotMatch(page, /__PCONF_FONT_/, 'both markers are filled');
});

test('the licence travels with the font', () => {
  const page = build.buildPage({});
  assert.ok(page.indexOf('Copyright 2016 The Inter Project Authors') !== -1);
  assert.ok(page.indexOf('SIL Open Font License, Version 1.1') !== -1);
  const licence = fs.readFileSync(path.join(FONTS, 'OFL.txt'), 'utf8');
  assert.match(licence, /^Copyright 2016 The Inter Project Authors/);
  assert.equal(licence.indexOf('*/'), -1, 'the licence cannot close its CSS comment early');
});
