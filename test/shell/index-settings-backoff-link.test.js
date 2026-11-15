// test/shell/index-settings-backoff-link.test.js
//
// End to end: the tick resends a NACKed settings message after 1, 2, 4, 8, 16, then every
// 30 minutes (channel-scheduler.js). When the link comes back, a weather ACK after a
// weather NACK (outbox.js setWeatherOutcomeListener) ends that wait, so settings saved
// during an outage reach the watch the minute after it answers again, not up to 30 min
// later. A watch that takes the weather but refuses only the settings keeps backing off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESS_NOW, HOUR, bootIndex, isWeatherMessage } = require('../helpers/index-harness.js');

const MIN = 60 * 1000;

/**
 * Boot with a refresh due at once (the hourly one is next due at 11:00, minute 40), save a
 * settings change at minute 1 and run 70 minutes, every send answered by `verdict`.
 *
 * @param {Object} t node:test context.
 * @param {function(string, number): string} verdict (kind, minute) -> 'ack' | 'nack'.
 * @returns {Array<{at: number, kind: string, ack: boolean}>} Every send, in order.
 */
function runOutage(t, verdict) {
  const sends = [];
  const h = bootIndex(t, {
    store: { lastFetchSuccess: JSON.stringify({ time: new Date(HARNESS_NOW - 2 * HOUR * 1000).toISOString() }) },
    onSend: (dict) => {
      const at = Math.round((Date.now() - HARNESS_NOW) / MIN);
      const kind = isWeatherMessage(dict) ? 'weather' : 'settings';
      const answer = verdict(kind, at);
      sends.push({ at, kind, ack: answer === 'ack' });
      return answer;
    }
  });
  h.start();
  h.minutes(1);
  h.saveSettings({ vibe: true });
  h.minutes(70);
  return sends;
}

/**
 * @param {Array<{at: number, kind: string, ack: boolean}>} sends What runOutage saw.
 * @param {number} after A minute.
 * @param {string} kind 'weather' or 'settings'.
 * @returns {?{at: number, kind: string, ack: boolean}} The first such send after `after`.
 */
function firstAfter(sends, after, kind) {
  return sends.find((s) => s.at > after && s.kind === kind) || null;
}

test('settings NACKed through an outage go out the minute after a weather message lands again', (t) => {
  // The link is down from minute 1 to minute 40: the settings resends back off to 30 min
  // (minute 32, then 62), and the 11:00 refresh NACKs at minute 40 and lands at minute 41.
  const sends = runOutage(t, (kind, at) => (at >= 1 && at <= 40 ? 'nack' : 'ack'));
  const landed = sends.find((s) => s.kind === 'weather' && s.ack && s.at > 1);
  assert.equal(landed.at, 41);
  assert.ok(sends.some((s) => s.kind === 'weather' && !s.ack && s.at === 40), 'the refresh NACKed first');
  assert.deepEqual(firstAfter(sends, 32, 'settings'), { at: 42, kind: 'settings', ack: true });
});

test('a watch that takes the weather but refuses the settings keeps backing off', (t) => {
  const sends = runOutage(t, (kind, at) => (kind === 'settings' && at >= 1 ? 'nack' : 'ack'));
  assert.ok(sends.some((s) => s.kind === 'weather' && s.ack && s.at === 40), 'the refresh lands');
  assert.deepEqual(sends.filter((s) => s.kind === 'settings' && s.at >= 1).map((s) => s.at),
    [1, 2, 4, 8, 16, 32, 62]);
});
