// src/pkjs/page/layout/watch-layout.js — ES5, WebView (+ Node for tests). Where the watch places
// each band of a view on its screen (layout.c layout_compute_spec), for the settings page's
// pictures of the watch (preview-watch.js layoutView). It places the bands on the seats of the
// phone's fit engine (view-cycle.js: topShape, rowTier, rowSeat) and is held to the watch's own
// placement by scripts/check-fit-lockstep.js (its R lines). Only the page draws with it, so it
// stays out of view-cycle.js, which the watch-runtime bake carries.
(function () {
  var VC = typeof require !== 'undefined' ? require('../../layout/domain/view-cycle.js') : VIEW_CYCLE;
  var FIT_PX = VC.FIT_PX, STACK_ORDERS = VC.STACK_ORDERS;
  var extFields = VC.extFields, sizeRows = VC.sizeRows, topShape = VC.topShape;
  var rowTier = VC.rowTier, rowSeat = VC.rowSeat, isStacked = VC.isStacked;
  var TIER_FULL = VC.TIER_FULL, TIER_COMPACT = VC.TIER_COMPACT;
  var TOP_EMPTY = VC.TOP_EMPTY, BODY_NONE = VC.BODY_NONE, BODY_FC = VC.BODY_FC;
  var STATUS_SRC_NONE = VC.STATUS_SRC_NONE;
  var ALIGN_CLOCK = VC.ALIGN_CLOCK, ALIGN_CENTER = VC.ALIGN_CENTER, ALIGN_BOTTOM = VC.ALIGN_BOTTOM;

  // The rest of layout.c's per-family numbers its placement uses, kept in lockstep with the C
  // engine by scripts/check-fit-lockstep.js (its R lines): the window's top pad
  // (LAYOUT_PAD_TOP), the floor the stack ends on (the screen's height less LAYOUT_PAD_BOTTOM),
  // the screen's height, the large Gothic the strip, the calendar and the COMPACT / NONE rows
  // draw in (STATUS_LARGE_FONT_H), the rows between the strip's ink and a calendar under it
  // (STATUS_STRIP_CAL_GAP), STATUS_TOP_STRIP_LIFT and the calendar's text lift
  // (CALENDAR_FONT_OFFSET, CALENDAR_TEXT_SHIFT_Y). The row seats' own numbers are view-cycle.js
  // SEAT_PX.
  var PLACE_PX = {
    padTop: [0, 2], floor: [168, 224], height: [168, 228], largeFont: [18, 24],
    stripCalGap: [0, 2], stripLift: 2, calLift: 5
  };

  // status_metrics.h's Gothic model, in C's integer arithmetic: where a line of `ch` rows seats
  // in a band, its cap's height and the blank rows above the cap.
  /** @param {number} a @param {number} b @returns {number} C's truncating a / b */
  function cdiv(a, b) { var q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); }
  /** @param {number} ch @returns {number} status_glyph_below */
  function statusGlyphBelow(ch) { return cdiv(ch + 6, 4); }
  /** @param {number} ch @returns {number} status_descender_h */
  function statusDescender(ch) { return cdiv(ch + 3, 6); }
  /** @param {number} ch @returns {number} status_cap_h */
  function statusCapH(ch) { return cdiv(ch, 2) + 2; }
  /** @param {number} ch @returns {number} status_ink_top */
  function statusInkTop(ch) { return ch - statusCapH(ch); }

  /**
   * status_seat_y: the line's top in a band, its cap centred on the band's middle unless its
   * descenders would leave the band.
   * @param {number} bandH the band's height
   * @param {number} ch the line's content height (its Gothic size)
   * @returns {number} rows below the band's top
   */
  function statusSeatY(bandH, ch) {
    var y = cdiv(bandH, 2) - ch + statusGlyphBelow(ch);
    var fit = bandH - ch - statusDescender(ch);
    return y < fit ? y : fit;
  }

  /**
   * calendar_metrics.h calendar_text_top: a date's line top in its cell (emery: the line centred
   * in the cell, then lifted; the 144 px watches: lifted out of the cell's top).
   * @param {number} cellY @param {number} cellH @param {number} ch @param {number} f
   * @returns {number}
   */
  function calendarTextTop(cellY, cellH, ch, f) {
    return f ? cellY + cdiv(cellH - ch, 2) - PLACE_PX.calLift : cellY - PLACE_PX.calLift;
  }

  /**
   * Where each band of a view lands on its screen: layout.c layout_compute_spec, for the settings
   * page's pictures of the watch. The seats of stackSeats' walk, placed from the strip's
   * reserve down: a top area leading under the strip on the strip's ink, a row on the band
   * row_seat gives it inside its slot (trimmed clear of a radar or graph above it), the band
   * that fills taking what the others leave, the clock's ink centred between its neighbours'
   * ink (clock_seat_y), and a stack that fills nothing moved by its Position
   * (stack_align_offset). A preset-shaped view walks its tier's legacy order, as the watch.
   * @param {!Object} s view spec as the watch lays it out
   * @param {number} f family index (0 = 144 px, 1 = emery)
   * @param {{centreOff: number, inkH: number}} ink the time font's ClockInk (clock_ink.c)
   * @returns {{tier: number, fill: string, bands: !Array<{band: string, y: number, h: number}>}}
   *     the rows' tier, the band that fills ('G' the body, 'T' the top area, '' none), and each
   *     present band ('T' top, 'C' clock, 'A'/'B' status rows, 'G' body) top to bottom, with
   *     its rows on the screen
   */
  function stackLayout(s, f, ink) {
    var e = extFields(s), top = topShape(s, e), tier = rowTier(s, top.rows);
    var row = FIT_PX.row[f], timeH = FIT_PX.clock[f], strip = !s.stripOff;
    var contentY = PLACE_PX.padTop[f], floor = PLACE_PX.floor[f];
    var largeCh = PLACE_PX.largeFont[f], stripH = FIT_PX.statusLarge[f];
    // The rows' Gothic: the full tier's is the squeezed band less its clearances.
    var rowCh = tier === TIER_FULL ? FIT_PX.statusFull[f] - 2 * FIT_PX.gap[f] : largeCh;
    var bodyOn = s.body !== BODY_NONE;
    var bodyRows = bodyOn ? sizeRows(e.bodySize, 0, s.body === BODY_FC) : 0;
    var bodyFill = bodyOn && !bodyRows;
    var order = isStacked(s) ? (s.order || 0) : (s.tier === TIER_COMPACT ? 0 : 1);
    var seq = (STACK_ORDERS[order] || 'TACB') + 'G', list = [], j, b;
    var present = { T: s.top !== TOP_EMPTY && top.rows > 0, C: !s.clockOff,
                    A: s.statusUpper !== STATUS_SRC_NONE, B: s.statusLower !== STATUS_SRC_NONE, G: bodyOn };
    for (j = 0; j < seq.length; j++) { if (present[seq.charAt(j)]) { list.push(seq.charAt(j)); } }
    var isRow = { A: true, B: true }, prevOf = {}, nextOf = {}, seat = {};
    // Pass 1: each present band's seat.
    for (j = 0; j < list.length; j++) {
      b = list[j];
      var prev = j > 0 ? list[j - 1] : null, next = j + 1 < list.length ? list[j + 1] : null;
      prevOf[b] = prev;
      nextOf[b] = next;
      if (b === 'T') {
        var tH = top.fill ? 0 : top.rows * row;
        var freed = Boolean(isRow[next]) && list[j + 2] === 'C';
        seat[b] = { pitch: tH, bandH: tH, off: 0, gap: (next === 'C' || freed) ? 0 : FIT_PX.gap[f] };
      } else if (b === 'C') {
        var cOff = (!prev && strip) ? 1 : 0;   // the noCal seat
        seat[b] = { pitch: timeH + cOff, bandH: timeH, off: cOff, gap: 0 };
      } else if (b === 'G') {
        seat[b] = { pitch: bodyRows * row, bandH: bodyRows * row, off: 0, gap: 0 };
      } else {
        seat[b] = rowSeat(prev, next, Boolean(isRow[prev]) && seat[prev].under, f, tier);
      }
    }
    // The strip's ink: its line's seat less the lift, and the rows it paints (descenders too).
    var stripSeat = statusSeatY(stripH, largeCh) - PLACE_PX.stripLift;
    var stripInkEnd = contentY + stripSeat + largeCh + statusDescender(largeCh);
    var calY = stripInkEnd + PLACE_PX.stripCalGap[f];   // strip_calendar_seat
    var start = floor - (strip ? FIT_PX.availStrip[f] : FIT_PX.availNoStrip[f]);
    // A row or the graph leading under the strip starts on the first row the strip does not paint.
    if (strip && list.length && (list[0] === 'G' || isRow[list[0]]) && start < stripInkEnd) { start = stripInkEnd; }
    if (top.fill && present.T) {
      var fixed = 0;
      for (j = 0; j < list.length; j++) {
        if (list[j] !== 'T') { fixed += seat[list[j]].pitch; }
        if (j + 1 < list.length) { fixed += seat[list[j]].gap; }
      }
      seat.T.pitch = seat.T.bandH = Math.max(floor - start - fixed, 0);
    }
    // Pass 2: place, each slot after the clearance the one above owes, clamped to the floor.
    var rect = {}, topSlot = start, y = start, pending = 0, blockEnd = start;
    for (j = 0; j < list.length; j++) {
      b = list[j];
      var sb = seat[b];
      y = Math.min(y + pending, floor);
      var fills = b === 'G' && bodyFill;
      var pitch = Math.max(Math.min(fills ? floor - y : sb.pitch, floor - y), 0);
      var ry = y + sb.off, rh = fills ? pitch : sb.bandH;
      if (b === 'T' && j === 0 && strip) {
        ry = calY;   // on the strip's ink
        if (top.fill) { rh = y + pitch - ry; }   // a fill still ends on its slot
      }
      // A row between a radar/graph top and the clock never overlaps it: its blank top is trimmed.
      if (isRow[b] && prevOf[b] === 'T' && top.sized && ry < rect.T.y + rect.T.h) {
        rh -= rect.T.y + rect.T.h - ry;
        ry = rect.T.y + rect.T.h;
      }
      ry = Math.min(ry, floor);
      rh = Math.max(Math.min(rh, floor - ry), 0);
      rect[b] = { band: b, y: ry, h: rh };
      if (b === 'T') { topSlot = y; }
      y += pitch;
      pending = sb.gap;
      // A radar/graph top slid onto the strip's ink pays its clearance from where it ends.
      if (b === 'T' && top.sized && sb.gap > 0 && ry + rh > y) { pending += ry + rh - y; }
      blockEnd = Math.max(blockEnd, ry + rh, y);
    }
    // The clock's ink centred between its neighbours' ink (clock_seat_y); a top area counts as
    // a calendar of its rows in the calendar's seat.
    if (present.C) {
      var above = prevOf.C, below = nextOf.C;
      var calTop = (!prevOf.T && strip) ? calY : topSlot;
      var calEnd = top.fill ? topSlot + seat.T.pitch : calTop + (seat.T ? seat.T.bandH : 0);
      var aboveInk = !above ? (strip ? contentY + stripSeat + largeCh - 1 : contentY - 1)
        : above === 'T' ? calendarTextTop(calEnd - row, row, largeCh, f) + largeCh - 1
        : rect[above].y + statusSeatY(rect[above].h, rowCh) + statusInkTop(rowCh) + statusCapH(rowCh) - 1;
      var belowInk = !below ? blockEnd
        : below === 'G' ? rect.G.y
        : below === 'T' ? calendarTextTop(calTop, row, largeCh, f) + statusInkTop(largeCh)
        : rect[below].y + statusSeatY(rect[below].h, rowCh) + statusInkTop(rowCh);
      var inkInBand = cdiv(rect.C.h, 2) + ink.centreOff - cdiv(ink.inkH, 2);
      rect.C.y = cdiv(aboveInk + belowInk - ink.inkH + 1, 2) - inkInBand;
    }
    // Position: only a stack nothing fills moves (the strip is pinned).
    var off = 0, fill = bodyFill ? 'G' : (top.fill && present.T) ? 'T' : '';
    if (!fill) {
      var slack = Math.max(floor - blockEnd, 0), align = s.align || ALIGN_CLOCK;
      if (align === ALIGN_BOTTOM) {
        off = slack;
      } else if (align === ALIGN_CENTER || (align === ALIGN_CLOCK && !present.C)) {
        off = cdiv(slack, 2);
      } else if (align === ALIGN_CLOCK) {
        var target = cdiv(PLACE_PX.height[f], 2) - cdiv(timeH, 2) - ink.centreOff;
        off = Math.min(Math.max(target - rect.C.y, 0), slack);
      }
    }
    return { tier: tier, fill: fill, bands: list.map(function (k) {
      return { band: k, y: rect[k].y + off, h: rect[k].h };
    }) };
  }

  var api = { PLACE_PX: PLACE_PX, stackLayout: stackLayout, statusSeatY: statusSeatY,
    statusGlyphBelow: statusGlyphBelow };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.WatchLayout = api; }
})();
