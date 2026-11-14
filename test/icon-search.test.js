// test/icon-search.test.js — the icon picker's chooser of Lucide and Tabler icons
// (scripts/pixel-icons/icon-search.js): its search, best answer first, and the SVG a picked icon
// becomes for Add SVG, which svg-icon.js reads as it reads a file.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const IS = require('../scripts/pixel-icons/icon-search.js');
const SI = require('../scripts/pixel-icons/svg-icon.js');

// A set in the shape build_picker.py writes: [name, body, tags].
const SET = {
  id: 'lucide', name: 'Lucide', version: '1.72.0', home: 'https://lucide.dev', licence: 'ISC',
  icons: [
    ['brain', '<path d="M6 6h12"/>', 'mind'],
    ['cloud', '<path d="M4 14a5 5 0 0 1 9-4h3a4 4 0 0 1 0 8H7"/>', 'weather'],
    ['cloud-rain', '<path d="M4 14a5 5 0 0 1 9-4"/><path d="M8 16v4"/>', 'weather showers'],
    ['cloud-rain-wind', '<path d="M4 14h12"/>', 'weather'],
    ['cloud-snow', '<path d="M8 16v4"/><circle cx="12" cy="20" r="1"/>', 'weather winter'],
    ['rainbow', '<path d="M2 18a10 10 0 0 1 20 0"/>', 'colours'],
    ['umbrella', '<path d="M12 2v18"/>', 'rain weather'],
    ['sun', '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/>', 'brightness day']
  ]
};
const names = (r) => r.icons.map((i) => i[0]);

test('a search: its name first, then whole words of a name, a name it starts, words it starts, inside a name, tags', () => {
  assert.deepEqual(names(IS.findIcons(SET, 'rain')), ['cloud-rain', 'cloud-rain-wind', 'rainbow', 'brain', 'umbrella'],
    'whole word, then the name it starts, then inside a name, then the tags alone');
  assert.deepEqual(names(IS.findIcons(SET, 'cloud rain')), ['cloud-rain', 'cloud-rain-wind'], 'every word must answer');
  assert.deepEqual(names(IS.findIcons(SET, 'Cloud-Rain')), ['cloud-rain', 'cloud-rain-wind'], 'any case, hyphens as spaces');
  assert.deepEqual(names(IS.findIcons(SET, 'clo')), ['cloud', 'cloud-rain', 'cloud-snow', 'cloud-rain-wind'],
    'the same rank: the shorter name first, then A to Z');
  assert.deepEqual(names(IS.findIcons(SET, 'winter')), ['cloud-snow'], 'a tag finds an icon');
  assert.deepEqual(names(IS.findIcons(SET, 'sun')), ['sun']);
});

test('no search, no icons; the total counts every match, the list stops at the limit', () => {
  assert.deepEqual(IS.findIcons(SET, ''), { icons: [], total: 0 });
  assert.deepEqual(IS.findIcons(SET, '  - '), { icons: [], total: 0 });
  assert.deepEqual(IS.findIcons(null, 'rain'), { icons: [], total: 0 });
  const r = IS.findIcons(SET, 'weather', 2);
  assert.equal(r.total, 5);
  assert.deepEqual(names(r), ['cloud', 'umbrella'], 'the first two of the five');
  assert.equal(IS.findIcons(SET, 'zzz').total, 0);
});

test('a picked icon becomes an SVG Add SVG reads as the library\'s own file, its source named in a comment', () => {
  const icon = SET.icons[4];
  const text = IS.svgText(SET, icon);
  assert.ok(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><!-- Lucide 1.72.0: cloud-snow -->'), text);
  assert.ok(text.endsWith(icon[1] + '</svg>'));
  const bare = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + icon[1] + '</svg>';
  assert.deepEqual(SI.toPdcPaths(text), SI.toPdcPaths(bare), 'the same PDC as the bare drawing: the comment is skipped');
  assert.ok(SI.toPdcPaths(text).length > 0);
});

test('the chooser draws an icon as the library does, at the size asked, hidden from screen readers', () => {
  const svg = IS.preview(SET.icons[7], 28);
  assert.equal(svg, '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + SET.icons[7][1] + '</svg>');
});
