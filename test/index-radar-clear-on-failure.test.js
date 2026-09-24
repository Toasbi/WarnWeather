// test/index-radar-clear-on-failure.test.js
//
// A radar source that can never answer (tomorrow.io with no key or a rejected
// one) answers the radar CLEAR, so the watch drops its radar instead of rolling
// the last window forward into a made-up "No rain ahead". But that clear rides
// the weather send's extras, which only go out when the FORECAST succeeds — and
// with tomorrow.io as both the forecast and the radar source, the same missing
// key fails the forecast too. The clear died with it every cycle, so the watch
// never learned. onFetchFailure now sends a clear on its own.
//
// Boots the real index.js in a child process (see helpers/boot-radar-probe.js),
// answering the reverse geocode so the forecast half reaches its own verdict:
// tomorrow.io's missing-key failure.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROBE = path.join(__dirname, 'helpers', 'boot-radar-probe.js');

function probe(platform, opts) {
  return JSON.parse(execFileSync(process.execPath, [PROBE, platform, JSON.stringify(opts)],
    { encoding: 'utf8' }).trim());
}

const CLEAR = { start: 0, len: 0 };

/**
 * The boot handshake (WATCH_HAS_FORECAST_DATA: 0) queues a forced refetch behind the
 * startup fetch, and a forced fetch drops the outbox cache on purpose -- so within the
 * probe's window every failing cycle sends its clear. What must hold is that the
 * watch got a clear and never anything but one.
 * @param {Array<{start: number, len: number}>} sends The probe's radar sends.
 * @param {string} msg Assertion message.
 * @returns {void}
 */
function assertOnlyClears(sends, msg) {
  assert.ok(sends.length >= 1, msg + ': a clear went out');
  sends.forEach((s) => assert.deepEqual(s, CLEAR, msg + ': every radar send is the clear'));
}

test('REGRESSION: tomorrow.io as forecast AND radar source with no key still clears the watch radar', () => {
  const out = probe('basalt', {
    settings: { provider: 'tomorrowio', radarProvider: 'tomorrowio', tomorrowioApiKey: '' },
    answerXhr: true
  });
  assertOnlyClears(out.radarSends, 'the clear reaches the watch though the forecast failed');
  assert.equal(out.radarRequests, 0);
});

test('radar switched off with a failing forecast: the clear still goes out', () => {
  const out = probe('basalt', {
    settings: { provider: 'tomorrowio', radarMode: 'off', tomorrowioApiKey: '' },
    answerXhr: true
  });
  assertOnlyClears(out.radarSends, 'radar off');
});

test('control: a failing forecast does not forward a real radar window, only the clear', () => {
  // Rainbow answers a real (dry) window; the tomorrow.io forecast fails on its key.
  const out = probe('basalt', {
    settings: { provider: 'tomorrowio', radarProvider: 'rainbow', tomorrowioApiKey: '' },
    answerXhr: true
  });
  assert.ok(out.radarRequests >= 1, 'the radar half did run');
  assert.deepEqual(out.radarSends, [], 'no radar window rides a failed forecast');
});

// The radar's sky rows (radar-sky.js) ride the same merged answer, so their CLEAR
// died with a failed forecast too: turn 'Clouds, sun & lightning' off, let the
// forced fetch's forecast fail, and the watch kept drawing the rows.

/**
 * Every sky send is the clear (an empty RADAR_SKY_UINT8), and at least one went out.
 * @param {Array<{len: number}>} sends The probe's sky sends.
 * @param {string} msg Assertion message.
 * @returns {void}
 */
function assertOnlySkyClears(sends, msg) {
  assert.ok(sends.length >= 1, msg + ': a sky clear went out');
  sends.forEach((s) => assert.deepEqual(s, { len: 0 }, msg + ': every sky send is the clear'));
}

test('REGRESSION: the sky toggle off with a failing forecast still clears the watch\'s sky rows', () => {
  // Rainbow answers a real (dry) window, so the radar half is no clear to carry it.
  const out = probe('basalt', {
    settings: { provider: 'tomorrowio', radarProvider: 'rainbow', radarSky: false, tomorrowioApiKey: '' },
    answerXhr: true
  });
  assert.ok(out.radarRequests >= 1, 'the radar half did run');
  assertOnlySkyClears(out.skySends, 'sky off');
  assert.deepEqual(out.radarSends, [], 'still no radar window rides a failed forecast');
});

test('sky on with a failing forecast: no fresh sky rides it, with a real radar window or a radar clear', () => {
  ['rainbow', 'tomorrowio'].forEach((radarProvider) => {
    const out = probe('basalt', {
      settings: { provider: 'tomorrowio', radarProvider, radarSky: true, tomorrowioApiKey: '' },
      answerXhr: true
    });
    if (radarProvider === 'tomorrowio') {
      // A keyless tomorrow.io radar can never answer: no sky request goes out for rows
      // it could never draw (radarFactory.canAnswer), only the sky clear.
      assert.equal(out.skyRequests, 0, 'tomorrowio: no sky request for a radar that can never answer');
      assertOnlySkyClears(out.skySends, 'keyless radar');
    } else {
      assert.ok(out.skyRequests >= 1, radarProvider + ': the sky half did run');
      assert.deepEqual(out.skySends, [], radarProvider + ': no sky data rides a failed forecast');
    }
    if (radarProvider === 'tomorrowio') {
      // The keyless radar answers a clear, merged with this cycle's fresh sky:
      // only the three radar keys go out.
      assertOnlyClears(out.radarSends, 'radar clear beside a fresh sky');
    } else {
      assert.deepEqual(out.radarSends, [], 'no radar window rides a failed forecast');
    }
  });
});

test('radar switched off with a failing forecast: the radar clear and the sky clear both go out', () => {
  const out = probe('basalt', {
    settings: { provider: 'tomorrowio', radarMode: 'off', radarSky: true, tomorrowioApiKey: '' },
    answerXhr: true
  });
  assertOnlyClears(out.radarSends, 'radar off');
  assertOnlySkyClears(out.skySends, 'radar off');
  assert.equal(out.skyRequests, 0, 'the sky is not fetched without the radar graph');
});
