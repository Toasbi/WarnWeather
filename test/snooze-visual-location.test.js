'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('status rows have no global sleeping display state', function() {
  [
    'src/c/layers/status_row.h',
    'src/c/layers/status_row.c',
    'src/c/layers/status_row_aplite.c',
    'src/c/layers/weather_status_layer.c',
    'src/c/layers/health_status_layer.c'
  ].forEach(function(file) {
    var source = read(file);
    assert.doesNotMatch(source, /status_row_set_sleeping/);
    assert.doesNotMatch(source, /snooze_draw/);
  });
});

test('radar always renders cached data instead of a sleep glyph', function() {
  var source = read('src/c/layers/rain_radar_layer.c');
  assert.doesNotMatch(source, /persist_get_radar_snooze/);
  assert.doesNotMatch(source, /s_sleep_glyph/);
  assert.doesNotMatch(source, /snooze_draw/);
  assert.match(source, /static void radar_update_proc\(/);
});

test('obsolete frozen-weather classifier is removed', function() {
  assert.doesNotMatch(read('src/c/appendix/status_line.h'),
                      /status_slot_is_frozen_weather/);
  assert.doesNotMatch(read('src/c/appendix/status_line.c'),
                      /status_slot_is_frozen_weather/);
});

test('procedural snooze helper is removed and color snooze is confined to the top strip', function() {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/c/appendix/snooze.c')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/c/appendix/snooze.h')), false);
  assert.match(read('src/c/layers/top_status_layer.c'), /RESOURCE_ID_SNOOZE/);
  [
    'src/c/layers/status_row.c',
    'src/c/layers/status_row_aplite.c',
    'src/c/layers/rain_radar_layer.c'
  ].forEach(function(file) {
    assert.doesNotMatch(read(file), /RESOURCE_ID_SNOOZE|snooze_draw/);
  });
});

test('the frozen-lean aplite top strip draws snooze as cheap text (reaps snooze_draw)', function() {
  var aplite = read('src/c/layers/top_status_layer_aplite.c');
  assert.doesNotMatch(aplite, /snooze_draw/);
  assert.match(aplite, /TOP_STATUS_INDICATOR_SNOOZE[\s\S]*graphics_draw_text/);
});
