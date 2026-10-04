// src/pkjs/settings/preview-status-bars.js — ES5, WebView (+ Node for tests). The Status
// bars tab's pinned preview (block 'statusBarsPreview'): every bar the watch draws right
// now, one line each, its three slots as sample values — left, middle and right — so a
// slot pick shows where it lands before the main Save. Also pinned above every slot dialog.
//
// The readings are SAMPLES (a fixed afternoon: 18°, wind 12 now / 30 at its peak, UV 3 …),
// but the TEXT is the watch's: each sample goes through the code that prints the real
// reading — slot-text.js and status-pair.js for the phone-baked kinds (Value selection,
// Order, Separator and its spacing, Show unit and whether it fits the slot's bytes, the
// unit giving way to the wind arrow), date-format.js' copy of the watch's date formats
// for the date slot (month + year where the bar's view shows a calendar, the full date
// where it doesn't), and the watch's own shapes for the kinds it renders itself (steps
// '6.2k', sleep '7h12'). Which item a slot holds is the catalog's own resolution
// (status-line-catalog.js resolveSelection — defaults and availability included), and
// which bars exist is on-demand.js barExists, the rule the Status bars tab gates its
// cards by, and only bars a view of the layout seats. The watch draws an icon beside
// most items; the preview shows the page's copy of it where one exists
// (status-slot-icons.js).
/* global PConf, VIEW_CYCLE */
(function () {
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var NODE = typeof require !== 'undefined';
    var catalog = NODE ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    var onDemand = NODE ? require('../on-demand.js') : window.OnDemand;
    var esc = NODE ? require('../config-ui/lib/html.js').esc : PConf.html.esc;
    var previewInk = (NODE ? require('./preview-svg.js') : window.PreviewSvg).previewInk;
    var slotText = NODE ? require('../slot-text.js') : window.SlotText;
    var utf8 = NODE ? require('../utf8.js') : window.Utf8;
    var dateFormat = NODE ? require('../date-format.js') : window.DateFormat;
    var VC = NODE ? require('../view-cycle.js') : VIEW_CYCLE;

    // The bars in the page's order, their slot-key prefixes, names and the view-cycle
    // status source that seats them (the Watch bar is the top strip, src: null).
    var BARS = [
        {bar: 'top', prefix: 'statusTop', name: 'Watch', src: null},
        {bar: 'forecast', prefix: 'statusForecast', name: 'Forecast', src: VC.STATUS_SRC_FORECAST},
        {bar: 'health', prefix: 'statusHealth', name: 'Health', src: VC.STATUS_SRC_HEALTH},
        {bar: 'radar', prefix: 'statusRadar', name: 'Radar', src: VC.STATUS_SRC_RADAR}
    ];
    // [key suffix, position, byte cap]: the middle slot holds 19 bytes, the edges 8
    // (status-line-catalog.js CAPS) — the room the unit and pair fit rules measure.
    var POSITIONS = [['Left', 'left', catalog.CAPS.EDGE_TEXT_MAX],
        ['Mid', 'mid', catalog.CAPS.MID_TEXT_MAX], ['Right', 'right', catalog.CAPS.EDGE_TEXT_MAX]];

    // The sample readings, in the units the payload carries them in: temperatures in °F
    // (18° / feels 16° / dew 9° C), the day-max kinds as [now, today's peak] in each wind
    // unit's whole numbers (kph 12/30, the same wind in mph and knots).
    var SAMPLE = {
        tempF: 64.4,
        feelsF: 60.8,
        dewF: 48.2,
        uv: [3, 7],
        aqi: [42, 58],
        wind: {kph: [12, 30], mph: [7, 19], knots: [6, 16]},
        gust: {kph: [20, 45], mph: [12, 28], knots: [11, 24]}
    };

    /**
     * A day-max kind's sample numbers as wire-units' dayMaxShown would pick them for
     * the kind's Value selection: the reading (Now, the default), the day's peak alone
     * (Day max) or both (Both). The sample's peak is today's, so it carries no mark.
     * @param {string} code 'uv' | 'wind' | 'gust' | 'aqi'.
     * @param {Object} S Settings.
     * @returns {{now: ?number, peak: ?number, nextDay: boolean}} The picked numbers.
     */
    function dayMaxShown(code, S) {
        var nums = SAMPLE[code];
        if (code === 'wind' || code === 'gust') {
            nums = nums[S.windUnits === 'mph' ? 'mph' : S.windUnits === 'knots' ? 'knots' : 'kph'];
        }
        var mode = S[code + 'SlotDisplay'];
        var shown = {now: nums[0], peak: null, nextDay: false};
        if (mode === 'max' || mode === 'both') { shown.peak = nums[1]; }
        if (mode === 'max') { shown.now = null; }
        return shown;
    }

    /**
     * Whether a wind or gust slot draws its direction arrow (status-lines.js
     * arrowSector, the sample having a bearing): its Show wind direction toggle is on,
     * the slot shows the current reading (Day max alone prints the peak, not the wind
     * the arrow describes), and the watch has the arrow at all (not aplite). The slot's
     * unit leaves the arrow its byte; packLine then appends it only into a free one.
     * @param {string} code The slot's item.
     * @param {Object} S Settings.
     * @param {Object} [env] Platform env.
     * @returns {boolean}
     */
    function arrowDue(code, S, env) {
        if (code !== 'wind' && code !== 'gust') { return false; }
        if (env && env.platform === 'aplite') { return false; }
        return Boolean(S[code + 'SlotDirection']) && dayMaxShown(code, S).now !== null;
    }

    /**
     * Whether the slot shows the arrow after its text: due, and a byte still free
     * (status-lines.js packLine: a text that fills the cap leaves it out).
     * @param {string} code The slot's item.
     * @param {string} text The slot's text (sample).
     * @param {Object} S Settings.
     * @param {Object} [env] Platform env.
     * @param {number} cap The slot's byte cap.
     * @returns {boolean}
     */
    function arrowShown(code, text, S, env, cap) {
        return arrowDue(code, S, env) && utf8.byteLength(text) < cap;
    }

    /**
     * Whether a view puts a calendar on screen — the watch's layout_full_date rule
     * (windows/layout.h) turned round: a calendar top band with rows to show (a 2- or
     * 3-row tier). Without one the date slot carries the full date.
     * @param {?Object} spec One view-cycle ViewSpec.
     * @returns {boolean}
     */
    function calendarShown(spec) {
        return Boolean(spec) && spec.top === VC.TOP_CAL
            && (spec.tier === VC.TIER_COMPACT || spec.tier === VC.TIER_FULL);
    }

    /**
     * The first view of the cycle that seats a bar — the Watch bar any view whose top
     * strip shows, a status bar a view with it in a status row.
     * @param {Array<?Object>} views The view cycle (preview-layout.js presetContents).
     * @param {{src: ?number}} b A BARS entry.
     * @returns {?Object} The ViewSpec, or null when no view shows the bar.
     */
    function barView(views, b) {
        for (var i = 0; i < views.length; i++) {
            var v = views[i];
            if (!v) { continue; }
            if (b.src === null ? !v.stripOff : (v.statusUpper === b.src || v.statusLower === b.src)) {
                return v;
            }
        }
        return null;
    }

    /**
     * The date slot's text as the watch prints it (status_row.c format_status_date):
     * month + year while a calendar is on screen, the full date otherwise, each in its
     * format picker's choice, day and month in the Holiday region's order. Aplite's
     * lean twin keeps the original two formats whatever is picked.
     * @param {Object} S Settings.
     * @param {Object} [env] Platform env.
     * @param {Date} now Today.
     * @param {boolean} fullDate Whether the bar's view shows no calendar.
     * @returns {string} e.g. 'Oct 2026', '03.10.26'
     */
    function dateText(S, env, now, fullDate) {
        var aplite = Boolean(env && env.platform === 'aplite');
        if (!fullDate) { return dateFormat.formatMonthYear(now, aplite ? 'auto' : S.dateSlotMonthFormat); }
        return dateFormat.formatFullDate(now, aplite ? 'auto' : S.dateSlotFullFormat,
            dateFormat.dateMonthFirst(S));
    }

    /**
     * One slot's sample text, exactly as the watch would print the sample reading.
     * @param {string} code The catalog item the slot shows.
     * @param {Object} S Settings.
     * @param {{cap: number, env: Object, now: Date, fullDate: boolean, slotKey: string}}
     *     [ctx] The slot's byte cap (absent = an edge slot's), the platform, today (absent
     *     = the clock's), whether its bar's view shows no calendar, and its settings key
     *     (the countdown's target date).
     * @returns {string} Plain text ('' for an empty slot or the battery glyph).
     */
    function sample(code, S, ctx) {
        var c = ctx || {};
        var cap = typeof c.cap === 'number' ? c.cap : catalog.CAPS.EDGE_TEXT_MAX;
        var now = c.now || new Date();
        switch (code) {
        case 'temp':
            return slotText.tempText(slotText.formatTemp(SAMPLE.tempF, S),
                slotText.formatTemp(SAMPLE.feelsF, S), S, cap);
        case 'wind':
        case 'gust':
        case 'uv':
        case 'aqi':
            return slotText.dayMaxText(code, dayMaxShown(code, S), null, S, cap, arrowDue(code, S, c.env));
        case 'pollen': return '1';
        case 'pressure':
            return slotText.withUnit('1013', slotText.unitEnabled(S, 'pressureSlotUnit') ? 'hPa' : '', cap);
        case 'dew':
            return slotText.withUnit(slotText.formatTemp(SAMPLE.dewF, S),
                slotText.unitEnabled(S, 'dewSlotUnit') ? slotText.DEGREE : '', cap);
        case 'sun': return slotText.clockText(19, 14, S);
        case 'date': return dateText(S, c.env, now, Boolean(c.fullDate));
        case 'week': return 'W' + slotText.isoWeek(now);
        case 'city': return 'Berlin';
        case 'countdown':
            return slotText.formatCountdown(c.slotKey ? S[c.slotKey + 'Countdown'] : undefined, now,
                slotText.unitEnabled(S, 'countdownSlotUnit'), cap);
        // The watch-rendered kinds, in status_row.c format_live_value's shapes.
        case 'steps': return '6.2k';
        case 'distance': return S.distanceUnits === 'imperial' ? '2.6mi' : '4.2km';
        case 'hr': return '64';
        case 'sleep': return '7h12';
        case 'batteryPct': return '80%';
        case 'phoneBattery': return '72%';
        case 'phoneBatteryPlain': return '72%';
        // The battery item is its glyph alone, except on aplite, whose lean twin prints
        // the charge (status_row_aplite.c format_live_value).
        case 'battery': return c.env && c.env.platform === 'aplite' ? '80%' : '';
        default: return '';
        }
    }

    /**
     * The glyph a slot's text follows: the page's copy of the watch's icon where
     * status-slot-icons.js has one. Aplite's battery slot is text, no glyph.
     * @param {string} code The slot's item.
     * @param {Object} [env] Platform env.
     * @returns {string} HTML ('' for none).
     */
    function lead(code, env) {
        if (code === 'battery' && env && env.platform === 'aplite') { return ''; }
        var svg = PConf && PConf.icons && PConf.icons.get ? PConf.icons.get(code) : null;
        return svg ? '<span class="sbp-ico" aria-hidden="true">' + svg + '</span>' : '';
    }

    /**
     * The block: one row per bar the watch draws now, its name and three sample slots.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} HTML ('' when no bar exists).
     */
    function statusBarsPreview(S, env) {
        var st = S || {}, rows = '';
        var layout = NODE ? require('./preview-layout.js') : (PConf && PConf.previewLayout);
        var views = layout && layout.presetContents ? layout.presetContents(st, env) : [];
        var now = new Date();
        BARS.forEach(function (b) {
            if ((b.bar === 'radar' || b.bar === 'health') && !onDemand.barExists(st, b.bar, env)) { return; }
            // A bar no view seats is not on the watch (Weather only without health has
            // no top strip anywhere). An empty cycle (no layout module) keeps every bar.
            var view = barView(views, b);
            if (!view && views.length) { return; }
            var fullDate = !calendarShown(view);
            var cells = POSITIONS.map(function (p) {
                var key = b.prefix + p[0];
                var code = catalog.resolveSelection(st[key], st, env, {slotKey: key, position: p[1]});
                var text = sample(code, st, {cap: p[2], env: env, now: now, fullDate: fullDate, slotKey: key});
                var arrow = arrowShown(code, text, st, env, p[2])
                    ? '<span class="sbp-arr" aria-hidden="true">↗</span>' : '';
                var body = code === 'empty' ? '' : lead(code, env) + esc(text) + arrow;
                return '<span class="sbp-v sbp-' + p[1] + '">' + body + '</span>';
            }).join('');
            rows += '<div class="sbp-row"><span class="sbp-n">' + esc(b.name) + '</span>' + cells + '</div>';
        });
        if (!rows) { return ''; }
        ensureStyle();
        // The watch draws the bars in its theme's ink (status_row.c: theme_fg() on the
        // theme's background), so a light theme previews black on white — except on a
        // watch without the light polarity (aplite), which always draws white on black.
        var ink = previewInk(env && env.themePolarity === false ? 'dark' : st.theme);
        return '<div class="sbp" role="img" aria-label="Status bars preview" style="--sbp-bg:' + ink.bg
            + ';--sbp-fg:' + ink.fg + ';--sbp-dim:' + ink.rgba('0.5') + ';--sbp-line:' + ink.rgba('0.12') + '">'
            + rows + '</div>';
    }

    // The preview's look, injected once: the watch's screen in its theme's ink (the
    // --sbp-* properties the block sets inline; the dark theme's as the fallback), rows
    // split by a hairline. The side slots take their text's width and the middle one the
    // rest, centred, as on the watch (whose middle slot holds 19 bytes to the sides' 8).
    // A slot's glyph sits on the text's line at the text's size.
    // It sits in a pinned frame that carries a preview's padding (shell.html .pin-blk),
    // which the negative margins cancel, as a preview SVG's do (preview-svg.js svgFrame).
    var CSS = '.sbp{background:#000;background:var(--sbp-bg,#000);padding:4px 12px;margin:-12px -16px -14px}'
        + '.sbp-row{display:grid;grid-template-columns:58px auto minmax(0,1fr) auto;column-gap:6px;'
        + 'align-items:center;'
        + 'padding:7px 0;border-top:1px solid #1C1C1E;border-top-color:var(--sbp-line,#1C1C1E)}'
        + '.sbp-row:first-child{border-top:none}'
        + '.sbp-n{font:700 10px Inter,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:#7C808A;'
        + 'color:var(--sbp-dim,#7C808A)}'
        + '.sbp-v{font:700 13px Inter,sans-serif;letter-spacing:-.01em;color:#FFFFFF;color:var(--sbp-fg,#FFFFFF);white-space:nowrap;'
        + 'overflow:hidden;text-overflow:ellipsis;min-width:0}'
        + '.sbp-left{text-align:left}.sbp-mid{text-align:center}.sbp-right{text-align:right}'
        + '.sbp-ico{display:inline-block;width:12px;height:12px;margin-right:2px;vertical-align:-1px}'
        + '.sbp-ico svg{display:block;width:100%;height:100%}'
        + '.sbp-arr{margin-left:1px}';
    /**
     * Inject the preview's stylesheet (id 'sbp-style') once; nothing outside a DOM or when
     * it is already there.
     * @returns {void}
     */
    function ensureStyle() {
        if (typeof document === 'undefined' || !document.getElementById || document.getElementById('sbp-style')) { return; }
        var el = document.createElement('style');
        el.id = 'sbp-style';
        el.textContent = CSS;
        document.head.appendChild(el);
    }

    if (PConf && PConf.blocks) { PConf.blocks.register('statusBarsPreview', statusBarsPreview); }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {statusBarsPreview: statusBarsPreview, sample: sample, arrowDue: arrowDue,
            arrowShown: arrowShown, calendarShown: calendarShown};
    }
})();
