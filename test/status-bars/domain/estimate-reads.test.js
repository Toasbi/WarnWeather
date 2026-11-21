'use strict';
// When Muninn's estimate of the days the watch has left is read again (estimate-reads.js):
// the rule, and what it adds up to over days of Muninn's wakeups. The reading itself, and the
// starts, ticks and saves that ask, are battery-estimate.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const reads = require('../../../src/pkjs/status-bars/domain/estimate-reads.js');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 21, 9, 0, 0);

/** An answered read at `at` that heard an estimate Muninn made at `made` (null: no time). */
function heard(at, made) {
  return { at: at, failures: 0, made: made };
}

/**
 * Read by the rule for `days` days, every read answered with Muninn's latest estimate.
 * @param {function(number): ?number} latest When Muninn made its latest estimate by an
 *   instant, or null for none.
 * @param {number} start The first read, in epoch milliseconds.
 * @param {number} days How long to read for.
 * @returns {Array<{at: number, made: ?number}>} Each read, and when the estimate it heard was made.
 */
function run(latest, start, days) {
  const out = [];
  let at = start;
  while (at < start + days * DAY) {
    const made = latest(at);
    out.push({ at: at, made: made });
    at = reads.nextReadAt(heard(at, made));
  }
  return out;
}

/**
 * Muninn's estimates: one at each of its wakeups, every 6 hours from `first`, the k-th
 * `late(k)` after the hour, and any `extra` ones (the user opening Muninn).
 * @param {number} first Its first wakeup.
 * @param {function(number): number} late How late its k-th wakeup's estimate lands.
 * @param {function(number): boolean} [made] Whether the k-th wakeup makes one (default: all).
 * @param {number[]} [extra] More estimates, made when the user opened Muninn.
 * @returns {function(number): ?number} The time of its latest estimate by an instant.
 */
function muninn(first, late, made, extra) {
  return (t) => {
    let best = null;
    for (let k = Math.floor((t - first) / (6 * HOUR)) + 1; k >= 0; k -= 1) {
      const at = first + k * 6 * HOUR + late(k);
      if (at <= t && (!made || made(k))) { best = at; break; }
    }
    (extra || []).forEach((e) => { if (e <= t && (best === null || e > best)) { best = e; } });
    return best;
  };
}

/** Up to ten minutes late, differently each time (as collisions with other apps make it). */
const JITTER = (k) => ((k * 7919) % 11) * MIN;

test('the rhythm: every 6 hours, read 20 minutes after; 12 hours with none to follow; retries from an hour', () => {
  assert.equal(reads.PERIOD_MS, 6 * HOUR);
  assert.equal(reads.SETTLE_MS, 20 * MIN);
  assert.equal(reads.IDLE_INTERVAL_MS, 12 * HOUR);
  assert.equal(reads.RETRY_MS, HOUR);
  assert.equal(reads.STALE_MS, batteryDays.MAX_AGE_MS, 'as old as an estimate the slot still shows');
});

test('when Muninn made an estimate: its plugin\'s updatedAt, while it is a time', () => {
  assert.equal(reads.madeOf(T0), T0);
  [-1, 0, NaN, Infinity, null, undefined, String(T0)].forEach((v) =>
    assert.equal(reads.madeOf(v), null, String(v)));
});

test('a record is a time after 1970, a whole count of failed reads, and when Muninn made what it heard', () => {
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: T0 - HOUR }), { at: T0, failures: 0, made: T0 - HOUR });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 3, made: null }), { at: T0, failures: 3, made: null });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0 }), { at: T0, failures: 0, made: null },
    'one kept before the time was: no time');
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: 'x' }), { at: T0, failures: 0, made: null });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: -1, extra: 1 }), { at: T0, failures: 0, made: null },
    'only its three fields');
  [null, undefined, 5, 'x', true, [], {}, { at: T0 }, { failures: 0 },
    { at: 0, failures: 0 }, { at: -1, failures: 0 }, { at: NaN, failures: 0 }, { at: Infinity, failures: 0 },
    { at: String(T0), failures: 0 }, { at: T0, failures: -1 }, { at: T0, failures: 1.5 },
    { at: T0, failures: '1' }, { at: T0, failures: Infinity }, { at: T0, failures: null }]
    .forEach((value) => assert.equal(reads.recordOf(value), null, JSON.stringify(value)));
});

test('an answer is read again 20 minutes after Muninn\'s next estimate is due, 6 hours after the one heard', () => {
  assert.equal(reads.nextReadAt(heard(T0, T0 - 5 * MIN)), T0 - 5 * MIN + 6 * HOUR + 20 * MIN);
  assert.equal(reads.nextReadAt(heard(T0, T0)), T0 + 6 * HOUR + 20 * MIN, 'made as it was read');
  assert.equal(reads.nextReadAt(heard(T0, T0 - 5 * HOUR)), T0 + HOUR + 20 * MIN, 'heard late: the next is sooner');
  assert.equal(reads.nextReadAt(heard(T0, T0 - 6 * HOUR)), T0 + 20 * MIN, 'the next is due now');
});

test('a read before the next estimate has landed leaves it its read; one after reads the one after', () => {
  // Muninn's next was due 5 minutes ago, and the read heard the one before: a late wakeup.
  assert.equal(reads.nextReadAt(heard(T0, T0 - 6 * HOUR - 5 * MIN)), T0 + 15 * MIN);
  assert.equal(reads.nextReadAt(heard(T0, T0 - 6 * HOUR - 20 * MIN + 1)), T0 + 1, 'up to its own time');
  // Its time has passed: that wakeup made none.
  assert.equal(reads.nextReadAt(heard(T0, T0 - 6 * HOUR - 20 * MIN)), T0 + 6 * HOUR);
  assert.equal(reads.nextReadAt(heard(T0, T0 - 13 * HOUR)), T0 + 5 * HOUR + 20 * MIN, 'two missed: the third');
});

test('no time heard, one more than a day before the read, or one far ahead of it: read 12 hours later', () => {
  assert.equal(reads.nextReadAt(heard(T0, null)), T0 + 12 * HOUR, 'no Muninn, or none made yet');
  assert.equal(reads.nextReadAt(heard(T0, T0 - DAY - 1)), T0 + 12 * HOUR, 'Muninn has stopped');
  assert.equal(reads.nextReadAt(heard(T0, T0 - DAY)), T0 + 20 * MIN, 'a day old: still its rhythm');
  assert.equal(reads.nextReadAt(heard(T0, T0 + 20 * MIN + 1)), T0 + 12 * HOUR, 'ahead: the clock went back');
  assert.equal(reads.nextReadAt(heard(T0, T0 + 20 * MIN)), T0 + 6 * HOUR + 40 * MIN,
    'a little ahead (the clock stepped back): still its rhythm');
});

test('a failed read is tried again an hour later, then 2, 4 and 8 hours, then every 12', () => {
  [[1, 1], [2, 2], [3, 4], [4, 8], [5, 12], [6, 12], [40, 12], [2000, 12]].forEach(([failures, hours]) => {
    assert.equal(reads.retryWait(failures), hours * HOUR, failures + ' in a row');
    [null, T0 - 20 * MIN].forEach((made) =>
      assert.equal(reads.nextReadAt({ at: T0, failures: failures, made: made }), T0 + hours * HOUR,
        failures + ' in a row, made ' + made));
  });
});

test('the clock went back when it is behind the last read', () => {
  assert.equal(reads.clockWentBack(heard(T0, null), T0 - 1), true);
  assert.equal(reads.clockWentBack(heard(T0, null), T0 - 3 * DAY), true);
  assert.equal(reads.clockWentBack(heard(T0, null), T0), false);
  assert.equal(reads.clockWentBack(heard(T0, null), T0 + DAY), false);
});

test('Muninn\'s wakeups, up to 10 minutes late: each estimate read once, at most half an hour after it', () => {
  for (let phase = 0; phase < 6 * HOUR; phase += 7 * MIN) {
    const latest = muninn(T0 - 6 * HOUR, JITTER);
    const all = run(latest, T0 + phase, 8);
    const label = 'first read ' + (phase / MIN) + ' min in';
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i].made > all[i - 1].made, label + ': read ' + i + ' heard nothing new');
      assert.ok(all[i].made - all[i - 1].made <= 6 * HOUR + 10 * MIN, label + ': read ' + i + ' skipped one');
      assert.ok(all[i].at - all[i].made <= 30 * MIN, label + ': an estimate ' + ((all[i].at - all[i].made) / MIN) + ' min old');
    }
    // Four a day: 8 days of reads after the first.
    assert.ok(Math.abs(all.length - 1 - 32) <= 1, label + ': ' + (all.length - 1) + ' reads in 8 days');
  }
});

test('a Muninn that stopped: four reads in its first day, then every 12 hours', () => {
  const all = run(() => T0 - HOUR, T0, 4);
  const firstDay = all.filter((r) => r.at < T0 - HOUR + DAY + 30 * MIN);
  assert.equal(firstDay.length, 5, 'the first read and one at each of its four wakeups');
  const later = all.slice(firstDay.length - 1);
  for (let i = 1; i < later.length; i++) { assert.equal(later[i].at - later[i - 1].at, 12 * HOUR); }
});

test('no Muninn, or one that has made no estimate: every 12 hours exactly', () => {
  const all = run(() => null, T0, 5);
  assert.equal(all.length, 10);
  for (let i = 1; i < all.length; i++) { assert.equal(all[i].at - all[i - 1].at, 12 * HOUR); }
});

test('a Muninn that misses wakeups: after the first read, never more than one read for each wakeup', () => {
  // The first read comes when the user switches the days on. Made at 9:00 here, just as a
  // wakeup is due, it leaves that wakeup its own read 20 minutes later.
  [(k) => k % 2 === 0, (k) => k % 3 !== 1, (k) => k < 3 || k > 9].forEach((makes, n) => {
    const all = run(muninn(T0 - 6 * HOUR, JITTER, makes), T0, 6);
    for (let i = 2; i < all.length; i++) {
      assert.ok(all[i].at - all[i - 1].at >= 5 * HOUR + 40 * MIN, 'case ' + n + ': reads ' + ((all[i].at - all[i - 1].at) / MIN) + ' min apart');
    }
    assert.ok(all.length <= 6 * 4 + 2, 'case ' + n + ': ' + all.length + ' reads in 6 days');
  });
});

test('the user opening Muninn between wakeups: at most one read more, then back on its wakeups', () => {
  // Switched on at 9:00, Muninn opened at 14:37 and read by the 15:00 switch-on of another save.
  const extra = T0 + 5 * HOUR + 37 * MIN;
  const latest = muninn(T0 - 3 * HOUR, (k) => 0, null, [extra]);   // wakeups at 6:00, 12:00...
  const all = run(latest, T0 + 6 * HOUR, 3);
  assert.equal(all[0].made, extra);
  assert.ok(all[1].at - all[0].at <= 6 * HOUR + 20 * MIN);
  all.slice(2).forEach((r, i) => assert.ok(r.at - r.made <= 20 * MIN, 'read ' + (i + 2) + ': back after the wakeup'));
  assert.ok(all.length <= 3 * 4 + 2, all.length + ' reads in 3 days');
});
