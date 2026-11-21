/**
 * The days the watch has left on its charge, which the watch battery's percentage slot can
 * show in place of the percentage ("5d" for "83%").
 *
 * The watch knows its charge, not how long it will last: that is an estimate another app
 * makes from the charge it has watched fall (Muninn's plugin, read by
 * status-bars/adapter/battery-estimate.js). The phone bakes the days into the slot, and the
 * watch shows them while they can be current, else its percentage (status_row.c
 * shows_battery_days). Shared by the bake (status-lines.js) and the settings page's
 * pictures of the watch. ES5 only (aplite PKJS).
 */
(function() {
  var DAY_MS = 24 * 60 * 60 * 1000;
  // An estimate older than this is not shown: the app that makes it has stopped telling
  // (removed, or its watch app no longer runs), and the slot shows the percentage again.
  var MAX_AGE_MS = 2 * DAY_MS;
  // The most days the slot prints: three bytes at most ('99d') in an edge slot's eight.
  var MAX_DAYS = 99;

  /**
   * Whether the watch battery's percentage slot is set to show the days left (its
   * dialog's batteryPctSlotShow; the percentage unless it is exactly 'days').
   * @param {?Object} settings Settings.
   * @returns {boolean}
   */
  function wanted(settings) {
    return Boolean(settings) && settings.batteryPctSlotShow === 'days';
  }

  /**
   * An estimate as the slot can use it, from what a plugin sent.
   * @param {?number} days The days left the plugin estimates (Muninn: -1 while it has none).
   * @param {?number} updatedAt When it made the estimate, in epoch milliseconds (-1: never).
   * @returns {?{days: number, updatedAt: number}} The estimate, or null when there is none:
   *   no number, less than a day, or no time it was made at.
   */
  function estimateOf(days, updatedAt) {
    if (typeof days !== 'number' || !isFinite(days) || days < 1) { return null; }
    if (typeof updatedAt !== 'number' || !isFinite(updatedAt) || updatedAt <= 0) { return null; }
    return { days: Math.floor(days), updatedAt: updatedAt };
  }

  /**
   * The whole days the slot shows: the estimate, counted down by the whole days that have
   * passed since it was made (an estimate of 5 days reads 4 a day later, with nothing new
   * heard). Null, and the slot shows the percentage, while there is no estimate, it is
   * older than MAX_AGE_MS, or less than a day is left.
   * @param {?{days: number, updatedAt: number}} estimate The estimate (estimateOf).
   * @param {number} nowMs The current time, in epoch milliseconds.
   * @returns {?number} 1..MAX_DAYS, or null.
   */
  function daysLeft(estimate, nowMs) {
    if (!estimate || estimateOf(estimate.days, estimate.updatedAt) === null) { return null; }
    var age = nowMs - estimate.updatedAt;
    // A clock that went backwards, or an estimate stamped ahead of this phone: no age.
    if (!(age > 0)) { age = 0; }
    if (age > MAX_AGE_MS) { return null; }
    var left = Math.floor(estimate.days) - Math.floor(age / DAY_MS);
    if (left < 1) { return null; }
    return left > MAX_DAYS ? MAX_DAYS : left;
  }

  /**
   * @param {number} days Whole days (daysLeft).
   * @returns {string} What the slot prints: '5d'.
   */
  function text(days) {
    return String(days) + 'd';
  }

  var api = {
    MAX_AGE_MS: MAX_AGE_MS,
    MAX_DAYS: MAX_DAYS,
    wanted: wanted,
    estimateOf: estimateOf,
    daysLeft: daysLeft,
    text: text
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.BatteryDays = api;
  }
})();
