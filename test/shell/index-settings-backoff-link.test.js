// test/shell/index-settings-backoff-link.test.js
//
// End to end: the tick resends a NACKed settings message after 1, 2, then every 4 minutes
// (channel-scheduler.js). PKJS has no sign that an unreachable watch is back, so that cap
// is what bounds the wait: settings saved during an outage reach the watch at most 4
// minutes after it answers again, whether or not a weather message went out meanwhile. A
// watch that refuses the settings is asked every 4 minutes, not every minute.
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

test('settings NACKed through a quiet outage reach the watch within four minutes of its return', (t) => {
  // The link is down from minute 1 to minute 20 and no weather message is due in it (the
  // hourly refresh is next due at minute 40): the settings resends NACK at 2, 4, 8, 12, 16
  // and 20, and the one at 24, three minutes after the link is back, lands.
  const sends = runOutage(t, (kind, at) => (at >= 1 && at <= 20 ? 'nack' : 'ack'));
  assert.ok(!sends.some((s) => s.kind === 'weather' && s.at >= 1 && s.at <= 20),
    'no weather message in the outage');
  assert.deepEqual(sends.filter((s) => s.kind === 'settings' && s.at >= 1 && s.at <= 20).map((s) => s.at),
    [1, 2, 4, 8, 12, 16, 20]);
  assert.deepEqual(firstAfter(sends, 20, 'settings'), { at: 24, kind: 'settings', ack: true });
});

test('a watch that takes the weather but refuses the settings is asked every 4 minutes', (t) => {
  const sends = runOutage(t, (kind, at) => (kind === 'settings' && at >= 1 ? 'nack' : 'ack'));
  assert.ok(sends.some((s) => s.kind === 'weather' && s.ack && s.at === 40), 'the refresh lands');
  const every4 = [];
  for (let at = 8; at <= 68; at += 4) { every4.push(at); }
  assert.deepEqual(sends.filter((s) => s.kind === 'settings' && s.at >= 1).map((s) => s.at),
    [1, 2, 4].concat(every4));
});
