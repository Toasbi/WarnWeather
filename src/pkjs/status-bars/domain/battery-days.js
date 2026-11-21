/**
 * What the watch battery slot's Text look prints: the percentage, the days the watch has
 * left on its charge ("5d"), or both ("83%|5d").
 *
 * The watch knows its charge, not how long it will last: that is an estimate another app
 * makes from the charge it has watched fall (Muninn's plugin, read by
 * status-bars/adapter/battery-estimate.js). The phone bakes the days into the slot, with
 * the place of the percentage beside them where the slot shows both (PCT_MARK, since only
 * the watch knows its charge of the moment), and the watch shows them while they can be
 * current, else its percentage alone (status_row.c shows_battery_days). Shared by the bake
 * (status-lines.js) and the settings page's pictures of the watch. ES5 only (aplite PKJS).
 */
(function() {
  var statusPair = (typeof require !== 'undefined') ? require('./status-pair.js') : window.StatusPair;

  var DAY_MS = 24 * 60 * 60 * 1000;
  // An estimate older than this is not shown: the app that makes it has stopped telling
  // (removed, or its watch app no longer runs), and the slot shows the percentage again.
  var MAX_AGE_MS = 2 * DAY_MS;
  // The most days the slot prints: three bytes at most ('99d') in an edge slot's eight.
  var MAX_DAYS = 99;
  // The app whose estimate the days are, on the Pebble appstore, and the link the settings
  // page names it with wherever it does (the slot's hints, the new-features tip).
  var MUNINN_URL = 'https://apps.repebble.com/muninn-battery-wisdom_692b3821d7dcba000a809ba5';
  var MUNINN_LINK = '<a href=\'' + MUNINN_URL + '\'>Muninn app</a>';
  // Where the watch prints its own percentage in the slot's text (status_line.h
  // STATUS_BATTERY_PCT_MARK; test/status-bars/domain/status-line-contract.test.js keeps the
  // two in lockstep). One byte on the wire, and no character a separator can hold
  // (status-pair.js sanitizeCustom keeps printable ones).
  var PCT_MARK = '\u001e';

  /**
   * What the slot's text shows (its dialog's batterySlotDisplay): 'percent' (the default,
   * and what anything unknown reads as), 'days' or 'both'.
   * @param {?Object} settings Settings.
   * @returns {string} 'percent', 'days' or 'both'
   */
  function display(settings) {
    var d = settings && settings.batterySlotDisplay;
    return d === 'days' || d === 'both' ? d : 'percent';
  }

  /**
   * Whether the slot's text needs the days left: it shows them, alone or beside the
   * percentage.
   * @param {?Object} settings Settings.
   * @returns {boolean}
   */
  function wanted(settings) {
    return display(settings) !== 'percent';
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
   * @returns {string} What the slot prints for them: '5d'.
   */
  function text(days) {
    return String(days) + 'd';
  }

  /**
   * The text the slot carries to the watch: none for the percentage alone (the watch
   * prints its own) and while there are no days to show, the days ('5d'), or the pair with
   * the place of the percentage in it (PCT_MARK + '|5d'), in the order and with the
   * separator its dialog sets (status-pair.js formatBatteryPair).
   * @param {?number} days The days left (daysLeft), or null for none.
   * @param {?Object} settings Settings.
   * @param {number} cap The slot's byte cap.
   * @returns {string}
   */
  function slotText(days, settings, cap) {
    var shown = display(settings);
    if (shown === 'percent' || days === null || typeof days !== 'number') { return ''; }
    if (shown === 'days') { return text(days); }
    return statusPair.formatBatteryPair(PCT_MARK, text(days), settings, cap);
  }

  /**
   * A carried text as the watch draws it: the percentage in place of its mark
   * (status_line.h status_battery_text), or the percentage alone for no text.
   * @param {string} carried The slot's text (slotText).
   * @param {string} percent The percentage as the watch prints it ('80%').
   * @returns {string} e.g. '80%', '5d', '80%|5d'
   */
  function drawn(carried, percent) {
    return carried ? carried.split(PCT_MARK).join(percent) : percent;
  }

  var api = {
    MAX_AGE_MS: MAX_AGE_MS,
    MAX_DAYS: MAX_DAYS,
    MUNINN_URL: MUNINN_URL,
    MUNINN_LINK: MUNINN_LINK,
    PCT_MARK: PCT_MARK,
    display: display,
    wanted: wanted,
    estimateOf: estimateOf,
    daysLeft: daysLeft,
    text: text,
    slotText: slotText,
    drawn: drawn
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.BatteryDays = api;
  }
})();
