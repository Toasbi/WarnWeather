// src/pkjs/view-cycle.js
// Single source of truth for the layout-preset matrix and the packed per-slot
// ViewSpec wire byte. ES5 only (required from clay-payload.js at watch runtime).
// Also read by the config UI's previews (settings/preview-watch.js and others) and the node tests.

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
// Bars 4 to 6 (Pebble Time 2, 2.7.0's New status bar; src/c/windows/layout.h StatusSource): the
// packed value's 2-bit row fields are full, so a row names one as FORECAST / RADAR / HEALTH
// there plus an ext bit that adds 3 (packExt: bit 11 the upper row, bit 12 the lower).
var STATUS_SRC_BAR4 = 4, STATUS_SRC_BAR5 = 5, STATUS_SRC_BAR6 = 6;
var EXT_UPPER_BAR_HI = 1 << 11, EXT_LOWER_BAR_HI = 1 << 12;
// Each of them: the value a screen's row names it by (viewUpper / viewLower), its source and
// its settings keys' prefix (statusBar4Left, statusBar4Name, statusBar4Made, ...;
// on-demand.js BARS and status-line-catalog.js EXTRA_LINES take them from here). A bar
// exists once New status bar made it (<prefix>Made true), on a watch that has them (env.extraBars).
var EXTRA_BARS = [
  { bar: 'bar4', src: STATUS_SRC_BAR4, prefix: 'statusBar4' },
  { bar: 'bar5', src: STATUS_SRC_BAR5, prefix: 'statusBar5' },
  { bar: 'bar6', src: STATUS_SRC_BAR6, prefix: 'statusBar6' }
];
// Each status source's bar (on-demand.js BARS' ids), by its STATUS_SRC_* value: THE table every
// reader of a view's rows names its bars by (barsIn, the page's previews and gates).
var BAR_OF_SRC = ['', 'forecast', 'radar', 'health'];
EXTRA_BARS.forEach(function (b) { BAR_OF_SRC[b.src] = b.bar; });

// Band size codes (the ext word's topSize / bodySize fields — one vocabulary for both
// seats, mirroring BandSize in src/c/windows/layout.h). 0 = the seat's default: 3 rows
// for a radar/graph top, fill for the graph body. The settings keys store '2'|'3'|'4'|'fill'.
var SIZE_DEFAULT = 0, SIZE_2 = 1, SIZE_3 = 2, SIZE_4 = 3, SIZE_FILL = 4;
var SIZE_CODE = { '2': SIZE_2, '3': SIZE_3, '4': SIZE_4, fill: SIZE_FILL };
// Position of a stack that nothing fills (the ext word's align field; BandAlign in C).
// 0 = the clock's ink centred on the screen midline (Middle when the view has no clock).
var ALIGN_CLOCK = 0, ALIGN_TOP = 1, ALIGN_CENTER = 2, ALIGN_BOTTOM = 3;
var ALIGN_CODE = { clock: ALIGN_CLOCK, top: ALIGN_TOP, center: ALIGN_CENTER, bottom: ALIGN_BOTTOM };
// A screen's graph style (the viewStyle key: '1' to '6', Pebble Time 2,
// src/pkjs/graph-styles.js MAX_STYLES) → the spec's graphStyle field, the style's index: '1',
// the first style, is none. The view word carries the watch's slot for it instead (0..2, ext
// bits 9-10), which graph-styles.js wireCycle writes into the specs the watch is sent.
var GRAPH_STYLES = 6;
var GRAPH_STYLE_CODE = {};
(function () {
  for (var k = 1; k < GRAPH_STYLES; k++) { GRAPH_STYLE_CODE[String(k + 1)] = k; }
})();
// The view word's codes for the watch's style slots (layout.h view_ext_graph_style: code 3
// reads as the first).
var GRAPH_STYLE_SLOTS = 3;

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
 * ext word's topKind/topSize/bodySize/align/graphStyle) that the 5-arg spec() builder does not
 * carry. Every cycle transform MUST clone through this helper — cloning via spec()
 * silently drops them (pinned by a test).
 * Canonical form: the fields are attached only when set (absent === off/0), so the
 * calendar presets stay flag-free and pack byte-identically to pre-custom builds (Weather
 * only sets stripOff + order 1 on its Default view).
 * @param {{tier:number,top:number,body:number,statusUpper:number,statusLower:number,
 *          clockOff:(boolean|undefined),stripOff:(boolean|undefined),order:(number|undefined),
 *          topKind:(number|undefined),topSize:(number|undefined),bodySize:(number|undefined),
 *          align:(number|undefined),graphStyle:(number|undefined)}} s
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
  if (s.graphStyle) { out.graphStyle = s.graphStyle; }
  return out;
}

/**
 * @param {string} bar A bar id.
 * @returns {?{bar: string, src: number, prefix: string}} its EXTRA_BARS entry, null for any
 *   other bar
 */
function extraBar(bar) {
  for (var i = 0; i < EXTRA_BARS.length; i++) {
    if (EXTRA_BARS[i].bar === bar) { return EXTRA_BARS[i]; }
  }
  return null;
}

/**
 * Whether New status bar made a bar 4 to 6 (its <prefix>Made is true). THE reading of "the bar is one
 * of yours", whatever the watch: the compiler (rowSource), the bake (status-lines.js) and the
 * page ask it.
 * @param {?Object} S Settings.
 * @param {string} bar 'bar4' | 'bar5' | 'bar6'
 * @returns {boolean} false for any other bar
 */
function barMade(S, bar) {
  var b = extraBar(bar);
  return Boolean(b && S && S[b.prefix + 'Made'] === true);
}

/**
 * Whether a bar 4 to 6 is on the watch: made, on a watch that has them (env.extraBars; an
 * unknown watch has three bars, platform.js). An omitted env is capable, as on-demand.js
 * facts reads one (the render signature's and the tests' reading); every wire path passes
 * the watch's.
 * @param {?Object} S Settings.
 * @param {string} bar 'bar4' | 'bar5' | 'bar6'
 * @param {?Object} [env] Platform env (omitted = capable).
 * @returns {boolean}
 */
function extraBarOn(S, bar, env) {
  return (!env || env.extraBars === true) && barMade(S, bar);
}

/**
 * The bar a status row draws.
 * @param {number} src STATUS_SRC_* value.
 * @returns {?string} 'forecast' | 'radar' | 'health' | 'bar4' | 'bar5' | 'bar6', null for an
 *   off row
 */
function barOfSource(src) {
  return BAR_OF_SRC[src] || null;
}

/**
 * A row's status source in the packed value's 2-bit field: a bar 4 to 6 rides as the first
 * three's plus 3 (EXT_*_BAR_HI carries the rest).
 * @param {number} src STATUS_SRC_* value.
 * @returns {number} 0..3
 */
function srcBits(src) {
  return (src > STATUS_SRC_HEALTH ? src - 3 : src) & 3;
}

/**
 * Pack a view spec into one 16-bit wire value. Null (disabled slot) → 0.
 * Bit layout (LSB→MSB): statusLower(0-1) | statusUpper(2-3) | body(4-5) |
 * top(6-7) | tier(8-9) | clockOff(10) | stripOff(11) | order(12-15).
 * Bits 10-15 are the custom-layout fields: the calendar presets never carry them, so they
 * pack to the same 10-bit value as pre-custom builds (pinned by a test); Weather only's
 * Default view sets stripOff + order 1.
 * Values with bit 15 set exceed 0x7FFF and ride the AppMessage int16 as negative;
 * the watch recovers all 16 bits via its (uint16_t) cast (config_wire.c). A bar 4 to 6
 * packs as the first three's source (srcBits); its ext bit is packExt's.
 * @param {?{tier:number,top:number,body:number,statusUpper:number,statusLower:number,
 *           clockOff:(boolean|undefined),stripOff:(boolean|undefined),order:(number|undefined)}} s
 * @returns {number} uint16
 */
function packSpec(s) {
  if (!s) { return 0; }
  return ((s.tier & 3) << 8) | ((s.top & 3) << 6) | ((s.body & 3) << 4)
       | (srcBits(s.statusUpper) << 2) | srcBits(s.statusLower)
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
 * while no band fills; a graph style (Pebble Time 2, src/pkjs/graph-styles.js) only on a view
 * with a forecast graph, the style's index 1 to 5 (0 = the first style), or once wireCycle has
 * put the watch's slot there, 1 or 2 (packExt sends a slot only).
 * @param {!Object} s view spec
 * @returns {{topKind:number,topSize:number,bodySize:number,align:number,graphStyle:number,
 *            fill:boolean}}
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
  var forecastGraph = s.body === BODY_FC || (s.top === TOP_GRAPH && topKind === TOP_KIND_FORECAST);
  var graphStyle = s.graphStyle || 0;
  if (!(graphStyle > 0 && graphStyle < GRAPH_STYLES) || !forecastGraph) { graphStyle = 0; }
  return { topKind: topKind, topSize: topSize, bodySize: bodySize, align: align,
           graphStyle: graphStyle, fill: fill };
}

/**
 * Pack a spec's ext fields into the 16-bit ext word — the HIGH half of the 32-bit
 * CLAY_VIEW_n tuple (the watch's config_wire.c reads it off the int32; aplite ignores
 * it). Bit layout (LSB→MSB): bodySize(0-2) | topSize(3-5) | topKind(6) | align(7-8) |
 * graphStyle(9-10, Pebble Time 2: layout.h view_ext_graph_style, the watch's slot: a spec
 * still naming a style past the slots packs the first, graph-styles.js wireCycle maps them)
 * | the upper row a bar 4 to
 * 6 (11) | the lower row one (12) (Pebble Time 2: layout.h VIEW_EXT_UPPER_BAR_HI);
 * 13-15 reserved (bit 15 stays clear so the whole wire word stays a positive int32).
 * Every field is 0 in its seat's default, so a preset (no fields) packs to 0.
 * @param {?Object} s view spec (null = disabled slot)
 * @returns {number} 0..0x1FFF
 */
function packExt(s) {
  if (!s) { return 0; }
  var e = extFields(s);
  return (e.bodySize & 7) | ((e.topSize & 7) << 3) | ((e.topKind & 1) << 6) | ((e.align & 3) << 7)
       | ((e.graphStyle < GRAPH_STYLE_SLOTS ? e.graphStyle : 0) << 9)
       | (s.statusUpper > STATUS_SRC_HEALTH ? EXT_UPPER_BAR_HI : 0)
       | (s.statusLower > STATUS_SRC_HEALTH ? EXT_LOWER_BAR_HI : 0);
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
  var graphStyle = (ext >> 9) & 3;
  if (graphStyle === 1 || graphStyle === 2) { s.graphStyle = graphStyle; }
  // A bar 4 to 6: the row's source plus 3 (a row that is off stays off), as the watch reads it.
  if ((ext & EXT_UPPER_BAR_HI) && s.statusUpper !== STATUS_SRC_NONE) { s.statusUpper += 3; }
  if ((ext & EXT_LOWER_BAR_HI) && s.statusLower !== STATUS_SRC_NONE) { s.statusLower += 3; }
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
  var names = ['topKind', 'topSize', 'bodySize', 'align', 'graphStyle'], j;
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
// The watch's band arithmetic in pixels, per screen family (index 0: the 144 px watches,
// 1: emery) — the SEATS src/c/windows/layout.c compute_layout gives each band, as the
// device renders them (the emery FULL-squeezed status band is 20 px on the watch; the C
// host goldens use a 24 px stand-in). Kept in lockstep with the C engine by
// scripts/check-fit-lockstep.js (run from scripts/test-c.sh). `avail*` = floor minus the
// cursor start (with / without the top bar). A FILL band is counted at its 2-row floor.
var FIT_PX = {
  row: [15, 20], clock: [45, 60], statusLarge: [17, 21], statusFull: [20, 20], gap: [3, 1],
  reserve: [14, 14], noneRow: [22, 30], slide: [2, 1], stripInk: [2, 0],
  cal2: [30, 40], cal3: [45, 60], availStrip: [155, 202], availNoStrip: [168, 222]
};

/**
 * The seats a stack's bands take on one screen family, in the watch's walk order: the
 * bands the compiled spec shows (STACK_ORDERS[order] + the body), each on its SEAT
 * (compute_layout's row_seat rules), with the clearance a band owes the next one. The
 * status rows' tier follows the top area's row count, like the watch (layout.c
 * status_tier_for). A FILL band is counted at its floor: 2 rows, or 3 for the forecast
 * (its labels collide below that). The walk stackNeed sums, and the settings page's
 * watch preview draws.
 * @param {!Object} s view spec as the watch lays it out (resolveForFit for a data state)
 * @param {number} f family index (0 = 144 px, 1 = emery)
 * @returns {{seats: !Array<{band: string, pitch: number, gap: number, fill: boolean}>,
 *     lead: number, tier: number, need: number, avail: number}} each present band
 *     ('T' top, 'C' clock, 'A'/'B' status rows, 'G' body) with the rows it takes and the
 *     clearance after it; `lead` the rows a row or graph leading under the top bar starts
 *     below it; `tier` the rows' tier; `need` the whole stack, `avail` the screen's rows
 */
function stackSeats(s, f) {
  var e = extFields(s);
  var row = FIT_PX.row[f], slide = FIT_PX.slide[f], bodyFill = false;
  var fcTop = s.top === TOP_GRAPH && e.topKind === TOP_KIND_FORECAST;
  /** @param {number} code @param {number} dflt @param {boolean} fc @returns {number} rows, 0 = fill */
  function sizeRows(code, dflt, fc) {
    var r = code === SIZE_2 ? 2 : code === SIZE_3 ? 3 : code === SIZE_4 ? 4 : code === SIZE_FILL ? 0 : dflt;
    return (fc && r === 2) ? 3 : r;
  }
  // The top area's rows (spec_top_rows): a calendar by its tier, a radar/graph by its size.
  var topRows = 0, topFill = false, sizedTop = s.top === TOP_RADAR || s.top === TOP_GRAPH;
  if (s.top === TOP_CAL) {
    topRows = s.tier === TIER_FULL ? 3 : s.tier === TIER_COMPACT ? 2 : 0;
  } else if (sizedTop) {
    topRows = sizeRows(e.topSize, 3, fcTop);
    if (!topRows) { topFill = true; topRows = 3; }
  }
  // The rows' tier (status_tier_for): 3+ rows FULL, 2 COMPACT (a dual squeezes to FULL),
  // none NONE; a removed clock, top bar or graph keeps the large font.
  var dual = s.statusUpper !== STATUS_SRC_NONE && s.statusLower !== STATUS_SRC_NONE;
  var bodyOn = s.body !== BODY_NONE;
  var tier = topRows >= 3 ? TIER_FULL : topRows === 2 ? (dual ? TIER_FULL : TIER_COMPACT) : TIER_NONE;
  if (tier === TIER_FULL && (s.clockOff || s.stripOff || !bodyOn)) { tier = TIER_COMPACT; }
  var full = tier === TIER_FULL, gap = FIT_PX.gap[f];
  var bandH = full ? FIT_PX.statusFull[f] : FIT_PX.statusLarge[f];
  // Present bands in the watch's walk order.
  var seq = (STACK_ORDERS[s.order || 0] || 'TACB') + 'G', list = [], j, b;
  var present = { T: s.top !== TOP_EMPTY && topRows > 0, C: !s.clockOff,
                  A: s.statusUpper !== STATUS_SRC_NONE, B: s.statusLower !== STATUS_SRC_NONE, G: bodyOn };
  for (j = 0; j < seq.length; j++) { if (present[seq.charAt(j)]) { list.push(seq.charAt(j)); } }
  var need = 0, under = {}, seats = [], lead = 0;
  var isRow = { A: true, B: true };
  // A status row or the graph leading under the top bar starts on the first row the bar
  // does not paint (2 rows past the reserve on the 144 px watches).
  if (!s.stripOff && list.length && (list[0] === 'G' || isRow[list[0]])) { lead = FIT_PX.stripInk[f]; need += lead; }
  for (j = 0; j < list.length; j++) {
    b = list[j];
    var prev = j > 0 ? list[j - 1] : null, next = j + 1 < list.length ? list[j + 1] : null;
    var pitch = 0, g = 0;
    var leads = j === 0 && !s.stripOff;
    if (b === 'T') {
      // A filling top at its floor; one leading under the bar loses the slide to it.
      pitch = topFill ? (fcTop ? 3 : 2) * row + (leads ? slide : 0) : topRows * row;
      var freedNext = Boolean(isRow[next]) && list[j + 2] === 'C';
      g = (next === 'C' || freedNext) ? 0 : gap;
      // A top leading under the bar is seated on the bar's ink, `slide` rows below its
      // slot: when nothing follows that overhang is the block's end, and a radar/graph
      // top (inking to its edge) pays its clearance from there.
      if (leads && !topFill && (!next || (sizedTop && g > 0))) { pitch += slide; }
    } else if (b === 'C') {
      pitch = FIT_PX.clock[f] + (leads ? 1 : 0);
    } else if (b === 'G') {
      var br = sizeRows(e.bodySize, 0, s.body === BODY_FC);
      pitch = br ? br * row : (s.body === BODY_FC ? 3 : 2) * row;
      bodyFill = !br;
    } else {
      // row_seat: the freed row above the clock, the reserve under it, else a plain band.
      if (prev === 'T' && next === 'C') {
        pitch = row;
      } else if (prev === 'C' || (isRow[prev] && under[prev])) {
        under[b] = true;
        var h = tier === TIER_NONE ? FIT_PX.noneRow[f] : bandH;
        pitch = (prev === 'C' && tier !== TIER_NONE) ? (full ? FIT_PX.reserve[f] : row) : h;
        g = (next === 'T' && tier === TIER_COMPACT) ? gap : 0;
      } else {
        pitch = bandH;
        g = full ? 0 : gap;
      }
    }
    need += pitch;
    if (next) { need += g; }
    seats.push({ band: b, pitch: pitch, gap: next ? g : 0,
                 fill: (b === 'T' && topFill) || (b === 'G' && bodyFill) });
  }
  return { seats: seats, lead: lead, tier: tier, need: need,
           avail: s.stripOff ? FIT_PX.availNoStrip[f] : FIT_PX.availStrip[f] };
}

/**
 * Pixels a stack needs on one screen family (stackSeats, summed), against the rows the
 * screen has.
 * @param {!Object} s view spec as the watch lays it out (resolveForFit for a data state)
 * @param {number} f family index (0 = 144 px, 1 = emery)
 * @returns {{need: number, avail: number}}
 */
function stackNeed(s, f) {
  var st = stackSeats(s, f);
  return { need: st.need, avail: st.avail };
}

/**
 * The view the watch lays out for one data state — the capability folds of layout.c
 * view_spec_resolve, mirrored: without health a health top empties and a health body falls
 * back to the forecast (or empties under a forecast top); without radar a radar top becomes
 * the calendar of its rows (2 → 2-row, else 3-row) and a radar body the forecast; a graph
 * never shows twice. The status rows always stay: the Radar bar and the Health bar are status
 * bars like the others and stay without radar or health data (only the GRAPHS need their
 * data). The order rule stays the configured view's (the watch keeps it).
 * @param {!Object} s compiled view spec
 * @param {boolean} hasRadar
 * @param {boolean} hasHealth
 * @returns {!Object} the resolved spec
 */
function resolveForFit(s, hasRadar, hasHealth) {
  var r = cloneSpec(s);
  var topSize = extFields(s).topSize;
  if (r.top === TOP_GRAPH && r.topKind === TOP_KIND_HEALTH && !hasHealth) { r.top = TOP_EMPTY; }
  if (r.body === BODY_GRAPH && !hasHealth) { r.body = BODY_FC; }
  if (r.top === TOP_RADAR && !hasRadar) {
    r.top = TOP_CAL;
    r.tier = topSize === SIZE_2 ? TIER_COMPACT : TIER_FULL;
  }
  if (r.body === BODY_RADAR && !hasRadar) { r.body = BODY_FC; }
  if (r.top === TOP_GRAPH && ((!r.topKind && r.body === BODY_FC)
                              || (r.topKind === TOP_KIND_HEALTH && r.body === BODY_GRAPH))) {
    r.body = BODY_NONE;
  }
  return canonicalExt(r);
}

/**
 * Does this compiled view fit the watch it is edited for? `family` is the watch's
 * platform name ('emery' → the 200×228 screen, any other named platform → 144×168); an
 * unknown platform ('') must fit both. `over` is how many pixels the tallest miss needs.
 * The budget covers the watch's no-data fallbacks too (every data state, resolveForFit), so
 * a view that fits keeps fitting before the first radar frame or without health data.
 * @param {?Object} s compiled view spec (null = a disabled slot: fits)
 * @param {string} family platform name or ''
 * @returns {{fits: boolean, over: number}}
 */
function stackFits(s, family) {
  // A disabled slot, or a preset-shaped view (legacy order, full chrome, a filling graph:
  // the presets' own seats, the graph takes what is left, nothing is ever cut), always fits.
  if (!s || !isStacked(s)) { return { fits: true, over: 0 }; }
  var fams = family === 'emery' ? [1] : family ? [0] : [0, 1];
  // Every data state the watch can meet — radar and health present or missing — laid out
  // the way it folds them (resolveForFit: only the graphs fold, the status bars stay): the
  // view must fit in the worst one.
  var states = [[true, true], [false, true], [true, false], [false, false]];
  var over = 0, j, k, n;
  for (j = 0; j < fams.length; j++) {
    for (k = 0; k < states.length; k++) {
      n = stackNeed(resolveForFit(s, states[k][0], states[k][1]), fams[j]);
      if (n.need - n.avail > over) { over = n.need - n.avail; }
    }
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

/**
 * A "Weather only" Default view: no top bar, then (top to bottom) the band `top`, the
 * clock, the status rows and the filling forecast graph — drawn in that literal order
 * (order code 1, T C A B), like a custom view that dropped its top bar.
 * @param {number} tier @param {number} top @param {number} upper @param {number} lower
 * @returns {Object} spec
 */
function weatherOnlyView(tier, top, upper, lower) {
  var s = spec(tier, top, BODY_FC, upper, lower);
  s.stripOff = true;
  s.order = 1;
  return s;
}
// With the radar graph: the rain radar on top, 3 rows (tier full), clock, weather row, graph.
var WO_RADAR   = weatherOnlyView(TIER_FULL, TOP_RADAR, STATUS_SRC_FORECAST, STATUS_SRC_NONE);
// Radar as a status row only: clock, weather row, radar row, graph.
var WO_RADAR_S = weatherOnlyView(TIER_NONE, TOP_EMPTY, STATUS_SRC_FORECAST, STATUS_SRC_RADAR);
// No radar view: clock, weather row, graph.
var WO_PLAIN   = weatherOnlyView(TIER_NONE, TOP_EMPTY, STATUS_SRC_FORECAST, STATUS_SRC_NONE);

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
 * @param {string} presetKey 'fullCal'|'compactCal'|'compactDense'|'noCal'|'weatherOnly'
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
  // "Weather only": the radar is part of the Default view (no radar flick), which has
  // no top bar; the health flicks are No calendar's. In countdown mode the Default view
  // keeps its top bar: the rain alert is drawn there by default (the strip's Alerts
  // placement is Left; another bar draws it only when its own placement is set).
  if (presetKey === 'weatherOnly') {
    var def = (radarMode === 'graph') ? WO_RADAR : (radarMode === 'status') ? WO_RADAR_S
      : (radarMode === 'countdown') ? NONE_FC_W : WO_PLAIN;
    var woHealth = MATRIX.noCal[mode] || MATRIX.noCal.off;
    return [def].concat(woHealth.n.slice(1));
  }
  // A compactDense that neither a health status row nor a radar view makes dense is
  // DORMANT: the settings page hides the option and shows "Compact calendar" (and its
  // swap toggle) in its place. Its cycle is already compactCal's, so compile it AS
  // compactCal — swap included — or the watch would ignore the swap the page offers.
  // Keep in step with schema.js's swapClockStatus gate (aplite's Layout card, the one
  // place a preset is still picked).
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
// the legacy order the presets ride (a preset-shaped view renders its tier's order);
// 1-11 are drawn literally. MIRRORS STACK_ORDER in src/c/windows/layout.c — keep in
// lockstep (both sides pin this exact list in their tests).
var STACK_ORDERS = [
  'TACB', 'TCAB', 'TABC', 'CTAB', 'CATB', 'CABT',
  'ATCB', 'ATBC', 'ACTB', 'ACBT', 'ABTC', 'ABCT'
];

/**
 * Does the watch draw this spec's bands LITERALLY in STACK_ORDERS[order] ('TACB' for code
 * 0) rather than in its tier's legacy order (compact: T A C B; full / none: T C A B)? THE
 * one copy of the watch's order rule (layout.c spec_is_stacked): an explicit band order
 * (1-11), a removed chrome band (clock / top strip), no graph body, a graph in the top
 * band, or a non-default band size (read normalised, as the watch does). One layout engine
 * draws both; this decides only the ORDER. The settings preview and the editor's band
 * list both read it, so neither can drift from the watch. The calendar presets never carry
 * these → false; Weather only's Default view (no top bar) → true.
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
// The key vocabulary is the screens' contract — settings/custom-layout-schema.js
// stores these exact strings and screens.js compileKeys / listFromSpec speak them.

// A graph in the top band compiles at tier NONE: no calendar rows, so the watch shows
// the strip's full date. The status rows' font follows the top area's ROW count on the
// watch (layout.c status_tier_for), not this wire tier: a 3-row graph top squeezes its
// row like fullCal's 3-row calendar, a 2-row one keeps compactCal's large row.
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
EXTRA_BARS.forEach(function (b) { CUSTOM_SRC[b.bar] = b.src; });
// And back: a status source's row value (specToKeys).
var SRC_NAME = [];
Object.keys(CUSTOM_SRC).forEach(function (value) { SRC_NAME[CUSTOM_SRC[value]] = value; });

/**
 * A row's status source (CUSTOM_SRC): a bar 4 to 6 only while it is on the watch
 * (extraBarOn), else the row is off, as is an unknown value.
 * @param {Object} S settings state
 * @param {*} value the row's viewUpper / viewLower value
 * @param {?Object} [env] platform env
 * @returns {number} STATUS_SRC_* value
 */
function rowSource(S, value, env) {
  var src = CUSTOM_SRC[value];
  if (src === undefined) { return STATUS_SRC_NONE; }
  return (src > STATUS_SRC_HEALTH && !extraBarOn(S, value, env)) ? STATUS_SRC_NONE : src;
}

// Capability gates, single-sourced: which radarMode/healthMode values unlock each
// seat kind. THE one copy — buildCustomCycle folds by them, and the modes the page
// writes are worked out from the screens (screens.js deriveModes), so a seat a screen
// holds is always unlocked once saved. Mirrors the watch's
// view_spec_resolve: radar CHART seats (top strip / body) need radarMode 'graph';
// a health graph body needs healthMode 'all'. The status SOURCES need no mode: the Radar
// bar and the Health bar are status bars like the others (they hold what their slots
// hold, 2.7.0's named bars), and the watch draws them without radar or health data, so a
// custom view keeps them whatever the modes say, and capabilities() has no seat for them.
// RADAR_ROW_MODES and HEALTH_ROW_MODES stay the PRESETS' facts — the modes whose preset
// cycles draw the Radar bar (MATRIX's 'r' cycles) and the Health bar (its 'status'/'all'
// buckets) — read by the 2.6 migration's 2.5 compile (migrations/screens.js legacyCycle,
// which folds the two bars outside them as 2.5 did).
var RADAR_CHART_MODES = ['graph'];
var RADAR_ROW_MODES = ['status', 'graph'];
var HEALTH_ROW_MODES = ['status', 'all'];
var HEALTH_BODY_MODES = ['all'];

/**
 * The capability booleans for a settings state — one per seat kind that folds, derived
 * from the mode lists above (reads S.radarMode / S.healthMode). The status bars have none:
 * custom views keep them in every mode.
 * @param {Object} S settings state
 * @returns {{radarChart:boolean,healthBody:boolean}}
 */
function capabilities(S) {
  S = S || {};
  return {
    radarChart: RADAR_CHART_MODES.indexOf(S.radarMode) >= 0,
    healthBody: HEALTH_BODY_MODES.indexOf(S.healthMode) >= 0
  };
}

// Every seat kind on: how the screens show a custom layout (screensCycle), whatever the
// modes say, since 2.6 works the modes out from the screens.
var ALL_CAPABLE = { radarChart: true, healthBody: true };

/**
 * Compile the custom per-view keys into a 1-3 slot cycle. Seats fold by
 * capabilities(S) — the shared gate table above — so the previews and the wire
 * agree with the watch's view_spec_resolve; the status bars never fold (the watch
 * draws them without radar or health data). A flick view left with NOTHING on
 * it (no clock, top band, graph or status row) compiles to null: a disabled slot the
 * watch skips, instead of a blank screen the flick would stop on.
 * A row naming a bar 4 to 6 keeps it only while the bar is on the watch (rowSource).
 * @param {Object} S settings state
 * @param {Object} [cap] the seats to keep, in place of capabilities(S) (screensCycle's
 *   ALL_CAPABLE)
 * @param {?Object} [env] platform env (bars 4 to 6 need env.extraBars; omitted = capable)
 * @returns {Array<?Object>} specs for packWire (length == viewCount, 1-3; null = disabled)
 */
function buildCustomCycle(S, cap, env) {
  var count = parseInt(S.viewCount, 10);
  if (!(count >= 1 && count <= 3)) { count = 1; }
  cap = cap || capabilities(S);
  var cycle = [];
  for (var i = 0; i < count; i++) {
    // 'cal' is the calendar with its rows in viewTopSize ('2' → 2 rows, else 3); the
    // older 'cal2' / 'cal3' spellings (stored before the calendar took a size) still
    // compile — the editor rewrites them to 'cal' + a size when it opens.
    var topKey = S['viewTop' + i];
    var t = (topKey === 'cal')
      ? ((S['viewTopSize' + i] === '2') ? CUSTOM_TOP.cal2 : CUSTOM_TOP.cal3)
      : (CUSTOM_TOP[topKey] || CUSTOM_TOP.cal2);
    var body = CUSTOM_BODY[S['viewBody' + i]];
    if (body === undefined) { body = BODY_FC; }
    var su = rowSource(S, S['viewUpper' + i], env);
    var sl = rowSource(S, S['viewLower' + i], env);

    // A radar top without the radar chart falls back to a calendar — the 2-row one for a
    // 2-row radar top (the same height, like the watch's no-data fold), else 3 rows.
    if (t.top === TOP_RADAR && !cap.radarChart) {
      t = (S['viewTopSize' + i] === '2') ? CUSTOM_TOP.cal2 : CUSTOM_TOP.cal3;
    }
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
    var code = orderCode(S['viewOrder' + i] || 'TACB');
    var s = spec(t.tier, t.top, body, su, sl);
    if (t.kind) { s.topKind = t.kind; }
    // The Default view always keeps its clock; any view may drop its top bar.
    if (i > 0 && S['viewClockOff' + i]) { s.clockOff = true; }
    if (S['viewStripOff' + i]) { s.stripOff = true; }
    if (code) { s.order = code; }
    // Sizes: a radar/graph top and a present body take '2'|'3'|'4'|'fill' rows. A
    // forecast seat never takes 2 rows (its labels collide) — '2' compiles to 3 rows, the
    // watch's band_rows clamp, so the fit check and the watch agree. Read with defaults,
    // so a blob that predates the keys compiles to ext 0.
    var fcTop = (t.top === TOP_GRAPH && t.kind === TOP_KIND_FORECAST);
    var ts = S['viewTopSize' + i] || '3', bs = S['viewBodySize' + i] || 'fill';   // (calendar rows: above)
    if (fcTop && ts === '2') { ts = '3'; }
    if (body === BODY_FC && bs === '2') { bs = '3'; }
    if (SIZE_CODE[ts]) { s.topSize = SIZE_CODE[ts]; }
    if (SIZE_CODE[bs]) { s.bodySize = SIZE_CODE[bs]; }
    // The forecast graph's style; canonicalExt drops it on a view without one. Whether the
    // watch draws styles at all, and whether the style exists, graph-styles.js wireCycle says.
    if (GRAPH_STYLE_CODE[S['viewStyle' + i]]) { s.graphStyle = GRAPH_STYLE_CODE[S['viewStyle' + i]]; }
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

// Size code → key value per seat (SIZE_CODE's inverse): code 0 is the seat default ('3'
// rows for a top, 'fill' for the body), so both columns differ only in row 0.
var TOP_SIZE_NAME = ['3', '2', '3', '4', 'fill'];
var BODY_SIZE_NAME = ['fill', '2', '3', '4', 'fill'];

/**
 * Invert a compiled cycle into the custom per-view keys — how a preset becomes a custom
 * layout (the 2.6 migration, the settings page's first edit), built so the keys compile
 * back to BYTE-IDENTICAL packed values (the zero-transmit upgrade proof, pinned by tests).
 * @param {Array<Object>} cycle specs from buildViewCycle (post-transform)
 * @returns {Object} key/value map to merge into the settings state
 */
function specToKeys(cycle) {
  var keys = { viewCount: String(cycle.length) };
  var alignName = ['clock', 'top', 'center', 'bottom'];
  for (var i = 0; i < cycle.length; i++) {
    var s = cycle[i];
    keys['viewTop' + i] = (s.top === TOP_RADAR) ? 'radar'
      : (s.top === TOP_CAL) ? 'cal'
      : (s.top === TOP_GRAPH) ? ((s.topKind === TOP_KIND_HEALTH) ? 'health' : 'forecast')
      : 'none';
    keys['viewBody' + i] = (s.body === BODY_GRAPH) ? 'health'
      : (s.body === BODY_RADAR) ? 'radar'
      : (s.body === BODY_NONE) ? 'none' : 'forecast';
    keys['viewUpper' + i] = SRC_NAME[s.statusUpper] || 'off';
    keys['viewLower' + i] = SRC_NAME[s.statusLower] || 'off';
    keys['viewOrder' + i] = STACK_ORDERS[s.order || 0];
    if (i > 0) { keys['viewClockOff' + i] = Boolean(s.clockOff); }
    keys['viewStripOff' + i] = Boolean(s.stripOff);
    // A calendar's size is its rows (the tier); a radar/graph top's is its ext code.
    keys['viewTopSize' + i] = (s.top === TOP_CAL) ? ((s.tier === TIER_FULL) ? '3' : '2')
      : (TOP_SIZE_NAME[s.topSize || 0] || '3');
    keys['viewBodySize' + i] = BODY_SIZE_NAME[s.bodySize || 0] || 'fill';
    keys['viewAlign' + i] = alignName[s.align || 0] || 'clock';
    keys['viewStyle' + i] = String((s.graphStyle || 0) + 1);
  }
  return keys;
}

var NEW_KEYS = { fullCal: 1, compactCal: 1, compactDense: 1, noCal: 1, weatherOnly: 1 };
// legacy layoutPreset -> new. fullCal is unchanged (key kept, new semantics).
var LEGACY_PRESET = {
  classic: 'compactCal', radarLast: 'compactCal', healthFirst: 'compactCal',
  forecast: 'noCal', fullCal: 'fullCal'
};

/**
 * Resolve the effective preset key from a settings object, migrating legacy values.
 * @param {Object} state Clay settings (or config-UI state).
 * @returns {string} one of fullCal|compactCal|compactDense|noCal|weatherOnly
 */
/**
 * The preset a watch actually runs: resolvePresetKey, with the presets a platform can't
 * draw folded to the one its settings radio shows instead (the dormant value's
 * fallback, compactCal). aplite has no radar and no view without top bar, so a stored
 * Weather only runs — and previews — as Compact calendar there. The one fold the
 * payload (clay-payload.js) and the settings page's watch preview (preview-watch.js) share.
 * @param {Object} state settings state
 * @param {?{platform: string}} env platform facts ('' / missing = capable)
 * @returns {string} preset key
 */
function presetKeyFor(state, env) {
  var key = resolvePresetKey(state);
  if (key === 'weatherOnly' && env && env.platform === 'aplite') { return 'compactCal'; }
  return key;
}

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

/**
 * The view cycle a watch runs for a settings state: THE one reading, for the Clay payload
 * (clay-payload.js), the settings page's watch preview (settings/preview-watch.js) and the Alerts tab's
 * About alerts Default-view note (settings/when-resolvers.js). layoutPreset 'custom' compiles the
 * per-view keys (buildCustomCycle), except on an APLITE watch, which folds custom to the
 * explicit compactCal preset: aplite is frozen-lean, its settings screen never offers
 * Custom, and resolvePresetKey pins the fold so a legacy topViewMode value can't redirect
 * it. A preset the watch can't draw runs as the one the settings radio shows
 * (presetKeyFor). An unknown platform ('' or no env) is custom-capable.
 * @param {Object} settings settings state
 * @param {?{platform: string}} [env] platform facts (config-ui platform.js computeEnv)
 * @returns {Array<?Object>} the view cycle (slot 0 is the Default view)
 */
function resolveViewCycle(settings, env) {
  var s = settings || {};
  if (s.layoutPreset === 'custom' && !(env && env.platform === 'aplite')) {
    return buildCustomCycle(s, null, env);
  }
  return buildViewCycle(presetKeyFor(s, env), s.healthMode || 'off', s.radarMode || 'graph',
    Boolean(s.swapClockStatus));
}

/**
 * The views the screens show, before the watch's data folds (2.6: the modes follow the
 * screens, settings/screens.js deriveModes): a custom layout compiled with every seat kind on,
 * so its stored rows and graphs all count; a preset as its cycle; and on aplite, which folds
 * a custom layout to a preset, what aplite runs (resolveViewCycle).
 * @param {Object} settings settings state
 * @param {?{platform: string}} [env] platform facts
 * @returns {Array<?Object>} the views (null = a screen with nothing on it, which the watch skips)
 */
function screensCycle(settings, env) {
  var s = settings || {};
  if (s.layoutPreset === 'custom' && !(env && env.platform === 'aplite')) {
    return buildCustomCycle(s, ALL_CAPABLE, env);
  }
  return resolveViewCycle(s, env);
}

/**
 * The status bars the screens show (screensCycle): the Watch bar on a screen the watch stops
 * on that keeps it, and each source's bar wherever a view seats its row. THE one reading of
 * "the bar is on the watch" for the Status bars tab, On demand (on-demand.js barExists) and
 * the modes the screens need (screens.js deriveModes, which has the cycle compiled already:
 * barsIn).
 * @param {Object} settings settings state
 * @param {?{platform: string}} [env] platform facts
 * @returns {{top: boolean, forecast: boolean, radar: boolean, health: boolean, bar4: boolean,
 *     bar5: boolean, bar6: boolean}}
 */
function barsShown(settings, env) {
  return barsIn(screensCycle(settings, env));
}

/**
 * barsShown over a cycle already compiled by screensCycle.
 * @param {Array<?Object>} cycle the views (null = a screen the watch skips)
 * @returns {{top: boolean, forecast: boolean, radar: boolean, health: boolean, bar4: boolean,
 *     bar5: boolean, bar6: boolean}}
 */
function barsIn(cycle) {
  var out = { top: false };
  BAR_OF_SRC.forEach(function (bar) { if (bar) { out[bar] = false; } });
  for (var i = 0; i < cycle.length; i++) {
    var v = cycle[i];
    if (!v) { continue; }
    if (!v.stripOff) { out.top = true; }
    if (barOfSource(v.statusUpper)) { out[barOfSource(v.statusUpper)] = true; }
    if (barOfSource(v.statusLower)) { out[barOfSource(v.statusLower)] = true; }
  }
  return out;
}

/**
 * The graphs a cycle's views show, over every screen the watch stops on (a null view is
 * skipped): the rain radar's, in the top area or the body, and the health graph's, as a
 * health-kind graph top or the graph body. Their bars are barsIn's.
 * @param {Array<?Object>} cycle the views (screensCycle, or the watch's resolveViewCycle)
 * @returns {{radar: boolean, health: boolean}}
 */
function graphsIn(cycle) {
  var out = { radar: false, health: false };
  for (var i = 0; i < cycle.length; i++) {
    var v = cycle[i];
    if (!v) { continue; }
    if (v.top === TOP_RADAR || v.body === BODY_RADAR) { out.radar = true; }
    if ((v.top === TOP_GRAPH && v.topKind === TOP_KIND_HEALTH) || v.body === BODY_GRAPH) { out.health = true; }
  }
  return out;
}

// Single public API object, defined once. As a CommonJS module (watch runtime, tests)
// this is module.exports. When this file is instead concatenated as a plain <script> into
// the config-UI webview (see scripts/build-config-page.js, which has no `module`),
// settings/preview-watch.js reads this same VIEW_CYCLE object from the shared top-level scope
// rather than require()-ing it — one export list, no hand-copied duplicate to drift.
var VIEW_CYCLE = {
  TIER_OFF: TIER_OFF, TIER_NONE: TIER_NONE, TIER_COMPACT: TIER_COMPACT, TIER_FULL: TIER_FULL,
  TOP_EMPTY: TOP_EMPTY, TOP_CAL: TOP_CAL, TOP_RADAR: TOP_RADAR, TOP_GRAPH: TOP_GRAPH,
  TOP_KIND_FORECAST: TOP_KIND_FORECAST, TOP_KIND_HEALTH: TOP_KIND_HEALTH,
  BODY_FC: BODY_FC, BODY_GRAPH: BODY_GRAPH, BODY_RADAR: BODY_RADAR, BODY_NONE: BODY_NONE,
  SIZE_DEFAULT: SIZE_DEFAULT, SIZE_2: SIZE_2, SIZE_3: SIZE_3, SIZE_4: SIZE_4, SIZE_FILL: SIZE_FILL,
  SIZE_CODE: SIZE_CODE, TOP_SIZE_NAME: TOP_SIZE_NAME, BODY_SIZE_NAME: BODY_SIZE_NAME,
  GRAPH_STYLE_CODE: GRAPH_STYLE_CODE, GRAPH_STYLES: GRAPH_STYLES, GRAPH_STYLE_SLOTS: GRAPH_STYLE_SLOTS,
  ALIGN_CLOCK: ALIGN_CLOCK, ALIGN_TOP: ALIGN_TOP, ALIGN_CENTER: ALIGN_CENTER,
  ALIGN_BOTTOM: ALIGN_BOTTOM, ALIGN_CODE: ALIGN_CODE,
  STATUS_SRC_NONE: STATUS_SRC_NONE, STATUS_SRC_FORECAST: STATUS_SRC_FORECAST,
  STATUS_SRC_RADAR: STATUS_SRC_RADAR, STATUS_SRC_HEALTH: STATUS_SRC_HEALTH,
  STATUS_SRC_BAR4: STATUS_SRC_BAR4, STATUS_SRC_BAR5: STATUS_SRC_BAR5, STATUS_SRC_BAR6: STATUS_SRC_BAR6,
  EXT_UPPER_BAR_HI: EXT_UPPER_BAR_HI, EXT_LOWER_BAR_HI: EXT_LOWER_BAR_HI,
  EXTRA_BARS: EXTRA_BARS, extraBar: extraBar, barMade: barMade, extraBarOn: extraBarOn,
  rowSource: rowSource, barOfSource: barOfSource,
  spec: spec, cloneSpec: cloneSpec, packSpec: packSpec, unpackSpec: unpackSpec,
  packExt: packExt, packWire: packWire, unpackWire: unpackWire, hasFill: hasFill,
  stackFits: stackFits, stackNeed: stackNeed, stackSeats: stackSeats, resolveForFit: resolveForFit, FIT_PX: FIT_PX,
  swapUpperToLower: swapUpperToLower, demoteRadarBody: demoteRadarBody,
  STACK_ORDERS: STACK_ORDERS, orderCode: orderCode, isStacked: isStacked,
  RADAR_CHART_MODES: RADAR_CHART_MODES, RADAR_ROW_MODES: RADAR_ROW_MODES,
  HEALTH_ROW_MODES: HEALTH_ROW_MODES, HEALTH_BODY_MODES: HEALTH_BODY_MODES,
  capabilities: capabilities,
  buildCustomCycle: buildCustomCycle, specToKeys: specToKeys,
  buildViewCycle: buildViewCycle, resolvePresetKey: resolvePresetKey, presetKeyFor: presetKeyFor,
  resolveViewCycle: resolveViewCycle, screensCycle: screensCycle, barsShown: barsShown, barsIn: barsIn,
  graphsIn: graphsIn
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VIEW_CYCLE;
}
