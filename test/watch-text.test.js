// test/watch-text.test.js — the watch's text in the settings page's pictures of its screens
// (src/pkjs/page/layout/watch-text.js): widths as the firmware measures them, its trailing
// ellipsis, and each line seated on the pixels the watch lights.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WT = require('../src/pkjs/page/layout/watch-text.js');

const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'text-fonts-system.json'), 'utf8'));

/**
 * A character's advance in a firmware font, read from the extracted glyphs.
 * @param {string} name e.g. 'GOTHIC_18_BOLD'.
 * @param {number} cp The codepoint.
 * @returns {number} Pixels, the wildcard's for a codepoint the font lacks.
 */
function adv(name, cp) {
  const f = SRC.fonts[name], g = f.glyphs.find((x) => x[0] === cp) || f.glyphs.find((x) => x[0] === f.wildcard);
  return g[5];
}

/**
 * A text's width summed from the extracted glyphs.
 * @param {string} name The font.
 * @param {string} s The text.
 * @returns {number} Pixels.
 */
function sum(name, s) {
  return s.split('').reduce((w, c) => w + adv(name, c.charCodeAt(0)), 0);
}

test('a line is as wide as its glyphs\' advances, a missing one the firmware\'s wildcard', () => {
  [[14, false, 'GOTHIC_14'], [18, false, 'GOTHIC_18'], [18, true, 'GOTHIC_18_BOLD'], [24, true, 'GOTHIC_24_BOLD']]
    .forEach((c) => {
      ['Berlin', '-12', '23:59', 'Ärger über Öl', 'Kraków'].forEach((s) => {
        assert.equal(WT.width(c[0], c[1], s), sum(c[2], s), c[2] + ' ' + s);
      });
    });
  assert.equal(WT.width(18, false, '一'), adv('GOTHIC_18', SRC.fonts.GOTHIC_18.wildcard), 'a character no font has');
  assert.equal(WT.width(14, false, '\u0085'), adv('GOTHIC_14', SRC.fonts.GOTHIC_14.wildcard), 'a hole in the Latin range too');
  assert.ok(WT.width(18, true, 'Berlin') > WT.width(18, false, 'Berlin'), 'bold runs wider');
  assert.equal(WT.width(18, false, ''), 0);
  assert.equal(WT.font(16).height, 18, 'a size the watch has no font for falls back to 18');
});

test('a line that does not fit is cut where the firmware cuts it, with its ellipsis', () => {
  const s = 'Frankfurt am Main', full = WT.width(18, false, s), dots = adv('GOTHIC_18', 0x2026);
  assert.equal(WT.fit(18, false, s, full), s, 'it fits: as it is');
  // At every narrower room: the longest start that fits with the ellipsis; one character more
  // would not.
  for (let room = full - 1; room >= dots + adv('GOTHIC_18', s.charCodeAt(0)); room--) {
    const cut = WT.fit(18, false, s, room), kept = cut.slice(0, -1);
    assert.equal(cut.slice(-1), '…', room + ': cut');
    assert.equal(s.indexOf(kept), 0, room + ': a start of the text');
    assert.ok(sum('GOTHIC_18', kept) + dots <= room, room + ': the cut fits');
    assert.ok(sum('GOTHIC_18', s.slice(0, kept.length + 1)) + dots > room, room + ': no longer start fits');
  }
  assert.equal(WT.fit(18, false, s, dots), '', 'room for the ellipsis alone: nothing');
  assert.equal(WT.fit(18, false, s, 0), '');
});

test('a line seats its baseline the font\'s height below its top, at the watch\'s size', () => {
  const m = WT.line(18, true, 7, 30, '#FFFFFF', 'A<b>&c');
  assert.equal(m, '<text x="7" y="48" font-size="18" fill="#FFFFFF" font-family="WatchGothic18, Roboto, '
    + '&#39;Helvetica Neue&#39;, Arial, sans-serif" font-weight="700">A&lt;b&gt;&amp;c</text>');
  assert.match(WT.line(14, false, 0, -3, '#000000', '15'), /^<text x="0" y="11" font-size="14" [^>]*font-family="WatchGothic14,[^"]*" font-weight="400">15<\/text>$/);
  assert.match(WT.line(24, false, 0, 0, '#000000', 'x', 'stroke="#000000"'), / font-weight="400" stroke="#000000">x</);
  assert.equal(WT.line(18, false, 0, 0, '#000000', ''), '', 'no text, no markup');
});

test('a line in a box: from its left edge, centred on the slack halved down, or on its right edge', () => {
  const box = { x: 10, y: 4, w: 41 }, w = WT.width(18, false, '25');
  const x = (m) => Number(/ x="(-?\d+)"/.exec(m)[1]);
  assert.equal(x(WT.inBox(18, false, box, 'left', '#FFFFFF', '25')), 10);
  assert.equal(x(WT.inBox(18, false, box, 'center', '#FFFFFF', '25')), 10 + Math.floor((41 - w) / 2));
  assert.equal(x(WT.inBox(18, false, box, 'right', '#FFFFFF', '25')), 10 + 41 - w);
  assert.match(WT.inBox(18, false, box, 'right', '#FFFFFF', '25'), / y="22" /, 'the box\'s top, the height down');
});
