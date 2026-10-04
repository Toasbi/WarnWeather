// test/status-slot-icons.test.js — the settings page's status-slot row glyphs
// (src/pkjs/settings/status-slot-icons.js): ten 24×24 fragments in currentColor,
// registered into the config-ui icon registry when the engine is loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
const ICONS = require('../src/pkjs/settings/status-slot-icons.js');

// The six weather glyphs and the Alert settings card's four System info glyphs (also the
// Status slots tab's read-only Alerts rows, by on-demand.js ITEMS icon).
const IDS = ['rain', 'uv', 'wind', 'gust', 'aqi', 'pollen', 'battery', 'bluetooth', 'quiet', 'snooze'];

test('every glyph is a 24x24 svg drawn in currentColor', () => {
  IDS.forEach((id) => {
    const svg = ICONS[id];
    assert.equal(typeof svg, 'string', id + ' is exported');
    assert.ok(svg.indexOf('<svg viewBox="0 0 24 24"') === 0, id + ' opens a 24x24 svg');
    assert.ok(/<\/svg>$/.test(svg), id + ' closes it');
    assert.ok(svg.indexOf('currentColor') !== -1, id + ' takes its colour from the row chrome');
    assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(svg), false, id + ' hard-codes no colour');
  });
});

test('rain is the filled drop; the others are Tabler-style outlines', () => {
  // The watch's rain drop is a pure fill (gen-rain-pdc.py), the status glyphs are strokes.
  assert.ok(ICONS.rain.indexOf('fill="currentColor"') !== -1, 'rain is filled');
  assert.equal(ICONS.rain.indexOf('stroke='), -1, 'rain has no outline');
  IDS.filter((id) => id !== 'rain').forEach((id) => {
    assert.ok(ICONS[id].indexOf('fill="none" stroke="currentColor" stroke-width="1.8"') !== -1,
      id + ' is an unfilled 1.8 outline');
    assert.ok(ICONS[id].indexOf('stroke-linecap="round" stroke-linejoin="round"') !== -1,
      id + ' has round caps and joins');
  });
});

test('requiring the module with the engine loaded registers every glyph', () => {
  // The module registered at require time above: engine.js had already attached
  // PConf.icons to the shared global, which is exactly the page's load order.
  IDS.forEach((id) => {
    assert.equal(global.PConf.icons.get(id), ICONS[id], id + ' is in PConf.icons');
  });
  const row = E.renderRow({ type: 'toggle', messageKey: 'alertUv', label: 'UV index', icon: 'uv' },
    { value: false });
  assert.ok(row.indexOf('<div class="lbl"><span class="lbl-ico" aria-hidden="true">' + ICONS.uv) !== -1,
    'a row naming the id prints the glyph before its label');
});

test('every Alerts item names a registered glyph (an unknown id would print nothing, silently)', () => {
  // The read-only Alerts rows draw each placed item by on-demand.js ITEMS icon. bt and qt
  // have no glyph of their own name, so the ids are not the codes.
  const OD = require('../src/pkjs/on-demand.js');
  OD.ITEMS.forEach((item) => {
    assert.ok(IDS.indexOf(item.icon) !== -1, item.code + ': ' + item.icon + ' is one of the glyphs');
    assert.equal(global.PConf.icons.get(item.icon), ICONS[item.icon], item.code + ': registered');
  });
  assert.deepEqual(OD.ITEMS.map((i) => i.icon), ['battery', 'bluetooth', 'quiet', 'snooze', 'rain', 'gust', 'uv',
    'aqi', 'pollen', 'wind']);
});
