'use strict';
// A status bar's slots in the settings, for the suites that set one up or read it back. Built
// from status-line-catalog.js LINES, so a renamed slot key fails here once.
const catalog = require('../../src/pkjs/status-bars/domain/status-line-catalog.js');

/**
 * A bar's slot keys, left to right.
 * @param {string} bar 'top' | 'forecast' | 'radar' | 'health'.
 * @returns {string[]}
 */
function slotKeys(bar) {
  return catalog.LINES.find((line) => line.id === bar).slots;
}

/**
 * A bar never set up: every slot stored Empty (as the 2.6 move stored health items where health
 * was off).
 * @param {string} bar 'top' | 'forecast' | 'radar' | 'health'.
 * @returns {Object<string, string>} slot key -> 'empty'
 */
function blankBar(bar) {
  return Object.fromEntries(slotKeys(bar).map((key) => [key, 'empty']));
}

/**
 * A bar's slots as stored, left to right.
 * @param {Object} S Settings.
 * @param {string} bar 'top' | 'forecast' | 'radar' | 'health'.
 * @returns {string[]}
 */
function slotsOf(S, bar) {
  return slotKeys(bar).map((key) => S[key]);
}

module.exports = { blankBar, slotsOf };
