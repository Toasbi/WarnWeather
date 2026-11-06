'use strict';

// Reading a feed's numbers: a value counts only when it is a finite number, and a field a feed may
// leave out falls back to the next candidate (a reported value, then the one derived for it).

/**
 * @param {*} value Candidate.
 * @returns {boolean} True for a finite number.
 */
function isNumber(value) {
  return typeof value === 'number' && isFinite(value);
}

/**
 * @param {*} value Candidate.
 * @returns {number|null} The value when it is a finite number, else null.
 */
function num(value) {
  return isNumber(value) ? value : null;
}

/**
 * The first finite number among the arguments.
 *
 * @param {...*} values Candidates, in order of preference.
 * @returns {number|null} The first number, or null.
 */
function first() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (isNumber(arguments[i])) {
      return arguments[i];
    }
  }
  return null;
}

module.exports = { isNumber, num, first };
