'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..');
var BASE = fs.readFileSync(
  path.join(ROOT, 'src/c/layers/top_status_layer.c'), 'utf8');
var APLITE = fs.readFileSync(
  path.join(ROOT, 'src/c/layers/top_status_layer_aplite.c'), 'utf8');

test('base top-status renderer owns and draws the snooze PDC', function() {
  assert.match(BASE, /#include "status_row_icons\.h"/);
  assert.doesNotMatch(BASE, /appendix\/snooze\.h|snooze_draw/);
  assert.match(BASE, /RESOURCE_ID_SNOOZE/);
  assert.match(BASE, /status_row_icons_load_resource/);
  assert.match(BASE,
    /TOP_STATUS_INDICATOR_SNOOZE[\s\S]*gdraw_command_image_draw/);
  assert.match(BASE,
    /top_status_layer_destroy[\s\S]*snooze_glyph_unload\(\)/);
});

// aplite still resolves the snooze indicator but renders it as cheap "zZ" text
// so --gc-sections reaps snooze.c from the frozen-lean image (ADR 0001).
test('aplite top-status resolves snooze but draws it as cheap text', function() {
  assert.match(APLITE, /#include "top_status_indicators\.h"/);
  assert.doesNotMatch(APLITE, /#include "c\/appendix\/snooze\.h"/);
  assert.match(APLITE,
    /top_status_indicators_resolve\([\s\S]*persist_get_is_sleeping\(\)/);
  assert.match(APLITE,
    /TOP_STATUS_INDICATOR_SNOOZE[\s\S]*graphics_draw_text/);
  assert.doesNotMatch(APLITE, /snooze_draw/);
  assert.doesNotMatch(APLITE, /ICON_SLOT_3/);
});

test('color rain-alert collision uses the resolved indicator count', function() {
  assert.match(BASE, /icons_right[\s\S]*indicators\.count/);
});
