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
