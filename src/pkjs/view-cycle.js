// src/pkjs/view-cycle.js
// Single source of truth for the layout-preset matrix and the packed per-slot
// ViewSpec wire byte. ES5 only (required from clay-payload.js at watch runtime).
// Also required by settings/blocks.js (config-UI preview) and the node tests.

var TIER_OFF = 0, TIER_NONE = 1, TIER_COMPACT = 2, TIER_FULL = 3;
var TOP_EMPTY = 0, TOP_CAL = 1, TOP_RADAR = 2;
// Unlike `top` above (deliberately renumbered and translated by view_spec_unpack()),
// these numberings must stay bit-for-bit identical to BodyContent/StatusRowContent in
// src/c/windows/layout.h — the packed wire byte passes them through untranslated.
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

// Named views (see the design doc's view vocabulary).
var CAL3_FC_W    = spec(TIER_FULL, TOP_CAL, BODY_FC, ST_W);
var CAL3_RDR_W   = spec(TIER_FULL, TOP_CAL, BODY_RADAR, ST_W);
var CAL2_FC_W    = spec(TIER_COMPACT, TOP_CAL, BODY_FC, ST_W);
var CAL2_FC_H    = spec(TIER_COMPACT, TOP_CAL, BODY_FC, ST_H);
var CAL2_FC_D    = spec(TIER_COMPACT, TOP_CAL, BODY_FC, ST_D);
var CAL2_RDR_W   = spec(TIER_COMPACT, TOP_CAL, BODY_RADAR, ST_W);
var CAL2_RDR_D   = spec(TIER_COMPACT, TOP_CAL, BODY_RADAR, ST_D);
var CAL2_GRAPH_D = spec(TIER_COMPACT, TOP_CAL, BODY_GRAPH, ST_D);
var NONE_FC_W    = spec(TIER_NONE, TOP_EMPTY, BODY_FC, ST_W);
var NONE_FC_H    = spec(TIER_NONE, TOP_EMPTY, BODY_FC, ST_H);
var NONE_GRAPH_H = spec(TIER_NONE, TOP_EMPTY, BODY_GRAPH, ST_H);
var NONE_RDR_W   = spec(TIER_NONE, TOP_EMPTY, BODY_RADAR, ST_W);

// preset -> healthMode -> radar-key ('r' = radar on, 'n' = off) -> cycle.
var MATRIX = {
  fullCal: {
    off:    { n: [CAL3_FC_W],           r: [CAL3_FC_W, CAL3_RDR_W] },
    // radar flick shows radar as the body (calendar on top), matching the off variant —
    // not radar-on-top with a squeezed forecast.
    status: { n: [CAL3_FC_W, CAL2_FC_D], r: [CAL3_FC_W, CAL2_FC_D, CAL3_RDR_W] },
    all:    { n: [CAL3_FC_W, NONE_GRAPH_H], r: [CAL3_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  },
  compactCal: {
    off:    { n: [CAL2_FC_W],           r: [CAL2_FC_W, CAL2_RDR_W] },
    // radar flick moves radar down into the body (calendar on top), matching the off
    // variant — not radar-on-top.
    status: { n: [CAL2_FC_W, CAL2_FC_H], r: [CAL2_FC_W, CAL2_FC_H, CAL2_RDR_W] },
    // default stays the compact 2-row calendar (was CAL3_FC_W — a 3-row default under the
    // Compact preset); big graph/radar flicks follow.
    all:    { n: [CAL2_FC_W, NONE_GRAPH_H], r: [CAL2_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  },
  compactDense: {
    off:    { n: [CAL2_FC_W],           r: [CAL2_FC_W, CAL2_RDR_W] },
    // radar flick shows radar in the body (dual-status dense), consistent with the other
    // presets — not radar-on-top.
    status: { n: [CAL2_FC_D],           r: [CAL2_FC_D, CAL2_RDR_D] },
    all:    { n: [CAL2_FC_D, CAL2_GRAPH_D], r: [CAL2_FC_D, CAL2_GRAPH_D, CAL2_RDR_D] }
  },
  noCal: {
    off:    { n: [NONE_FC_W],           r: [NONE_FC_W, NONE_RDR_W] },
    status: { n: [NONE_FC_W, NONE_FC_H], r: [NONE_FC_W, NONE_FC_H, NONE_RDR_W] },
    all:    { n: [NONE_FC_W, NONE_GRAPH_H], r: [NONE_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  }
};

/**
 * Compile a preset + health mode + radar availability to the 1–3 view cycle.
 * @param {string} presetKey 'fullCal'|'compactCal'|'compactDense'|'noCal'
 * @param {string} healthMode 'off'|'slot'|'status'|'all'
 * @param {boolean} radarEnabled
 * @returns {Array<{tier:number,top:number,body:number,status:number}>}
 */
function buildViewCycle(presetKey, healthMode, radarEnabled) {
  var byPreset = MATRIX[presetKey] || MATRIX.compactCal;
  // 'slot' shows health only in the regular status bars — it adds no dedicated
  // Health view, so its flick cycle is identical to 'off'.
  var mode = (healthMode === 'slot') ? 'off' : healthMode;
  var byHealth = byPreset[mode] || byPreset.off;
  return byHealth[radarEnabled ? 'r' : 'n'];
}

var NEW_KEYS = { fullCal: 1, compactCal: 1, compactDense: 1, noCal: 1 };
// legacy layoutPreset -> new. fullCal is unchanged (key kept, new semantics).
var LEGACY_PRESET = {
  classic: 'compactCal', radarLast: 'compactCal', healthFirst: 'compactCal',
  forecast: 'noCal', fullCal: 'fullCal'
};

/**
 * Resolve the effective preset key from a settings object, migrating legacy values.
 * @param {Object} state Clay settings (or config-UI state).
 * @returns {string} one of fullCal|compactCal|compactDense|noCal
 */
function resolvePresetKey(state) {
  state = state || {};
  var p = state.layoutPreset;
  if (p && NEW_KEYS[p]) { return p; }
  if (p && LEGACY_PRESET[p]) { return LEGACY_PRESET[p]; }
  if (state.topViewMode === 'full') { return 'fullCal'; }
  if (state.topViewMode === 'none') { return 'noCal'; }
  return 'compactCal';
}

// Single public API object, defined once. As a CommonJS module (watch runtime, tests)
// this is module.exports. When this file is instead concatenated as a plain <script> into
// the config-UI webview (see scripts/build-config-page.js, which has no `module`),
// settings/blocks.js reads this same VIEW_CYCLE object from the shared top-level scope
// rather than require()-ing it — one export list, no hand-copied duplicate to drift.
var VIEW_CYCLE = {
  TIER_OFF: TIER_OFF, TIER_NONE: TIER_NONE, TIER_COMPACT: TIER_COMPACT, TIER_FULL: TIER_FULL,
  TOP_EMPTY: TOP_EMPTY, TOP_CAL: TOP_CAL, TOP_RADAR: TOP_RADAR,
  BODY_FC: BODY_FC, BODY_GRAPH: BODY_GRAPH, BODY_RADAR: BODY_RADAR,
  ST_W: ST_W, ST_H: ST_H, ST_D: ST_D, ST_NONE: ST_NONE,
  spec: spec, packSpec: packSpec, unpackSpec: unpackSpec,
  buildViewCycle: buildViewCycle, resolvePresetKey: resolvePresetKey
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VIEW_CYCLE;
}
