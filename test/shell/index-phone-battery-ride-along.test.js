// test/shell/index-phone-battery-ride-along.test.js
//
// The phone's battery in a status slot, end to end in the real index.js on an Android phone
// (the harness's BatteryManager stand-in). A weather fetch bakes the reading the watch was
// last sent (phone-battery.js bakeFacts), so the charge drifting inside its 5-point bucket
// sends nothing by itself; a message that goes out anyway carries the exact reading through
// the outbox's ride-along (outbox.js setRideAlong); a bucket move still sends at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootIndex } = require('../helpers/index-harness.js');
const { fakeManager } = require('../helpers/fake-battery.js');

/**
 * The phone battery slot's text in a send's Forecast bar line.
 * @param {Object} msg An AppMessage dict.
 * @returns {?string} 'NN%', or null when the send carries no Forecast bar line.
 */
function batteryText(msg) {
  const line = msg.STATUS_LINE_1_UINT8;
  if (!line) { return null; }
  const m = /(\d+)%/.exec(Buffer.from(line).toString('latin1'));
  return m ? m[1] + '%' : null;
}

test('the charge drifting inside its bucket wakes nothing; the next message going out carries it', (t) => {
  const battery = fakeManager(0.84);
  // The harness's forecast holds still within each UTC hour and moves on with it.
  const h = bootIndex(t, { battery: battery,
    settings: { fetchIntervalMin: '15', statusForecastLeft: 'phoneBattery' } });
  h.start();
  h.minutes(1);                 // the boot fetch (10:20) has landed
  assert.equal(h.uncaught.length, 0);
  const boot = h.weatherSends();
  assert.equal(boot.length, 1);
  assert.equal(batteryText(boot[0]), '84%');

  h.sends.length = 0;
  battery.setLevel(0.83);            // still in the 80 bucket
  h.minutes(15);                // the 10:30 fetch: the same hour's forecast
  battery.setLevel(0.82);
  h.minutes(15);                // the 10:45 fetch
  assert.equal(h.weatherSends().length, 0, 'only the battery moved, inside its bucket: no wake-up');

  h.minutes(10);                // the 11:00 fetch brings the new hour
  const hourly = h.weatherSends();
  assert.equal(hourly.length, 1);
  assert.ok('TEMP_TREND_UINT8' in hourly[0], 'the forecast went out');
  assert.equal(batteryText(hourly[0]), '82%', 'with the exact reading riding along in the status');

  h.sends.length = 0;
  battery.setLevel(0.81);
  h.minutes(15);                // the 11:15 fetch: nothing new, and the watch shows 82% already
  assert.equal(h.weatherSends().length, 0);
  battery.setLevel(0.79);            // into the 75 bucket: a trigger
  const moved = h.weatherSends();
  assert.equal(moved.length, 1, 'a bucket move sends at once');
  assert.equal(batteryText(moved[0]), '79%', 'with the exact reading of that moment');
});
