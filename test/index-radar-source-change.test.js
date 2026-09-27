// test/index-radar-source-change.test.js
//
// Rainbow's "Use your own key" switch changes which radar source runs (radar-source-id.js:
// 'rainbow' <-> 'rainbowkey') without touching the stored radarProvider. Closing the
// settings page has to see that as a radar change and fetch at once (index.js ->
// config-close.js radarProviderChanged), exactly as picking another radar does — else the
// watch keeps the other source's window until the next scheduled refresh.
const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESS_NOW, bootIndex } = require('./helpers/index-harness.js');

const MIN = 60 * 1000;
const FETCHING = /^Fetching from /;

/**
 * Boot on a fresh success (so no scheduled fetch runs) with the radar on.
 * @param {Object} t node:test context.
 * @param {Object} settings Radar settings merged over the harness base.
 * @returns {Object} The index harness, booted and settled.
 */
function bootFresh(t, settings) {
  const h = bootIndex(t, {
    settings: Object.assign({ radarMode: 'graph', rainbowApiKey: 'K' }, settings),
    store: { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - MIN).toISOString() }) },
  });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 0, 'a fresh success: the boot does not fetch');
  return h;
}

test('switching "Use your own key" on and off again fetches straight away each time', (t) => {
  const h = bootFresh(t, { radarProvider: 'rainbow', rainbowOwnKey: false });
  h.saveSettings({ rainbowOwnKey: true });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1, 'on: the radar moved to the own-key source');
  h.saveSettings({ rainbowOwnKey: false });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 2, 'off: back on the shared radar');
});

test('a save that leaves the radar source alone does not fetch', (t) => {
  const h = bootFresh(t, { radarProvider: 'rainbow', rainbowOwnKey: true });
  h.saveSettings({});
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 0, 'nothing changed');
});

test('the switch left on under another radar source changes nothing, so no fetch', (t) => {
  // Only Rainbow reads the switch: under DWD it is not the radar source.
  const h = bootFresh(t, { radarProvider: 'dwd', rainbowOwnKey: false });
  h.saveSettings({ rainbowOwnKey: true });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 0, 'DWD stays DWD');
});

test('picking Rainbow with the switch already on fetches, like any radar switch', (t) => {
  const h = bootFresh(t, { radarProvider: 'dwd', rainbowOwnKey: true });
  h.saveSettings({ radarProvider: 'rainbow' });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1);
});
