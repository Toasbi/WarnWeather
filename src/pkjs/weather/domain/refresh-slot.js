// src/pkjs/weather/domain/refresh-slot.js — ES5, watch runtime.
//
// The refresh slot: a UTC-aligned chunk of an interval since the epoch. A weather fetch is
// due once the clock is in a later slot of the update interval than the last success
// (shell/fetch-cycle.js), a forecast snapshot serves the rest of its slot
// (forecast-snapshot.js), and a throttled source asks once per slot of its own interval
// (weather/adapter/radar/request-throttle.js).

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
 * The update interval, whose slots the weather fetches follow.
 *
 * @param {Object} settings Clay settings (fetchIntervalMin, minutes, as stored: a string).
 * @returns {number} The interval in ms; NaN for a value that is no number.
 */
function updateIntervalMs(settings) {
    return settings.fetchIntervalMin * 60 * 1000;
}

module.exports = { isPastSlot: isPastSlot, updateIntervalMs: updateIntervalMs };
