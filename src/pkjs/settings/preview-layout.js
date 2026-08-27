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
     * Shares view-cycle.js with clay-payload.js — no manual sync.
     * @param {Object} state Live settings (layoutPreset/healthMode/radarMode/swapClockStatus).
     * @returns {Array.<Object>} The view cycle — one ViewSpec per flick slot.
     */
    function presetContents(state) {
        state = state || {};
        var radarMode = state.radarMode || 'graph';
        return VC.buildViewCycle(VC.resolvePresetKey(state), state.healthMode || 'off', radarMode,
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
        var bands = [{ label: 'Watch Status', h: 12 }];
        var isNone = spec.tier === VC.TIER_NONE;
        var isFull = spec.tier === VC.TIER_FULL;
        var topBand = null;
        if (spec.top === VC.TOP_RADAR) { topBand = { label: 'Radar', h: CAL3_H }; }
        else if (!isNone) { topBand = { label: isFull ? 'Calendar (3 rows)' : 'Calendar (2 rows)', h: isFull ? CAL3_H : CAL2_H }; }
        var bodyLabel = spec.body === VC.BODY_GRAPH ? 'Health graph'
                      : spec.body === VC.BODY_RADAR ? 'Radar' : 'Forecast';
        // The body always takes the remaining space (flex); the fallback h only matters to a
        // consumer that doesn't resolve flex bands.
        var bodyBand = { label: bodyLabel, h: 20, flex: true };
        var upperLabel = STATUS_LABEL[spec.statusUpper];
        var lowerLabel = STATUS_LABEL[spec.statusLower];
        var upperRow = upperLabel ? { label: upperLabel, h: STATUS_H } : null;
        var lowerRow = lowerLabel ? { label: lowerLabel, h: STATUS_H } : null;
        var clock = { label: 'Clock', h: isNone ? 30 : 22 };
        if (topBand) { bands.push(topBand); }
        if (!isNone && !isFull) {                 // compact: upper rides the freed cal row
            if (upperRow) { bands.push(upperRow); }   // freed row, above the clock
            bands.push(clock);
            if (lowerRow) { bands.push(lowerRow); }   // carved band, below the clock (near the body)
        } else {                                  // full / none: clock, then status row(s)
            bands.push(clock);
            if (upperRow) { bands.push(upperRow); }
            if (lowerRow) { bands.push(lowerRow); }
        }
        bands.push(bodyBand);
        return bands;
    }

    // One column of a side-by-side layout preview: a header label over a band stack that
    // fills the column width (no side padding). `dim`/`note` are unused by the adaptive
    // cycle preview (every slot in the cycle is available by construction) but kept as
    // params — `note` still renders as a placeholder sub-note when a column has no bands.
    // Card/placeholder fills are theme-relative washes (previewInk's rgba helper), so
    // this — the block wired into the Layout tab via layoutPreviewCombined — follows
    // the theme too, not just its outer canvas.
    function renderBandColumn(bands, x, w, header, note, dim, theme) {
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
        for (i = 0; i < bands.length; i++) {
            e += rect(x, y, w, heights[i], bandFill);
            e += txt(x + w / 2, y + heights[i] / 2 + 3, 7.5, labelColor, 'middle', 600, bands[i].label);
            y += heights[i] + BAND_GAP;
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
        var contents = presetContents(state);
        var HEADERS = ['Default', 'Flick 1', 'Flick 2'];
        var W = 200, GAP = 6, n = contents.length || 1, colW = (W - GAP * (n - 1)) / n;
        var e = rect(0, 0, W, 128, previewInk(state.theme).bg), i;
        for (i = 0; i < contents.length; i += 1) {
            e += renderBandColumn(contentBands(contents[i]), i * (colW + GAP), colW,
                HEADERS[i], null, false, state.theme);
        }
        return svgFrame(e, 128);
    }

    PConf.blocks.register('layoutPreviewCombined', layoutPreviewCombined);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            layoutPreviewCombined: layoutPreviewCombined,
            presetContents: presetContents,
            contentBands: contentBands,
            resolveBandHeights: resolveBandHeights
        };
    }
})();
