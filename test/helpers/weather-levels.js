// test/helpers/weather-levels.js — read a weather kind's highlight off the public
// wire (status-thresholds' packWeatherLevels, the STATUS_LEVELS_UINT8 bytes) rather
// than through the module's internals. Shared by test/status-thresholds.test.js and
// test/day-max-slots.test.js, which both pin what the highlight judges.
'use strict';
const assert = require('node:assert/strict');
const th = require('../../src/pkjs/status-thresholds.js');

/**
 * One weather kind's 2-bit level off packWeatherLevels' wire bytes: kinds 0..3 at
 * bits 2k of byte 0, UV (kind 7) at bits 0-1 of byte 1.
 * @param {string} code A weather kind's code.
 * @param {Object} payload Weather payload.
 * @param {Object} settings Clay settings blob.
 * @returns {number} 0 normal / 1 warn / 2 danger
 */
function packedLevel(code, payload, settings) {
  const k = th.KINDS.findIndex((x) => x.code === code);
  const bytes = th.packWeatherLevels(payload, settings);
  return ((bytes[0] | (bytes[1] << 8)) >> (k <= 3 ? 2 * k : 8)) & 3;
}

/**
 * The number a weather kind's highlight judges. Under a stored pair (v, v + 0.25)
 * the kind packs warn exactly when that number is v, since every judged number sits
 * on the 0.5 grid (whole display numbers, pollen's half-bands); under (0, 0) any
 * number at all packs danger, so a kind that packs normal there judges nothing.
 * The stored pair is the day-max hold rule's warn too, so this reads only picks
 * that do not hang on the hold: the Now mode, a today's peak still ahead of now,
 * and pollen.
 * @param {string} code A weather kind's code.
 * @param {Object} payload Weather payload.
 * @param {Object} settings Clay settings blob (its own pair for the kind is ignored).
 * @returns {?number} the judged number; null when the kind judges none
 */
function judged(code, payload, settings) {
  const key = th.KINDS.find((k) => k.code === code).key;
  const at = (warn, danger) => packedLevel(code, payload, Object.assign({}, settings, {
    ['thresh' + key + 'Warn']: String(warn), ['thresh' + key + 'Danger']: String(danger)
  }));
  if (at(0, 0) === 0) { return null; }
  for (let v = 0; v <= 1000; v += 0.5) {
    if (at(v, v + 0.25) === 1) { return v; }
  }
  return assert.fail(code + ': the judged number is off the 0..1000 grid');
}

module.exports = { packedLevel, judged };
