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

[BASE, APLITE].forEach(function(source) {
  test('top-status renderer resolves and draws the snooze indicator', function() {
    assert.match(source, /#include "top_status_indicators\.h"/);
    assert.match(source, /#include "c\/appendix\/snooze\.h"/);
    assert.match(source,
      /top_status_indicators_resolve\([\s\S]*persist_get_is_sleeping\(\)/);
    assert.match(source,
      /TOP_STATUS_INDICATOR_SNOOZE[\s\S]*snooze_draw\(/);
    assert.doesNotMatch(source, /ICON_SLOT_3/);
  });
});

test('color rain-alert collision uses the resolved indicator count', function() {
  assert.match(BASE, /icons_right[\s\S]*indicators\.count/);
});
