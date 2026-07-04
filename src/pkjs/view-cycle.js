// src/pkjs/view-cycle.js
// Single source of truth for the layout-preset matrix and the packed per-slot
// ViewSpec wire byte. ES5 only (required from clay-payload.js at watch runtime).
// Also required by settings/blocks.js (config-UI preview) and the node tests.

var TIER_OFF = 0, TIER_NONE = 1, TIER_COMPACT = 2, TIER_FULL = 3;
var TOP_EMPTY = 0, TOP_CAL = 1, TOP_RADAR = 2;
var BODY_FC = 0, BODY_GRAPH = 1, BODY_RADAR = 2;
var ST_W = 0, ST_H = 1, ST_D = 2, ST_NONE = 3;

/**
 * Build a view spec object.
 * @param {number} tier TIER_* value.
 * @param {number} top TOP_* value.
 * @param {number} body BODY_* value.
 * @param {number} status ST_* value.
 * @returns {{tier:number,top:number,body:number,status:number}}
 */
function spec(tier, top, body, status) {
  return { tier: tier, top: top, body: body, status: status };
}

/**
 * Pack a view spec into one wire byte. Null (disabled slot) → 0.
 * @param {?{tier:number,top:number,body:number,status:number}} s
 * @returns {number} uint8
 */
function packSpec(s) {
  if (!s) { return 0; }
  return ((s.tier & 3) << 6) | ((s.top & 3) << 4) | ((s.body & 3) << 2) | (s.status & 3);
}

/**
 * Decode a wire byte to a spec. 0 → null (disabled slot).
 * @param {number} b uint8
 * @returns {?{tier:number,top:number,body:number,status:number}}
 */
function unpackSpec(b) {
  if (!b) { return null; }
  return spec((b >> 6) & 3, (b >> 4) & 3, (b >> 2) & 3, b & 3);
}

module.exports = {
  TIER_OFF: TIER_OFF, TIER_NONE: TIER_NONE, TIER_COMPACT: TIER_COMPACT, TIER_FULL: TIER_FULL,
  TOP_EMPTY: TOP_EMPTY, TOP_CAL: TOP_CAL, TOP_RADAR: TOP_RADAR,
  BODY_FC: BODY_FC, BODY_GRAPH: BODY_GRAPH, BODY_RADAR: BODY_RADAR,
  ST_W: ST_W, ST_H: ST_H, ST_D: ST_D, ST_NONE: ST_NONE,
  spec: spec, packSpec: packSpec, unpackSpec: unpackSpec
};
