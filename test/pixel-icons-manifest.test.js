// test/pixel-icons-manifest.test.js — the icons and their sizes as JSON for the icon creator
// (WarnWeatherTools): scripts/pixel-icons/watch_icons.py manifest. Its sizes are the ones
// resources/pixel-icons.json holds, and each size's scale height paints that many rows.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const python = spawnSync('python3', ['--version']).status === 0;
const skip = python ? false : 'python3 is not installed';

function manifest() {
  return JSON.parse(execFileSync('python3', [path.join(ROOT, 'scripts', 'pixel-icons', 'watch_icons.py'), 'manifest']).toString());
}

test('the manifest lists every icon with the sizes resources/pixel-icons.json holds', { skip }, () => {
  const m = manifest();
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'pixel-icons.json'), 'utf8'));
  assert.equal(m.app, 'WarnWeather');
  assert.deepEqual(m.icons.map((i) => i.id).sort(), Object.keys(doc.icons).sort());
  for (const icon of m.icons) {
    const saved = Object.keys(doc.icons[icon.id].sizes).filter((k) => k !== 'A').map(Number).sort((a, b) => a - b);
    assert.deepEqual(icon.sizes.map((s) => s.rows), saved, icon.id + ': the Pebble Classic masks are no PDCs and are left out');
    for (const size of icon.sizes) {
      const painted = size.scaleHeight % 2 === 0 ? size.scaleHeight + 1 : size.scaleHeight + 2;
      assert.equal(painted, size.rows, icon.id + ' ' + size.rows + ': the scale height paints the size');
      assert.ok(size.uses.length > 0);
      for (const use of size.uses) assert.ok(m.fonts[use.font], icon.id + ': ' + use.font + ' is in the fonts');
    }
  }
});

test("the manifest's cap centres are the ones the pixel icon editor seats icons on", { skip }, () => {
  const editor = fs.readFileSync(path.join(ROOT, 'scripts', 'pixel-icons', 'editor.html'), 'utf8');
  const caps = JSON.parse(/var CAP_CY = (\{[^}]*\})/.exec(editor)[1].replace(/(\w+):/g, '"$1":'));
  const m = manifest();
  for (const [font, f] of Object.entries(m.fonts)) assert.equal(f.capCentre, caps[font], font);
});
