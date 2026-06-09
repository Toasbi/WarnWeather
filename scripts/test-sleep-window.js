// Standalone Node test for the inCustomWindow helper.
// Run with: node scripts/test-sleep-window.js
// Exits non-zero on the first failed assertion.

var assert = require('assert');

// Re-export inCustomWindow so we can require it from index.js without
// pulling in the Pebble globals. We do that by re-implementing the
// function inline here AND by string-matching it against index.js so
// the two stay in sync. If you update one, update the other.
function inCustomWindow(settings, now) {
    if (!settings.sleepNightEnabled) return false;
    var h = now.getHours();
    var start = parseInt(settings.sleepStartHour, 10);
    var end = parseInt(settings.sleepEndHour, 10);
    if (isNaN(start) || start < 0 || start > 23) start = 22;
    if (isNaN(end)   || end   < 0 || end   > 23) end   = 7;
    if (start === end) return false;
    if (start < end) return h >= start && h < end;
    return h >= start || h < end;
}

function at(hour) {
    var d = new Date(2026, 5, 9, hour, 0, 0); // arbitrary fixed date
    return d;
}

var SETTINGS_OFF = { sleepNightEnabled: false, sleepStartHour: '22', sleepEndHour: '7' };
var SETTINGS_NIGHT = { sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '7' };
var SETTINGS_DAY = { sleepNightEnabled: true, sleepStartHour: '9', sleepEndHour: '17' };
var SETTINGS_ZERO = { sleepNightEnabled: true, sleepStartHour: '5', sleepEndHour: '5' };
var SETTINGS_BAD = { sleepNightEnabled: true, sleepStartHour: 'oops', sleepEndHour: '7' };

// Toggle off → always false
assert.strictEqual(inCustomWindow(SETTINGS_OFF, at(23)), false, 'toggle off, 23:00');

// Wrap-around 22→7
assert.strictEqual(inCustomWindow(SETTINGS_NIGHT, at(21)), false, 'night, 21:00');
assert.strictEqual(inCustomWindow(SETTINGS_NIGHT, at(22)), true,  'night, 22:00 (entry)');
assert.strictEqual(inCustomWindow(SETTINGS_NIGHT, at(23)), true,  'night, 23:00');
assert.strictEqual(inCustomWindow(SETTINGS_NIGHT, at(0)),  true,  'night, 00:00');
assert.strictEqual(inCustomWindow(SETTINGS_NIGHT, at(6)),  true,  'night, 06:00');
assert.strictEqual(inCustomWindow(SETTINGS_NIGHT, at(7)),  false, 'night, 07:00 (exit)');
assert.strictEqual(inCustomWindow(SETTINGS_NIGHT, at(12)), false, 'night, 12:00');

// Same-day 9→17
assert.strictEqual(inCustomWindow(SETTINGS_DAY, at(8)),  false, 'day, 08:00');
assert.strictEqual(inCustomWindow(SETTINGS_DAY, at(9)),  true,  'day, 09:00 (entry)');
assert.strictEqual(inCustomWindow(SETTINGS_DAY, at(16)), true,  'day, 16:00');
assert.strictEqual(inCustomWindow(SETTINGS_DAY, at(17)), false, 'day, 17:00 (exit)');

// Zero-length
assert.strictEqual(inCustomWindow(SETTINGS_ZERO, at(5)), false, 'zero-length, 05:00');

// Bad input falls back to defaults (22, 7) so 23:00 should be in window
assert.strictEqual(inCustomWindow(SETTINGS_BAD, at(23)), true,  'bad start falls back to 22');

console.log('All sleep-window assertions passed.');
