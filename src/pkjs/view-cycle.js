// src/pkjs/view-cycle.js
// Single source of truth for the layout-preset matrix and the packed per-slot
// ViewSpec wire byte. ES5 only (required from clay-payload.js at watch runtime).
// Also read by settings/preview-layout.js (config-UI preview) and the node tests.

var TIER_OFF = 0, TIER_NONE = 1, TIER_COMPACT = 2, TIER_FULL = 3;
// TOP_GRAPH (custom layouts only): a forecast or health graph in the top band; which
// one rides the ext word's topKind (packExt). The watch decodes it to TOP_BAND_GRAPH.
var TOP_EMPTY = 0, TOP_CAL = 1, TOP_RADAR = 2, TOP_GRAPH = 3;
var TOP_KIND_FORECAST = 0, TOP_KIND_HEALTH = 1;
// Unlike `top` above (deliberately renumbered and translated by view_spec_unpack()),
// these numberings must stay bit-for-bit identical to BodyContent/StatusRowContent in
// src/c/windows/layout.h — the packed wire byte passes them through untranslated.
// RADAR_STATUS retired — radar flavor now lives in a status row (statusUpper/statusLower).
// BODY_NONE (custom layouts only): the view has no graph band at all.
var BODY_FC = 0, BODY_GRAPH = 1, BODY_RADAR = 2, BODY_NONE = 3;
// Positional status sources: which content feeds the upper/lower status row.
var STATUS_SRC_NONE = 0, STATUS_SRC_FORECAST = 1, STATUS_SRC_RADAR = 2, STATUS_SRC_HEALTH = 3;

// Band size codes (the ext word's topSize / bodySize fields — one vocabulary for both
// seats, mirroring BandSize in src/c/windows/layout.h). 0 = the seat's default: 3 rows
// for a radar/graph top, fill for the graph body. The settings keys store '2'|'3'|'4'|'fill'.
var SIZE_DEFAULT = 0, SIZE_2 = 1, SIZE_3 = 2, SIZE_4 = 3, SIZE_FILL = 4;
var SIZE_CODE = { '2': SIZE_2, '3': SIZE_3, '4': SIZE_4, fill: SIZE_FILL };
// Position of a stack that nothing fills (the ext word's align field; BandAlign in C).
// 0 = the clock's ink centred on the screen midline (Middle when the view has no clock).
var ALIGN_CLOCK = 0, ALIGN_TOP = 1, ALIGN_CENTER = 2, ALIGN_BOTTOM = 3;
var ALIGN_CODE = { clock: ALIGN_CLOCK, top: ALIGN_TOP, center: ALIGN_CENTER, bottom: ALIGN_BOTTOM };

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
 * Clone a spec, preserving the custom-layout fields (clockOff/stripOff/order and the
 * ext word's topKind/topSize/bodySize/align) that the 5-arg spec() builder does not
 * carry. Every cycle transform MUST clone through this helper — cloning via spec()
 * silently drops them (pinned by a test).
 * Canonical form: the fields are attached only when set (absent === off/0), so
 * preset constants stay flag-free and pack byte-identically to pre-custom builds.
 * @param {{tier:number,top:number,body:number,statusUpper:number,statusLower:number,
 *          clockOff:(boolean|undefined),stripOff:(boolean|undefined),order:(number|undefined),
 *          topKind:(number|undefined),topSize:(number|undefined),bodySize:(number|undefined),
 *          align:(number|undefined)}} s
 * @returns {!Object} an independent copy with the same canonical fields
 */
function cloneSpec(s) {
  var out = spec(s.tier, s.top, s.body, s.statusUpper, s.statusLower);
  if (s.clockOff) { out.clockOff = true; }
  if (s.stripOff) { out.stripOff = true; }
  if (s.order) { out.order = s.order; }
  if (s.topKind) { out.topKind = s.topKind; }
  if (s.topSize) { out.topSize = s.topSize; }
  if (s.bodySize) { out.bodySize = s.bodySize; }
  if (s.align) { out.align = s.align; }
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

/**
 * The ext fields of a spec in the watch's NORMALISED form — the exact rules
 * view_spec_apply_ext + view_spec_resolve apply in src/c/windows/layout.c, so the phone
 * packs, previews and dispatches on the same values the watch renders: out-of-range
 * sizes → 0; explicit fill on the body and 3 rows on the top → 0 (their seat defaults);
 * sizes only on a radar/graph top and on a present body; topKind only on a graph top;
 * one fill per view (both → the body fills, the top takes its 3-row default); align only
 * while no band fills.
 * @param {!Object} s view spec
 * @returns {{topKind:number,topSize:number,bodySize:number,align:number,fill:boolean}}
 */
function extFields(s) {
  var topKind = (s.topKind || 0) & 1;
  var topSize = s.topSize || 0;
  var bodySize = s.bodySize || 0;
  var align = (s.align || 0) & 3;
  var sizedTop = (s.top === TOP_RADAR || s.top === TOP_GRAPH);
  if (topSize > SIZE_FILL || topSize === SIZE_3 || !sizedTop) { topSize = SIZE_DEFAULT; }
  if (bodySize > SIZE_FILL || bodySize === SIZE_FILL || s.body === BODY_NONE) { bodySize = SIZE_DEFAULT; }
  if (s.top !== TOP_GRAPH) { topKind = TOP_KIND_FORECAST; }
  var bodyFills = (s.body !== BODY_NONE && bodySize === SIZE_DEFAULT);
  if (bodyFills && topSize === SIZE_FILL) { topSize = SIZE_DEFAULT; }
  var fill = bodyFills || topSize === SIZE_FILL;
  if (fill) { align = ALIGN_CLOCK; }
  return { topKind: topKind, topSize: topSize, bodySize: bodySize, align: align, fill: fill };
}

/**
 * Pack a spec's ext fields into the 16-bit ext word — the HIGH half of the 32-bit
 * CLAY_VIEW_n tuple (the watch's config_wire.c reads it off the int32; aplite ignores
 * it). Bit layout (LSB→MSB): bodySize(0-2) | topSize(3-5) | topKind(6) | align(7-8);
 * 9-15 reserved (bit 15 stays clear so the whole wire word stays a positive int32).
 * Every field is 0 in its seat's default, so a preset (no fields) packs to 0.
 * @param {?Object} s view spec (null = disabled slot)
 * @returns {number} 0..0x1FF
 */
function packExt(s) {
  if (!s) { return 0; }
  var e = extFields(s);
  return (e.bodySize & 7) | ((e.topSize & 7) << 3) | ((e.topKind & 1) << 6) | ((e.align & 3) << 7);
}

/**
 * Pack a spec into the full 32-bit wire word the CLAY_VIEW_n tuples carry:
 * packSpec in the low 16 bits, packExt in the high 16. packExt is 0 for every preset,
 * so a preset's wire word is exactly its 16-bit packSpec (the upgrade no-op).
 * @param {?Object} s view spec (null = disabled slot → 0)
 * @returns {number} non-negative integer below 2^31
 */
function packWire(s) {
  return packSpec(s) + packExt(s) * 65536;
}

/**
 * Decode a 32-bit wire word (packWire's inverse, in canonical form). A zero low half
 * is a disabled slot → null, whatever the high half says (the watch keys slot
 * availability on the wire tier the same way).
 * @param {number} v wire word
 * @returns {?Object} view spec
 */
function unpackWire(v) {
  var s = unpackSpec(v & 0xFFFF);
  if (!s) { return null; }
  var ext = Math.floor(v / 65536) & 0x7FFF;
  if (ext & 7) { s.bodySize = ext & 7; }
  if ((ext >> 3) & 7) { s.topSize = (ext >> 3) & 7; }
  if ((ext >> 6) & 1) { s.topKind = 1; }
  if ((ext >> 7) & 3) { s.align = (ext >> 7) & 3; }
  return s;
}

/**
 * Rewrite a spec's ext fields in their canonical form (extFields — the watch's
 * normalisation): a field equal to its seat default is removed, one that does not apply
 * is removed, both-fill leaves the body filling. The compiler's specs then carry exactly
 * what packExt sends.
 * @param {!Object} s view spec (mutated)
 * @returns {!Object} s
 */
function canonicalExt(s) {
  var e = extFields(s);
  var names = ['topKind', 'topSize', 'bodySize', 'align'], j;
  for (j = 0; j < names.length; j++) {
    if (e[names[j]]) { s[names[j]] = e[names[j]]; } else { delete s[names[j]]; }
  }
  return s;
}

/**
 * Does a band of this view fill the space left over (the graph body at its default
 * size, or a radar/graph top sized 'fill')? Without one, the stack is shorter than the
 * screen and the view's Position (align) places it.
 * @param {!Object} s view spec
 * @returns {boolean}
 */
function hasFill(s) {
  return extFields(s).fill;
}

// ── Fit check (the editor's size pickers) ───────────────────────────────────
// The watch's stacked-band arithmetic in pixels, per screen family (index 0: the 144 px
// watches, 1: emery) — the constants src/c/windows/layout.c compute_stacked uses, as the
// device renders them (the emery FULL-squeezed status band is 20 px on the watch; the C
// host goldens use a 24 px stand-in). Pinned against the C goldens by
// test/view-cycle.test.js. `avail*` = floor minus the cursor start (with / without the
// top bar). A FILL band is counted at its 2-row floor.
var FIT_PX = {
  row: [15, 20], clock: [45, 60], statusLarge: [17, 21], statusFull: [20, 20], gap: [3, 1],
  cal2: [30, 40], cal3: [45, 60], tail: [0, 10], availStrip: [155, 202], availNoStrip: [168, 222]
};

/**
 * Pixels a stack needs on one screen family, in the watch's walk order: the bands the
 * compiled spec shows (STACK_ORDERS[order] + the body) with the clearance after every
 * edge-inking band that another band follows.
 * @param {!Object} s compiled view spec
 * @param {number} f family index (0 = 144 px, 1 = emery)
 * @returns {{need: number, avail: number}}
 */
function stackNeed(s, f) {
  var e = extFields(s);
  var rows = (s.tier === TIER_FULL) ? 3 : (s.tier === TIER_COMPACT) ? 2 : 0;
  var dual = s.statusUpper !== STATUS_SRC_NONE && s.statusLower !== STATUS_SRC_NONE;
  var bodyOn = s.body !== BODY_NONE;
  // FULL-squeezed rows: layout_status_tier (a 3-row calendar, or a 2-row one with two
  // rows) with every chrome band and the graph present (status_tier_for's exemptions).
  var fullRows = (rows === 3 || (rows === 2 && dual)) && !s.clockOff && !s.stripOff && bodyOn;
  /** @param {number} code @param {number} dflt @param {boolean} fc @returns {number} rows, 0 = fill */
  function sizeRows(code, dflt, fc) {
    var r = code === SIZE_2 ? 2 : code === SIZE_3 ? 3 : code === SIZE_4 ? 4 : code === SIZE_FILL ? 0 : dflt;
    return (fc && r === 2) ? 3 : r;
  }
  var fill = 2 * FIT_PX.row[f];
  var h = {}, gapAfter = {};
  if (s.top === TOP_CAL && rows) {
    h.T = rows === 3 ? FIT_PX.cal3[f] : FIT_PX.cal2[f];
  } else if (s.top === TOP_RADAR || s.top === TOP_GRAPH) {
    var tr = sizeRows(e.topSize, 3, s.top === TOP_GRAPH && e.topKind === TOP_KIND_FORECAST);
    h.T = tr ? tr * FIT_PX.row[f] + (s.top === TOP_GRAPH ? FIT_PX.tail[f] : 0) : fill;
  }
  gapAfter.T = FIT_PX.gap[f];
  if (!s.clockOff) { h.C = FIT_PX.clock[f]; }
  gapAfter.C = 0;
  var rowH = fullRows ? FIT_PX.statusFull[f] : FIT_PX.statusLarge[f];
  if (s.statusUpper !== STATUS_SRC_NONE) { h.A = rowH; }
  if (s.statusLower !== STATUS_SRC_NONE) { h.B = rowH; }
  gapAfter.A = gapAfter.B = fullRows ? 0 : FIT_PX.gap[f];
  if (bodyOn) {
    var br = sizeRows(e.bodySize, 0, s.body === BODY_FC);
    h.G = br ? br * FIT_PX.row[f] + (s.body === BODY_RADAR ? 0 : FIT_PX.tail[f]) : fill;
  }
  var seq = (STACK_ORDERS[s.order || 0] || 'TACB') + 'G';
  var need = 0, prev = null, j, b;
  for (j = 0; j < seq.length; j++) {
    b = seq.charAt(j);
    if (h[b] === undefined) { continue; }
    if (prev !== null) { need += gapAfter[prev] || 0; }
    need += h[b];
    prev = b;
  }
  return { need: need, avail: s.stripOff ? FIT_PX.availNoStrip[f] : FIT_PX.availStrip[f] };
}

/**
 * Does this compiled view fit the watch it is edited for? `family` is the watch's
 * platform name ('emery' → the 200×228 screen, any other named platform → 144×168); an
 * unknown platform ('') must fit both. `over` is how many pixels the tallest miss needs.
 * @param {?Object} s compiled view spec (null = a disabled slot: fits)
 * @param {string} family platform name or ''
 * @returns {{fits: boolean, over: number}}
 */
function stackFits(s, family) {
  if (!s) { return { fits: true, over: 0 }; }
  var fams = family === 'emery' ? [1] : family ? [0] : [0, 1];
  var over = 0, j, n;
  for (j = 0; j < fams.length; j++) {
    n = stackNeed(s, fams[j]);
    if (n.need - n.avail > over) { over = n.need - n.avail; }
  }
  return { fits: over <= 0, over: over };
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
  // 'slot' shows health only in the regular status bars — it adds no dedicated
  // Health view, so its flick cycle is identical to 'off'.
  var mode = (healthMode === 'slot') ? 'off' : healthMode;
  var radarShowsView = (radarMode === 'status' || radarMode === 'graph');
  // A compactDense that neither a health status row nor a radar view makes dense is
  // DORMANT: the settings page hides the option and shows "Compact calendar" (and its
  // swap toggle) in its place. Its cycle is already compactCal's, so compile it AS
  // compactCal — swap included — or the watch would ignore the swap the page offers.
  // Keep in step with blocks.js layoutPresetOptions and schema.js's swapClockStatus gate.
  if (presetKey === 'compactDense' && mode === 'off' && !radarShowsView) {
    presetKey = 'compactCal';
  }
  var byPreset = MATRIX[presetKey] || MATRIX.compactCal;
  var byHealth = byPreset[mode] || byPreset.off;
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
 * Does the watch render this spec through its STACKED engine (compute_stacked) rather
 * than the legacy preset engine? THE one copy of the watch's dispatch rule
 * (layout.c spec_is_stacked): an explicit band order (1-11), a removed chrome band
 * (clock / top strip), no graph body, a graph in the top band, or a non-default band
 * size (read normalised, as the watch does). The stacked engine draws the bands literally in
 * STACK_ORDERS[order] ('TACB' for code 0) minus the absent ones; the legacy engine
 * seats them per tier. The settings preview and the editor's band list both read it,
 * so neither can drift from the watch. Presets never carry these fields → false.
 * @param {?Object} s view spec (packSpec's shape)
 * @returns {boolean}
 */
function isStacked(s) {
  if (!s) { return false; }
  if ((s.order >= 1) || Boolean(s.clockOff) || Boolean(s.stripOff)) { return true; }
  if (s.body === BODY_NONE || s.top === TOP_GRAPH) { return true; }
  var e = extFields(s);
  return e.topSize !== SIZE_DEFAULT || e.bodySize !== SIZE_DEFAULT;
}

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
// viewClockOff{i}, viewStripOff{i}, viewTopSize{i}, viewBodySize{i}, viewAlign{i})
// into the same spec objects packWire ships.
// The key vocabulary is the editor's contract — settings/custom-layout-schema.js
// and settings/view-editor.js speak these exact strings.

// A graph in the top band compiles at tier NONE: no calendar rows, so the watch shows
// the strip's full date and keeps the status rows at the large font with no re-keying.
var CUSTOM_TOP = {
  cal3:     { tier: TIER_FULL,    top: TOP_CAL },
  cal2:     { tier: TIER_COMPACT, top: TOP_CAL },
  radar:    { tier: TIER_FULL,    top: TOP_RADAR },
  forecast: { tier: TIER_NONE,    top: TOP_GRAPH, kind: TOP_KIND_FORECAST },
  health:   { tier: TIER_NONE,    top: TOP_GRAPH, kind: TOP_KIND_HEALTH },
  none:     { tier: TIER_NONE,    top: TOP_EMPTY }
};
var CUSTOM_BODY = { forecast: BODY_FC, health: BODY_GRAPH, radar: BODY_RADAR, none: BODY_NONE };
var CUSTOM_SRC = {
  off: STATUS_SRC_NONE, weather: STATUS_SRC_FORECAST,
  radar: STATUS_SRC_RADAR, health: STATUS_SRC_HEALTH
};

// Capability gates, single-sourced: which radarMode/healthMode values unlock each
// seat kind. THE one copy — buildCustomCycle folds by them, view-editor.js's
// freeStatusSource offers by them, and settings/custom-layout-schema.js builds its
// declarative optionDisabledWhen gates from these very arrays, so the compiler,
// the editor and the sheets can never disagree. Mirrors the watch's
// view_spec_resolve: radar CHART seats (top strip / body) need radarMode 'graph';
// the radar status SOURCE needs 'status'|'graph'; a health graph body needs
// healthMode 'all'; a health status source needs 'status'|'all' ('slot' shows
// health only in the regular slot system, same as the preset MATRIX's bucket rule).
var RADAR_CHART_MODES = ['graph'];
var RADAR_ROW_MODES = ['status', 'graph'];
var HEALTH_ROW_MODES = ['status', 'all'];
var HEALTH_BODY_MODES = ['all'];

/**
 * The capability booleans for a settings state — one per seat kind, derived
 * from the mode lists above (reads S.radarMode / S.healthMode).
 * @param {Object} S settings state
 * @returns {{radarChart:boolean,radarRow:boolean,healthRow:boolean,healthBody:boolean}}
 */
function capabilities(S) {
  S = S || {};
  return {
    radarChart: RADAR_CHART_MODES.indexOf(S.radarMode) >= 0,
    radarRow: RADAR_ROW_MODES.indexOf(S.radarMode) >= 0,
    healthRow: HEALTH_ROW_MODES.indexOf(S.healthMode) >= 0,
    healthBody: HEALTH_BODY_MODES.indexOf(S.healthMode) >= 0
  };
}

/**
 * Compile the custom per-view keys into a 1-3 slot cycle. Seats fold by
 * capabilities(S) — the shared gate table above — so the previews and the wire
 * agree with the watch's view_spec_resolve. Under the legacy order a folded-away
 * upper promotes the surviving lower (dense degradation, the watch's rule);
 * explicit stacked orders keep user-placed seats. A flick view left with NOTHING on
 * it (no clock, top band, graph or status row — e.g. its only status bar's source was
 * switched off in settings) compiles to null: a disabled slot the watch skips, instead
 * of a blank screen the flick would stop on.
 * @param {Object} S settings state
 * @returns {Array<?Object>} specs for packWire (length == viewCount, 1-3; null = disabled)
 */
function buildCustomCycle(S) {
  var count = parseInt(S.viewCount, 10);
  if (!(count >= 1 && count <= 3)) { count = 1; }
  var cap = capabilities(S);
  var cycle = [];
  for (var i = 0; i < count; i++) {
    var t = CUSTOM_TOP[S['viewTop' + i]] || CUSTOM_TOP.cal2;
    var body = CUSTOM_BODY[S['viewBody' + i]];
    if (body === undefined) { body = BODY_FC; }
    var suRaw = CUSTOM_SRC[S['viewUpper' + i]];
    if (suRaw === undefined) { suRaw = STATUS_SRC_NONE; }
    var slRaw = CUSTOM_SRC[S['viewLower' + i]];
    if (slRaw === undefined) { slRaw = STATUS_SRC_NONE; }

    if (t.top === TOP_RADAR && !cap.radarChart) { t = CUSTOM_TOP.cal3; }
    if (t.top === TOP_GRAPH && t.kind === TOP_KIND_HEALTH && !cap.healthBody) { t = CUSTOM_TOP.none; }
    if (body === BODY_RADAR && !cap.radarChart) { body = BODY_FC; }
    if (body === BODY_GRAPH && !cap.healthBody) { body = BODY_FC; }
    // One seat per graph kind (each graph layer is a single instance): a body showing —
    // or just folded to — the top band's graph goes empty; the top keeps it. Mirrors the
    // watch's view_spec_resolve dedupe.
    if (t.top === TOP_GRAPH && ((t.kind === TOP_KIND_FORECAST && body === BODY_FC)
                                || (t.kind === TOP_KIND_HEALTH && body === BODY_GRAPH))) {
      body = BODY_NONE;
    }
    var su = suRaw, sl = slRaw;
    if (su === STATUS_SRC_RADAR && !cap.radarRow) { su = STATUS_SRC_NONE; }
    if (su === STATUS_SRC_HEALTH && !cap.healthRow) { su = STATUS_SRC_NONE; }
    if (sl === STATUS_SRC_RADAR && !cap.radarRow) { sl = STATUS_SRC_NONE; }
    if (sl === STATUS_SRC_HEALTH && !cap.healthRow) { sl = STATUS_SRC_NONE; }

    var code = orderCode(S['viewOrder' + i] || 'TACB');
    if (code === 0 && suRaw !== STATUS_SRC_NONE && su === STATUS_SRC_NONE
        && sl !== STATUS_SRC_NONE) {
      su = sl;
      sl = STATUS_SRC_NONE;
    }

    var s = spec(t.tier, t.top, body, su, sl);
    if (t.kind) { s.topKind = t.kind; }
    if (i > 0) {   // the Default view always keeps its clock and top bar
      if (S['viewClockOff' + i]) { s.clockOff = true; }
      if (S['viewStripOff' + i]) { s.stripOff = true; }
    }
    if (code) { s.order = code; }
    // Sizes: a radar/graph top and a present body take '2'|'3'|'4'|'fill' rows. A
    // forecast seat never takes 2 rows (its labels collide) — '2' compiles to 3 rows, the
    // watch's band_rows clamp, so the fit check and the watch agree. Read with defaults,
    // so a blob that predates the keys compiles to ext 0.
    var fcTop = (t.top === TOP_GRAPH && t.kind === TOP_KIND_FORECAST);
    var ts = S['viewTopSize' + i] || '3', bs = S['viewBodySize' + i] || 'fill';
    if (fcTop && ts === '2') { ts = '3'; }
    if (body === BODY_FC && bs === '2') { bs = '3'; }
    if (SIZE_CODE[ts]) { s.topSize = SIZE_CODE[ts]; }
    if (SIZE_CODE[bs]) { s.bodySize = SIZE_CODE[bs]; }
    canonicalExt(s);
    // Alignment: only while no band fills (the watch zeroes it otherwise), and read
    // with its default so a blob that predates the key compiles to ext 0.
    var align = ALIGN_CODE[S['viewAlign' + i] || 'clock'] || ALIGN_CLOCK;
    if (align && !hasFill(s)) { s.align = align; }
    if (s.clockOff && s.top === TOP_EMPTY && s.body === BODY_NONE
        && s.statusUpper === STATUS_SRC_NONE && s.statusLower === STATUS_SRC_NONE) {
      s = null;   // nothing left to show (only a flick can drop its clock)
    }
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
  // Size code → key value per seat: code 0 is the seat default ('3' rows for a top,
  // 'fill' for the body), so both columns differ only in row 0.
  var topSizeName = ['3', '2', '3', '4', 'fill'];
  var bodySizeName = ['fill', '2', '3', '4', 'fill'];
  var alignName = ['clock', 'top', 'center', 'bottom'];
  for (var i = 0; i < cycle.length; i++) {
    var s = cycle[i];
    keys['viewTop' + i] = (s.top === TOP_RADAR) ? 'radar'
      : (s.top === TOP_CAL) ? ((s.tier === TIER_FULL) ? 'cal3' : 'cal2')
      : (s.top === TOP_GRAPH) ? ((s.topKind === TOP_KIND_HEALTH) ? 'health' : 'forecast')
      : 'none';
    keys['viewBody' + i] = (s.body === BODY_GRAPH) ? 'health'
      : (s.body === BODY_RADAR) ? 'radar'
      : (s.body === BODY_NONE) ? 'none' : 'forecast';
    keys['viewUpper' + i] = srcName[s.statusUpper] || 'off';
    keys['viewLower' + i] = srcName[s.statusLower] || 'off';
    keys['viewOrder' + i] = STACK_ORDERS[s.order || 0];
    if (i > 0) {
      keys['viewClockOff' + i] = Boolean(s.clockOff);
      keys['viewStripOff' + i] = Boolean(s.stripOff);
    }
    keys['viewTopSize' + i] = topSizeName[s.topSize || 0] || '3';
    keys['viewBodySize' + i] = bodySizeName[s.bodySize || 0] || 'fill';
    keys['viewAlign' + i] = alignName[s.align || 0] || 'clock';
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
  TOP_EMPTY: TOP_EMPTY, TOP_CAL: TOP_CAL, TOP_RADAR: TOP_RADAR, TOP_GRAPH: TOP_GRAPH,
  TOP_KIND_FORECAST: TOP_KIND_FORECAST, TOP_KIND_HEALTH: TOP_KIND_HEALTH,
  BODY_FC: BODY_FC, BODY_GRAPH: BODY_GRAPH, BODY_RADAR: BODY_RADAR, BODY_NONE: BODY_NONE,
  SIZE_DEFAULT: SIZE_DEFAULT, SIZE_2: SIZE_2, SIZE_3: SIZE_3, SIZE_4: SIZE_4, SIZE_FILL: SIZE_FILL,
  SIZE_CODE: SIZE_CODE,
  ALIGN_CLOCK: ALIGN_CLOCK, ALIGN_TOP: ALIGN_TOP, ALIGN_CENTER: ALIGN_CENTER,
  ALIGN_BOTTOM: ALIGN_BOTTOM, ALIGN_CODE: ALIGN_CODE,
  STATUS_SRC_NONE: STATUS_SRC_NONE, STATUS_SRC_FORECAST: STATUS_SRC_FORECAST,
  STATUS_SRC_RADAR: STATUS_SRC_RADAR, STATUS_SRC_HEALTH: STATUS_SRC_HEALTH,
  spec: spec, cloneSpec: cloneSpec, packSpec: packSpec, unpackSpec: unpackSpec,
  packExt: packExt, packWire: packWire, unpackWire: unpackWire, hasFill: hasFill,
  stackFits: stackFits, FIT_PX: FIT_PX,
  swapUpperToLower: swapUpperToLower, demoteRadarBody: demoteRadarBody,
  STACK_ORDERS: STACK_ORDERS, orderCode: orderCode, isStacked: isStacked,
  RADAR_CHART_MODES: RADAR_CHART_MODES, RADAR_ROW_MODES: RADAR_ROW_MODES,
  HEALTH_ROW_MODES: HEALTH_ROW_MODES, HEALTH_BODY_MODES: HEALTH_BODY_MODES,
  capabilities: capabilities,
  buildCustomCycle: buildCustomCycle, specToKeys: specToKeys,
  seedCustomKeys: seedCustomKeys,
  buildViewCycle: buildViewCycle, resolvePresetKey: resolvePresetKey
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VIEW_CYCLE;
}
