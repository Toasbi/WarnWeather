// src/pkjs/settings/preview-status-bars.js — ES5, WebView (+ Node for tests). The status bars'
// pictures: one bar's three slots as sample values, left, middle and right (barPicture: the
// Status bars tab's Your status bars card draws each bar with it, a tap on a slot opening its picker,
// and a bar's dialog draws its bar large), and the preview pinned above every slot dialog
// (block 'statusBarsPreview'): the bar the dialog was opened from, else every bar the watch
// draws right now, one line each, the slots the picture alone.
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
// cards by — for the Watch and Forecast bars only where a view of the layout seats
// them, for the Radar and Health bars wherever a screen shows them. The
// watch draws an icon beside most items; the preview shows the page's copy of each
// (status-slot-icons.js) where the watch it draws for has one (slotIcon).
/* global PConf, VIEW_CYCLE */
(function () {
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var NODE = typeof require !== 'undefined';
    var catalog = NODE ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    // A bar's name (screens.js barName), read when a row is drawn: screens.js loads after this
    // file's dependencies and before the page draws.
    var screens = NODE ? require('../screens.js') : window.Screens;
    var onDemand = NODE ? require('../on-demand.js') : window.OnDemand;
    var esc = NODE ? require('../config-ui/lib/html.js').esc : PConf.html.esc;
    var previewInk = (NODE ? require('./preview-svg.js') : window.PreviewSvg).previewInk;
    var slotText = NODE ? require('../slot-text.js') : window.SlotText;
    var utf8 = NODE ? require('../utf8.js') : window.Utf8;
    var dateFormat = NODE ? require('../date-format.js') : window.DateFormat;
    var VC = NODE ? require('../view-cycle.js') : VIEW_CYCLE;

    // The bars in the page's order, each with the view-cycle status source a screen's row
    // seats it by (view-cycle.js barOfSource, read back); the Watch bar is the top strip
    // (src: null).
    var SRC_OF_BAR = {};
    for (var src = 1; VC.barOfSource(src); src++) { SRC_OF_BAR[VC.barOfSource(src)] = src; }
    var BARS = onDemand.PAGE_BARS.map(function (b) {
        return {bar: b.bar, src: b.bar === 'top' ? null : SRC_OF_BAR[b.bar]};
    });
    // Each slot's byte cap, left to right: the middle slot holds 19 bytes, the edges 8
    // (status-line-catalog.js CAPS) — the room the unit and pair fit rules measure.
    var SLOT_CAPS = [catalog.CAPS.EDGE_TEXT_MAX, catalog.CAPS.MID_TEXT_MAX, catalog.CAPS.EDGE_TEXT_MAX];

    // The sample readings, in the units the payload carries them in: temperatures in °F
    // (18° / feels 16° / dew 9° C), the day-max kinds as [now, today's peak] in each wind
    // unit's whole numbers (kph 12/30, the same wind in mph and knots).
    var SAMPLE = {
        tempF: 64.4,
        feelsF: 60.8,
        dewF: 48.2,
        // A partly cloudy afternoon (weather/condition.js names('partly')).
        condition: {full: 'Partly cloudy', short: 'PCLDY'},
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
     * @param {Array<?Object>} views The view cycle (view-cycle.js resolveViewCycle).
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
        // As the bake prints it: no text in the Icon look; the name, with its short form
        // after catalog.ALT_SEP where the slot has the bytes (barSlots splits them).
        case 'condition':
            if (slotText.conditionLook(S, c.env) === 'icon') { return ''; }
            return slotText.conditionText(SAMPLE.condition, cap, c.env, slotText.conditionName(S));
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

    // The items aplite's lean status row draws a glyph for: its bitmap masks
    // (status_row_aplite.c status_mask_for) and the drawn sun arrow. No dew drops,
    // and its battery slot prints the charge as text.
    var APLITE_GLYPHS = {temp: true, wind: true, gust: true, uv: true, aqi: true, pollen: true,
        countdown: true, sun: true};

    /**
     * The glyph a slot's text follows on this watch: the page's copy of the watch's icon
     * (status-slot-icons.js), where the watch draws one. The Status bars tab's rows and the
     * watch pictures (preview-watch.js) both ask here.
     * @param {string} code The slot's item.
     * @param {Object} [env] Platform env.
     * @param {Object} [S] Settings: the weather condition in its Text look draws none.
     * @returns {?string} The glyph's <svg>, or null for none.
     */
    function slotIcon(code, env, S) {
        if (env && env.platform === 'aplite' && !APLITE_GLYPHS[code]) { return null; }
        if (code === 'condition' && slotText.conditionLook(S, env) === 'text') { return null; }
        // The city draws the current weather's icon before its name (citySlotIcon); the
        // sample's weather is the condition slot's, partly cloudy.
        if (code === 'city') {
            return slotText.cityIcon(S, env) && PConf && PConf.icons && PConf.icons.get
                ? PConf.icons.get('condition') || null : null;
        }
        return (PConf && PConf.icons && PConf.icons.get && PConf.icons.get(code)) || null;
    }

    /**
     * The item each of one bar's three slots holds, the catalog's resolution (defaults and
     * availability included), without the text barSlots draws for it. screens-page.js
     * fillNewBars reads a bar's slots here to tell one that shows nothing.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {string} bar 'top' | 'forecast' | 'health' | 'radar', or a bar 4 to 6.
     * @returns {Array<{pos: string, key: string, code: string}>} The left, middle and right
     *     slots (pos from status-line-catalog.js SLOT_POSITIONS, key the slot's setting, e.g.
     *     'statusTopLeft'); [] for an unknown bar.
     */
    function barCodes(S, env, bar) {
        var st = S || {}, line = catalog.lineById(bar);
        if (!line) { return []; }
        return line.slots.map(function (key, p) {
            var pos = catalog.SLOT_POSITIONS[p];
            return {pos: pos, key: key, code: catalog.resolveSelection(st[key], st, env, {slotKey: key, position: pos})};
        });
    }

    /**
     * One bar's three slots as the watch prints them: the item each holds (barCodes), its
     * sample text and whether the wind arrow follows it. The Status bars tab's rows and the
     * Watchface tab's watch (preview-watch.js) both read their slots here.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {string} bar 'top' | 'forecast' | 'health' | 'radar'.
     * @param {boolean} fullDate Whether the view drawing the bar shows no calendar (the
     *     date slot prints the full date there).
     * @param {Date} [now] Today (absent = the clock's).
     * @returns {Array<{pos: string, key: string, code: string, text: string, alt: string,
     *     arrow: boolean, icon: ?string}>} The left, middle and right slots (pos 'left' | 'mid' |
     *     'right', key the slot's setting, e.g. 'statusTopLeft'; alt the short form the text
     *     brought after catalog.ALT_SEP, '' for none; icon its glyph's <svg>, slotIcon); [] for
     *     an unknown bar.
     */
    function barSlots(S, env, bar, fullDate, now) {
        var st = S || {}, when = now || new Date();
        var codes = barCodes(st, env, bar);
        var slotSample = function (c, cap) {
            return sample(c.code, st, {cap: cap, env: env, now: when, fullDate: fullDate, slotKey: c.key});
        };
        var texts = codes.map(function (c, p) { return slotSample(c, SLOT_CAPS[p]); });
        // An edge slot's weather condition takes the middle slot's room where the whole line
        // still fits, as the bake gives it (status-lines.js widenEdgeConditions).
        var bytes = codes.map(function (c, p) { return wireBytes(c.code, texts[p], st, env, SLOT_CAPS[p]); });
        [0, 2].forEach(function (p) {
            var c = codes[p];
            if (!c || c.code !== 'condition' || (env && env.platform === 'aplite')) { return; }
            var wide = slotSample(c, catalog.CAPS.EDGE_COND_TEXT_MAX);
            var grown = wireBytes(c.code, wide, st, env, catalog.CAPS.EDGE_COND_TEXT_MAX);
            if (bytes[0] + bytes[1] + bytes[2] - bytes[p] + grown <= catalog.CAPS.LINE_MAX) {
                texts[p] = wide;
                bytes[p] = grown;
            }
        });
        return codes.map(function (c, p) {
            var forms = texts[p].split(catalog.ALT_SEP);
            return {pos: c.pos, key: c.key, code: c.code, text: forms[0], alt: forms[1] || '',
                arrow: arrowShown(c.code, forms[0], st, env, SLOT_CAPS[p]), icon: slotIcon(c.code, env, st)};
        });
    }

    /**
     * A slot's bytes on the wire as the bake packs them (status-lines.js packLine): its three
     * header bytes, and a text slot's value and wind arrow byte.
     * @param {string} code The catalog item. @param {string} text Its sample (sample()).
     * @param {Object} S Settings. @param {Object} env Platform env. @param {number} cap Its cap.
     * @returns {number}
     */
    function wireBytes(code, text, S, env, cap) {
        var item = catalog.byCode(code);
        if (!item || item.kind !== catalog.KINDS.TEXT) { return 3; }
        return 3 + utf8.byteLength(text || '') + (arrowShown(code, text, S, env, cap) ? 1 : 0);
    }

    // How a slot is named to a screen reader, after its bar's name.
    var POS_NAME = {left: 'left slot', mid: 'middle slot', right: 'right slot'};

    /**
     * One slot of a row. On the tab it is a button that opens the slot's picker (the
     * engine's [data-select] path, as the slot's own row in its card does), an empty one
     * marked so there is something to tap; above a slot's dialog, where a picker cannot
     * open, it is the picture alone.
     * @param {{pos: string, key: string, code: string, text: string, arrow: boolean}} c The
     *     slot (barSlots).
     * @param {string} barName The bar's name (screens.js barName).
     * @param {Object} env Platform env.
     * @param {boolean} tappable Whether the slot opens its picker.
     * @returns {string} HTML.
     */
    function slotCell(c, barName, env, tappable) {
        var arrow = c.arrow ? '<span class="sbp-arr" aria-hidden="true">↗</span>' : '';
        var empty = c.code === 'empty';
        // The weather icons (the condition's, the city's) are detailed: a size up from the
        // other glyphs, so they read as well beside their text.
        var wx = c.code === 'condition' || c.code === 'city';
        var lead = c.icon ? '<span class="sbp-ico' + (wx ? ' sbp-wx' : '') + '" aria-hidden="true">' + c.icon
            + '</span>' : '';
        var body = empty ? '' : lead + esc(c.text) + arrow;
        var cls = 'sbp-v sbp-' + c.pos;
        if (!tappable) { return '<span class="' + cls + '">' + body + '</span>'; }
        var item = catalog.byCode(c.code);
        var name = barName + ', ' + POS_NAME[c.pos] + ': ' + (item ? item.label : c.code);
        return '<button type="button" class="' + cls + (empty ? ' sbp-empty' : '') + '" data-select="' + esc(c.key)
            + '" aria-label="' + esc(name) + '">' + (empty ? '<span class="sbp-hole" aria-hidden="true"></span>' : body)
            + '</button>';
    }

    /**
     * The pictures' frame: the watch's screen in its theme's ink. The watch draws the bars in
     * its theme's ink (status_row.c: theme_fg() on the theme's background), so a light theme
     * previews black on white, except on a watch without the light polarity (aplite), which
     * always draws white on black.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {string} cls Its classes.
     * @param {boolean} tappable Whether its slots are buttons (a group), else a picture.
     * @param {string} label Its accessible name.
     * @param {string} inner Its rows.
     * @returns {string} HTML
     */
    function frame(S, env, cls, tappable, label, inner) {
        var ink = previewInk(env && env.themePolarity === false ? 'dark' : S.theme);
        ensureStyle();
        return '<div class="' + cls + '" role="' + (tappable ? 'group' : 'img') + '" aria-label="' + esc(label)
            + '" style="--sbp-bg:' + ink.bg + ';--sbp-fg:' + ink.fg + ';--sbp-dim:' + ink.rgba('0.5') + ';--sbp-line:'
            + ink.rgba('0.12') + ';--sbp-chip:' + ink.rgba('0.1') + '">' + inner + '</div>';
    }

    /**
     * One bar's picture: its three slots as the watch prints them (barSlots), the date slot as
     * the first view showing the bar shows it. The Your status bars card draws each bar with it, a tap
     * on a slot opening its picker (opts.tappable), dimmed while no screen shows the bar
     * (opts.dim); a bar's dialog draws its bar large (opts.big).
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {string} bar An on-demand.js BARS bar.
     * @param {{tappable: boolean, big: boolean, dim: boolean}} [opts] How it is drawn.
     * @returns {string} HTML ('' for an unknown bar)
     */
    function barPicture(S, env, bar, opts) {
        var st = S || {}, o = opts || {}, b = null;
        BARS.forEach(function (x) { if (x.bar === bar) { b = x; } });
        if (!b) { return ''; }
        var name = screens.barName(st, bar), tappable = Boolean(o.tappable);
        var view = barView(VC.resolveViewCycle(st, env), b);
        var cells = barSlots(st, env, bar, !calendarShown(view), new Date()).map(function (c) {
            return slotCell(c, name, env, tappable);
        }).join('');
        return frame(st, env, 'sbp one' + (tappable ? ' tap' : '') + (o.big ? ' big' : '') + (o.dim ? ' dim' : ''), tappable,
            name, '<div class="sbp-row">' + cells + '</div>');
    }

    /**
     * The block pinned above a slot's dialog: the bar it was opened from (opts.from, that bar's
     * dialog), else one row per bar the watch draws now, its name and three sample slots, the
     * picture alone. Off a dialog (the page's old pinned preview) a tap on a slot opens its
     * picker.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {Object} [userData] Page userData (unused).
     * @param {{dialog: boolean, from: ?string}} [opts] dialog: pinned above a dialog; from: the
     *     sheet id of the dialog it was opened from (engine renderEditModal).
     * @returns {string} HTML ('' when no bar exists).
     */
    function statusBarsPreview(S, env, userData, opts) {
        var st = S || {}, rows = '', tappable = !(opts && opts.dialog);
        var from = screens.barOfSheet(opts && opts.from);
        if (from) { return barPicture(st, env, from, {big: true}); }
        var views = VC.resolveViewCycle(st, env);
        var now = new Date();
        BARS.forEach(function (b) {
            var optional = b.bar !== 'top' && b.bar !== 'forecast';
            if (optional && !onDemand.barExists(st, b.bar, env)) { return; }
            // The Radar and Health bars (and a made bar 4 to 6) show while a screen shows
            // them, as their cards on the tab do (on-demand.js barExists). The Watch and Forecast bars show only
            // where a view seats them (Weather only without health has no top strip
            // anywhere).
            var view = barView(views, b);
            if (!view && !optional) { return; }
            // Each row by its bar's name (screens.js barName), the label column without the
            // trailing " bar" every default name has ("Forecast", a "Wind bar" as "Wind").
            var name = screens.barName(st, b.bar);
            var cells = barSlots(st, env, b.bar, !calendarShown(view), now).map(function (c) {
                return slotCell(c, name, env, tappable);
            }).join('');
            rows += '<div class="sbp-row"><span class="sbp-n">' + esc(name.replace(/ bar$/i, '')) + '</span>' + cells
                + '</div>';
        });
        if (!rows) { return ''; }
        // On the tab, a line under the bars says the slots can be tapped (their chips show
        // which); assistive tech hears each slot's button instead.
        if (tappable) { rows += '<div class="sbp-tip" aria-hidden="true">Tap a slot to change it</div>'; }
        return frame(st, env, 'sbp' + (tappable ? ' tap' : ''), tappable, tappable ? 'Status bars' : 'Status bars preview', rows);
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
        + '.sbp-ico.sbp-wx{width:16px;height:16px;margin-right:3px;vertical-align:-3px}'
        + '.sbp-arr{margin-left:1px}'
        // On the tab each slot is a button: the row's height and a little to each side are
        // its tap area (the negative margins keep the watch's spacing), a press shades it,
        // and an empty slot shows a dashed hole to tap. A filled one sits on a faint chip
        // (its ::before, inside the tap area so rows never touch), so every slot reads as
        // something to tap; the line under the bars says what a tap does.
        + 'button.sbp-v{-webkit-appearance:none;appearance:none;min-width:40px;margin:-7px -4px;padding:7px 6px;'
        + 'border:none;border-radius:7px;background:none;cursor:pointer;position:relative;z-index:0}'
        + 'button.sbp-v:not(.sbp-empty):before{content:"";position:absolute;top:3px;bottom:3px;left:0;right:0;'
        + 'z-index:-1;border-radius:6px;background:rgba(255,255,255,.1);background:var(--sbp-chip,rgba(255,255,255,.1))}'
        // Each chip hugs its value (the middle one centred, as the watch centres it), so
        // chips never meet across the narrow column gap.
        + 'button.sbp-left{justify-self:start}button.sbp-mid{justify-self:center}button.sbp-right{justify-self:end}'
        + 'button.sbp-v{text-align:center}'
        + 'button.sbp-v:active{background:var(--sbp-line,#1C1C1E)}'
        + 'button.sbp-v:focus-visible{outline:2px solid var(--sbp-fg,#FFFFFF);outline-offset:-2px}'
        + '.sbp-hole{display:inline-block;width:30px;height:15px;border:1px dashed var(--sbp-dim,#7C808A);'
        + 'border-radius:4px;vertical-align:middle}'
        + '.sbp-tip{padding:6px 0 3px;border-top:1px solid #1C1C1E;border-top-color:var(--sbp-line,#1C1C1E);'
        + 'text-align:center;font:600 11px Inter,sans-serif;color:#7C808A;color:var(--sbp-dim,#7C808A)}'
        // One bar's picture (barPicture): its own rounded strip, no name column; large in its
        // dialog; dimmed while no screen shows it.
        + '.sbp.one{margin:0;padding:0 10px;border-radius:9px}'
        + '.sbp.one .sbp-row{grid-template-columns:auto minmax(0,1fr) auto}'
        + '.sbp.big{padding:6px 14px;border-radius:12px}'
        + '.sbp.big .sbp-v{font-size:17px}'
        + '.sbp.big .sbp-ico{width:15px;height:15px}'
        + '.sbp.big .sbp-ico.sbp-wx{width:20px;height:20px;vertical-align:-4px}'
        + '.sbp.dim{opacity:.55}';
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
    var api = {statusBarsPreview: statusBarsPreview, barPicture: barPicture, sample: sample, arrowDue: arrowDue,
        arrowShown: arrowShown, calendarShown: calendarShown, barCodes: barCodes, barSlots: barSlots,
        slotIcon: slotIcon};
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    // The page: the Watchface tab's watch reads the slots too (preview-watch.js).
    if (typeof window !== 'undefined') { window.PreviewStatusBars = api; }
})();
