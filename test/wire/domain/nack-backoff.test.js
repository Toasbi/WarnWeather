// test/wire/domain/nack-backoff.test.js — the resend backoff of a message the watch keeps
// NACKing (src/pkjs/wire/domain/nack-backoff.js), which the settings channel and the status
// re-send share.
const test = require('node:test');
const assert = require('node:assert/strict');
const nackBackoff = require('../../../src/pkjs/wire/domain/nack-backoff.js');

/**
 * The minute ticks at which a resend goes while every send is NACKed.
 * @param {Object} backoff A backoff (createNackBackoff).
 * @param {number} minutes How many ticks to run.
 * @returns {number[]} The ticks that resent.
 */
function resendTicks(backoff, minutes) {
  const sent = [];
  for (let minute = 1; minute <= minutes; minute++) {
    if (!backoff.waitTick()) {
      sent.push(minute);
      backoff.nack();
    }
  }
  return sent;
}

test('a message that keeps NACKing is resent after 1, 2, then every 4 ticks', () => {
  const backoff = nackBackoff.createNackBackoff();
  assert.equal(backoff.waitTick(), false, 'nothing NACKed yet: the first resend goes at once');
  assert.deepEqual(resendTicks(backoff, 20), [1, 2, 4, 8, 12, 16, 20]);
  assert.equal(backoff.nacksInARow(), 7);
  assert.equal(nackBackoff.MAX_TICKS, 4);
});

test('an ACK ends the backoff: the next NACK is resent a tick later again', () => {
  const backoff = nackBackoff.createNackBackoff();
  resendTicks(backoff, 8);
  backoff.ack();
  assert.equal(backoff.nacksInARow(), 0);
  assert.equal(backoff.waitTick(), false, 'no wait left');
  backoff.nack();
  assert.equal(backoff.nacksInARow(), 1);
  assert.equal(backoff.waitTick(), false, 'the first NACK in a row waits no tick');
});

test('each backoff counts its own NACKs', () => {
  const settings = nackBackoff.createNackBackoff();
  const status = nackBackoff.createNackBackoff();
  settings.nack();
  settings.nack();
  assert.equal(status.nacksInARow(), 0);
  assert.equal(status.waitTick(), false);
  assert.equal(settings.waitTick(), true);
});
