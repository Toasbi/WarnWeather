// src/pkjs/config-ui/lib/color.js — ES5. Single-source int<->hex, dual-use (PConf global + module).
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
function intToHex(n) { return '#' + ('000000' + (n & 0xFFFFFF).toString(16)).slice(-6).toUpperCase(); }
function hexToInt(h) { return parseInt(String(h).replace(/^#/, ''), 16); }
PConf.color = { intToHex: intToHex, hexToInt: hexToInt };
if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.color; }
