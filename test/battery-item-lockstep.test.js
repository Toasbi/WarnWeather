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
