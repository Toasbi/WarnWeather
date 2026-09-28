// test/index-config-close-rebake.test.js
//
// The status category (slot text, STATUS_LEVELS_UINT8, the Alerts row's
// ALERT_ENTRIES_UINT8) is baked phone-side, so an alert switch, a level or a Look
// used to reach the watch only through the save's forced fetch. When that fetch
// failed (offline, a provider error, an auth backoff) a switched-off alert kept
// its icon on the watch, and a Clay-only save (the 'Alert highlighting' switch)
// forced no fetch at all. Every config close now re-bakes the status category
// from the last payload against the settings just saved, chained between the
// Clay send and the forced fetch on the half-duplex channel.
//
// Boots the REAL index.js (helpers/index-harness.js): one healthy fetch bakes a
// UV of 9 (danger on the 6/8 seed pair), then the network goes down or hangs and
// the settings page closes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESS_NOW, bootIndex, healthyNetwork, isWeatherMessage } = require('./helpers/index-harness.js');
const KEYS = require('../src/pkjs/storage-keys.js');

const HOUR = 3600;
const FETCHING = /^Fetching from /;
const FETCHED = /Successfully fetched weather/;
// The UV kind's wire id (its index in status-thresholds' KINDS) and a danger
// entry's header byte: kind | level 2 << 3, no value text.
const UV_KIND = 7;
const UV_DANGER_ENTRY = UV_KIND | (2 << 3);

/**
 * Open-Meteo's GFS UV answer: `uv` every hour around now.
 *
 * @param {number} uv UV index.
 * @returns {Object} Response body.
 */
function uvBody(uv) {
  const base = Math.floor(Date.now() / 1000 / HOUR) * HOUR - HOUR;
  const time = [];
  const uvIndex = [];
  for (let i = 0; i < 96; i += 1) {
    time.push(base + i * HOUR);
    uvIndex.push(uv);
  }
  return { hourly: { time: time, uv_index: uvIndex } };
}

/**
 * A network whose health the test switches: 'up' (the harness's healthy
 * network plus a UV of 9), 'down' (every request fails) or 'hang' (no request
 * ever answers).
 *
 * @returns {{mode: string, network: Function}} Switch + network function.
 */
function switchableNetwork() {
  const net = { mode: 'up' };
  net.network = function (url) {
    if (net.mode === 'down') { return { status: 503, body: '' }; }
    if (net.mode === 'hang') { return 'hang'; }
    if (url.indexOf('hourly=uv_index') !== -1) { return { status: 200, body: uvBody(9) }; }
    return healthyNetwork(url);
  };
  return net;
}

/**
 * Boot with a stale success, so the first tick fetches, and let that fetch
 * land and bake.
 *
 * @param {Object} t node:test context.
 * @param {Object} settings Settings merged over the harness base.
 * @param {Object} [opts] Extra bootIndex options (onSend).
 * @returns {{h: Object, net: Object}} The harness and the network switch.
 */
function bootBaked(t, settings, opts) {
  const net = switchableNetwork();
  const h = bootIndex(t, Object.assign({
    settings: settings,
    network: net.network,
    store: { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR * 1000).toISOString() }) },
  }, opts || {}));
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHED), 1, 'the boot fetch baked');
  return { h: h, net: net };
}

/** @returns {Object[]} The status-carrying weather sends, oldest first. */
function statusSends(h) {
  return h.weatherSends().filter((d) => 'ALERT_ENTRIES_UINT8' in d);
}

/** @returns {number} The UV cell (bits 8-9) of a STATUS_LEVELS_UINT8 word. */
function uvLevel(levels) {
  return levels[1] & 3;
}

test('an alert switched off reaches the watch even when the forced fetch fails', (t) => {
  const { h, net } = bootBaked(t, { alertUv: true });
  const baked = statusSends(h);
  assert.deepEqual(Array.from(baked[baked.length - 1].ALERT_ENTRIES_UINT8), [UV_DANGER_ENTRY],
    'the UV alert is on the watch');

  net.mode = 'down';
  const before = h.sends.length;
  h.saveSettings({ alertUv: false });
  h.advance(5 * 1000);

  assert.equal(h.count(FETCHING), 2, 'the save forced a fetch...');
  assert.equal(h.count(FETCHED), 1, '...and it failed');
  const after = statusSends(h).filter((d) => h.sends.indexOf(d) >= before);
  assert.equal(after.length, 1, 'one status send, from the re-bake');
  assert.deepEqual(Array.from(after[0].ALERT_ENTRIES_UINT8), [], 'no UV entry left');
  assert.equal(h.uncaught.length, 0);
});

test('a level moved across the current value re-bakes levels and entries without the network', (t) => {
  const { h, net } = bootBaked(t, { alertUv: true });
  const baked = statusSends(h);
  assert.equal(uvLevel(baked[baked.length - 1].STATUS_LEVELS_UINT8), 2, 'UV 9 is danger on 6/8');

  net.mode = 'hang';
  const before = h.sends.length;
  const requestsBefore = h.requests.length;
  h.saveSettings({ threshUvWarn: '10', threshUvDanger: '11' });
  h.advance(5 * 1000);

  const after = statusSends(h).filter((d) => h.sends.indexOf(d) >= before);
  assert.equal(after.length, 1, 'the re-bake sent the status category');
  assert.equal(uvLevel(after[0].STATUS_LEVELS_UINT8), 0, 'UV 9 is below the new warn');
  assert.deepEqual(Array.from(after[0].ALERT_ENTRIES_UINT8), [], 'and no longer alerts');
  assert.ok(h.requests.length > requestsBefore, 'the forced fetch is out on the network...');
  assert.equal(h.count(FETCHED), 1, '...and has not answered: the re-bake did not wait for it');
});

test('upgrade: a Clay-only highlight switch re-bakes a level word an older build packed', (t) => {
  // 1.23 packed no level for a kind whose highlight was off, so the watch holds
  // UV's cell at 0. The switch is Clay-only (it joins no render signature, so it
  // forces no fetch); without the re-bake the box stayed off until the next
  // scheduled fetch.
  const { h } = bootBaked(t, { threshUvOn: false });
  const cached = JSON.parse(h.store[KEYS.LAST_SENT_STATUS_KEY]);
  cached.STATUS_LEVELS_UINT8 = [0, 0];      // the watch's 1.23-packed word
  delete cached.ALERT_ENTRIES_UINT8;        // a tuple 1.23 never sent
  h.store[KEYS.LAST_SENT_STATUS_KEY] = JSON.stringify(cached);

  const before = h.sends.length;
  h.saveSettings({ threshUvOn: true });
  h.advance(5 * 1000);

  assert.equal(h.count(FETCHING), 1, 'a Clay-only save forces no fetch');
  const clay = h.sends.slice(before).filter((d) => !isWeatherMessage(d));
  assert.equal(clay.length, 1, 'the Clay send carries the enable bit');
  const after = statusSends(h).filter((d) => h.sends.indexOf(d) >= before);
  assert.equal(after.length, 1, 'and the re-bake follows it');
  assert.equal(uvLevel(after[0].STATUS_LEVELS_UINT8), 2, 'the watch gets UV\'s danger level at once');
});

test('Clay, re-bake and fetch never share the channel: each waits for the one before', (t) => {
  let hold = false;
  const { h } = bootBaked(t, { alertUv: true }, {
    onSend: () => (hold ? 'hold' : 'ack'),
  });
  hold = true;
  const before = h.sends.length;
  const fetchesBefore = h.count(FETCHING);
  // The switch forces the fetch; the Alerts placement rides the Clay blob, so
  // the Clay send is a real one too.
  h.saveSettings({ alertUv: false, statusForecastAlerts: 'left' });
  h.advance(5 * 1000);
  assert.equal(h.sends.length - before, 1, 'only the Clay is on the channel');
  assert.equal(isWeatherMessage(h.held[0].dict), false, 'and it is the Clay');

  h.held[0].ack({});
  h.advance(5 * 1000);
  assert.equal(h.sends.length - before, 2, 'the ACK let exactly one more send out');
  assert.ok('ALERT_ENTRIES_UINT8' in h.held[1].dict, 'the status re-bake');
  assert.equal(h.count(FETCHING), fetchesBefore, 'no fetch while the re-bake is in flight');

  h.held[1].ack({});
  h.advance(5 * 1000);
  assert.equal(h.count(FETCHING), fetchesBefore + 1, 'its ACK started the forced fetch');
  assert.equal(h.held.length, 3, 'whose own send came last');
  assert.ok('FORECAST_START' in h.held[2].dict, 'the fetch\'s weather send');
  assert.equal(h.uncaught.length, 0);
});

test('a NACKed config-close Clay is re-delivered by the next minute tick', (t) => {
  // The Clay NACKs (a collision, a Bluetooth hiccup) but the forced fetch after
  // it still lands, so without a retry the watch ran the new alert entries
  // against the old thresholds blob until the next midnight or the next save.
  let nackClay = false;
  const { h } = bootBaked(t, {}, {
    onSend: (d) => (nackClay && !isWeatherMessage(d) ? 'nack' : 'ack'),
  });
  nackClay = true;
  const before = h.sends.length;
  const clay = () => h.sends.slice(before).filter((d) => !isWeatherMessage(d));
  h.saveSettings({ alertWind: true, statusForecastAlerts: 'left' });
  h.advance(5 * 1000);
  nackClay = false;
  assert.equal(clay().length, 1, 'the close sent Clay once, and it NACKed');
  assert.equal(h.count(FETCHED), 2, 'the forced fetch still landed');

  h.minutes(1);
  assert.equal(clay().length, 2, 'the next tick re-delivered the settings');
  assert.deepEqual(clay()[1].CLAY_THRESHOLDS_UINT8, clay()[0].CLAY_THRESHOLDS_UINT8,
    'the same blob, with the new Alerts placement');
  h.minutes(2);
  assert.equal(clay().length, 2, 'its ACK ended the retries');
});
