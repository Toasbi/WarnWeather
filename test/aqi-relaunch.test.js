// The AQI slot across PKJS lives: the user leaves the watchface for a watch app
// (PKJS torn down) and comes back, and the fetch that runs on the return is the
// one the user sees. The REAL index.js over one phone store (helpers/pkjs-lives.js),
// with strict WAQI as the AQI source and the slot pinned to the forecast line's
// right end. The watch is modelled as holding the last AQI text any message
// carried to it, whether or not PKJS heard the ACK.
const test = require('node:test');
const assert = require('node:assert/strict');
const lives = require('./helpers/pkjs-lives.js');
const { decodeLine } = require('./helpers/status-line-bytes.js');

const MIN = 60 * 1000;

/**
 * The AQI slot's text in an AppMessage, or null when it carries no status line.
 * @param {Object} dict AppMessage dictionary.
 * @returns {?string} The forecast line's right slot (pinned to AQI).
 */
function aqiText(dict) {
  return dict.STATUS_LINE_1_UINT8 ? decodeLine(dict.STATUS_LINE_1_UINT8)[2].text : null;
}

/**
 * A story over one store: each life() boots PKJS at `now`, lets its startup fetch
 * run, and tears it down, failing if a response callback threw (the harness
 * catches those). `waqi` is what the station reports this life (a number or '-');
 * `answer` how the watch answers a message carrying the AQI slot.
 * @param {Object} t node:test context.
 * @returns {{life: Function, watch: Function, store: Object}} The story's handles.
 */
function story(t) {
  const store = lives.freshStore({ aqiSource: 'waqi', statusForecastRight: 'aqi' });
  let watchAqi = null;
  return {
    store: store,
    watch: () => watchAqi,
    life(now, waqi, answer) {
      const h = lives.boot(t, {
        store: store, now: now, waqiToken: 'T',
        network: (url) => (/api\.waqi\.info/.test(url)
          ? { status: 200, body: { status: 'ok', data: { aqi: waqi } } }
          : lives.healthyNetwork(url, 57)),
        onSend: (dict) => {
          const text = aqiText(dict);
          if (text === null) { return 'ack'; }
          watchAqi = text;   // the watch stores it whatever PKJS hears back
          return answer || 'ack';
        }
      });
      h.start();
      h.advance(8000);
      h.teardown();
      assert.deepEqual(h.uncaught, [], 'no response callback threw');
      return h;
    }
  };
}

test('a WAQI "-" on the return keeps the last reading for 2 h, then shows --', (t) => {
  const s = story(t);
  const t0 = lives.HARNESS_NOW;   // 10:20Z

  const life1 = s.life(t0, 57);
  assert.equal(life1.requestsTo(/api\.waqi\.info/), 1);
  assert.equal(s.watch(), '57');

  // Back in the next refresh slot (10:47): the station answers '-'.
  const life2 = s.life(t0 + 27 * MIN, '-');
  assert.equal(life2.requestsTo(/api\.waqi\.info/), 1, 'the return fetched');
  assert.equal(life2.count(/^AQI: no reading \(waqi: ok\/string\)$/), 1);
  assert.equal(life2.count(/^AQI: showing the reading from 27 min ago$/), 1);
  assert.equal(s.watch(), '57', 'the slot keeps the last reading');
  assert.equal(life2.sends.filter((d) => aqiText(d) !== null).length, 0,
    'the bake equals the status the watch holds: no status send');

  // Back more than 2 h after that reading (12:35): '-' again, nothing to stand in.
  const life3 = s.life(t0 + 135 * MIN, '-');
  assert.equal(life3.requestsTo(/api\.waqi\.info/), 1);
  assert.equal(life3.count(/^AQI: no recent reading, slot shows --$/), 1);
  assert.equal(s.watch(), '--');
});

test('an AQI send PKJS never heard answered is resent by the next healthy fetch', (t) => {
  const s = story(t);
  const t0 = lives.HARNESS_NOW;

  s.life(t0, 57);
  assert.equal(s.watch(), '57');

  // 12:35, '-' with no recent reading: the watch stores '--', but the user leaves
  // before the ACK reaches PKJS, which dies with the callback unanswered.
  const held = s.life(t0 + 135 * MIN, '-', 'hold');
  assert.equal(held.sends.filter((d) => aqiText(d) === '--').length, 1);
  assert.equal(s.watch(), '--');

  // 12:50, the station is healthy again and reports the same 57 the last ACKed
  // status carried: it must still go out, or the watch keeps '--'.
  const healthy = s.life(t0 + 150 * MIN, 57);
  assert.equal(healthy.requestsTo(/api\.waqi\.info/), 1);
  assert.deepEqual(healthy.sends.map(aqiText).filter((x) => x !== null), ['57'],
    'the status category is transmitted');
  assert.equal(s.watch(), '57');
});
