// test/shell/index-tick-jobs.test.js
//
// The minute's jobs in the real index.js (onSchedulerTick): each runs on its own, so one that
// throws, every minute even, holds up none of the others. Its error is logged by the job's
// name and the error's kind only: the jobs handle other apps' plugin values, which are never
// logged.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { bootIndex } = require('../helpers/index-harness.js');

const PKJS = path.join(__dirname, '..', '..', 'src', 'pkjs');

test('a minute job that throws every minute holds up none of the others', (t) => {
  const h = bootIndex(t, {});
  h.start();
  // The modules this life of index.js loaded (every boot loads them fresh).
  const batteryEstimate = require(path.join(PKJS, 'status-bars', 'adapter', 'battery-estimate.js'));
  const statusRebake = require(path.join(PKJS, 'status-bars', 'application', 'status-rebake.js'));
  const realTick = statusRebake.onTick;
  let rebakeTicks = 0;
  batteryEstimate.onTick = () => { throw new TypeError('12d left'); };
  statusRebake.onTick = function () {
    rebakeTicks += 1;
    return realTick.apply(this, arguments);
  };
  h.minutes(3);
  assert.ok(rebakeTicks >= 3, 'the re-bake after it ran every minute: ' + rebakeTicks);
  const failed = h.logs.filter((line) => line.indexOf('battery-estimate') !== -1 && line.indexOf('failed') !== -1);
  assert.ok(failed.length >= 3, 'each throw is logged');
  assert.ok(failed.every((line) => line.indexOf('12d') === -1 && line.indexOf('TypeError') !== -1),
    'by the job\'s name and the error\'s kind, never its message');
});
