'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var TWIN = path.join(__dirname, '..', 'src', 'c', 'layers', 'status_row_aplite.c');
var PUBLIC_API = [
  ['StatusRow\\s*\\*', 'status_row_create'],
  ['void', 'status_row_destroy'],
  ['void', 'status_row_apply'],
  ['bool', 'status_row_refresh'],
  ['void', 'status_row_set_sleeping'],
  ['void', 'status_row_set_full_date'],
  ['bool', 'status_row_uses_live_health'],
  ['void', 'status_row_set_battery_override'],
  ['void', 'status_row_set_suppress_edges'],
  ['int16_t', 'status_row_right_slot_width'],
  ['void', 'status_row_draw']
];

test('aplite status row is a complete frozen lean twin', function() {
  assert.ok(fs.existsSync(TWIN),
    'src/c/layers/status_row_aplite.c must exist');

  var source = fs.readFileSync(TWIN, 'utf8');
  assert.match(source,
    /Lean aplite[^\n]*twin of status_row\.c[\s\S]*status_row\.c as of [0-9a-f]{7,40}/,
    'twin must record its base file and fork-point SHA');

  PUBLIC_API.forEach(function(entry) {
    var signature = new RegExp('^' + entry[0] + '\\s*' + entry[1] + '\\s*\\(', 'm');
    assert.match(source, signature, entry[1] + ' must implement status_row.h');
  });

  [
    'status_row_icons',
    'GDrawCommandImage',
    'gpath_',
    'status_row_layout',
    'StatusSlotMeasure',
    'PBL_HEALTH',
    'health_summary',
    'iso_week'
  ].forEach(function(forbidden) {
    assert.equal(source.indexOf(forbidden), -1,
      forbidden + ' does not belong in the frozen aplite twin');
  });
});
