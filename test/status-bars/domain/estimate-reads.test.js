'use strict';
// When Muninn's estimate of the days the watch has left is read again (estimate-reads.js):
// the rule, and what it adds up to over days of Muninn's wakeups. The reading itself, and the
// starts, ticks and saves that ask, are battery-estimate.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const reads = require('../../../src/pkjs/status-bars/domain/estimate-reads.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 21, 9, 0, 0);

/** An answered read at `at`. */
function answered(at) {
  return { at: at, failures: 0 };
}

/** An estimate made at `made`. */
function madeAt(made) {
  return { days: 5, updatedAt: made };
}

/**
 * Read by the rule for `days` days, every read answered with Muninn's latest estimate.
 * @param {function(number): ?number} latest When Muninn made its latest estimate before an
 *   instant, or null for none.
 * @param {number} start The first read, in epoch milliseconds.
 * @param {number} days How long to read for.
 * @returns {Array<{at: number, age: ?number}>} Each read, and how old the estimate it heard was.
 */
function run(latest, start, days) {
  const out = [];
  let at = start;
  while (at < start + days * DAY) {
    const made = latest(at);
    out.push({ at: at, age: made === null ? null : at - made });
    at = reads.nextReadAt(answered(at), made === null ? null : madeAt(made));
  }
  return out;
}

/**
 * A Muninn that makes its estimate every `period`, `offset` after each multiple of it.
 * @param {number} period Its rhythm.
 * @param {number} offset How late after each multiple its estimate lands.
 * @returns {function(number): number} Its latest estimate's time before an instant.
 */
function rhythm(period, offset) {
  return (t) => Math.floor((t - offset) / period) * period + offset;
}

test('a record is a time after 1970 and a whole count of failed reads', () => {
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0 }), { at: T0, failures: 0 });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 3 }), { at: T0, failures: 3 });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, extra: 1 }), { at: T0, failures: 0 }, 'only its two fields');
  [null, undefined, 5, 'x', true, [], {}, { at: T0 }, { failures: 0 },
    { at: 0, failures: 0 }, { at: -1, failures: 0 }, { at: NaN, failures: 0 }, { at: Infinity, failures: 0 },
    { at: String(T0), failures: 0 }, { at: T0, failures: -1 }, { at: T0, failures: 1.5 },
    { at: T0, failures: '1' }, { at: T0, failures: Infinity }, { at: T0, failures: null }]
    .forEach((value) => assert.equal(reads.recordOf(value), null, JSON.stringify(value)));
});

test('about twice a day: an answer without an estimate is read again a whole interval later', () => {
  assert.equal(reads.READ_INTERVAL_MS, 12 * HOUR);
  assert.equal(reads.nextReadAt(answered(T0), null), T0 + 12 * HOUR);
});

test('an answer with a fresh estimate is read again just after Muninn\'s next-but-one', () => {
  assert.equal(reads.SETTLE_MS, 20 * MIN);
  // Muninn makes one every 6 hours: the one after next lands 12 hours after the one held,
  // and the read follows it by 20 minutes, so the watch gets an estimate minutes old.
  assert.equal(reads.nextReadAt(answered(T0), madeAt(T0 - 20 * MIN)), T0 + 12 * HOUR);
  assert.equal(reads.nextReadAt(answered(T0), madeAt(T0 - HOUR)), T0 + 11 * HOUR + 20 * MIN);
  assert.equal(reads.nextReadAt(answered(T0), madeAt(T0)), T0 + 12 * HOUR + 20 * MIN, 'made as it was read');
});

test('never less than 10 hours after an answer, however old the estimate it brought', () => {
  assert.equal(reads.MIN_GAP_MS, 10 * HOUR);
  [2 * HOUR + 20 * MIN, 3 * HOUR, 6 * HOUR, 11 * HOUR, 12 * HOUR - 1].forEach((age) =>
    assert.equal(reads.nextReadAt(answered(T0), madeAt(T0 - age)), T0 + 10 * HOUR, (age / HOUR) + ' h old'));
});

test('an estimate made before the interval, or after the read, sets no rhythm to follow', () => {
  [12 * HOUR, 13 * HOUR, 3 * DAY].forEach((age) =>
    assert.equal(reads.nextReadAt(answered(T0), madeAt(T0 - age)), T0 + 12 * HOUR, (age / HOUR) + ' h old'));
  assert.equal(reads.nextReadAt(answered(T0), madeAt(T0 + MIN)), T0 + 12 * HOUR,
    'stamped after the read: the clock went back in between');
});

test('a failed read is tried again an hour later, then 2, 4 and 8 hours, then every 12', () => {
  assert.equal(reads.RETRY_MS, HOUR);
  const held = madeAt(T0 - 20 * MIN);
  [[1, 1], [2, 2], [3, 4], [4, 8], [5, 12], [6, 12], [40, 12], [2000, 12]].forEach(([failures, hours]) => {
    assert.equal(reads.retryWait(failures), hours * HOUR, failures + ' in a row');
    assert.equal(reads.nextReadAt({ at: T0, failures: failures }, null), T0 + hours * HOUR, failures + ' in a row');
    assert.equal(reads.nextReadAt({ at: T0, failures: failures }, held), T0 + hours * HOUR,
      failures + ' in a row: the estimate held does not move a retry');
  });
});

test('the clock went back when it is behind the last read', () => {
  assert.equal(reads.clockWentBack(answered(T0), T0 - 1), true);
  assert.equal(reads.clockWentBack(answered(T0), T0 - 3 * DAY), true);
  assert.equal(reads.clockWentBack(answered(T0), T0), false);
  assert.equal(reads.clockWentBack(answered(T0), T0 + DAY), false);
});

test('against Muninn\'s 6-hour wakeups: two reads a day, each minutes after an estimate', () => {
  // Its wakeups land on the hour or up to ten minutes late; start the reads at every phase.
  [0, 5 * MIN, 10 * MIN].forEach((late) => {
    for (let phase = 0; phase < 6 * HOUR; phase += 15 * MIN) {
      const all = run(rhythm(6 * HOUR, late), T0 + phase, 7);
      const label = 'late ' + (late / MIN) + ' min, first read ' + (phase / MIN) + ' min in';
      // Within the first day and a half it falls into step, and stays there.
      const settled = all.filter((r) => r.at >= all[0].at + 36 * HOUR);
      assert.ok(settled.length >= 10, label);
      settled.forEach((r) => assert.ok(r.age <= 20 * MIN, label + ': an estimate ' + (r.age / MIN) + ' min old'));
      for (let i = 1; i < settled.length; i++) {
        assert.equal(settled[i].at - settled[i - 1].at, 12 * HOUR, label + ': twice a day');
      }
    }
  });
});

test('whatever Muninn\'s rhythm, reads are 10 to 12 hours 20 minutes apart: at most three a day', () => {
  [4 * HOUR, 5 * HOUR, 8 * HOUR, 12 * HOUR, DAY, 3 * DAY].forEach((period) => {
    const all = run(rhythm(period, 7 * MIN), T0, 10);
    for (let i = 1; i < all.length; i++) {
      const gap = all[i].at - all[i - 1].at;
      assert.ok(gap >= 10 * HOUR && gap <= 12 * HOUR + 20 * MIN, (period / HOUR) + ' h rhythm: ' + (gap / MIN) + ' min apart');
    }
    for (let i = 3; i < all.length; i++) {
      assert.ok(all[i].at - all[i - 3].at > DAY, (period / HOUR) + ' h rhythm: four reads in a day');
    }
  });
});

test('a Muninn that has stopped, or has no estimate yet, is read every 12 hours exactly', () => {
  [() => T0 - 5 * DAY, () => null].forEach((latest, n) => {
    const all = run(latest, T0, 5);
    assert.equal(all.length, 10, 'case ' + n);
    for (let i = 1; i < all.length; i++) {
      assert.equal(all[i].at - all[i - 1].at, 12 * HOUR, 'case ' + n);
    }
  });
});
