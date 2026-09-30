'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..');
var SLOT = fs.readFileSync(path.join(ROOT, 'src/c/layers/battery_draw.c'), 'utf8');
var ITEM = fs.readFileSync(path.join(ROOT, 'src/c/layers/battery_item.c'), 'utf8');

/**
 * The body of the static C function `name` in `src`, with its whitespace collapsed:
 * from the brace after `name(` to the closing brace on its own line.
 * @param {string} src C source text.
 * @param {string} name Function name.
 * @returns {string} The body, or '' when the function is not found.
 */
function body(src, name) {
  var m = new RegExp('static GColor ' + name + '\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}').exec(src);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

// The On demand Battery item (battery_item.c) draws the Watch battery slot's colour
// code and its 0 % sliver. battery_draw.c stays untouched (it has an aplite twin), so
// the item carries a copy: a low charge must read the same in the slot and the item.
test('the Battery item fills like the Watch battery slot', function() {
  var slot = body(SLOT, 'battery_fill_color');
  var item = body(ITEM, 'fill_color');
  assert.notEqual(slot, '', 'battery_draw.c battery_fill_color found');
  assert.equal(item, slot);
  assert.match(SLOT, /\(level \+ 10\) \/ 110/);
  assert.match(ITEM, /\(level \+ 10\) \/ 110/);
});

/**
 * The integer a C `#define NAME <int>` gives in `src`.
 * @param {string} src C source text.
 * @param {string} name Macro name.
 * @returns {number} Its value, or NaN when it is not defined as a plain integer.
 */
function define(src, name) {
  var m = new RegExp('#define ' + name + '\\s+(\\d+)\\b').exec(src);
  return m ? Number(m[1]) : NaN;
}

// The Watch battery slot's short form (On demand) is the glyph without its bolt lane,
// which battery_draw.c puts in front of the body: the charging icon and its spacing.
// status_row.c draws the short glyph that far to the left, so the lane the short form
// drops must be exactly the one the glyph leaves empty while not charging.
test('the short Watch battery drops exactly the glyph\'s bolt lane', function() {
  var SHORT = fs.readFileSync(path.join(ROOT, 'src/c/appendix/status_short_text.h'), 'utf8');
  var lane = define(SLOT, 'BATTERY_POWER_ICON_W') + define(SLOT, 'ICON_SPACING');
  assert.ok(lane > 0, 'battery_draw.c lane found');
  assert.equal(define(SHORT, 'STATUS_SHORT_BATTERY_LANE_W'), lane);
  assert.match(SLOT, /int battery_x = BATTERY_POWER_ICON_W \+ ICON_SPACING;/);
});
