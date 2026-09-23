// test/sleep-state-commit.test.js
// The battery saver pauses fetching while asleep AND the watch is known to be
// asleep (needRefresh). "Known" used to be committed when the payload was
// BUILT, before the reverse geocode, the provider requests and the AppMessage
// send — so a sleep-onset fetch that failed after that point recorded the watch
// as asleep although IS_SLEEPING never reached it, and every retry was skipped
// until the window ended: no sleep glyph and no radar snooze all night. The
// state is now committed only once the payload carrying it is delivered, with
// the value it carried.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootIndex, healthyNetwork } = require('./helpers/index-harness.js');

const HOUR_MS = 60 * 60 * 1000;
const FETCHING = /^Fetching from /;
// Ten past midnight, local time, inside a 00:00-03:00 battery-saver window.
const ONSET = new Date(2026, 0, 6, 0, 10).getTime();
const SAVER = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '3' };

/**
 * Seed a last success two hours before `now` and an awake watch.
 *
 * @param {number} now Epoch ms.
 * @returns {Object} Store entries.
 */
function awakeWithStaleForecast(now) {
  return {
    lastFetchSuccess: JSON.stringify({ time: new Date(now - 2 * HOUR_MS).toISOString() }),
    lastIsSleeping: 'false',
  };
}

/** @returns {number} How many delivered weather sends told the watch it sleeps. */
function sleepSends(h, delivered) {
  return delivered.filter((d) => 'IS_SLEEPING' in d && Boolean(d.IS_SLEEPING)).length;
}

// A reverse-geocode failure no longer fails the fetch (it falls back to a placeholder
// city), so the forecast request is the failure this drives.
test('a sleep-onset fetch whose forecast request fails is retried until IS_SLEEPING lands', (t) => {
  let providerUp = false;
  const h = bootIndex(t, {
    now: ONSET, settings: SAVER, store: awakeWithStaleForecast(ONSET),
    network: (url) => (/^https:\/\/api\.open-meteo\.com\/v1\/forecast/.test(url) && !providerUp
      ? 'error' : healthyNetwork(url)),
  });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(/"stage":"provider_data","code":"openmeteo_network_error"/), 1,
    'the onset fetch failed at the forecast request');
  assert.equal(h.store.lastIsSleeping, 'false', 'the watch is NOT recorded asleep: it was never told');

  h.minutes(3);
  assert.ok(h.count(FETCHING) >= 2, 'the failed onset fetch is retried inside the window');

  providerUp = true;
  h.minutes(10);
  assert.equal(sleepSends(h, h.weatherSends()), 1, 'IS_SLEEPING reached the watch once the network was back');
  assert.equal(h.store.lastIsSleeping, 'true', 'and only then is the watch recorded asleep');

  const fetches = h.count(FETCHING);
  h.minutes(90);
  assert.equal(h.count(FETCHING), fetches, 'from there on the saver pauses fetching, as designed');
});

test('a NACKed sleep-onset send is retried until the watch ACKs IS_SLEEPING', (t) => {
  let nacks = 1;
  const delivered = [];
  const h = bootIndex(t, {
    now: ONSET, settings: SAVER, store: awakeWithStaleForecast(ONSET),
    onSend: (dict) => {
      if ('IS_SLEEPING' in dict && nacks > 0) { nacks -= 1; return 'nack'; }
      delivered.push(dict);
      return 'ack';
    },
  });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(h.count(/"stage":"app_message","code":"nack"/), 1, 'the onset send was NACKed');
  assert.equal(h.store.lastIsSleeping, 'false', 'a NACK commits nothing');

  h.minutes(3);
  assert.equal(sleepSends(h, delivered), 1, 'the retry delivered IS_SLEEPING');
  assert.equal(h.store.lastIsSleeping, 'true');
  const fetches = h.count(FETCHING);
  h.minutes(90);
  assert.equal(h.count(FETCHING), fetches, 'then fetching pauses for the night');
});

test('a delivered onset fetch commits the sleep state at once and pauses fetching', (t) => {
  const h = bootIndex(t, { now: ONSET, settings: SAVER, store: awakeWithStaleForecast(ONSET) });
  h.ready();
  h.advance(5 * 1000);
  assert.equal(sleepSends(h, h.weatherSends()), 1);
  assert.equal(h.store.lastIsSleeping, 'true');
  h.minutes(120);
  assert.equal(h.count(FETCHING), 1, 'one fetch at onset, then the saver holds');
});

test('the commit records the value the payload CARRIED, not a reading at ACK time', (t) => {
  // Built awake half a second before the window opens, ACKed after it opened:
  // the watch was told "awake", so that is what must be recorded — a fresh
  // reading here would say "asleep" and the pause would swallow the real
  // onset send.
  const edge = new Date(2026, 0, 5, 23, 59, 59, 500).getTime();
  const h = bootIndex(t, { now: edge, settings: SAVER, store: awakeWithStaleForecast(edge), latencyMs: 400 });
  h.ready();
  h.advance(5 * 1000);
  const first = h.weatherSends();
  assert.equal(first.length, 1);
  assert.equal(Boolean(first[0].IS_SLEEPING), false, 'the payload was built awake');
  assert.equal(h.store.lastIsSleeping, 'false', 'so awake is what gets recorded');

  // The onset send comes with the next refresh slot: at once where local
  // midnight is a UTC hour, up to an hour later in a half-hour-offset zone.
  h.minutes(61);
  assert.equal(sleepSends(h, h.weatherSends()), 1, 'and the onset send still follows');
  assert.equal(h.store.lastIsSleeping, 'true');
});
