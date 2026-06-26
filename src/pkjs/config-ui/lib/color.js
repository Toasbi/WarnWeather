// src/pkjs/config-ui/lib/color.js — ES5. Single-source int<->hex, dual-use (PConf global + module).
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
/**
 * Convert a 24-bit integer color to an uppercase #RRGGBB hex string.
 * @param {number} n Integer color (low 24 bits used).
 * @returns {string} Hex string like '#FF8800'.
 */
function intToHex(n) { return '#' + ('000000' + (n & 0xFFFFFF).toString(16)).slice(-6).toUpperCase(); }
/**
 * Convert a #RRGGBB hex string to a 24-bit integer color.
 * @param {string} h Hex string, with or without leading '#'.
 * @returns {number} Integer color.
 */
function hexToInt(h) { return parseInt(String(h).replace(/^#/, ''), 16); }
PConf.color = { intToHex: intToHex, hexToInt: hexToInt };
if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.color; }
