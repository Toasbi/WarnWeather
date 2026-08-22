'use strict';
// test/config-close.test.js — the settings-close decision truth table
// (src/pkjs/config-close.js). This logic lived inline in index.js's
// webviewclosed handler, untestable (index.js registers Pebble listeners at
// load and exports nothing) — and it is where the 1.13.x reset/ack bugs lived.
const test = require('node:test');
const assert = require('node:assert/strict');

const decide = require('../src/pkjs/config-close.js').decideConfigClose;

/** @returns {Object} decision for the base input with overrides applied */
const d = (over) => decide(Object.assign({
  providerOrLocationChanged: false,
  radarProviderChanged: false,
  renderSettingsChanged: false,
  fetchToggle: false,
  acked: false,
  hadWatchNotice: false,
  authBackoffActive: false,
}, over || {}));

test('a no-op close: nothing forced, nothing cleared, caches kept', () => {
  assert.deepEqual(d(), {
    needsRefetch: false, pureAck: false, forceFetch: false, clearNotice: false,
  });
});

test('each refetch trigger alone drops the caches and forces a fetch', () => {
  ['providerOrLocationChanged', 'radarProviderChanged', 'renderSettingsChanged']
    .forEach((flag) => {
      const dec = d({ [flag]: true });
      assert.equal(dec.needsRefetch, true, flag + ' must drop the weather caches');
      assert.equal(dec.forceFetch, true, flag + ' must force a fetch');
    });
});

test('the Force toggle forces a fetch without dropping the caches', () => {
  const dec = d({ fetchToggle: true });
  assert.equal(dec.forceFetch, true);
  assert.equal(dec.needsRefetch, false, 'a plain forced fetch resends what changed');
});

test('an active auth backoff forces an immediate retry on close', () => {
  // Closing the config is an explicit user action — they likely just fixed the
  // key/subscription (possibly without changing the key STRING, e.g. activating
  // One Call by Call), and a forced fetch clears the backoff.
  assert.equal(d({ authBackoffActive: true }).forceFetch, true);
});

test('a PURE ack never forces a doomed retry through an active backoff', () => {
  // Dismiss-with-no-change means "I saw it, I'm not fixing it now" — a forced
  // retry would fail again and re-raise the notice the user just dismissed.
  const dec = d({ authBackoffActive: true, acked: true, hadWatchNotice: true });
  assert.equal(dec.pureAck, true);
  assert.equal(dec.forceFetch, false);
  assert.equal(dec.clearNotice, true, 'the on-watch overlay clear is pushed instead');
});

test('an ack alongside a real change is not pure: the backoff retry proceeds', () => {
  const render = d({ authBackoffActive: true, acked: true, renderSettingsChanged: true });
  assert.equal(render.pureAck, false);
  assert.equal(render.forceFetch, true);
  const toggled = d({ authBackoffActive: true, acked: true, fetchToggle: true });
  assert.equal(toggled.pureAck, false);
  assert.equal(toggled.forceFetch, true);
});

test('clearNotice carries hadWatchNotice verbatim — precedence is the scheduler\'s', () => {
  // channel-scheduler runs the overlay clear only when no fetch is forced (a
  // successful forced fetch self-heals the overlay), so the decision does NOT
  // encode forceFetch-over-clearNotice a second time.
  assert.equal(d({ hadWatchNotice: true, renderSettingsChanged: true }).clearNotice, true);
  assert.equal(d({ hadWatchNotice: false, acked: true }).clearNotice, false,
    'an info-only dismiss needs no watch send');
});
