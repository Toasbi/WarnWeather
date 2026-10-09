const test = require('node:test');
const assert = require('node:assert/strict');

// Capture each send; tests fire ack/nack manually. Set before requiring outbox.
var sent = [];
global.Pebble = {
  sendAppMessage: function(payload, ack, nack) { sent.push({ payload: payload, ack: ack, nack: nack }); }
};
var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

const KEYS = require('../src/pkjs/storage-keys');
const outbox = require('../src/pkjs/outbox');

function reset() { for (var k in store) { delete store[k]; } sent = []; }

const FORECAST_AND_STATUS = {
  TEMP_TREND_UINT8: [1], TEMP_MIN: 0, TEMP_MAX: 1, NUM_ENTRIES: 1, FORECAST_START: 100,
  STATUS_LINE_1_UINT8: [1], STATUS_LINE_2_UINT8: [2],
  STATUS_LINE_3_UINT8: [3], STATUS_LINE_4_UINT8: [4]
};

test('bundles changed categories into a single send', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  assert.equal(sent.length, 1, 'exactly one sendAppMessage for two changed categories');
  assert.ok('TEMP_TREND_UINT8' in sent[0].payload, 'carries forecast keys');
  assert.ok('STATUS_LINE_4_UINT8' in sent[0].payload, 'carries all status keys in the SAME send');
});

test('commits the last-sent cache only after the ACK fires', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY), null, 'no commit before ACK');
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY), null, 'no commit before ACK');
  sent[0].ack();
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY) !== null, 'forecast committed on ACK');
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY) !== null, 'status committed on ACK');
});

test('a NACK leaves no cache behind, so the next send retries', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  sent[0].nack({ error: true });
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY), null, 'no commit on NACK');
  outbox.sendWeather(FORECAST_AND_STATUS);
  assert.equal(sent.length, 2, 'identical payload re-sends after a NACK (not skipped)');
});

test('a send forgets the changed categories\' caches before it goes out, and only theirs', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  sent[0].ack();
  const forecastCache = global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY);
  outbox.sendWeather(Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [9] }));
  assert.equal(sent.length, 2);
  assert.deepEqual(Object.keys(sent[1].payload).sort(),
    ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8']);
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY), null,
    'in flight: the watch holds the old status or the new one, so neither is cached');
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY), forecastCache,
    'the unchanged forecast keeps its cache');
  sent[1].ack();
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY),
    JSON.stringify({ STATUS_LINE_1_UINT8: [9], STATUS_LINE_2_UINT8: [2],
      STATUS_LINE_3_UINT8: [3], STATUS_LINE_4_UINT8: [4] }), 'the ACK commits the new status');
});

// The AQI slot's '--' bake: the watch can store a message whose ACK PKJS never
// hears (a NACK after delivery, or PKJS torn down mid-send when the user leaves
// the watchface). The next healthy bake equals the status ACKed before it, and
// must still go out, or the watch keeps '--' until the status next changes.
[
  ['NACKed', (msg) => msg.nack({ error: true })],
  ['left unanswered', () => {}]
].forEach(([label, answer]) => {
  test('a status ' + label + ' after an ACKed one: the ACKed content goes out again', () => {
    reset();
    const reading = Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [53, 55] });   // '57'
    const dashes = Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [45, 45] });    // '--'
    outbox.sendWeather(reading);
    sent[0].ack();
    outbox.sendWeather(dashes);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].payload.STATUS_LINE_1_UINT8, [45, 45]);
    answer(sent[1]);
    let ok = false;
    outbox.sendWeather(reading, () => { ok = true; });
    assert.equal(sent.length, 3, 'the status category is transmitted, not skipped');
    assert.deepEqual(Object.keys(sent[2].payload).sort(),
      ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8'],
      'only the status: the forecast cache was never in doubt');
    assert.deepEqual(sent[2].payload.STATUS_LINE_1_UINT8, [53, 55]);
    sent[2].ack();
    assert.equal(ok, true);
  });
});

// Two sends of one category in flight at once: a status re-bake (a phone-battery
// event, a config close) beside a fetch's send. The older one's ACK must not
// cache its content over the newer send, which the watch may already hold.
test('an older send\'s ACK does not cache over a newer send still in flight', () => {
  reset();
  const reading = Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [53, 55] });   // '57'
  const dashes = Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [45, 45] });    // '--'
  outbox.sendWeather(reading);
  sent[0].ack();
  outbox.sendWeather(Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [53, 56] }));   // A: '58'
  outbox.sendWeather(dashes);                                                                      // B: '--'
  assert.equal(sent.length, 3, 'B goes out while A is in flight');
  assert.deepEqual(sent[2].payload.STATUS_LINE_1_UINT8, [45, 45]);
  sent[1].ack();   // A's ACK; B is never answered (PKJS torn down)
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY), null,
    'A\'s ACK does not commit: the watch may hold B\'s status');
  outbox.sendWeather(Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [53, 56] }));
  assert.equal(sent.length, 4, 'A\'s content goes out again, not skipped');
  assert.deepEqual(sent[3].payload.STATUS_LINE_1_UINT8, [53, 56]);
});

test('ACKs that arrive out of order leave the newer send\'s content cached', () => {
  reset();
  const older = Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [53, 55] });
  const newer = Object.assign({}, FORECAST_AND_STATUS, { STATUS_LINE_1_UINT8: [45, 45] });
  outbox.sendWeather(older);
  outbox.sendWeather(newer);
  assert.equal(sent.length, 2);
  sent[1].ack();
  sent[0].ack();
  const cached = JSON.parse(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY));
  assert.deepEqual(cached.STATUS_LINE_1_UINT8, [45, 45], 'the newer send\'s status, not the older one\'s');
  outbox.sendWeather(newer);
  assert.equal(sent.length, 2, 'the newer content is known to be on the watch: skipped');
});

test('a newer send of another category does not stop an ACK committing its own', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  outbox.sendClay({ CLAY_CELSIUS: true });
  sent[0].ack();
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_STATUS_KEY) !== null, 'status committed');
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY) !== null, 'forecast committed');
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_CLAY_KEY), null, 'the Clay send is still in flight');
});

test('skips the send when nothing changed and still calls onSuccess', () => {
  reset();
  outbox.sendWeather(FORECAST_AND_STATUS);
  sent[0].ack();           // prime the caches
  sent = [];
  var ok = false;
  outbox.sendWeather(FORECAST_AND_STATUS, function() { ok = true; });
  assert.equal(sent.length, 0, 'no send when nothing changed');
  assert.equal(ok, true, 'onSuccess still called on a no-op');
});

test('sendClay sends only the Clay payload keys and commits to the Clay cache', () => {
  reset();
  outbox.sendClay({ CLAY_CELSIUS: true, CLAY_TIME_FONT: 1 });
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].payload).sort(), ['CLAY_CELSIUS', 'CLAY_TIME_FONT']);
  sent[0].ack();
  assert.ok(global.localStorage.getItem(KEYS.LAST_SENT_CLAY_KEY) !== null, 'commits to the Clay cache');
  assert.equal(global.localStorage.getItem(KEYS.LAST_SENT_FORECAST_KEY), null, 'does not touch weather caches');
});
