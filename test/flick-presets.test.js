// test/flick-presets.test.js
// The Layout tab's preset radio maps to the watch's three-slot view cycle
// (view_content[3] + view_reset_min) via clay-payload.js's LAYOUT_PRESETS map.
// Values mirror enum ViewContent in src/c/config.h: VC_OFF=0, VC_FORECAST_FULL=1,
// VC_FORECAST_COMPACT=2, VC_FORECAST_NONE=3, VC_RADAR=4, VC_HEALTH_STATUS=5.
const test = require('node:test');
const assert = require('node:assert/strict');

// holiday-mask → nager-source touches localStorage; install the mock before
// any watch module loads (see change-detector.test.js for the pattern).
global.localStorage = {
  getItem: function(k) { return null; },
  setItem: function(k, v) {},
  removeItem: function(k) {}
};

const { buildClayPayload } = require('../src/pkjs/clay-payload.js');

test('classic preset → compact default, radar first flick, none second', () => {
  const p = buildClayPayload({ layoutPreset: 'classic' }, null, new Date(0));
  assert.strictEqual(p.CLAY_VIEW_0, 2);   // VC_FORECAST_COMPACT
  assert.strictEqual(p.CLAY_VIEW_1, 4);   // VC_RADAR
  assert.strictEqual(p.CLAY_VIEW_2, 0);   // VC_OFF
});

test('radar-last preset → radar on the second flick', () => {
  const p = buildClayPayload({ layoutPreset: 'radarLast', healthMode: 'status' }, null, new Date(0));
  assert.strictEqual(p.CLAY_VIEW_1, 5);   // VC_HEALTH_STATUS first
  assert.strictEqual(p.CLAY_VIEW_2, 4);   // VC_RADAR second
});
