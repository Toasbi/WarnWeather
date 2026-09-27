// test/rainbow-budget.test.js — the free-plan budget math for Rainbow on the user's own key.
const test = require('node:test');
const assert = require('node:assert/strict');
const budget = require('../src/pkjs/settings/rainbow-budget.js');
const tio = require('../src/pkjs/settings/tomorrowio-budget.js');
const radarSourceId = require('../src/pkjs/weather/radar-source-id.js');

// Base state: radar on Rainbow with "Use your own key" on, graph mode, night pause off.
function S(over) {
  return Object.assign({
    radarProvider: 'rainbow', rainbowOwnKey: true, radarMode: 'graph',
    sleepNightEnabled: false, sleepStartHour: '22', sleepEndHour: '7'
  }, over || {});
}
// A night pause ending at 7:00 and starting at `start`: 22 -> 9 h, 21 -> 10 h, 20 -> 11 h.
function paused(start, over) {
  return S(Object.assign({ sleepNightEnabled: true, sleepStartHour: String(start), sleepEndHour: '7' }, over || {}));
}

test('free-plan constants: 5000 calls a month, budgeted over the longest (31-day) month', () => {
  assert.equal(budget.LIMIT_MONTH, 5000);
  assert.equal(budget.DAYS_PER_MONTH, 31);
  assert.equal(budget.RADAR_CALLS_PER_CYCLE, 1);
});

test('callsPerCycle: one call whenever Rainbow on the user\'s own key drives a running radar', () => {
  ['graph', 'status', 'countdown'].forEach((mode) => {
    assert.equal(budget.callsPerCycle(S({ radarMode: mode })), 1, 'radarMode ' + mode);
  });
  // A missing radarMode is the schema default (graph), which runs the radar.
  const noMode = S();
  delete noMode.radarMode;
  assert.equal(budget.callsPerCycle(noMode), 1, 'a missing radarMode counts as on');
});

test('callsPerCycle: nothing billed with radar off, the switch off or any other radar source', () => {
  assert.equal(budget.callsPerCycle(S({ radarMode: 'off' })), 0, 'radar off');
  assert.equal(budget.callsPerCycle(S({ rainbowOwnKey: false })), 0, 'the shared Rainbow radar bills the user nothing');
  const untouched = S();
  delete untouched.rainbowOwnKey;
  assert.equal(budget.callsPerCycle(untouched), 0, 'a switch never touched is off');
  ['tomorrowio', 'dwd', 'metno'].forEach((src) => {
    assert.equal(budget.callsPerCycle(S({ radarProvider: src })), 0, 'radarProvider ' + src + ', switch left on');
  });
  assert.equal(budget.callsPerCycle(null), 0, 'no state');
  assert.equal(budget.callsPerCycle({}), 0, 'empty state');
});

test('callsPerCycle bills exactly when the runtime resolves the own-key source', () => {
  // The budget and fetch-cycle.js read the same resolver, so the page never budgets a
  // radar the watch does not fetch, or misses one it does.
  ['dwd', 'metno', 'rainbow', 'tomorrowio', undefined].forEach((radarProvider) => {
    [true, false, undefined].forEach((rainbowOwnKey) => {
      const state = S({ radarProvider: radarProvider, rainbowOwnKey: rainbowOwnKey });
      const ownKey = radarSourceId.effectiveRadarId(state) === 'rainbowkey';
      assert.equal(budget.callsPerCycle(state), ownKey ? 1 : 0,
        'radarProvider=' + radarProvider + ' rainbowOwnKey=' + rainbowOwnKey);
    });
  });
});

test('monthlyCalls matches every row of the worked budget table', () => {
  const rows = [
    // [interval, state, calls/month, fits?]
    [5, S(), 8928, false],
    [5, paused(22), 5580, false],   // 9 h, the saver's default 22 -> 7
    [5, paused(21), 5208, false],   // 10 h
    [5, paused(20), 4836, true],    // 11 h
    [10, S(), 4464, true],
    [15, S(), 2976, true],
    [30, S(), 1488, true],
    [60, S(), 744, true]
  ];
  rows.forEach(([interval, state, calls, fits]) => {
    const label = interval + ' min, pause ' + budget.sleepHours(state) + ' h';
    assert.equal(budget.monthlyCalls(state, interval), calls, label);
    assert.equal(budget.fits(state, interval), fits, label + ' fits?');
  });
  // The day and the month agree (31 days).
  assert.equal(budget.dailyCalls(S(), 15), 96);
  assert.equal(budget.monthlyCalls(S(), 15), 96 * 31);
});

test('fittingOptions: drops 5 min with no pause, all five with an 11 h pause, the full ladder when not in play', () => {
  assert.deepEqual(budget.fittingOptions(S()).map((o) => o[1]), ['10', '15', '30', '60']);
  assert.deepEqual(budget.fittingOptions(paused(20)).map((o) => o[1]), ['5', '10', '15', '30', '60']);
  assert.deepEqual(budget.fittingOptions(S({ rainbowOwnKey: false })).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
  assert.deepEqual(budget.fittingOptions(S({ radarMode: 'off' })).map((o) => o[1]),
    ['5', '10', '15', '30', '60']);
  // The default interval survives the guard.
  assert.ok(budget.fittingOptions(S()).some((o) => o[1] === '15'));
});

test('minSleepHoursFor derives the unlock rule (5 min needs >= 11 h; 10 min needs none)', () => {
  assert.equal(budget.minSleepHoursFor(S(), 5), 11);
  assert.equal(budget.minSleepHoursFor(S(), 10), 0);
  assert.equal(budget.minSleepHoursFor(S({ rainbowOwnKey: false }), 5), 0, 'no Rainbow key budget in play');
  assert.equal(budget.minSleepHoursFor(S({ radarMode: 'off' }), 5), 0, 'radar off: nothing to unlock');
  // The derived pause really does unlock the interval, and one hour less does not.
  assert.equal(budget.fits(paused(20), 5), true);
  assert.equal(budget.fits(paused(21), 5), false);
});

test('the ladder and the night-pause rule are tomorrowio-budget.js\'s own, not copies', () => {
  assert.equal(budget.INTERVAL_LADDER, tio.INTERVAL_LADDER, 'same ladder array');
  assert.equal(budget.sleepHours, tio.sleepHours, 'same sleepHours function');
});

test('STATE_KEYS lists every settings key the budget math reads', () => {
  // interval-budget.js (and through it the onSubmit fit in onbuild.js) rebuilds its
  // state object from these keys; a key read here but missing there would silently
  // read as undefined at save time.
  const read = new Set();
  const spy = new Proxy(S({ sleepNightEnabled: true }), {
    get: (target, k) => { if (typeof k === 'string') { read.add(k); } return target[k]; }
  });
  budget.fittingOptions(spy);
  budget.fits(spy, 5);
  budget.minSleepHoursFor(spy, 5);
  budget.monthlyCalls(spy, 5);
  assert.deepEqual([...read].sort(), budget.STATE_KEYS.slice().sort());
});
