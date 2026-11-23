// src/pkjs/wire/domain/nack-backoff.js — ES5. How long the resend of a message the watch keeps
// NACKing waits, in minute ticks: the n-th NACK in a row waits 2^(n-1) ticks, at most MAX_TICKS
// (1, 2, then every 4). A resend every minute woke a watch that was refusing. An ACK, or the
// outbox's no-op, ends it. The cap is short on purpose: PKJS has no sign that an unreachable
// watch is back, so it bounds how late news held up by an outage arrives. Kept in memory: a
// PKJS restart retries at its first tick. The settings channel (channel-scheduler.js) and the
// status re-send (status-rebake.js) each keep one.

var MAX_TICKS = 4;

/**
 * A fresh backoff: nothing NACKed yet, so the next resend goes at the next tick.
 * @returns {{nack: function():void, ack: function():void, waitTick: function():boolean,
 *   nacksInARow: function():number}}
 */
function createNackBackoff() {
    var nacks = 0;
    var wait = 0;
    return {
        /** A send was NACKed: the resend waits one more step. @returns {void} */
        nack: function () {
            nacks += 1;
            wait = Math.min(Math.pow(2, Math.min(nacks, 6) - 1), MAX_TICKS) - 1;
        },
        /** A send was ACKed (or had nothing new): the next resend goes at once. @returns {void} */
        ack: function () {
            nacks = 0;
            wait = 0;
        },
        /**
         * A tick that would resend: counts one tick off the wait.
         * @returns {boolean} Whether the resend still waits at this tick.
         */
        waitTick: function () {
            if (wait > 0) {
                wait -= 1;
                return true;
            }
            return false;
        },
        /** @returns {number} How many sends were NACKed since the last ACK. */
        nacksInARow: function () {
            return nacks;
        }
    };
}

module.exports = { createNackBackoff: createNackBackoff, MAX_TICKS: MAX_TICKS };
