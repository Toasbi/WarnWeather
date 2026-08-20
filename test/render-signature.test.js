'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/pkjs/status-line-catalog.js');
const thresholds = require('../src/pkjs/status-thresholds.js');

// renderSignature() is a private function in index.js (no module.exports there, and the
// module registers Pebble listeners at load time). Lift the REAL source of that one
// function out of index.js and evaluate it with its two module dependencies injected, so
// this suite exercises the shipped code rather than a copy of it.
const INDEX_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pkjs', 'index.js'), 'utf8');

/** @returns {function(Object): string} index.js's renderSignature, deps injected */
function loadRenderSignature() {
  const m = INDEX_SRC.match(/\nfunction renderSignature\(settings\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'renderSignature() not found in src/pkjs/index.js');
  return new Function('statusCatalog', 'statusThresholds', 'return ' + m[0].trim())(
    catalog, thresholds);
}

const renderSignature = loadRenderSignature();
const WEATHER_KINDS = thresholds.KINDS.slice(0, 4);   // aqi, pollen, wind, gust
const HEALTH_KINDS = thresholds.KINDS.slice(4);       // steps, sleep, distance

test('renderSignature is empty for falsy settings and stable for equal settings', () => {
  assert.equal(renderSignature(null), '');
  assert.equal(renderSignature({ windUnits: 'mph' }), renderSignature({ windUnits: 'mph' }));
  // Sanity that the lifted function is really the change detector: a known member changes it.
  assert.notEqual(renderSignature({ windUnits: 'mph' }), renderSignature({ windUnits: 'kph' }));
});

// tempSlotDisplay changes the phone-side temp-slot bake (formatValue), so per the
// force-fetch rule it must be part of the signature or switching Temp/Feels like/Both
// would not show until the next scheduled fetch.
test('tempSlotDisplay changes the render signature (forces a rebake)', () => {
  const base = renderSignature({});
  assert.notEqual(renderSignature({ tempSlotDisplay: 'feels' }), base);
  assert.notEqual(renderSignature({ tempSlotDisplay: 'both' }),
    renderSignature({ tempSlotDisplay: 'feels' }));
});

// The wind/gust direction arrows are baked phone-side into the slot text (a trailing
// sentinel byte appended in status-lines.js), so per the force-fetch rule both toggles
// must be part of the signature — otherwise the arrow appears only after the next
// scheduled fetch.
test('the wind-direction toggles change the render signature', () => {
  assert.notEqual(renderSignature({ windSlotDirection: false }),
    renderSignature({ windSlotDirection: true }));
  assert.notEqual(renderSignature({ gustSlotDirection: false }),
    renderSignature({ gustSlotDirection: true }));
  // The two are independent: flipping one must not read as flipping the other.
  assert.notEqual(renderSignature({ windSlotDirection: true }),
    renderSignature({ gustSlotDirection: true }));
});

// The six per-kind "Show unit" toggles decide whether the phone bakes the unit into the
// slot text at all, so the same force-fetch rule applies: without them in the signature
// a flip sits invisible until the next scheduled fetch. All six, not just the ones that
// ship off — a user turning kph OFF has exactly the same right to see it now.
const UNIT_KEYS = ['windSlotUnit', 'gustSlotUnit', 'pressureSlotUnit',
  'countdownSlotUnit', 'tempSlotUnit', 'dewSlotUnit'];

test('every Show unit toggle changes the render signature (forces a rebake)', () => {
  UNIT_KEYS.forEach((key) => {
    assert.notEqual(renderSignature({ [key]: false }), renderSignature({ [key]: true }),
      key + ' must be part of the render signature');
  });
});

test('the Show unit toggles are independent of each other', () => {
  // Each key must occupy its own position: flipping one may not read as flipping any
  // other (a single shared slot would make wind's unit hide the countdown's).
  const seen = UNIT_KEYS.map((key) => renderSignature({ [key]: true }));
  seen.forEach((sig, i) => seen.slice(i + 1).forEach((other, j) =>
    assert.notEqual(sig, other,
      UNIT_KEYS[i] + ' and ' + UNIT_KEYS[i + 1 + j] + ' share a signature slot')));
});

// The four weather kinds are evaluated phone-side at weather-bake time, so enabling one
// only reaches the watch through a refetch. Without these keys in the signature,
// shouldForceFetch stays false for a threshold-only edit and the user sees nothing until
// the next scheduled fetch (fetchIntervalMin, 15 min default — or after the night pause).
test('enabling a WEATHER-kind threshold changes the render signature (forces a refetch)', () => {
  WEATHER_KINDS.forEach(kind => {
    ['Warn', 'Danger'].forEach(which => {
      const key = 'thresh' + kind.key + which;
      const before = renderSignature({});
      const after = renderSignature({ [key]: '100' });
      assert.notEqual(after, before, key + ' must be part of the render signature');
      // And an edit of an already-set value counts too (raising warn re-bakes the levels).
      assert.notEqual(renderSignature({ [key]: '100' }), renderSignature({ [key]: '150' }),
        key + ' must react to a changed value, not merely to being present');
    });
  });
});

// Health thresholds are evaluated WATCH-side against the Clay-delivered blob, and the
// threshold colors are applied by the watch on its next paint: both are already immediate
// when the config closes, so dropping the weather caches for them would be pure waste.
test('health thresholds and threshold colors do NOT change the render signature', () => {
  const base = renderSignature({});
  HEALTH_KINDS.forEach(kind => {
    ['Warn', 'Danger'].forEach(which => {
      const key = 'thresh' + kind.key + which;
      assert.equal(renderSignature({ [key]: '5000' }), base,
        key + ' is watch-side evaluated — it must not force a weather refetch');
    });
  });
  thresholds.KINDS.forEach(kind => {
    ['WarnColor', 'DangerColor'].forEach(which => {
      const key = 'thresh' + kind.key + which;
      assert.equal(renderSignature({ [key]: 0x00FF00 }), base,
        key + ' rides the Clay message — it must not force a weather refetch');
    });
  });
});
