// test/interval-budget.test.js — the update-interval ladder under every active budget
// guard (tomorrow.io, Rainbow on the user's own key): the one list the page's fetchIntervalBudget
// resolver and onbuild.js's save-time fit both read.
const test = require('node:test');
const assert = require('node:assert/strict');
const ib = require('../src/pkjs/settings/interval-budget.js');
const tio = require('../src/pkjs/settings/tomorrowio-budget.js');
const rb = require('../src/pkjs/settings/rainbow-budget.js');

const FULL = ['5', '10', '15', '30', '60'];
const values = (opts) => opts.map((o) => o[1]);

// Base state: no guarded call (Open-Meteo weather, the shared Rainbow radar: "Rainbow
// (limited)"), no night pause, both guards on. OWN_KEY puts the radar on the user's key
// ("Rainbow (own key)").
const OWN_KEY = { radarProvider: 'rainbowkey' };
function S(over) {
  return Object.assign({
    provider: 'openmeteo', radarProvider: 'rainbow', radarMode: 'graph',
    sleepNightEnabled: false, sleepStartHour: '22', sleepEndHour: '7',
    tomorrowioFitBudget: true, rainbowFitBudget: true
  }, over || {});
}

test('no guard active: the full ladder', () => {
  assert.deepEqual(values(ib.fittingOptions(S())), FULL);
  assert.deepEqual(ib.activeGuards(S()), []);
  // No state at all reads as "nothing selected".
  assert.deepEqual(values(ib.fittingOptions()), FULL);
  assert.deepEqual(values(ib.fittingOptions(null)), FULL);
});

test('tomorrow.io only: exactly tomorrow.io\'s own list', () => {
  const s = S({ provider: 'tomorrowio', radarProvider: 'tomorrowio' });
  assert.deepEqual(ib.fittingOptions(s), tio.fittingOptions(s));
  assert.deepEqual(values(ib.fittingOptions(s)), ['10', '15', '30', '60']);
  assert.deepEqual(ib.activeGuards(s).map((g) => g.toggleKey), ['tomorrowioFitBudget']);
});

test('Rainbow on the user\'s own key only, no pause: 5 min drops out', () => {
  const s = S(OWN_KEY);
  assert.deepEqual(values(ib.fittingOptions(s)), ['10', '15', '30', '60']);
  assert.deepEqual(ib.fittingOptions(s), rb.fittingOptions(s));
  assert.deepEqual(ib.activeGuards(s).map((g) => g.toggleKey), ['rainbowFitBudget']);
});

test('both guards active: the intersection', () => {
  // Weather on tomorrow.io (1 call/cycle, fits 5 min) with radar on Rainbow's own key.
  const s = S({ provider: 'tomorrowio', radarProvider: 'rainbowkey' });
  assert.deepEqual(ib.activeGuards(s).map((g) => g.toggleKey), ['tomorrowioFitBudget', 'rainbowFitBudget']);
  assert.deepEqual(values(ib.fittingOptions(s)), ['10', '15', '30', '60']);
});

test('the two toggles are independent', () => {
  const both = { provider: 'tomorrowio', radarProvider: 'rainbowkey' };
  // tomorrow.io's guard off: Rainbow's list alone.
  const tioOff = S(Object.assign({ tomorrowioFitBudget: false }, both));
  assert.deepEqual(values(ib.fittingOptions(tioOff)), values(rb.fittingOptions(tioOff)));
  assert.deepEqual(values(ib.fittingOptions(tioOff)), ['10', '15', '30', '60']);
  // Rainbow's guard off: tomorrow.io's list alone (weather only fits every step).
  const rbOff = S(Object.assign({ rainbowFitBudget: false }, both));
  assert.deepEqual(values(ib.fittingOptions(rbOff)), values(tio.fittingOptions(rbOff)));
  assert.deepEqual(values(ib.fittingOptions(rbOff)), FULL);
  // Both off: the full ladder, and no guard is active.
  const bothOff = S(Object.assign({ tomorrowioFitBudget: false, rainbowFitBudget: false }, both));
  assert.deepEqual(values(ib.fittingOptions(bothOff)), FULL);
  assert.deepEqual(ib.activeGuards(bothOff), []);
});

// Stub guards: each "fits" a fixed set of intervals and is always in play.
function stubGuard(toggleKey, fitting) {
  return {
    toggleKey: toggleKey,
    budget: {
      callsPerCycle: function () { return 1; },
      fits: function (state, min) { return fitting.indexOf(min) !== -1; }
    }
  };
}

test('fittingOptionsFor intersects the guards\' fits(), not their fallback lists', () => {
  const a = stubGuard('aFit', [5, 10, 15]);
  const b = stubGuard('bFit', [10, 15, 30, 60]);
  assert.deepEqual(values(ib.fittingOptionsFor([a, b], {})), ['10', '15']);
  // A guard whose toggle is off drops out of the intersection.
  assert.deepEqual(values(ib.fittingOptionsFor([a, b], { bFit: false })), ['5', '10', '15']);
});

test('fittingOptionsFor never returns an empty list (disjoint guards -> full ladder)', () => {
  const a = stubGuard('aFit', [5, 10]);
  const b = stubGuard('bFit', [30, 60]);
  assert.deepEqual(values(ib.fittingOptionsFor([a, b], {})), FULL);
  // ...and the fallback is a copy, never the shared ladder itself.
  assert.notEqual(ib.fittingOptionsFor([a, b], {}), ib.LADDER);
  assert.notEqual(ib.fittingOptions(S()), ib.LADDER);
});

test('STATE_KEYS holds both toggles and every key of both budgets, with no duplicates', () => {
  const keys = ib.STATE_KEYS;
  tio.STATE_KEYS.concat(rb.STATE_KEYS).concat(['tomorrowioFitBudget', 'rainbowFitBudget'])
    .forEach((k) => assert.ok(keys.indexOf(k) !== -1, 'missing ' + k));
  assert.equal(new Set(keys).size, keys.length, 'no duplicates: ' + keys.join(','));
});

test('STATE_KEYS is enough: a state rebuilt from exactly these keys gives the same list', () => {
  // onbuild.js's onSubmit sees only ctx.get(key) and rebuilds S from STATE_KEYS.
  [S({ provider: 'tomorrowio', radarProvider: 'rainbowkey' }),
    S({ radarProvider: 'rainbowkey', sleepNightEnabled: true, sleepStartHour: '20' }),
    S({ provider: 'tomorrowio', radarProvider: 'tomorrowio', rainbowFitBudget: false })
  ].forEach((full) => {
    const rebuilt = {};
    ib.STATE_KEYS.forEach((k) => { rebuilt[k] = full[k]; });
    assert.deepEqual(ib.fittingOptions(rebuilt), ib.fittingOptions(full));
  });
});

test('activeGuards treats a toggle stored as undefined as on (its default)', () => {
  const s = S({ radarProvider: 'rainbowkey', rainbowFitBudget: undefined });
  assert.deepEqual(ib.activeGuards(s).map((g) => g.toggleKey), ['rainbowFitBudget']);
  const missing = S(OWN_KEY);
  delete missing.rainbowFitBudget;
  assert.deepEqual(ib.activeGuards(missing).map((g) => g.toggleKey), ['rainbowFitBudget']);
  assert.deepEqual(values(ib.fittingOptions(missing)), ['10', '15', '30', '60']);
});

test('GUARDS wires each budget module to its own toggle', () => {
  assert.deepEqual(ib.GUARDS.map((g) => [g.budget, g.toggleKey]),
    [[tio, 'tomorrowioFitBudget'], [rb, 'rainbowFitBudget']]);
  assert.equal(ib.LADDER, tio.INTERVAL_LADDER);
});

// fitInterval: the interval Save stores (onbuild.js fitIntervalToBudget) and the budget
// read-outs show (blocks.js), so the page never warns about an interval Save replaces.
test('fitInterval: kept when the list offers it, else the item default 15', () => {
  const rbk = S(OWN_KEY);
  assert.equal(ib.fitInterval(rbk, '10'), '10', 'offered: kept');
  assert.equal(ib.fitInterval(rbk, '5'), '15', 'dropped out: the item default, which fits');
  assert.equal(ib.fitInterval(rbk, 10), '10', 'a number reads as its string');
  const both = S({ provider: 'tomorrowio', radarProvider: 'rainbowkey', tomorrowioFitBudget: false });
  assert.equal(ib.fitInterval(both, '5'), '15', 'Rainbow\'s guard binds with tomorrow.io\'s off');
});

test('fitInterval: no active guard keeps the stored value, even one off the ladder', () => {
  assert.equal(ib.fitInterval(S(), '5'), '5', 'no guarded call');
  assert.equal(ib.fitInterval(S(), '20'), '20');
  assert.equal(ib.fitInterval(S({ radarProvider: 'rainbowkey', rainbowFitBudget: false }), '5'), '5',
    'the guard is off: the read-out warns instead');
  assert.equal(ib.fitInterval(undefined, '5'), '5', 'no state');
});

test('fitIntervalFor: the shortest fitting step when 15 does not fit', () => {
  const late = stubGuard('lateFit', [30, 60]);
  assert.equal(ib.fitIntervalFor([late], {}, '5'), '30');
  assert.equal(ib.fitIntervalFor([late], {}, '60'), '60', 'offered: kept');
  assert.equal(ib.fitIntervalFor([late], { lateFit: false }, '5'), '5', 'toggle off');
});
