// src/pkjs/view-cycle.js
// Single source of truth for the layout-preset matrix and the packed per-slot
// ViewSpec wire byte. ES5 only (required from clay-payload.js at watch runtime).
// Also read by settings/preview-layout.js (config-UI preview) and the node tests.

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
 * Clone a spec, preserving the custom-layout fields (clockOff/stripOff/order) that
 * the 5-arg spec() builder does not carry. Every cycle transform MUST clone through
 * this helper — cloning via spec() silently drops the flags (pinned by a test).
 * Canonical form: the fields are attached only when set (absent === off/0), so
 * preset constants stay flag-free and pack byte-identically to pre-custom builds.
 * @param {{tier:number,top:number,body:number,statusUpper:number,statusLower:number,
 *          clockOff:(boolean|undefined),stripOff:(boolean|undefined),order:(number|undefined)}} s
 * @returns {!Object} an independent copy with the same canonical fields
 */
function cloneSpec(s) {
  var out = spec(s.tier, s.top, s.body, s.statusUpper, s.statusLower);
  if (s.clockOff) { out.clockOff = true; }
  if (s.stripOff) { out.stripOff = true; }
  if (s.order) { out.order = s.order; }
  return out;
}

/**
 * Pack a view spec into one 16-bit wire value. Null (disabled slot) → 0.
 * Bit layout (LSB→MSB): statusLower(0-1) | statusUpper(2-3) | body(4-5) |
 * top(6-7) | tier(8-9) | clockOff(10) | stripOff(11) | order(12-15).
 * Bits 10-15 are custom-layout-only: preset specs never carry the fields, so every
 * preset packs to the same 10-bit value as pre-custom builds (pinned by a test).
 * Values with bit 15 set exceed 0x7FFF and ride the AppMessage int16 as negative;
 * the watch recovers all 16 bits via its (uint16_t) cast (config_wire.c).
 * @param {?{tier:number,top:number,body:number,statusUpper:number,statusLower:number,
 *           clockOff:(boolean|undefined),stripOff:(boolean|undefined),order:(number|undefined)}} s
 * @returns {number} uint16
 */
function packSpec(s) {
  if (!s) { return 0; }
  return ((s.tier & 3) << 8) | ((s.top & 3) << 6) | ((s.body & 3) << 4)
       | ((s.statusUpper & 3) << 2) | (s.statusLower & 3)
       | ((s.clockOff ? 1 : 0) << 10) | ((s.stripOff ? 1 : 0) << 11)
       | ((s.order & 15) << 12);
}

/**
 * Decode a packed wire value to a spec. 0 → null (disabled slot).
 * Custom-layout fields come back in canonical form: attached only when set.
 * @param {number} v uint16
 * @returns {?{tier:number,top:number,body:number,statusUpper:number,statusLower:number,
 *             clockOff:(boolean|undefined),stripOff:(boolean|undefined),order:(number|undefined)}}
 */
function unpackSpec(v) {
  if (!v) { return null; }
  var s = spec((v >> 8) & 3, (v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3);
  if ((v >> 10) & 1) { s.clockOff = true; }
  if ((v >> 11) & 1) { s.stripOff = true; }
  if ((v >> 12) & 15) { s.order = (v >> 12) & 15; }
  return s;
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
// compactDense radar flicks: the dense preset stays DENSE on the radar view too
// (radarMode='status' demotes the chart to the forecast graph via demoteRadarBody,
// keeping both rows). With a health bar: health upper + radar lower over the chart.
// Without one (health off/slot): the default's radar-upper + forecast-lower pair
// carries over onto the chart. CAL2_HR_D also serves as fullCal's radar flick when
// health=status — once that cycle's health flick drops to the 2-row calendar, the
// radar flick keeps the same tier instead of bouncing back to 3 rows.
var CAL2_HR_D    = spec(TIER_COMPACT, TOP_CAL,   BODY_RADAR, STATUS_SRC_HEALTH,   STATUS_SRC_RADAR);
var CAL2_RDR_D   = spec(TIER_COMPACT, TOP_CAL,   BODY_RADAR, STATUS_SRC_RADAR,    STATUS_SRC_FORECAST);
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
    // status: the health flick drops to the 2-row dense view, so the radar flick rides
    // the SAME 2-row tier (dense health+radar) — flicks never bounce back to 3 rows.
    status: { n: [CAL3_FC_W, CAL2_HF_D],   r: [CAL3_FC_W, CAL2_HF_D, CAL2_HR_D] },
    all:    { n: [CAL3_FC_W, NONE_GRAPH_H],r: [CAL3_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  },
  compactCal: {
    off:    { n: [CAL2_FC_W],              r: [CAL2_FC_W, CAL2_RDR_W] },
    status: { n: [CAL2_FC_W, CAL2_FC_H],   r: [CAL2_FC_W, CAL2_FC_H, CAL2_RDR_W] },
    all:    { n: [CAL2_FC_W, NONE_GRAPH_H],r: [CAL2_FC_W, NONE_GRAPH_H, NONE_RDR_W] }
  },
  compactDense: {
    // off/slot + radar: dense still shows up — radar upper + weather lower (the same
    // default the radarMode='status' special case below builds), and the radar flick
    // keeps that dense pair over the chart; health-and-radar-less dense has only ONE
    // weather status line, so it degrades to the single-row view.
    off:    { n: [CAL2_FC_W],              r: [CAL2_RF_D, CAL2_RDR_D] },
    status: { n: [CAL2_HF_D],              r: [CAL2_HF_D, CAL2_HR_D] },
    all:    { n: [CAL2_HF_D, CAL2_GRAPH_D],r: [CAL2_HF_D, CAL2_GRAPH_D, CAL2_HR_D] }
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
    var out = cloneSpec(s);
    out.statusUpper = STATUS_SRC_NONE;
    out.statusLower = s.statusUpper;
    return out;
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
  if (s.body !== BODY_RADAR) { return s; }
  var out = cloneSpec(s);
  out.body = BODY_FC;
  return out;
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

// The 12 canonical band orderings of {T=top band, C=clock, A=status upper, B=status
// lower} with A rendered above B (the compiler assigns the visually-upper source to
// the wire's upper slot). Index == the wire order code (spec bits 12-15). Code 0 is
// the legacy order the presets ride (dispatched to the legacy watch engine); 1-11 go
// to the stacked engine. MIRRORS STACK_ORDER in src/c/windows/layout.c — keep in
// lockstep (both sides pin this exact list in their tests).
var STACK_ORDERS = [
  'TACB', 'TCAB', 'TABC', 'CTAB', 'CATB', 'CABT',
  'ATCB', 'ATBC', 'ACTB', 'ACBT', 'ABTC', 'ABCT'
];

/**
 * Wire order code for a band sequence (e.g. 'CTAB'). Unknown sequences (including
 * a B-before-A non-canonical spelling) return 0 — the legacy order.
 * @param {string} seq 4-char permutation of T/C/A/B
 * @returns {number} 0-11
 */
function orderCode(seq) {
  var i = STACK_ORDERS.indexOf(seq);
  return i < 0 ? 0 : i;
}

// ── Custom layout compiler ──────────────────────────────────────────────────
// The second producer beside the preset MATRIX: compiles the per-view settings keys
// (viewCount, viewTop{i}, viewBody{i}, viewUpper{i}, viewLower{i}, viewOrder{i},
// viewClockOff{i}, viewStripOff{i}) into the same spec objects packSpec ships.
// The key vocabulary is the editor's contract — schema.js and view-editor.js speak
// these exact strings.

var CUSTOM_TOP = {
  cal3:  { tier: TIER_FULL,    top: TOP_CAL },
  cal2:  { tier: TIER_COMPACT, top: TOP_CAL },
  radar: { tier: TIER_FULL,    top: TOP_RADAR },
  none:  { tier: TIER_NONE,    top: TOP_EMPTY }
};
var CUSTOM_BODY = { forecast: BODY_FC, health: BODY_GRAPH, radar: BODY_RADAR };
var CUSTOM_SRC = {
  off: STATUS_SRC_NONE, weather: STATUS_SRC_FORECAST,
  radar: STATUS_SRC_RADAR, health: STATUS_SRC_HEALTH
};

/**
 * Compile the custom per-view keys into a 1-3 slot cycle. Mirrors the watch's
 * view_spec_resolve capability semantics so the previews and the wire agree:
 * radar CHART seats (top strip / body) need radarMode 'graph'; the radar status
 * SOURCE needs 'status' or 'graph'; a health graph body needs healthMode 'all';
 * a health status source needs 'status' or 'all' ('slot' shows health only in the
 * regular slot system, same as the preset MATRIX's bucket rule). Under the legacy
 * order a folded-away upper promotes the surviving lower (dense degradation, the
 * watch's rule); explicit stacked orders keep user-placed seats.
 * @param {Object} S settings state
 * @returns {Array<Object>} specs for packSpec (length == viewCount, 1-3)
 */
function buildCustomCycle(S) {
  var count = parseInt(S.viewCount, 10);
  if (!(count >= 1 && count <= 3)) { count = 1; }
  var radarChartOk = S.radarMode === 'graph';
  var radarRowOk = S.radarMode === 'status' || S.radarMode === 'graph';
  var healthRowOk = S.healthMode === 'status' || S.healthMode === 'all';
  var healthBodyOk = S.healthMode === 'all';
  var cycle = [];
  for (var i = 0; i < count; i++) {
    var t = CUSTOM_TOP[S['viewTop' + i]] || CUSTOM_TOP.cal2;
    var body = CUSTOM_BODY[S['viewBody' + i]];
    if (body === undefined) { body = BODY_FC; }
    var suRaw = CUSTOM_SRC[S['viewUpper' + i]];
    if (suRaw === undefined) { suRaw = STATUS_SRC_NONE; }
    var slRaw = CUSTOM_SRC[S['viewLower' + i]];
    if (slRaw === undefined) { slRaw = STATUS_SRC_NONE; }

    if (t.top === TOP_RADAR && !radarChartOk) { t = CUSTOM_TOP.cal3; }
    if (body === BODY_RADAR && !radarChartOk) { body = BODY_FC; }
    if (body === BODY_GRAPH && !healthBodyOk) { body = BODY_FC; }
    var su = suRaw, sl = slRaw;
    if (su === STATUS_SRC_RADAR && !radarRowOk) { su = STATUS_SRC_NONE; }
    if (su === STATUS_SRC_HEALTH && !healthRowOk) { su = STATUS_SRC_NONE; }
    if (sl === STATUS_SRC_RADAR && !radarRowOk) { sl = STATUS_SRC_NONE; }
    if (sl === STATUS_SRC_HEALTH && !healthRowOk) { sl = STATUS_SRC_NONE; }

    var code = orderCode(S['viewOrder' + i] || 'TACB');
    if (code === 0 && suRaw !== STATUS_SRC_NONE && su === STATUS_SRC_NONE
        && sl !== STATUS_SRC_NONE) {
      su = sl;
      sl = STATUS_SRC_NONE;
    }

    var s = spec(t.tier, t.top, body, su, sl);
    if (i > 0) {   // the Default view always keeps its clock and top bar
      if (S['viewClockOff' + i]) { s.clockOff = true; }
      if (S['viewStripOff' + i]) { s.stripOff = true; }
    }
    if (code) { s.order = code; }
    cycle.push(s);
  }
  return cycle;
}

/**
 * Seed the custom per-view keys from the preset the user is leaving — the ONE-TIME
 * copy when Custom mode is first entered (S.customLayoutSeeded latches it; preset
 * re-picks leave the keys dormant so custom work survives). Mutates S in place and
 * compiles back byte-identical, so entering Custom transmits nothing.
 * @param {Object} S settings state (S.layoutPreset is already 'custom' at hook time)
 * @param {string} oldPreset the layoutPreset value being left (may be legacy/undefined)
 * @returns {void}
 */
function seedCustomKeys(S, oldPreset) {
  if (S.customLayoutSeeded) { return; }
  var presetKey = resolvePresetKey({ layoutPreset: oldPreset, topViewMode: S.topViewMode });
  var cycle = buildViewCycle(presetKey, S.healthMode || 'off', S.radarMode || 'graph',
                             Boolean(S.swapClockStatus));
  var keys = specToKeys(cycle);
  for (var k in keys) {
    if (Object.prototype.hasOwnProperty.call(keys, k)) { S[k] = keys[k]; }
  }
  S.customLayoutSeeded = true;
}

/**
 * Invert a compiled cycle into the custom per-view keys — the one-time seed when the
 * user enters Custom mode, built so an untouched Custom session compiles back to
 * BYTE-IDENTICAL packed values (the zero-transmit upgrade proof, pinned by tests).
 * @param {Array<Object>} cycle specs from buildViewCycle (post-transform)
 * @returns {Object} key/value map to merge into the settings state
 */
function specToKeys(cycle) {
  var keys = { viewCount: String(cycle.length) };
  var srcName = ['off', 'weather', 'radar', 'health'];
  for (var i = 0; i < cycle.length; i++) {
    var s = cycle[i];
    keys['viewTop' + i] = (s.top === TOP_RADAR) ? 'radar'
      : (s.top === TOP_CAL) ? ((s.tier === TIER_FULL) ? 'cal3' : 'cal2')
      : 'none';
    keys['viewBody' + i] = (s.body === BODY_GRAPH) ? 'health'
      : (s.body === BODY_RADAR) ? 'radar' : 'forecast';
    keys['viewUpper' + i] = srcName[s.statusUpper] || 'off';
    keys['viewLower' + i] = srcName[s.statusLower] || 'off';
    keys['viewOrder' + i] = STACK_ORDERS[s.order || 0];
    if (i > 0) {
      keys['viewClockOff' + i] = Boolean(s.clockOff);
      keys['viewStripOff' + i] = Boolean(s.stripOff);
    }
  }
  return keys;
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
  // 'custom' folds to an EXPLICIT preset for the preset-path consumers (an aplite
  // watch's payload, the wizard's nearest-highlight, preview fallbacks). Never let
  // it reach the topViewMode fall-through below — a legacy value there could
  // redirect a custom user to fullCal/noCal and break display == wire.
  if (p === 'custom') { return 'compactCal'; }
  if (p && NEW_KEYS[p]) { return p; }
  if (p && LEGACY_PRESET[p]) { return LEGACY_PRESET[p]; }
  if (state.topViewMode === 'full') { return 'fullCal'; }
  if (state.topViewMode === 'none') { return 'noCal'; }
  return 'compactCal';
}

// Single public API object, defined once. As a CommonJS module (watch runtime, tests)
// this is module.exports. When this file is instead concatenated as a plain <script> into
// the config-UI webview (see scripts/build-config-page.js, which has no `module`),
// settings/preview-layout.js reads this same VIEW_CYCLE object from the shared top-level scope
// rather than require()-ing it — one export list, no hand-copied duplicate to drift.
var VIEW_CYCLE = {
  TIER_OFF: TIER_OFF, TIER_NONE: TIER_NONE, TIER_COMPACT: TIER_COMPACT, TIER_FULL: TIER_FULL,
  TOP_EMPTY: TOP_EMPTY, TOP_CAL: TOP_CAL, TOP_RADAR: TOP_RADAR,
  BODY_FC: BODY_FC, BODY_GRAPH: BODY_GRAPH, BODY_RADAR: BODY_RADAR,
  STATUS_SRC_NONE: STATUS_SRC_NONE, STATUS_SRC_FORECAST: STATUS_SRC_FORECAST,
  STATUS_SRC_RADAR: STATUS_SRC_RADAR, STATUS_SRC_HEALTH: STATUS_SRC_HEALTH,
  spec: spec, cloneSpec: cloneSpec, packSpec: packSpec, unpackSpec: unpackSpec,
  swapUpperToLower: swapUpperToLower, demoteRadarBody: demoteRadarBody,
  STACK_ORDERS: STACK_ORDERS, orderCode: orderCode,
  buildCustomCycle: buildCustomCycle, specToKeys: specToKeys,
  seedCustomKeys: seedCustomKeys,
  buildViewCycle: buildViewCycle, resolvePresetKey: resolvePresetKey
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VIEW_CYCLE;
}
