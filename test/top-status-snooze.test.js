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

// Off aplite Quiet time, Bluetooth and Sleep are On demand items the row draws
// (status_on_demand.c, the compiled defaults put them on the strip's left): the base
// strip resolves no fixed indicators any more, loads no indicator bitmap and carves
// no room for one — its content rect is the quiet strip's at all times.
test('the base strip keeps no fixed indicators; the Sleep item draws the Z\'s', function() {
  assert.doesNotMatch(BASE, /top_status_indicators/);
  assert.doesNotMatch(BASE, /snooze/);
  assert.doesNotMatch(BASE, /RESOURCE_ID_IMAGE_(MUTE|BT_CONNECT|BT_DISCONNECT)/);
  assert.doesNotMatch(BASE, /ICON_SLOT_|s_last_qt_active|update_battery_override/);
  var items = fs.readFileSync(path.join(ROOT, 'src/c/layers/status_on_demand.c'), 'utf8');
  assert.match(items, /#include "\.\.\/appendix\/snooze\.h"/);
  assert.match(items, /s->active\[OD_SLEEP\] = persist_get_is_sleeping\(\)/);
  assert.match(items, /OD_SLEEP[\s\S]*snooze_draw\(/);
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

// The strip's rain text takeover is gone: the rain alert is an On demand item
// (status_row.c), so the strip has one paint path and no longer resolves the
// countdown itself.
test('the strip has one paint path and no rain takeover', function() {
  assert.doesNotMatch(BASE, /rain_countdown_get/);
  // The pattern names a live symbol, so the check above cannot pass vacuously.
  var items = fs.readFileSync(path.join(ROOT, 'src/c/layers/status_on_demand.c'), 'utf8');
  assert.match(items, /rain_countdown_get\(/);
  assert.doesNotMatch(BASE, /status_row_set_suppress_edges|status_row_right_slot_width/);
  assert.doesNotMatch(BASE, /draw_indicators|s_rain_alert|rain_glyph/);
  var proc = BASE.slice(BASE.indexOf('static void top_status_update_proc'),
    BASE.indexOf('void top_status_layer_create'));
  assert.equal(proc.split('status_row_draw(').length - 1, 1, 'one row paint');
  // The countdown's segment cache is primed at boot, before the window loads, so every
  // bar's first refresh finds it; the strip's create no longer does it.
  assert.doesNotMatch(BASE, /rain_countdown/);
  var boot = fs.readFileSync(path.join(ROOT, 'src/c/watchface.c'), 'utf8');
  var init = boot.slice(boot.indexOf('static void init'), boot.indexOf('static void deinit'));
  var prime = init.indexOf('rain_countdown_refresh(watch_services_now())');
  assert.ok(prime >= 0, 'init primes the countdown');
  assert.ok(prime < init.indexOf('main_window_create()'), 'before the window loads');
});
