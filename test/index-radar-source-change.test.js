// test/index-radar-source-change.test.js
//
// Picking "Rainbow (own key)" or "Rainbow (limited)" changes radarProvider ('rainbowkey' <->
// 'rainbow'), which changes which radar source runs. Closing the settings page has to see
// that as a radar change and fetch at once (index.js -> config-close.js
// radarProviderChanged), exactly as picking another radar does — else the watch keeps the
// other source's window until the next scheduled refresh.
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

test('picking "Rainbow (own key)" and back to "Rainbow (limited)" fetches straight away each time', (t) => {
  const h = bootFresh(t, { radarProvider: 'rainbow' });
  h.saveSettings({ radarProvider: 'rainbowkey' });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1, 'own key: the radar moved to the own-key source');
  h.saveSettings({ radarProvider: 'rainbow' });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 2, 'limited: back on the shared radar');
});

test('a save that leaves the radar source alone does not fetch', (t) => {
  const h = bootFresh(t, { radarProvider: 'rainbowkey' });
  h.saveSettings({});
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 0, 'nothing changed');
});

test('a 1.23.2 install on its own key boots onto "Rainbow (own key)", and its first save changes nothing', (t) => {
  // The boot's migrations store the pair as the source it ran; the page then saves that.
  const h = bootFresh(t, { radarProvider: 'rainbow', rainbowOwnKey: true });
  const stored = JSON.parse(h.store['clay-settings']);
  assert.equal(stored.radarProvider, 'rainbowkey');
  assert.ok(!('rainbowOwnKey' in stored), 'the switch is gone from the blob');
  h.saveSettings({});
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 0, 'the same source as before the upgrade: no fetch');
});

test('picking "Rainbow (own key)" from another radar fetches, like any change of radar', (t) => {
  const h = bootFresh(t, { radarProvider: 'dwd' });
  h.saveSettings({ radarProvider: 'rainbowkey' });
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), 1);
});
