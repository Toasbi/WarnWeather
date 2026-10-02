// src/pkjs/settings/alerts-page.js — ES5, WebView. The Alerts tab's resolvers, split out of
// blocks.js: what the Alert settings card's rows print (their live hints and Edit badges),
// the rows of every item's Shows on grid (onDemandBars, a checklist's options), and the
// icons a bar's read-only Alerts row on the Status slots tab shows (onDemandBarIcons). The
// card's reset (resetOnDemand) stays among blocks.js's reset actions, beside the Status
// slots card's, which restores the same side lists.
//
// It reads two helpers of blocks.js's threshold machinery, which blocks.js publishes as
// PConf.thresholdLevels: a kind's slider geometry (rangeOf, the unit a metric alert's
// levels print in) and its badge dots (levelDots, which the slot pencil draws too). So it
// loads AFTER blocks.js in both contexts: under Node blocks.js requires this file at the
// end of its own body, so requiring blocks.js registers these resolvers too; the webview
// concatenates it right after blocks.js (scripts/build-config-page.js APP_FILES, pinned by
// test/config-page-bundle.test.js).
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    // Dual-context pattern (see line-style.js): CommonJS under Node, the concatenated
    // <script> globals in the webview, all of which precede this file.
    var statusLineCatalog = (typeof require !== 'undefined')
        ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    // The threshold contract (status-thresholds.js): the metric alerts, their pairs, Days
    // and the rain alert's look and window.
    var thresholds = (typeof require !== 'undefined')
        ? require('../status-thresholds.js') : window.StatusThresholds;
    // The On demand contract (on-demand.js): which bar shows which item, and the Battery
    // item's warn level — the phone's own reading.
    var onDemand = (typeof require !== 'undefined')
        ? require('../on-demand.js') : window.OnDemand;
    var rangeOf = PConf.thresholdLevels.rangeOf;
    var levelDots = PConf.thresholdLevels.levelDots;

    /**
     * The contract's metric alert behind an Alert settings card row, found by the row's key
     * stem (the schema builds each row's sheet and keys from it).
     * @param {*} keyStem Kind key stem, e.g. 'Uv'.
     * @returns {?{code: string, key: string}} Its ALERT_KINDS entry, or null for a
     *     stem with no metric alert.
     */
    function alertKindOf(keyStem) {
        for (var i = 0; i < thresholds.ALERT_KINDS.length; i++) {
            if (thresholds.ALERT_KINDS[i].key === keyStem) { return thresholds.ALERT_KINDS[i]; }
        }
        return null;
    }

    // What every Alert settings card row reads while its item is ticked on no side of a bar
    // that exists (on-demand.js placedAnywhere): the item cannot show anywhere.
    var NOT_PLACED = 'Not in any status bar';

    /**
     * The Alert settings card row's badge for a metric alert (editBadgeFrom, args.keyStem):
     * the colours the watch draws that alert in, while its item is placed on a bar (no
     * dots at all otherwise) — the warn pip in the kind's warn look (no pip for 'none', a
     * ring for 'outline', a dot for 'fill' — warnPip, shared with the slot pencil) and a
     * dot in the danger colour (the filled box). No 'B': bold is how a SLOT prints, not
     * part of the alert. The placement decides, not the slot's Highlight switch: the
     * entries take the kind's colours either way.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string}} args The row's alert, by its kind's key stem.
     * @returns {?Object} Badge state, or null where the alert cannot exist (aplite,
     *     a stem with no metric alert).
     */
    function alertLevelBadge(S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var metric = alertKindOf(args && args.keyStem);
        if (!metric) { return null; }
        var st = S || {};
        if (!onDemand.placedAnywhere(st, metric.code, env)) {
            return {label: 'Edit', ariaNote: 'not in any status bar', dots: []};
        }
        return {label: 'Edit', ariaNote: '', dots: levelDots(st, env, metric.key)};
    }
    PConf.badgeResolvers.register('alertLevelBadge', alertLevelBadge);

    /**
     * The Alert settings card's Rain row badge (editBadgeFrom): the Edit button every row
     * carries, and no dots — rain draws in the radar's colours and never boxes. Only the
     * aria note follows the placement.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {Object} Badge state.
     */
    function rainAlertBadge(S, env) {
        return {label: 'Edit', ariaNote: onDemand.placedAnywhere(S, 'rain', env) ? '' : 'not in any status bar',
            dots: []};
    }
    PConf.badgeResolvers.register('rainAlertBadge', rainAlertBadge);

    /**
     * The badge of an Alert settings card row with no colours to preview (Battery,
     * Bluetooth, Quiet time, Sleep): the Edit button alone.
     * @returns {Object} Badge state.
     */
    function onDemandBadge() {
        return {label: 'Edit', ariaNote: '', dots: []};
    }
    PConf.badgeResolvers.register('onDemandBadge', onDemandBadge);

    /**
     * The Alert settings card row's hint for a metric alert: "Not in any status bar" while
     * its item is ticked on no bar, else the kind's levels, e.g. "Warn 40 kph · Danger
     * 60 kph". The pair is the resolved one (the stored pair, else the seed — what the
     * watch judges with), in the unit the kind's slider shows, so the row reads the
     * numbers its sheet opens on. A Days other than the default follows by the label its
     * sheet offers it under ("Warn 6 · Danger 8 · Today"); the default adds nothing. The
     * Days is the contract's reading (alertDays), so an unknown value reads as the
     * default the phone bakes with. Only numbers, the range table's unit label and the
     * schema's option label are interpolated (the engine prints hints as raw HTML).
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{keyStem: string, days: Array<Array<string>>}} args The row's kind key
     *     stem, e.g. 'Wind', and the Days options (alerts-schema.js ALERT_DAYS_OPTIONS).
     * @returns {?string} The hint, or null where the levels do not exist (aplite,
     *     a stem with no metric alert) — the engine then falls back to the static hint.
     */
    function alertLevelsHint(S, env, args) {
        if (!env || !env.thresholds) { return null; }
        var metric = alertKindOf(args && args.keyStem);
        if (!metric) { return null; }
        var st = S || {};
        if (!onDemand.placedAnywhere(st, metric.code, env)) { return NOT_PLACED; }
        var pair = thresholds.resolvedPair(metric.key, st);
        var unit = rangeOf(metric.key, st).unit;
        var suffix = unit ? ' ' + unit : '';
        var text = 'Warn ' + pair.warn + suffix + ' · Danger ' + pair.danger + suffix;
        var days = thresholds.alertDays(st, metric.code);
        var daysLabel = days === thresholds.alertDays(null, metric.code) ? null : optionLabel(args.days, days);
        return daysLabel ? text + ' · ' + daysLabel : text;
    }
    PConf.hintResolvers.register('alertLevelsHint', alertLevelsHint);

    /**
     * The label of a stored value in a [label, value] option list.
     * @param {Array<Array<string>>} options The list.
     * @param {*} value The stored value.
     * @returns {?string} Its label, or null when the list has no such value.
     */
    function optionLabel(options, value) {
        for (var i = 0; i < (options || []).length; i++) {
            if (options[i][1] === String(value)) { return options[i][0]; }
        }
        return null;
    }

    /**
     * Whether the radar fetches nothing (radar mode 'off', the schema default 'graph'
     * for an absent key): the rain alert then cannot show.
     * @param {Object} S Live settings state.
     * @returns {boolean}
     */
    function radarOff(S) {
        return ((S && S.radarMode) || 'graph') === 'off';
    }

    /**
     * The Alert settings card's Rain row hint: "Turn on the rain radar (Radar tab)" while the
     * radar is off (that comes first: no tick helps then), "Not in any status bar" while
     * Rain is ticked on no bar, else its time window and look by the labels its sheet
     * offers them under, e.g. "Within 60 min · Text". The lists come from the schema
     * through args (one copy of each); the look and the defaults come from the contract
     * (rainAlert), so a window outside the list (a legacy '0') reads as the default
     * window and an unknown look as the look the watch then draws.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{windows: Array<Array<string>>, looks: Array<Array<string>>}} args The
     *     sheet's option lists (alerts-schema.js RAIN_WINDOW_OPTIONS, RAIN_LOOK_OPTIONS).
     * @returns {string} The hint.
     */
    function rainAlertHint(S, env, args) {
        var st = S || {};
        if (radarOff(st)) { return 'Turn on the rain radar (Radar tab)'; }
        if (!onDemand.placedAnywhere(st, 'rain', env)) { return NOT_PLACED; }
        var rain = thresholds.rainAlert(st);
        var a = args || {};
        // The window by its long label — the stored pick, not its parse — and the
        // contract's default window for one outside the list.
        return (optionLabel(a.windows, st.rainCountdownHorizon)
                || optionLabel(a.windows, thresholds.rainAlert(null).horizonMin))
            + ' · ' + optionLabel(a.looks, rain.look);
    }
    PConf.hintResolvers.register('rainAlertHint', rainAlertHint);

    /**
     * Whether a placed item cannot show, wherever it is placed: Rain while the radar is
     * off, Pollen off the DWD provider.
     * @param {Object} S Live settings state.
     * @param {string} code An on-demand.js ITEMS code.
     * @returns {?string} Why it cannot show, or null when it can.
     */
    function onDemandBlocked(S, code) {
        if (code === 'rain' && radarOff(S)) { return 'Needs the rain radar (Radar tab)'; }
        if (code === 'pollen' && (!S || S.provider !== 'dwd')) { return 'DWD provider only'; }
        return null;
    }

    /**
     * The rows of an item's Shows on grid (alerts-schema.js showsOnRows; a checklist): one per
     * status bar the watch draws (on-demand.js barExists, the rule the Status slots tab's
     * bar gates RADAR_BAR_WHEN / HEALTH_BAR_WHEN state), in the page's order. Each row
     * names its two side lists in meta.keys (Left, Right), the lists its ticks read and
     * write (reset-status-defaults.js onDemandTick). Like those gates, it ignores the
     * layout: a bar no view draws still gets its row. While the item
     * cannot show at all (onDemandBlocked: Rain with the radar off, Pollen off DWD) the
     * rows go inert and keep their ticks; the Rain sheet's box says why, and Pollen's card
     * row (so its sheet) is gone off DWD.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{code: string, bars: string[], names: Object<string, string>}} args The item,
     *     the bars in the page's order and their names.
     * @returns {Array<Array>} [label, value, meta] options.
     */
    function onDemandBars(S, env, args) {
        var a = args || {};
        var inert = onDemandBlocked(S, a.code) !== null;
        var out = [];
        (a.bars || []).forEach(function (bar) {
            if (!onDemand.barExists(S, bar, env)) { return; }
            var meta = {keys: onDemand.SIDES.map(function (side) { return onDemand.itemsKey(bar, side); })};
            if (inert) { meta.disabled = true; }
            out.push([(a.names || {})[bar] || bar, bar, meta]);
        });
        return out;
    }
    PConf.optionsResolvers.register('onDemandBars', onDemandBars);

    /**
     * A bar's read-only Alerts row on the Status slots tab (its hint): per side, the icons
     * of the placed items that can show, in priority order (the Alert settings card's), each
     * side one unbreakable run ("Left" + icons, "Right" + icons; shell.html .ico-run), so a
     * narrow phone wraps between the sides, never inside one; then args.where on a line of
     * its own, where they are set up (a link to the Alerts tab). Each icon carries its
     * item's name (role img), so a screen reader reads "Left Bluetooth Rain Right Battery".
     * Blocked items (Rain with the radar off, Pollen off DWD) are left out, as the watch
     * leaves them out; when every placed item is blocked the row says so. With nothing
     * placed, the pointer alone. The names are on-demand.js ITEMS constants, never
     * settings: the engine prints a hint as raw HTML.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env (unused).
     * @param {{bar: string, where: string}} args The bar (an on-demand.js BARS bar) and the
     *     schema's pointer HTML.
     * @returns {string} The hint HTML.
     */
    function onDemandBarIcons(S, env, args) {
        var runs = [], placed = false;
        onDemand.SIDES.forEach(function (side) {
            var icons = '';
            onDemand.parse((S || {})[onDemand.itemsKey(args.bar, side)]).forEach(function (code) {
                placed = true;
                if (onDemandBlocked(S, code) !== null) { return; }
                var item = onDemand.ITEMS[onDemand.itemIndex(code)];
                var svg = PConf.icons ? PConf.icons.get(item.icon) : null;
                if (svg) {
                    icons += '<span class="lbl-ico" role="img" aria-label="' + item.label + '">' + svg + '</span>';
                }
            });
            if (icons) { runs.push('<span class="ico-run">' + (side === 'left' ? 'Left ' : 'Right ') + icons + '</span>'); }
        });
        if (!placed) { return args.where; }
        return (runs.length ? runs.join(' ') : 'None of the alerts placed here can show.') + '<br>' + args.where;
    }
    PConf.hintResolvers.register('onDemandBarIcons', onDemandBarIcons);

    /**
     * Whether a bar that shows the Battery item also shows the watch battery in a slot
     * (the Watch battery glyph or its percentage, any position): the watch then leaves the
     * item out while that slot stays visible (status_on_demand.c battery_slots), whatever
     * the item's Look.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {boolean}
     */
    function batteryBesideSlot(S, env) {
        var positions = [['Left', 'left'], ['Mid', 'mid'], ['Right', 'right']];
        for (var b = 0; b < onDemand.BARS.length; b++) {
            var bar = onDemand.BARS[b];
            if (onDemand.sideOf(S, bar.bar, 'battery', env) === null) { continue; }
            for (var p = 0; p < positions.length; p++) {
                var slotKey = bar.prefix + positions[p][0];
                var code = statusLineCatalog.resolveSelection(S[slotKey], S, env,
                    {slotKey: slotKey, position: positions[p][1]});
                if (code === 'battery' || code === 'batteryPct') { return true; }
            }
        }
        return false;
    }

    /**
     * The Battery row's live text: "At 10% or below" (the warn level the watch is sent,
     * on its charge step — on-demand.js batteryLevel), " · Icon + value" for that Look,
     * and " · Hidden while a battery slot shows the charge" while a bar it is ticked on
     * shows the watch battery in a slot. The item stays ticked either way.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} The hint.
     */
    function onDemandBatteryText(S, env) {
        var st = S || {};
        if (!onDemand.placedAnywhere(st, 'battery', env)) { return NOT_PLACED; }
        var text = 'At ' + onDemand.batteryLevel(st, env) + '% or below';
        if (onDemand.batteryShowsValue(st)) { text += ' · Icon + value'; }
        if (batteryBesideSlot(st, env)) { text += ' · Hidden while a battery slot shows the charge'; }
        return text;
    }
    PConf.hintResolvers.register('onDemandBatteryText', onDemandBatteryText);

    // The Bluetooth row's rule per btIcons value (the Show row's choice).
    var BT_SHOW_TEXT = {disconnected: 'When disconnected', connected: 'When connected',
        both: 'Always', none: 'Never'};

    /**
     * The Bluetooth row's live text: when the icon shows (by btIcons), plus
     * " · Vibrates on disconnect" while vibe is on — also while the item is ticked on no
     * bar, because the vibration does not depend on the tick.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} The hint.
     */
    function onDemandBluetoothText(S, env) {
        var st = S || {};
        var vibe = st.vibe === true ? ' · Vibrates on disconnect' : '';
        if (!onDemand.placedAnywhere(st, 'bt', env)) { return NOT_PLACED + vibe; }
        return (BT_SHOW_TEXT[st.btIcons] || BT_SHOW_TEXT.disconnected) + vibe;
    }
    PConf.hintResolvers.register('onDemandBluetoothText', onDemandBluetoothText);

    /**
     * A settings-less item's live text (Quiet time): its rule, or "Not in any status
     * bar".
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @param {{code: string, text: string}} args The item and its rule.
     * @returns {string} The hint.
     */
    function onDemandPlainText(S, env, args) {
        return onDemand.placedAnywhere(S, args.code, env) ? args.text : NOT_PLACED;
    }
    PConf.hintResolvers.register('onDemandPlainText', onDemandPlainText);

    /**
     * @param {*} hour A stored hour ('0'..'23').
     * @param {number} fallback The hour for an unparseable value.
     * @returns {string} e.g. '7:00'
     */
    function hourText(hour, fallback) {
        var h = parseInt(hour, 10);
        return (isNaN(h) ? fallback : h) + ':00';
    }

    /**
     * The Sleep row's live text: the Battery saver's hours (the phone's IS_SLEEPING
     * window, which the Z's follow), or where to switch the saver on.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} The hint.
     */
    function onDemandSleepText(S, env) {
        var st = S || {};
        if (!onDemand.placedAnywhere(st, 'snooze', env)) { return NOT_PLACED; }
        if (st.sleepNightEnabled === false) { return 'Battery saver is off (General tab)'; }
        return 'During the Battery saver hours, ' + hourText(st.sleepStartHour, 0) + '–'
            + hourText(st.sleepEndHour, 7);
    }
    PConf.hintResolvers.register('onDemandSleepText', onDemandSleepText);
})();
