// src/pkjs/settings/preview-layout.js — ES5, WebView. The Layout tab's preview
// block: one schematic band column per slot of the adaptive view cycle. The cycle
// itself comes from view-cycle.js (shared with clay-payload.js, so the preview and
// the wire cannot disagree); what lives here is the band geometry that turns a
// ViewSpec into a labelled stack of rectangles.
/* global PConf, VIEW_CYCLE */
// The `.blocks` test is not redundant. config-ui's lib/color.js and lib/schema-walk.js
// each do `global.PConf = global.PConf || {}` to attach their own shard, and
// line-style.js pulls both in — so under Node, from the second preview file onwards,
// global.PConf EXISTS while carrying no block registry unless engine.js was loaded
// first. The page and every test do load it first; without the test, a require of
// this file on its own would pick that shard up and throw on the register below.
var PConf = (typeof global !== 'undefined' && global.PConf && global.PConf.blocks)
    ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    // Node (tests/build tooling): view-cycle.js is a real CommonJS module, require it.
    // Webview: view-cycle.js is concatenated as a plain <script> before this file (see
    // scripts/build-config-page.js), which has no require(). It exposes its whole API as
    // one top-level VIEW_CYCLE object sharing this scope.
    var VC = (typeof require !== 'undefined') ? require('../view-cycle.js') : VIEW_CYCLE;
    // Same dual-context pattern: a CommonJS module under Node, a concatenated
    // <script> exposing window.PreviewSvg in the webview.
    var svg = (typeof require !== 'undefined') ? require('./preview-svg.js') : window.PreviewSvg;
    var rect = svg.rect, txt = svg.txt, previewInk = svg.previewInk, svgFrame = svg.svgFrame;

    /**
     * Resolve the Layout state to the adaptive view cycle (array of ViewSpec objects).
     * Shares view-cycle.js with clay-payload.js — no manual sync. layoutPreset
     * 'custom' compiles the per-view keys (with the same capability folds the wire
     * gets), EXCEPT for an aplite watch: there the payload folds custom to the
     * explicit compactCal preset, and the preview must show what the watch renders.
     * @param {Object} state Live settings (layoutPreset/healthMode/radarMode/swapClockStatus).
     * @param {Object} [env] Config-UI environment facts (platform gate).
     * @returns {Array.<Object>} The view cycle — one ViewSpec per flick slot.
     */
    function presetContents(state, env) {
        state = state || {};
        var radarMode = state.radarMode || 'graph';
        if (state.layoutPreset === 'custom' && !(env && env.platform === 'aplite')) {
            return VC.buildCustomCycle(state);
        }
        return VC.buildViewCycle(VC.presetKeyFor(state, env), state.healthMode || 'off', radarMode,
            Boolean(state.swapClockStatus));
    }

    // Schematic band-stack geometry (px). The calendar is modelled as rows of height ROW
    // stacked with BAND_GAP between them (the same gap the renderers draw), so a status bar
    // is exactly one freed calendar row: CAL2_H + BAND_GAP + STATUS_H === CAL3_H. Dropping the
    // 3rd calendar row buys precisely one status band. Kept honest by a test in
    // test/preview-layout.test.js.
    var ROW = 10, BAND_GAP = 2;
    var CAL3_H = ROW * 3 + BAND_GAP * 2;   // 34 — full 3-row calendar (2 inter-row gaps)
    var CAL2_H = ROW * 2 + BAND_GAP;       // 22 — compact 2-row calendar (1 inter-row gap)
    var STATUS_H = ROW;                    // 10 — a status bar = the freed calendar row
    var FLEX_MIN = 12;                     // floor for the flex (body) band so it never vanishes

    /**
     * Resolve band heights for a stack that fills `availH` (bands + gaps span exactly
     * availH). The single band flagged `flex` absorbs the slack; the rest keep their
     * fixed `h`. With no flex band, returns the fixed heights unchanged.
     * @param {Array.<{h: number, flex: boolean}>} bands The band stack.
     * @param {number} availH Height the stack must span, gaps included.
     * @param {number} gap Inter-band gap.
     * @returns {number[]} Resolved heights (px), parallel to `bands`.
     */
    function resolveBandHeights(bands, availH, gap) {
        var fixed = 0, flexIdx = -1, i, out = [];
        for (i = 0; i < bands.length; i++) {
            out.push(bands[i].h);
            if (bands[i].flex) { flexIdx = i; } else { fixed += bands[i].h; }
        }
        if (flexIdx >= 0) {
            var rest = availH - fixed - (bands.length - 1) * gap;
            out[flexIdx] = rest > FLEX_MIN ? rest : FLEX_MIN;
        }
        return out;
    }

    /**
     * Schematic height of `rows` stacked rows (the calendar model: ROW + BAND_GAP):
     * 2 → 22, 3 → 34, 4 → 46.
     * @param {number} rows @returns {number} px
     */
    function rowsH(rows) { return rows * ROW + (rows - 1) * BAND_GAP; }

    /**
     * Rows a sized seat shows for its ext size code (view-cycle.js SIZE_*): 2 / 3 / 4,
     * 0 for fill, `dflt` for the seat default; a forecast never under 3 (the watch clamp).
     * @param {number|undefined} code @param {number} dflt @param {boolean} forecast
     * @returns {number} rows, 0 = fill
     */
    function sizedRows(code, dflt, forecast) {
        var r = code === VC.SIZE_2 ? 2 : code === VC.SIZE_3 ? 3 : code === VC.SIZE_4 ? 4
              : code === VC.SIZE_FILL ? 0 : dflt;
        return (forecast && r === 2) ? 3 : r;
    }

    // Status-source -> band label. Labels drop the trailing "Bar" to stay compact in the
    // narrow preview columns. STATUS_SRC_NONE (0) has no entry, so a lookup for it is falsy
    // (no band) — see upperRow/lowerRow below.
    var STATUS_LABEL = {};
    STATUS_LABEL[VC.STATUS_SRC_FORECAST] = 'Forecast Status';
    STATUS_LABEL[VC.STATUS_SRC_RADAR] = 'Radar Status';
    STATUS_LABEL[VC.STATUS_SRC_HEALTH] = 'Health Status';

    /**
     * Schematic band stack for one ViewSpec — proportional, not pixel-accurate. Mirrors
     * layout.c band ordering: compact = cal, upper status row (freed cal row) before the
     * clock, lower status row (forecast-abutting) after; full/none = clock, then upper row,
     * then lower row. Reads spec.statusUpper/spec.statusLower directly — radar flavor is
     * data (STATUS_SRC_RADAR), not inferred from spec.top/spec.body.
     * @param {?Object} spec One ViewSpec from the cycle.
     * @returns {?Array.<{label: string, h: number, flex: boolean}>} The band stack, or null.
     */
    function contentBands(spec) {
        if (!spec) { return null; }
        // Custom omissions: a stripless view drops the Watch Status band, a clockless
        // one drops the Clock band, a graphless one the body — a present flex body
        // absorbs the freed space, like the watch; without one the column's Position
        // (renderBandColumn's align) places the shorter stack.
        // Every band carries its `kind` ('strip'|'top'|'clock'|'status'|'body').
        var bands = spec.stripOff ? [] : [{ label: 'Watch Status', h: 12, kind: 'strip' }];
        var isNone = spec.tier === VC.TIER_NONE;
        var isFull = spec.tier === VC.TIER_FULL;
        var topBand = null;
        if (spec.top === VC.TOP_RADAR || spec.top === VC.TOP_GRAPH) {
            // A radar/graph top: its size in schematic rows (default 3), or flex for fill.
            var tRows = sizedRows(spec.topSize, 3,
                spec.top === VC.TOP_GRAPH && spec.topKind !== VC.TOP_KIND_HEALTH);
            topBand = { label: spec.top === VC.TOP_RADAR ? 'Radar'
                          : spec.topKind === VC.TOP_KIND_HEALTH ? 'Health graph' : 'Forecast',
                        h: tRows ? rowsH(tRows) : 20, flex: !tRows, kind: 'top' };
        }
        else if (!isNone) {
            topBand = { label: isFull ? 'Calendar (3 rows)' : 'Calendar (2 rows)',
                        h: isFull ? CAL3_H : CAL2_H, kind: 'top' };
        }
        var bodyLabel = spec.body === VC.BODY_GRAPH ? 'Health graph'
                      : spec.body === VC.BODY_RADAR ? 'Radar' : 'Forecast';
        // The body takes the remaining space (flex); the fallback h only matters to a
        // consumer that doesn't resolve flex bands. A graphless view has none.
        var bRows = sizedRows(spec.bodySize, 0, spec.body === VC.BODY_FC);
        var bodyBand = spec.body === VC.BODY_NONE ? null
            : { label: bodyLabel, h: bRows ? rowsH(bRows) : 20, flex: !bRows, kind: 'body' };
        var upperLabel = STATUS_LABEL[spec.statusUpper];
        var lowerLabel = STATUS_LABEL[spec.statusLower];
        var upperRow = upperLabel ? { label: upperLabel, h: STATUS_H, kind: 'status' } : null;
        var lowerRow = lowerLabel ? { label: lowerLabel, h: STATUS_H, kind: 'status' } : null;
        var clock = spec.clockOff ? null : { label: 'Clock', h: isNone ? 30 : 22, kind: 'clock' };
        var code = spec.order || 0;
        if (VC.isStacked(spec)) {
            // Generic stacker — the watch's dispatch rule, shared (view-cycle.js
            // isStacked): ANY custom spec with clockOff/stripOff OR an explicit order
            // 1-11 renders as the STACK_ORDERS[order] band sequence (order 0 = 'TACB'),
            // absent bands skipped, body last. Only pure order-0 full-chrome specs take
            // the legacy tier branches below.
            var seq = VC.STACK_ORDERS[code] || VC.STACK_ORDERS[0], j, byLetter = {
                T: topBand, C: clock, A: upperRow, B: lowerRow
            };
            for (j = 0; j < 4; j++) {
                if (byLetter[seq.charAt(j)]) { bands.push(byLetter[seq.charAt(j)]); }
            }
        } else if (!isNone && !isFull) {          // compact: upper rides the freed cal row
            if (topBand) { bands.push(topBand); }
            if (upperRow) { bands.push(upperRow); }   // freed row, above the clock
            if (clock) { bands.push(clock); }
            if (lowerRow) { bands.push(lowerRow); }   // carved band, below the clock (near the body)
        } else {                                  // full / none: clock, then status row(s)
            if (topBand) { bands.push(topBand); }
            if (clock) { bands.push(clock); }
            if (upperRow) { bands.push(upperRow); }
            if (lowerRow) { bands.push(lowerRow); }
        }
        if (bodyBand) { bands.push(bodyBand); }
        return bands;
    }

    /**
     * Scale a column's fixed band heights down so the stack spans at most 104 px (gaps
     * included), keeping a flex band at least rowsH(2). Unchanged when it already fits.
     * @param {Array.<{flex: boolean}>} bands @param {number[]} heights resolved heights
     * @returns {number[]} heights that fit the column
     */
    function squeezeToColumn(bands, heights) {
        var gaps = (bands.length - 1) * BAND_GAP, fixed = 0, flexIdx = -1, i;
        for (i = 0; i < bands.length; i++) {
            if (bands[i].flex) { flexIdx = i; } else { fixed += heights[i]; }
        }
        var flexH = flexIdx >= 0 ? Math.max(heights[flexIdx], rowsH(2)) : 0;
        if (fixed + flexH + gaps <= 104 || fixed <= 0) { return heights; }
        var k = (104 - gaps - flexH) / fixed, out = [], used = 0;
        for (i = 0; i < bands.length; i++) {
            out.push(bands[i].flex ? 0 : Math.max(4, Math.floor(heights[i] * k)));
            if (!bands[i].flex) { used += out[i]; }
        }
        if (flexIdx >= 0) { out[flexIdx] = 104 - gaps - used; }
        return out;
    }

    /**
     * Where the band column's stack sits when nothing fills it (spec.align — the watch's
     * Position; see stack_align_offset in src/c/windows/layout.c): 0 Clock centres the
     * clock band on the column's midline (Middle without a clock), clamped to the slack;
     * 1 Top, 2 Middle, 3 Bottom. Schematic like the rest of the preview: the column's
     * midline stands in for the screen's.
     * @param {number} align ALIGN_* code
     * @param {number} slack free rows under the top-anchored stack
     * @param {?{y: number, h: number}} clock the clock band in the top-anchored column
     * @param {number} midY the column's midline
     * @returns {number} offset in [0, slack]
     */
    function alignOffset(align, slack, clock, midY) {
        if (align === VC.ALIGN_TOP) { return 0; }
        if (align === VC.ALIGN_BOTTOM) { return slack; }
        if (align === VC.ALIGN_CENTER || !clock) { return Math.floor(slack / 2); }
        var off = Math.round(midY - (clock.y + clock.h / 2));
        return off < 0 ? 0 : (off > slack ? slack : off);
    }

    // One column of a side-by-side layout preview: a header label over a band stack that
    // fills the column width (no side padding). `dim`/`note` are unused by the adaptive
    // cycle preview (every slot in the cycle is available by construction) but kept as
    // params — `note` still renders as a placeholder sub-note when a column has no bands.
    // Card/placeholder fills are theme-relative washes (previewInk's rgba helper), so
    // this — the block wired into the Layout tab via layoutPreviewCombined — follows
    // the theme too, not just its outer canvas.
    function renderBandColumn(bands, x, w, header, note, dim, theme, align, tooTall) {
        var ink = previewInk(theme);
        var headerColor = dim ? '#5A6270' : '#8A92A0';
        var bandFill = ink.rgba(dim ? '0.08' : '0.12');
        var labelColor = dim ? '#4A505C' : '#AEB4BD';
        var e = txt(x + w / 2, 9, 8, headerColor, 'middle', 700, header), y = 16, i;
        if (!bands || !bands.length) {
            e += rect(x, y, w, 104, ink.rgba('0.07'));
            e += txt(x + w / 2, y + 54, 8, '#6A7280', 'middle', 600, note || '—');
            return e;
        }
        // Bands + gaps span y=16..120, matching the empty-column placeholder's 104px box, so
        // the flex (body) band always fills down to the same bottom across all columns.
        var heights = resolveBandHeights(bands, 104, BAND_GAP);
        // The schematic rows are not the watch's pixels, so a stack the watch fits can
        // overrun the 104 px column (sized graphs, several rows): squeeze the fixed bands
        // to fit, leaving a flex band its 2-row schematic floor. Only a view the watch
        // itself cannot fit (tooTall — view-cycle.js stackFits) is clipped and flagged.
        if (!tooTall) { heights = squeezeToColumn(bands, heights); }
        var ys = [], total = 0, clock = null, flex = false;
        for (i = 0; i < bands.length; i++) {
            ys.push(y);
            if (bands[i].kind === 'clock') { clock = { y: y, h: heights[i] }; }
            if (bands[i].flex) { flex = true; }
            y += heights[i] + BAND_GAP;
            total += heights[i] + (i > 0 ? BAND_GAP : 0);
        }
        // No flex band: the stack is shorter than the column and the view's alignment
        // places it. The Watch Status strip is pinned (the watch never moves it).
        var off = flex ? 0 : alignOffset(align || 0, Math.max(0, 104 - total), clock, 16 + 52);
        // Too tall (sized bands the watch cannot fit): clip at the column floor like the
        // watch clamps its last bands, and say so.
        var clipped = false;
        for (i = 0; i < bands.length; i++) {
            var by = ys[i] + (bands[i].kind === 'strip' ? 0 : off);
            var bh = heights[i];
            if (by + bh > 120) { bh = Math.max(0, 120 - by); clipped = true; }
            if (bh <= 0) { continue; }
            e += rect(x, by, w, bh, bandFill);
            e += txt(x + w / 2, by + bh / 2 + 3, 7.5, labelColor, 'middle', 600, bands[i].label);
        }
        if (clipped) {
            e += txt(x + w / 2, 127, 6.5, '#FA4A35', 'middle', 700, 'cut off');
        }
        if (note) {
            e += txt(x + w / 2, y + 8, 7, '#7C828D', 'middle', 600, note);
        }
        return e;
    }

    /**
     * One labeled column per cycle slot: Default (slot 0) then Flick 1 / Flick 2. The cycle
     * (from view-cycle.js) already reflects radar/health availability — a disabled slot is
     * simply absent, so there's no "would be skipped" case left to flag.
     * @param {Object} state Live settings.
     * @param {Object} env Config-UI environment facts (unused).
     * @param {Object} [userData] Page userData (unused).
     * @returns {string} SVG markup.
     */
    function layoutPreviewCombined(state, env, userData) {
        state = state || {};
        var contents = presetContents(state, env);
        var HEADERS = ['Default', 'Flick 1', 'Flick 2'];
        var W = 200, GAP = 6, n = contents.length || 1, colW = (W - GAP * (n - 1)) / n;
        var e = rect(0, 0, W, 128, previewInk(state.theme).bg), i;
        var family = (env && env.platform) || '';
        for (i = 0; i < contents.length; i += 1) {
            e += renderBandColumn(contentBands(contents[i]), i * (colW + GAP), colW,
                HEADERS[i], null, false, state.theme, contents[i] ? (contents[i].align || 0) : 0,
                !VC.stackFits(contents[i] || null, family).fits);
        }
        return svgFrame(e, 128);
    }

    /**
     * One view's band column as a standalone SVG — the Custom-layout editor's live
     * preview of the tab being edited (view-editor.js), so a pick, a move or an
     * Alignment tap shows its effect right away. Same column geometry as the Layout
     * tab's preview; a view with nothing on it (a disabled slot) shows the placeholder.
     * @param {Object} state Live settings.
     * @param {Object} env Config-UI environment facts (platform gate).
     * @param {number} i View slot (0 = Default, 1-2 = flicks).
     * @returns {string} SVG markup.
     */
    function viewPreviewSvg(state, env, i) {
        state = state || {};
        var spec = presetContents(state, env)[i] || null;
        var W = 84, H = 130;   // 130: room for the "cut off" note under the column
        var e = rect(0, 0, W, H, previewInk(state.theme).bg);
        e += renderBandColumn(contentBands(spec), 0, W, 'Preview', spec ? null : 'Nothing to show',
            false, state.theme, spec ? (spec.align || 0) : 0,
            !VC.stackFits(spec, (env && env.platform) || '').fits);
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Preview of this view"'
            + ' style="display:block;width:108px;height:auto">' + e + '</svg>';
    }

    PConf.blocks.register('layoutPreviewCombined', layoutPreviewCombined);
    // The editor overlay (view-editor.js, concatenated after this file in the webview)
    // reads the single-view preview from here; under Node it require()s this module.
    PConf.previewLayout = { viewPreviewSvg: viewPreviewSvg };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            layoutPreviewCombined: layoutPreviewCombined,
            presetContents: presetContents,
            contentBands: contentBands,
            resolveBandHeights: resolveBandHeights,
            renderBandColumn: renderBandColumn,
            alignOffset: alignOffset,
            viewPreviewSvg: viewPreviewSvg
        };
    }
})();
