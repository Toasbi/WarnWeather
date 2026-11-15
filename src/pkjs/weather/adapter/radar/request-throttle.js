// src/pkjs/weather/adapter/radar/request-throttle.js — ES5, watch runtime.
//
// One request per UTC-aligned slot of a source's own interval, wherever the watch is: the
// throttle is purely time-based and keeps no position. The cycles in between re-serve the
// slot's answer, kept on the slot's record in localStorage and read and written at call
// time only (fetch-cycle.js loads with no globals installed). Two throttles use it:
// - the radar's (radar-factory.js minRequestIntervalMs: the shared Rainbow proxy), whose
//   failures and timeouts count, so a failing proxy is not hammered;
// - the sky rows' (radar-sky-source.js minRequestIntervalMs), whose failures do not, so
//   the next cycle asks again.

/**
 * Slot-boundary check: true when `nowMs` sits in a later interval slot than
 * `lastTimeMs`. Slots are UTC-aligned chunks of `intervalMs` since the epoch, so a
 * 5/10/15-min cadence crosses a 30-min slot at :00 and :30 with no tick-drift skips.
 *
 * @param {number} lastTimeMs The earlier time, epoch ms.
 * @param {number} nowMs Current epoch ms.
 * @param {number} intervalMs Slot length in ms.
 * @returns {boolean} True when a new slot has begun.
 */
function isPastSlot(lastTimeMs, nowMs, intervalMs) {
    return Math.floor(nowMs / intervalMs) > Math.floor(lastTimeMs / intervalMs);
}

/**
 * A request throttle over one localStorage record, {id, at, <answerField>}.
 *
 * Accepted edge cases:
 * - A forced fetch next to a slot boundary (say 10:28) plus the scheduled one right after
 *   it (10:30) make two requests: at most one extra request per forced fetch.
 * - A move within the slot does not ask again: the throttled cycles re-serve the slot's
 *   answer for the place it was asked for, and the next slot asks for the new position.
 *
 * @param {{key: string, answerField: string, failuresCount: boolean}} options The storage
 *   key, the record's answer field, and whether a request without an answer (a failure,
 *   a timeout) still holds its slot: true records the request before it goes out, false
 *   records it only with its answer.
 * @returns {{take: Function, remember: Function}} The throttle.
 */
function createRequestThrottle(options) {
    var key = options.key;
    var field = options.answerField;
    var failuresCount = Boolean(options.failuresCount);

    /**
     * The persisted record, or null when missing or unreadable. Only id and at are
     * required (any other field, such as the lat/lon an earlier dev build stored, is
     * ignored); a throttle whose failures do not count also needs the answer.
     * @returns {?Object} Record.
     */
    function read() {
        try {
            var rec = JSON.parse(localStorage.getItem(key));
            if (!rec || typeof rec.id !== 'string' || typeof rec.at !== 'number' || !isFinite(rec.at)) { return null; }
            return failuresCount || (rec[field] && typeof rec[field] === 'object') ? rec : null;
        } catch (e) { return null; }
    }

    /**
     * Decide this cycle's request: none while the record holds this slot (re-serve its
     * answer), else one, and always when forced (settings change incl. switching to the
     * source, the watch reporting no forecast, reset). An interval of 0 (a source that is
     * not throttled, or one that can never answer) forgets the record.
     * @param {string} id The source id.
     * @param {number} intervalMs The source's slot length (0 = not throttled).
     * @param {number} nowMs Current epoch ms.
     * @param {boolean} force Whether this fetch was forced.
     * @returns {{request: boolean, answer: ?Object, id: string, at: number, intervalMs: number}}
     *   request false = throttled, re-serve `answer` (null = the slot's request got none);
     *   the rest is what remember() needs.
     */
    function take(id, intervalMs, nowMs, force) {
        var slot = { request: true, answer: null, id: id, at: nowMs, intervalMs: intervalMs };
        try {
            if (!(intervalMs > 0)) {
                if (localStorage.getItem(key) !== null) { localStorage.removeItem(key); }
                return slot;
            }
            var last = read();
            if (!force && last && last.id === id && nowMs >= last.at && !isPastSlot(last.at, nowMs, intervalMs)) {
                slot.request = false;
                slot.answer = last[field] || null;
                return slot;
            }
            if (failuresCount) { localStorage.setItem(key, JSON.stringify({ id: id, at: nowMs })); }
        } catch (e) {
            // A full/broken store: request anyway. This runs inside the async coordinates
            // callback, outside start()'s try, so it must not throw.
        }
        return slot;
    }

    /**
     * Keep a slot's answer for the throttled cycles of the same slot to re-serve (the
     * outbox's compare makes that a no-op once it is on the watch; after a failed
     * forecast, a NACK or the watchdog it is what gets it there). A null (transient) keeps
     * nothing.
     * @param {{request: boolean, id: string, at: number, intervalMs: number}} slot What
     *   take() returned for the request.
     * @param {?Object} answer The source's answer.
     * @returns {void}
     */
    function remember(slot, answer) {
        if (!answer || !slot.request || !(slot.intervalMs > 0)) { return; }
        try {
            var rec = failuresCount ? read() : { id: slot.id, at: slot.at };
            if (!rec || rec.id !== slot.id || rec.at !== slot.at) { return; }   // a later request owns the record
            rec[field] = answer;
            localStorage.setItem(key, JSON.stringify(rec));
        } catch (e) {
            // Best effort: without it the throttled cycles answer null, or the next one asks again.
        }
    }

    return { take: take, remember: remember };
}

module.exports = { createRequestThrottle: createRequestThrottle, isPastSlot: isPastSlot };
