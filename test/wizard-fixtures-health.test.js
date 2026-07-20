// test/wizard-fixtures-health.test.js
// Guards that the emery wizard health shots represent the REAL emery experience:
// steps / sleep / hr. The baker fills unset slots from the catalog BASE defaults
// (statusHealthMid: 'empty'), NOT hrDefaults — so an emery fixture that pins only
// statusHealthRight: 'hr' bakes steps / EMPTY / hr, hiding sleep in the middle. The
// fixture must pin the full hr triple, mirroring what config hydrate persists on a
// real emery/diorite watch.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const wiz = require('../scripts/gen-wizard-fixtures.js');
const fw = require('../src/pkjs/fixture-weather.js');
const catalog = require('../src/pkjs/status-line-catalog.js');

const base = JSON.parse(fs.readFileSync(wiz.BASE_PATH, 'utf8'));

// Bake a shot's health line (STATUS_LINE_4) on emery and return the three slot kinds.
function bakeHealthKinds(shot) {
  const fixture = { name: shot.slug, weather: base.weather };
  const settings = Object.assign({}, base.claySettings, shot.clay);
  const payload = fw.getFixtureWeatherPayload(fixture, settings, { platform: 'emery' });
  const b = payload.STATUS_LINE_4_UINT8;
  const kinds = [];
  let off = 0;
  for (let i = 0; i < 3; i++) { kinds.push(b[off]); off += 3 + b[off + 2]; }
  return kinds;
}

test('emery wizard health shots bake steps / sleep / hr (middle slot shows sleep)', () => {
  const shots = wiz.SHOTS.filter(function (s) {
    return s.slug === 'health-status-emery' || s.slug === 'health-all-emery';
  });
  assert.equal(shots.length, 2, 'both emery health shots present');
  const K = catalog.KINDS;
  shots.forEach(function (s) {
    assert.deepEqual(bakeHealthKinds(s), [K.LIVE_STEPS, K.LIVE_SLEEP, K.LIVE_HR],
      s.slug + ' should bake steps/sleep/hr');
  });
});
