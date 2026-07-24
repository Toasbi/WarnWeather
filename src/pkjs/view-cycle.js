// src/pkjs/view-cycle.js
// Single source of truth for the layout-preset matrix and the packed per-slot
// ViewSpec wire byte. ES5 only (required from clay-payload.js at watch runtime).
// Also required by settings/blocks.js (config-UI preview) and the node tests.

var TIER_OFF = 0, TIER_NONE = 1, TIER_COMPACT = 2, TIER_FULL = 3;
var TOP_EMPTY = 0, TOP_CAL = 1, TOP_RADAR = 2;
// Unlike `top` above (deliberately renumbered and translated by view_spec_unpack()),
// these numberings must stay bit-for-bit identical to BodyContent/StatusRowContent in
// src/c/windows/layout.h — the packed wire byte passes them through untranslated.
// RADAR_STATUS retired — radar flavor now lives in a status row (statusUpper/statusLower).
var BODY_FC = 0, BODY_GRAPH = 1, BODY_RADAR = 2;
// Positional status sources: which content feeds the upper/lower status row.
var STATUS_SRC_NONE = 0, STATUS_SRC_FORECAST = 1, STATUS_SRC_RADAR = 2, STATUS_SRC_HEALTH = 3;

/**
 * Build a view spec object.
 * @param {number} tier TIER_* value.
 * @param {number} top TOP_* value.
 * @param {number} body BODY_* value.
 * @param {number} statusUpper STATUS_SRC_* value for the upper status row.
 * @param {number} statusLower STATUS_SRC_* value for the lower status row.
 * @returns {{tier:number,top:number,body:number,statusUpper:number,statusLower:number}}
 */
function spec(tier, top, body, statusUpper, statusLower) {
  return { tier: tier, top: top, body: body,
           statusUpper: statusUpper, statusLower: statusLower };
}

/**
 * Pack a view spec into one 10-bit wire value. Null (disabled slot) → 0.
 * Bit layout (LSB→MSB): statusLower(0-1) | statusUpper(2-3) | body(4-5) |
 * top(6-7) | tier(8-9).
 * @param {?{tier:number,top:number,body:number,statusUpper:number,statusLower:number}} s
 * @returns {number} uint16 (fits in 10 bits)
 */
function packSpec(s) {
  if (!s) { return 0; }
  return ((s.tier & 3) << 8) | ((s.top & 3) << 6) | ((s.body & 3) << 4)
       | ((s.statusUpper & 3) << 2) | (s.statusLower & 3);
}

/**
 * Decode a packed wire value to a spec. 0 → null (disabled slot).
 * @param {number} v uint16 (10-bit)
 * @returns {?{tier:number,top:number,body:number,statusUpper:number,statusLower:number}}
 */
function unpackSpec(v) {
  if (!v) { return null; }
  return spec((v >> 8) & 3, (v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3);
}

// Named views (see the design doc's view vocabulary). Positional status:
// tier, top, body, statusUpper, statusLower.
var CAL3_FC_W    = spec(TIER_FULL,    TOP_CAL,   BODY_FC,    STATUS_SRC_FORECAST, STATUS_SRC_NONE);
var CAL3_RDR_W   = spec(TIER_FULL,    TOP_CAL,   BODY_RADAR, STATUS_SRC_RADAR,    STATUS_SRC_NONE);
var CAL2_FC_W    = spec(TIER_COMPACT, TOP_CAL,   BODY_FC,    STATUS_SRC_FORECAST, STATUS_SRC_NONE);
var CAL2_FC_H    = spec(TIER_COMPACT, TOP_CAL,   BODY_FC,    STATUS_SRC_HEALTH,   STATUS_SRC_NONE);
var CAL2_HF_D    = spec(TIER_COMPACT, TOP_CAL,   BODY_FC,    STATUS_SRC_HEALTH,   STATUS_SRC_FORECAST);
var CAL2_RF_D    = spec(TIER_COMPACT, TOP_CAL,   BODY_FC,    STATUS_SRC_RADAR,    STATUS_SRC_FORECAST);
var CAL2_RDR_W   = spec(TIER_COMPACT, TOP_CAL,   BODY_RADAR, STATUS_SRC_RADAR,    STATUS_SRC_NONE);
var CAL2_GRAPH_D = spec(TIER_COMPACT, TOP_CAL,   BODY_GRAPH, STATUS_SRC_HEALTH,   STATUS_SRC_FORECAST);
var NONE_FC_W    = spec(TIER_NONE,    TOP_EMPTY, BODY_FC,    STATUS_SRC_FORECAST, STATUS_SRC_NONE);
var NONE_FC_H    = spec(TIER_NONE,    TOP_EMPTY, BODY_FC,    STATUS_SRC_HEALTH,   STATUS_SRC_NONE);
var NONE_GRAPH_H = spec(TIER_NONE,    TOP_EMPTY, BODY_GRAPH, STATUS_SRC_HEALTH,   STATUS_SRC_NONE);
var NONE_RDR_W   = spec(TIER_NONE,    TOP_EMPTY, BODY_RADAR, STATUS_SRC_RADAR,    STATUS_SRC_NONE);

// preset -> healthMode-bucket -> radar-key ('n'|'r') -> cycle. 'r' is the radar-enabled
// (graph-flavor) cycle; radarMode='status' demotes its BODY_RADAR slot to BODY_FC below
// (see demoteRadarBody) while keeping the RADAR status row, so the forecast graph stays
// and only the status line turns radar — radarMode='graph' keeps the chart.
var MATRIX = {
  fullCal: {
    off:    { n: [CAL3_FC_W],              r: [CAL3_FC_W, CAL3_RDR_W] },
    status: { n: [CAL3_FC_W, CAL2_HF_D],   r: [CAL3_FC_W, CAL2_HF_D, CAL3_RDR_W] },
    all:    { n: [CAL3_FC_W, NONE_GRAPH_H],r: [CAL3_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  },
  compactCal: {
    off:    { n: [CAL2_FC_W],              r: [CAL2_FC_W, CAL2_RDR_W] },
    status: { n: [CAL2_FC_W, CAL2_FC_H],   r: [CAL2_FC_W, CAL2_FC_H, CAL2_RDR_W] },
    all:    { n: [CAL2_FC_W, NONE_GRAPH_H],r: [CAL2_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  },
  compactDense: {
    off:    { n: [CAL2_FC_W],              r: [CAL2_FC_W, CAL2_RDR_W] },
    status: { n: [CAL2_HF_D],              r: [CAL2_HF_D, CAL2_RDR_W] },
    all:    { n: [CAL2_HF_D, CAL2_GRAPH_D],r: [CAL2_HF_D, CAL2_GRAPH_D, CAL2_RDR_W] }
  },
  noCal: {
    off:    { n: [NONE_FC_W],              r: [NONE_FC_W, NONE_RDR_W] },
    status: { n: [NONE_FC_W, NONE_FC_H],   r: [NONE_FC_W, NONE_FC_H, NONE_RDR_W] },
    all:    { n: [NONE_FC_W, NONE_GRAPH_H],r: [NONE_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  }
};

/**
 * Move a single upper status row to the lower band (compactCal only — the one preset
 * with a movable single row above the clock; see the "Swap clock and status row" toggle).
 * A no-op when there's no single upper-only row to move (e.g. a dual view, or NONE).
 * @param {{tier:number,top:number,body:number,statusUpper:number,statusLower:number}} s
 * @returns {{tier:number,top:number,body:number,statusUpper:number,statusLower:number}}
 */
function swapUpperToLower(s) {
  if (s.statusUpper !== STATUS_SRC_NONE && s.statusLower === STATUS_SRC_NONE) {
    return spec(s.tier, s.top, s.body, STATUS_SRC_NONE, s.statusUpper);
  }
  return s;
}

/**
 * Demote a radar-chart body to plain forecast for radarMode='status': the MATRIX's 'r'
 * cycle is built radar-graph-flavored (BODY_RADAR, chart), so a genuine radarMode='status'
 * ("Adds the Radar Status Bar while retaining the forecast graph" — schema.js) needs the
 * chart body downgraded to BODY_FC. The STATUS_SRC_RADAR row already on that slot is left
 * untouched — it's already correct, so no BODY_RADAR_STATUS-style enum value is needed.
 * @param {{tier:number,top:number,body:number,statusUpper:number,statusLower:number}} s
 * @returns {{tier:number,top:number,body:number,statusUpper:number,statusLower:number}}
 */
function demoteRadarBody(s) {
  return s.body === BODY_RADAR ? spec(s.tier, s.top, BODY_FC, s.statusUpper, s.statusLower) : s;
}

/**
 * Compile a preset + health mode + radar mode (+ optional swap) to the 1–3 view cycle.
 * 'status'/'graph' both include a radar flick view; 'off'/'countdown' do not. Only radar
 * specs are ever cloned (demoteRadarBody/swapUpperToLower), so the shared MATRIX/named-view
 * constants are never mutated.
 * @param {string} presetKey 'fullCal'|'compactCal'|'compactDense'|'noCal'
 * @param {string} healthMode 'off'|'slot'|'status'|'all'
 * @param {string} radarMode 'off'|'countdown'|'status'|'graph'
 * @param {boolean} [swapClockStatus] Move a single upper status row to the lower band
 *   (compactCal only). Defaults to false.
 * @returns {Array<{tier:number,top:number,body:number,statusUpper:number,statusLower:number}>}
 */
function buildViewCycle(presetKey, healthMode, radarMode, swapClockStatus) {
  var byPreset = MATRIX[presetKey] || MATRIX.compactCal;
  // 'slot' shows health only in the regular status bars — it adds no dedicated
  // Health view, so its flick cycle is identical to 'off'.
  var mode = (healthMode === 'slot') ? 'off' : healthMode;
  var byHealth = byPreset[mode] || byPreset.off;
  var radarShowsView = (radarMode === 'status' || radarMode === 'graph');
  var cycle = byHealth[radarShowsView ? 'r' : 'n'];

  // compactDense + radar='status' + health has no bar (off/slot): fold radar into the
  // single dense default (radar upper, forecast lower); drop the radar flick.
  if (presetKey === 'compactDense' && radarMode === 'status' && mode === 'off') {
    return [CAL2_RF_D];
  }
  if (radarMode === 'status') {
    cycle = cycle.map(demoteRadarBody);
  }
  if (swapClockStatus && presetKey === 'compactCal') {
    cycle = cycle.map(swapUpperToLower);
  }
  return cycle;
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
  STATUS_SRC_NONE: STATUS_SRC_NONE, STATUS_SRC_FORECAST: STATUS_SRC_FORECAST,
  STATUS_SRC_RADAR: STATUS_SRC_RADAR, STATUS_SRC_HEALTH: STATUS_SRC_HEALTH,
  spec: spec, packSpec: packSpec, unpackSpec: unpackSpec,
  buildViewCycle: buildViewCycle, resolvePresetKey: resolvePresetKey
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VIEW_CYCLE;
}
