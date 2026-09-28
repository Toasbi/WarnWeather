const test = require('node:test');
const assert = require('node:assert/strict');

const cloudCover = require('../src/pkjs/weather/cloud-cover.js');

test('weightedCloudCover: the layers overlap with high cloud at half weight; else the total stands in', () => {
  assert.equal(cloudCover.HIGH_CLOUD_WEIGHT, 0.5);
  assert.equal(cloudCover.weightedCloudCover(0, 0, 100, 100), 50, 'a veil of high cloud alone draws half');
  assert.equal(cloudCover.weightedCloudCover(100, 0, 0, 100), 100, 'overcast low cloud is full');
  assert.equal(cloudCover.weightedCloudCover(0, 100, 100, 100), 100, 'overcast mid cloud is full');
  assert.equal(cloudCover.weightedCloudCover(50, 0, 0, 50), 50);
  assert.ok(Math.abs(cloudCover.weightedCloudCover(40, 50, 100, 100) - 85) < 1e-9, '1 - 0.6 * 0.5 * 0.5');
  assert.equal(cloudCover.weightedCloudCover(0, 0, 25, 25), 12.5, 'a quarter veil of high cloud: the level-1 edge');
  assert.equal(cloudCover.weightedCloudCover(0, 0, 0, 0), 0);
  assert.ok(Math.abs(cloudCover.weightedCloudCover('20', '0', '0', '90') - 20) < 1e-9,
    'numeric strings are readings (the layers win over the total)');
  assert.equal(cloudCover.weightedCloudCover(150, -10, 0, 100), 100, 'layers clamp to 0..100 %');
  // Capped at the model's total: independent layers can sum above the total the
  // model reports for overlapping ones (live Tokyo: 50/60/76 % over a 77 % total
  // would weigh in at 87.6 %, a full row where the total draws level 3).
  assert.equal(cloudCover.weightedCloudCover(50, 60, 76, 77), 77, 'never above the total');
  assert.ok(Math.abs(cloudCover.weightedCloudCover(50, 60, 76, null) - 87.6) < 1e-9,
    'no total to cap against: the weighted cover stands');
  // Without the layer split (any layer missing or not a number), the total cover.
  assert.equal(cloudCover.weightedCloudCover(null, 0, 100, 70), 70, 'a missing layer');
  assert.equal(cloudCover.weightedCloudCover(0, undefined, 100, 70), 70);
  assert.equal(cloudCover.weightedCloudCover(0, 0, 'x', 70), 70, 'a non-numeric layer');
  assert.equal(cloudCover.weightedCloudCover(null, null, null, 130), 100, 'the total clamps');
  assert.equal(cloudCover.weightedCloudCover(null, null, null, -4), 0);
  assert.equal(cloudCover.weightedCloudCover(null, null, null, null), 0, 'nothing at all reads clear');
  assert.equal(cloudCover.weightedCloudCover(undefined, undefined, undefined, 'x'), 0);
});
