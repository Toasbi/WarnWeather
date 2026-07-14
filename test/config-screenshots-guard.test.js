'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const build = require('../scripts/build-config-page.js');

test('build-config-page exposes assertScreenshots', () => {
  assert.equal(typeof build.assertScreenshots, 'function');
});

test('assertScreenshots passes with the committed asset', () => {
  assert.doesNotThrow(function () { build.assertScreenshots(); });
});

test('assertScreenshots throws when a required (platform, group, val) is missing/empty', () => {
  // A complete-looking module with one hole: aplite is missing layoutPreset.noCal.
  const PNG = 'data:image/png;base64,AAAA';
  const full = require('../src/pkjs/settings/wizard-screenshots.generated.js');
  const bad = JSON.parse(JSON.stringify(full));
  delete bad.aplite.layoutPreset.noCal;
  assert.throws(function () { build.assertScreenshots(bad); }, /aplite\.layoutPreset\.noCal/);
});
