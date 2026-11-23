// test/shell/index-saver-window-edges.test.js
//
// The battery saver's window in the real index.js, at its closing edge: a phone-battery
// update the window swallowed is owed to the watch (status-rebake.js resendStatusAwake), and the
// window's first fetch is due in the same minute. The push waits out that fetch, whose
// message goes out anyway (the sleep flag ends) and takes the exact reading along, so the
// minute costs one message, not a push and a fetch. Local hours throughout, as the saver's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootIndex } = require('../helpers/index-harness.js');
const { fakeManager } = require('../helpers/fake-battery.js');

test('the window closes with one message: the owed push rides the fetch due that minute', (t) => {
  const battery = fakeManager(0.84);
  const h = bootIndex(t, {
    now: new Date(2026, 0, 6, 6, 40).getTime(),
    battery: battery,
    settings: { fetchIntervalMin: '15', statusForecastLeft: 'phoneBattery',
      sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' }
  });
  h.start();
  h.minutes(1);                 // the boot fetch, inside the window: the sleep onset
  assert.equal(h.uncaught.length, 0);
  assert.equal(h.weatherSends().length, 1);
  assert.equal(h.weatherSends()[0].IS_SLEEPING, true, 'the watch is told it sleeps');

  h.sends.length = 0;
  battery.setLevel(0.79);            // a bucket move inside the window: owed, not sent
  h.minutes(18);                // to 06:59:xx
  assert.equal(h.weatherSends().length, 0, 'the window stays quiet');

  h.minutes(5);                 // through 07:00: the push is owed and the fetch is due
  const edge = h.weatherSends();
  assert.equal(edge.length, 1, 'one message at the window\'s end');
  assert.equal(edge[0].IS_SLEEPING, false, 'the fetch\'s, ending the sleep');
  assert.ok(/79%/.test(Buffer.from(edge[0].STATUS_LINE_1_UINT8 || []).toString('latin1')),
    'carrying the battery the window owed');
});
