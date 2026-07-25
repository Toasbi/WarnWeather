'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateThresholdPair } = require('../src/pkjs/settings/threshold-validate.js');

test('an inverted above-is-worse pair reverts the edited field', () => {
  const S = { threshAqiWarn: '200', threshAqiDanger: '100' };
  validateThresholdPair(S, '', 'threshAqiDanger');
  assert.equal(S.threshAqiDanger, '');
  assert.equal(S.threshAqiWarn, '200');
});

test('an inverted below-is-worse pair reverts the edited field', () => {
  const S = { threshStepsWarn: '4000', threshStepsDanger: '8000' };
  validateThresholdPair(S, '', 'threshStepsDanger');
  assert.equal(S.threshStepsDanger, '');
});

test('well-ordered pairs are kept in both directions', () => {
  const S = { threshAqiWarn: '100', threshAqiDanger: '200' };
  validateThresholdPair(S, '', 'threshAqiDanger');
  assert.equal(S.threshAqiDanger, '200');
  const S2 = { threshStepsWarn: '8000', threshStepsDanger: '4000' };
  validateThresholdPair(S2, '', 'threshStepsDanger');
  assert.equal(S2.threshStepsDanger, '4000');
});

test('a half-blank pair is kept (the kind simply stays disabled)', () => {
  const S = { threshAqiWarn: '100', threshAqiDanger: '' };
  validateThresholdPair(S, '50', 'threshAqiWarn');
  assert.equal(S.threshAqiWarn, '100');
});

test('non-numeric input reverts to the previous value', () => {
  const S = { threshAqiWarn: 'abc', threshAqiDanger: '' };
  validateThresholdPair(S, '100', 'threshAqiWarn');
  assert.equal(S.threshAqiWarn, '100');
});

test('clearing a field is always allowed', () => {
  const S = { threshAqiWarn: '', threshAqiDanger: '200' };
  validateThresholdPair(S, '100', 'threshAqiWarn');
  assert.equal(S.threshAqiWarn, '');
});

test('non-threshold keys are ignored', () => {
  const S = { provider: 'dwd' };
  validateThresholdPair(S, 'x', 'provider');
  assert.equal(S.provider, 'dwd');
});

// A negative health threshold used to be accepted here and then silently clamped to 0 by
// healthWire() at pack time, so the STORED setting meant something other than what the
// user typed. No health kind (steps / sleep hours / distance) has a legitimate negative
// reading, so reject it at entry instead. The weather kinds are unaffected — they are
// compared as plain numbers with no clamp.
test('a negative HEALTH threshold is rejected; weather kinds still accept negatives', () => {
  const S = { threshStepsWarn: '-5', threshStepsDanger: '' };
  validateThresholdPair(S, '8000', 'threshStepsWarn');
  assert.equal(S.threshStepsWarn, '8000', 'negative steps reverts (healthWire would clamp to 0)');
  const S2 = { threshSleepWarn: '', threshSleepDanger: '-1' };
  validateThresholdPair(S2, '5', 'threshSleepDanger');
  assert.equal(S2.threshSleepDanger, '5', 'negative sleep hours revert');
  const S3 = { threshDistanceWarn: '-0,5', threshDistanceDanger: '' };
  validateThresholdPair(S3, '', 'threshDistanceWarn');
  assert.equal(S3.threshDistanceWarn, '', 'negative distance (comma decimal) reverts to blank');
  const S4 = { threshAqiWarn: '-2', threshAqiDanger: '' };
  validateThresholdPair(S4, '', 'threshAqiWarn');
  assert.equal(S4.threshAqiWarn, '-2', 'weather kinds keep accepting negative thresholds');
});

// 0 and negatives are legitimate thresholds, and an equal pair is valid — so
// "unset" must never collapse into "zero" (parseThreshold returns null, not 0).
test('zero and an equal pair are legitimate, not treated as unset', () => {
  const S = { threshAqiWarn: '0', threshAqiDanger: '0' };
  validateThresholdPair(S, '', 'threshAqiDanger');
  assert.equal(S.threshAqiDanger, '0');
  const S2 = { threshSleepWarn: '0', threshSleepDanger: '0' };
  validateThresholdPair(S2, '', 'threshSleepDanger');
  assert.equal(S2.threshSleepDanger, '0');
});
