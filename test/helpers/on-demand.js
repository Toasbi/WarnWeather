// test/helpers/on-demand.js — the one way a test ticks On demand items. An alert is on
// while its item is ticked on a side of a bar that exists
// (src/pkjs/on-demand.js placedAnywhere), and a settings blob WITHOUT the side keys
// reads the defaults — the Watch Status Bar ticks Wind gusts, UV index, Air quality,
// Wind speed and Rain on its right. So a test that means "these alerts and no others"
// starts from NOTHING_PLACED and ticks what it bakes.
'use strict';
const OD = require('../../src/pkjs/on-demand.js');

// Every side's list empty: nothing shows anywhere.
const NOTHING_PLACED = {};
OD.BARS.forEach((b) => OD.SIDES.forEach((side) => { NOTHING_PLACED[OD.itemsKey(b.bar, side)] = ''; }));

/**
 * Tick items on one side of one bar (the list replaced). Mutates and returns S.
 * @param {Object} S Settings blob (created when null).
 * @param {string} bar 'top' | 'forecast' | 'radar' | 'health'
 * @param {string} side 'left' | 'right'
 * @param {string[]|string} codes Item codes (an array or a comma list).
 * @returns {Object} S
 */
function placeOn(S, bar, side, codes) {
  const out = S || {};
  out[OD.itemsKey(bar, side)] = OD.canonical(Array.isArray(codes) ? codes : String(codes).split(','));
  return out;
}

/**
 * A settings blob with exactly these items ticked, on the Watch Status Bar's right side,
 * and nothing else anywhere.
 * @param {string[]|string} codes Item codes.
 * @param {Object} [extra] More settings merged over it.
 * @returns {Object} The blob.
 */
function placedOnly(codes, extra) {
  return Object.assign(placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'right', codes), extra || {});
}

module.exports = { NOTHING_PLACED, placeOn, placedOnly };
