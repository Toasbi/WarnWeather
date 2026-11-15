// test/page/weather/condition-icons.test.js — the weather condition icons the settings page draws
// (src/pkjs/page/weather/condition-icons.js): one outline per condition glyph, in the page's icon
// family (status-slot-icons.js), with every stroke as wide as the family's however a part is
// scaled.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CI = require('../../../src/pkjs/page/weather/condition-icons.js');
const condition = require('../../../src/pkjs/weather/domain/condition.js');

const STROKE = 1.8;

test('every glyph the condition slot shows has an icon, and no icon is left over', () => {
  const glyphs = new Set();
  Object.values(condition.CONDITIONS).forEach((c) => c.glyph.forEach((g) => glyphs.add(g.replace(/^COND_/, ''))));
  assert.ok(glyphs.size >= 14, 'premise: every condition glyph');
  assert.deepEqual(CI.KEYS.slice().sort(), Array.from(glyphs).sort());
});

test('an icon is a 24-unit outline in the current colour, the family\'s', () => {
  CI.KEYS.forEach((k) => {
    const svg = CI.svg(k);
    assert.ok(svg.indexOf('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">') === 0, k);
    assert.ok(svg.endsWith(CI.body(k) + '</svg>'), k + ': its shapes inside');
    assert.equal(/#[0-9a-fA-F]{3,6}\b|crispEdges|fill="currentColor"/.test(svg), false, k + ': no colour of its own, no pixels');
  });
  assert.ok(CI.svg('RAIN', 24).indexOf('<svg viewBox="0 0 24 24" width="24" height="24" fill="none"') === 0,
    'a size gives it its width and height');
  assert.equal(CI.svg('NOPE'), '', 'nothing for no such glyph');
  assert.equal(CI.body('NOPE'), '');
});

test('a part drawn smaller keeps the family\'s stroke: its width times every scale it sits in is 1.8', () => {
  let checked = 0;
  CI.KEYS.forEach((k) => {
    // Walk the groups: each opens with its scale and width, and closes with </g>.
    const stack = [1];
    const re = /<g transform="translate\([^)]*\) scale\(([\d.]+)\)" stroke-width="([\d.]+)">|<\/g>/g;
    let m;
    while ((m = re.exec(CI.body(k)))) {
      if (m[0] === '</g>') { stack.pop(); continue; }
      const scale = stack[stack.length - 1] * Number(m[1]);
      stack.push(scale);
      assert.ok(Math.abs(Number(m[2]) * scale - STROKE) < 0.002, k + ': ' + m[0]);
      checked++;
    }
    assert.deepEqual(stack, [1], k + ': its groups close');
  });
  assert.equal(checked, 5, 'the peeking sun and moon: the whole fitted, the cloud and the moon drawn smaller');
});
