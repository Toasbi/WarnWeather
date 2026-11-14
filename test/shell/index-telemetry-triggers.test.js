// test/shell/index-telemetry-triggers.test.js
// The settings-page telemetry triggers (telemetry.js onSettingsSaved and
// onSettingsOpened) count for nothing unless index.js calls them: the Save from
// webviewclosed, the open from showConfiguration. test/telemetry/adapter/telemetry.test.js covers the
// client's rules; this boots the REAL index.js and reads the batches off the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { HARNESS_NOW, bootIndex, healthyNetwork } = require('../helpers/index-harness.js');
const { TELEMETRY_REPORTED_KEY } = require('../../src/pkjs/settings/adapter/storage-keys.js');

const HOUR_MS = 60 * 60 * 1000;
const INGEST = 'https://ingest.test/functions/v1/telemetry-ingest';

/**
 * Boot with telemetry on (a local package.json carries no endpoint) and let the
 * boot fetch queue its event.
 *
 * @param {Object} t node:test context.
 * @param {Object} [store] Extra localStorage entries.
 * @returns {Object} Harness handles.
 */
function boot(t, store) {
  const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));
  const prev = pkg.telemetry;
  pkg.telemetry = { enabled: true, endpoint: INGEST };
  t.after(() => { pkg.telemetry = prev; });
  const h = bootIndex(t, {
    store: Object.assign({
      lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR_MS).toISOString() }),
    }, store || {}),
    network: (url) => (url === INGEST ? { status: 202, body: '{"ok":true}' } : healthyNetwork(url)),
  });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(/Successfully fetched weather/), 1, 'the boot fetch completed');
  return h;
}

/**
 * The telemetry batches posted so far.
 *
 * @param {Object} h Harness handles.
 * @returns {Object[]} Parsed batch bodies.
 */
function batches(h) {
  return h.requests.filter((r) => r.url === INGEST).map((r) => JSON.parse(r.body));
}

test('a new install is counted on its first Save, not on opening the settings', (t) => {
  const h = boot(t);
  assert.equal(batches(h).length, 0, 'one queued fetch is below both batch triggers');
  h.listeners.showConfiguration({});
  assert.equal(batches(h).length, 0, 'the open sends nothing before the first report');
  h.saveSettings({ startOnWeatherTab: true });
  const sent = batches(h);
  assert.equal(sent.length, 1, 'the Save sent the queue');
  assert.equal(sent[0].events.length, 1);
  assert.equal(sent[0].settings.startOnWeatherTab, true, 'headed by the saved settings');
  assert.equal(sent[0].watchInfo.platform, 'basalt');
  h.advance(1000);   // the ingest's 202
  assert.equal(h.store[TELEMETRY_REPORTED_KEY], '1');
  assert.equal(h.uncaught.length, 0);
});

test('turning telemetry off on that Save sends nothing', (t) => {
  const h = boot(t);
  h.saveSettings({ telemetryEnabled: false });
  assert.equal(batches(h).length, 0);
});

test('once reported, the first settings open of a UTC day sends the queue', (t) => {
  const h = boot(t, { [TELEMETRY_REPORTED_KEY]: '1' });
  h.listeners.showConfiguration({});
  const sent = batches(h);
  assert.equal(sent.length, 1, 'the open sent the queued fetch');
  assert.equal(sent[0].settings.fetchIntervalMin, 60, 'headed by the stored settings');
  h.advance(1000);
  h.minutes(61);   // the next hourly fetch queues another event
  assert.equal(h.count(/Successfully fetched weather/), 2);
  h.listeners.showConfiguration({});
  assert.equal(batches(h).length, 1, 'the second open that day sends nothing');
  assert.equal(h.uncaught.length, 0);
});
