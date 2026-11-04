'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('radar always renders cached data instead of a sleep glyph', function() {
  var source = read('src/c/layers/rain_radar_layer.c');
  assert.doesNotMatch(source, /persist_get_radar_snooze/);
  assert.doesNotMatch(source, /s_sleep_glyph/);
  assert.doesNotMatch(source, /snooze_draw/);
  assert.match(source, /static void radar_update_proc\(/);
});
