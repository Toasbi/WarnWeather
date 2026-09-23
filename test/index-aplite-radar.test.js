// test/index-aplite-radar.test.js
//
// aplite (Pebble Classic/Steel) compiles the rain radar out (no WW_RAIN_RADAR)
// and drops every RAIN_RADAR_* tuple, and its settings page hides the Radar tab.
// An install whose settings were never saved still holds the seeded defaults
// (radarMode 'graph', radarProvider 'rainbow'), so the phone used to spend a
// Rainbow proxy request — and the shared monthly budget — on every fetch cycle
// for a watch that throws the answer away. Boots the real index.js per platform
// in a child process (see helpers/boot-radar-probe.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROBE = path.join(__dirname, 'helpers', 'boot-radar-probe.js');

function probe(platform) {
  return JSON.parse(execFileSync(process.execPath, [PROBE, platform], { encoding: 'utf8' }).trim());
}

test('control: a radar-capable watch on defaults fetches the Rainbow radar on its first cycle', () => {
  // Proves the probe really reaches the radar fetch, so the aplite zero below means something.
  assert.equal(probe('basalt').radarRequests, 1);
  assert.equal(probe('diorite').radarRequests, 1, 'B/W alone is not the gate: diorite ships the radar');
});

test('aplite on defaults makes no radar request', () => {
  assert.equal(probe('aplite').radarRequests, 0);
});
