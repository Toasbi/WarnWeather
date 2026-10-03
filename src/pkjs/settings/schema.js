// src/pkjs/settings/schema.js — ES5, PKJS-parsed. WarnWeather's settings SoT.
var meta = require('../../../package.json');
var BMC_BADGE = require('./bmc-badge.js');
var holidayData = require('./holiday-data.js');
// The per-kind "Show unit" defaults come from the catalog's UNIT_TOGGLES
// table (shared with the baker, the reset, and renderSignature).
var STATUS_LINE_CATALOG = require('../status-line-catalog.js');
// The two-value slots' presentation vocabulary: the separator presets, the UV next-day
// marks and the custom separator's length, from the module that PRINTS them into the
// slot text — so every option label is exactly what the watch will show.
var STATUS_PAIR = require('../status-pair.js');
// The graph-colour vocabulary: the storage key behind every picker, the roles each
// metric actually owns, and the built-in colour each one defaults to. All of it comes
// from line-style.js — the module that RESOLVES these keys for the watch's wire
// (weather/graph-wire.js packs its answer) — so the settings page cannot offer a colour
// the renderer doesn't know, miss one it does, or carry a transcribed default hex that
// drifts away from what the graph paints.
var lineStyle = require('../line-style.js');
// Bars from [Bottom | Top]: the values, from the module the wire packs the flags through.
var DRAW_FROM = require('../draw-from.js');
// The keyed sources of the Weather and Radar provider pickers (their names, key sheets and
// key fields): the key sheets are built from it here, and the rows' key-status resolvers
// read it in the page (key-status.js).
var KEY_SOURCES = require('./key-sources.js');
// The Custom-layout block (the per-view storage items, their sheetOnly section and
// the Edit-button row) lives in its own module so its capability gates are BUILT
// from view-cycle.js's mode lists — the same table buildCustomCycle folds by.
var customLayout = require('./custom-layout-schema.js');
// The gates and copy links the schema's modules share (settings/schema-gates.js): the
// named capability and setting gates, the one-pass gateAll, the Alerts tab link and the
// intros' inline action button.
var gates = require('./schema-gates.js');
var HEALTH_SLOT_WHEN = gates.HEALTH_SLOT_WHEN;
var HR_SLOT_WHEN = gates.HR_SLOT_WHEN;
var THRESHOLD_WHEN = gates.THRESHOLD_WHEN;
var ON_DEMAND_WHEN = gates.ON_DEMAND_WHEN;
var ALERTS_TAB_LINK = gates.ALERTS_TAB_LINK;
var BOLD_ALL_WHEN = gates.BOLD_ALL_WHEN;
var RADAR_BAR_WHEN = gates.RADAR_BAR_WHEN;
var HEALTH_BAR_WHEN = gates.HEALTH_BAR_WHEN;
var COLOR_THEME_WHEN = gates.COLOR_THEME_WHEN;
var LINE_STYLES_WHEN = gates.LINE_STYLES_WHEN;
var gateAll = gates.gateAll;
var introAction = gates.introAction;
// A kind's level group (its Alert levels or Goals: the header, the slider, the warn look
// and the colours), the group's two voices and the next-day mark options
// (settings/level-rows-schema.js), shared with the Alerts tab's alert sheets.
var levelRowsSchema = require('./level-rows-schema.js');
var BOLD_ALWAYS_HINT = levelRowsSchema.BOLD_ALWAYS_HINT;
var ALERT_VOICE = levelRowsSchema.ALERT_VOICE;
var GOAL_VOICE = levelRowsSchema.GOAL_VOICE;
var nextDayMarkOptions = levelRowsSchema.nextDayMarkOptions;
var levelRows = levelRowsSchema.levelRows;
// The Alerts tab's schema (settings/alerts-schema.js): its card and sheets, plus what the
// other tabs show of it (a bar's Alerts row, the rain alert's note, the Bluetooth icon's
// choices) and what the alert slot sheets read (the kinds, their codes, the placement
// leaf).
var alertsSchema = require('./alerts-schema.js');
var ALERT_KINDS = alertsSchema.ALERT_KINDS;
var BT_ICON_OPTIONS = alertsSchema.BT_ICON_OPTIONS;
var alertCodeOf = alertsSchema.alertCodeOf;
var onDemandPlacedWhen = alertsSchema.onDemandPlacedWhen;
var onDemandRow = alertsSchema.onDemandRow;
var rainAlertUnshownNote = alertsSchema.rainAlertUnshownNote;
// The Forecast tab's line rows (settings/forecast-lines-schema.js): the rows each metric
// picker carries (Line style, Draw from, the graph scales, Visible values), the metric
// pickers' derived hint and the two stripe styles the Area fill row reads.
var forecastLines = require('./forecast-lines-schema.js');
var METRIC_HINT_FROM = forecastLines.METRIC_HINT_FROM;
var STRIPE_STYLES = forecastLines.STRIPE_STYLES;
var lineStyleCopy = forecastLines.lineStyleCopy;
var lineFromCopies = forecastLines.lineFromCopies;
var WIND_SCALE_HINTS_KPH = forecastLines.WIND_SCALE_HINTS_KPH;
var WIND_SCALE_HINTS_MPH = forecastLines.WIND_SCALE_HINTS_MPH;
var WIND_SCALE_HINTS_KNOTS = forecastLines.WIND_SCALE_HINTS_KNOTS;
var windScaleCopy = forecastLines.windScaleCopy;
var pressureScaleCopy = forecastLines.pressureScaleCopy;
var lineShowCopy = forecastLines.lineShowCopy;
var versionLabel = 'v' + meta.version + (meta.buildProfile === 'dev' ? ' (dev)' : '');
var HOURS = (function () {
    var o = [], h;
    for (h = 0; h < 24; h += 1) {
        o.push([(h < 10 ? '0' + h : String(h)) + ':00', String(h)]);
    }
    return o;
})();
// The Bars from rows' one hint, for Top (Bottom, the default, has none).
var BARS_TOP_HINT = 'The more rain, the further down they reach.';

/**
 * The shared sheet envelope every slot-sheet builder returns: a sheetOnly
 * section reachable only through a slot's pencil, keyed thresh<Stem>, gated on
 * the thresholds capability (aplite compiles the machinery out).
 * @param {string} keyStem Kind key stem, e.g. 'City'.
 * @param {string} title Catalog label of the slot kind.
 * @param {Object[]} items The sheet's rows.
 * @returns {Object} Schema section.
 */
function sheetOf(keyStem, title, items) {
    return {
        sheetOnly: true,
        sheetId: 'thresh' + keyStem,
        showWhen: THRESHOLD_WHEN,
        title: title + ' slot',
        items: items
    };
}

// The nine rows of the Graph-colors card, each opening its own sheet. The eight metrics
// come first, labelled and ordered exactly like the Main/Second metric pickers offer
// them (forecast-hints.js' FORECAST_METRICS — a user reads the two lists together), then
// the full-height night band. `scope` is line-style.js' vocabulary: a metric id, or 'night'.
// A row is NOT gated on the metric being selected — its colours are configurable before
// it is picked, and the feels row simply has fewer pickers in its sheet.
var GRAPH_COLOR_ROWS = [
    {scope: 'precip_prob', sheetId: 'gcPrecip', label: 'Precipitation %'},
    {scope: 'cloud', sheetId: 'gcCloud', label: 'Cloud cover %'},
    {scope: 'wind', sheetId: 'gcWind', label: 'Wind speed'},
    {scope: 'gust', sheetId: 'gcGust', label: 'Wind gusts'},
    {scope: 'uv', sheetId: 'gcUv', label: 'UV Index'},
    {scope: 'pressure', sheetId: 'gcPressure', label: 'Air pressure (hPa)'},
    {scope: 'feels', sheetId: 'gcFeels', label: 'Feels-like temperature'},
    {scope: 'dew', sheetId: 'gcDew', label: 'Dew point'},
    {scope: 'night', sheetId: 'gcNight', label: 'Night shading'}
];
// What each role is called and explained as inside a sheet. Keyed by line-style.js'
// role names, so a role it stops handing out simply stops being rendered.
var GRAPH_ROLE_LABELS = {
    Line: 'Line',
    // One term for the Main metric's toggle and its colour (direction-neutral: with
    // Draw from on Top the fill hangs with its line).
    Fill: 'Area fill',
    Night: 'Night fill tint',
    Hatch: 'Night hatch',
    Boundary: 'Dusk / dawn line'
};
var GRAPH_ROLE_HINTS = {
    Fill: 'Only drawn while this is the Main metric and “Area fill” is on.',
    Night: 'Re-shades the filled area under the night hours. Follows the fill colour until you pick one here.',
    Hatch: 'Only drawn while “Day / night shading” is on.',
    Boundary: 'Only drawn while “Day / night shading” is on.'
};

/**
 * One graph colour = TWO picker rows on the same label, gated on the theme's polarity
 * so exactly one is ever visible and a Dark <-> Light switch never loses a tuned set
 * (the colorUSFederal idiom below). The default is the CONCRETE built-in from
 * line-style.js, so the picker opens with the colour the graph draws today already
 * highlighted — there is no "Auto" sentinel to name any more.
 * @param {string} scope A metric id, or 'night' (line-style.js' graphColorKey vocabulary).
 * @param {string} role 'Line'|'Fill'|'Night' for a metric; 'Hatch'|'Boundary' for 'night'.
 * @returns {Object[]} The two schema items, Dark first.
 */
function graphColorPair(scope, role) {
    var pol = [['dark', 'Dark'], ['light', 'Light']], rows = [], i;
    for (i = 0; i < pol.length; i++) {
        rows.push({
            type: 'color',
            messageKey: lineStyle.graphColorKey(scope, role, pol[i][1]),
            label: GRAPH_ROLE_LABELS[role],
            hint: GRAPH_ROLE_HINTS[role] || null,
            // The INT form, like colorUSFederal below: deriveDefaults seeds the int,
            // the page hydrates it to '#RRGGBB' and parseResponse converts it back.
            // No settings blob is passed — gust's dark line reads rainBarColor at
            // RESOLVE time, and a schema default is a constant, so this row gets the
            // multicolour-bars value; graphColorIsDefault counts BOTH of its built-in
            // greys as "still the default", so a white-bar install is not misread.
            defaultValue: lineStyle.graphColorDefault(scope, role, pol[i][1], null),
            capabilities: ['COLOR'],
            showWhen: {all: [{key: 'theme', eq: pol[i][0]}]}
        });
        // The night tint is the one graph colour whose picker paints something other
        // than its stored value: it cascades from the metric's fill until it is picked
        // in its own right (line-style.js' graphNightTint), so the swatch shown as
        // highlighted has to be the cascaded colour, not the untouched key. The
        // polarity comes from this row's own gate rather than the live theme — the two
        // rows of the pair are edited independently. ('Night' is a metric role only:
        // graphColorRoles('night') is Hatch/Boundary, so the band never lands here.)
        if (role === 'Night') {
            rows[rows.length - 1].displayFrom = {
                resolver: 'graphNightTint',
                args: {scope: scope, suffix: pol[i][1]}
            };
        }
    }
    return rows;
}

/**
 * One row's colour sheet: every picker that row owns, headed by a sub-header carrying
 * the reset for exactly those keys. BOTH gates are set — buildSectionBody and
 * renderEditModal test sec.showWhen first, so capabilities alone would not gate a
 * section. No blockBefore: a blockBeforeSticky preview stays pinned below the sheet's
 * header while the rows scroll under it, so on a narrow phone it would cover part of
 * the open 64-swatch palette wherever the sheet is scrolled to.
 * @param {Object} row An entry of GRAPH_COLOR_ROWS.
 * @returns {Object} A sheetOnly schema section.
 */
function graphColorSheet(row) {
    var roles = lineStyle.graphColorRoles(row.scope);
    var items = [], keys = [], i, pair;
    for (i = 0; i < roles.length; i++) {
        pair = graphColorPair(row.scope, roles[i]);
        items = items.concat(pair);
        // Both polarities ride the reset: the button resets the ROW, and leaving the
        // hidden polarity tuned would resurrect old picks on the next theme switch.
        keys.push(pair[0].messageKey);
        keys.push(pair[1].messageKey);
    }
    return {
        sheetOnly: true,
        sheetId: row.sheetId,
        title: row.label + ' colors',
        capabilities: ['COLOR'],
        showWhen: COLOR_THEME_WHEN,
        // The reset covers the whole sheet, so it rides the sheet's TITLE (renderEditModal
        // seats a section-level labelAction beside the title text). It used to hang off a
        // 'Colors' sub-header, which then sat directly under a title already reading
        // "<Metric> colors" and said the same word twice. blocks.js takes the key list
        // from HERE through data-action-arg and keeps no copy that could drift.
        labelAction: {action: 'resetGraphColors', arg: keys.join(','), label: 'Reset to default'},
        items: items
    };
}

/**
 * One row of the Graph-colors card: label, a preview of the colours behind it, Edit.
 * @param {Object} row An entry of GRAPH_COLOR_ROWS.
 * @param {boolean} joins Whether the row joins the one above (no divider).
 * @returns {Object} Schema item.
 */
function graphColorRow(row, joins) {
    var item = {
        type: 'sheet',
        sheetId: row.sheetId,
        label: row.label,
        // A `sheet` row has no messageKey, and the engine merges the item's (absent) one
        // UNDER these args — so `scope` is the resolver's ONLY way to know which row it
        // is badging.
        editBadgeFrom: {resolver: 'graphColorSwatch', args: {scope: row.scope}}
    };
    if (joins) { item.joinPrevious = true; }
    return item;
}
// The wind/gust slots' direction arrow. The arrow flies DOWNWIND (the way the wind is
// blowing), not the meteorological "comes from" bearing the providers report — the
// phone flips it before baking — so the copy has to say which way it points, or half
// the readers will read it backwards. Shared by both slots: one arrow, two kinds.
var WIND_DIRECTION_HINT = 'Draws an arrow after the speed, pointing the way the ' +
    'wind is blowing now. Not while Day max shows a peak alone.';
// The two-value slots — Temperature and the day-max kinds in their "Both" mode — print a
// pair in one slot (12|10, 3/7). How the pair reads is chosen per kind, on the rows
// orderRow() and separatorRows() build below that kind's Value selection. The phone
// bakes the text (status-pair.js, through status-lines.js formatValue) and sanitises the
// custom separator there, authoritatively, so the page stores what was typed and needs
// no hook. An absent key reads as the kind's default (status-pair.js defaultSeparator:
// the bar for temperature, the slash for the day-max kinds).
//
// The formatter's fit rule: a pair wider than its slot's byte cap drops its spaces, and
// one still too wide prints with the kind's default separator; a day-max pair still too
// wide shows the reading alone. The default separator is the fit rule's last step, so
// its own hint would read differently: the Separator row explains every value but the
// default (pairFallbackHints).
/**
 * The Separator row's hints: the fit rule, for every value but the kind's default.
 * @param {string} prefix Key prefix: 'temp' | 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {string} first Sample of the value that leads by default, e.g. '12'.
 * @param {string} second Sample of the other value, e.g. '10'.
 * @param {Array<string>} values Every value the row offers.
 * @returns {Object} hintByValue: value → hint, the default absent.
 */
function pairFallbackHints(prefix, first, second, values) {
    var def = STATUS_PAIR.defaultSeparator(prefix);
    var preset = STATUS_PAIR.SEPARATORS[def];
    // Only a day-max pair can still be too wide in its default form (a mark and two
    // three-digit numbers: '152/»178'); then the slot shows the reading alone.
    var tail = prefix === 'temp' ? '.' : ', then to the reading alone.';
    var hint = 'When the pair doesn\'t fit, it drops its spaces, then falls back to ' +
        first + preset.mid + second + preset.end + tail;
    var out = {};
    values.forEach(function (value) {
        if (value !== def) { out[value] = hint; }
    });
    return out;
}
// The watch draws slot text in its Gothic system fonts, which cover printable ASCII and
// Latin-1 (the slots already print '°' and '»' from them); the formatter keeps
// only those, then the first two. Spaces are kept, not trimmed: ', ' is a real separator.
/**
 * The Custom separator row's hint. Empty falls back to the kind's default separator.
 * @param {string} prefix Key prefix: 'temp' | 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {string} first Sample of the value that leads by default, e.g. '12'.
 * @param {string} second Sample of the other value, e.g. '10'.
 * @returns {string} The hint.
 */
function pairCustomHint(prefix, first, second) {
    var def = STATUS_PAIR.defaultSeparator(prefix);
    var preset = STATUS_PAIR.SEPARATORS[def];
    var empty = def === 'slash' ? 'empty uses the slash'
        : 'empty prints ' + first + preset.mid + second + preset.end;
    return 'Up to ' + STATUS_PAIR.CUSTOM_MAX_CHARS + ' characters, spaces included; ' +
        empty + '. Only characters the watch font can draw are kept ' +
        '(printable ASCII and Latin-1).';
}
/**
 * A two-value slot's Order row: which value leads the pair. Shown only in the kind's
 * "Both" mode — the one mode that prints a pair — and joined tight to the row above,
 * the way every group of rows revealed by a control joins that control.
 * @param {string} prefix Key prefix: 'temp' | 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {Array<Array<string>>} orderOptions The order pills as [label, value]; the
 *     first one is the default (the order the slot has always printed).
 * @returns {Object} The Order row.
 */
function orderRow(prefix, orderOptions) {
    return {
        type: 'segmented',
        messageKey: prefix + 'SlotOrder',
        label: 'Order',
        defaultValue: orderOptions[0][1],
        options: orderOptions,
        joinPrevious: true,
        showWhen: {key: prefix + 'SlotDisplay', eq: 'both'}
    };
}
/**
 * Build the rows that shape a two-value slot's separator: the separator dropdown, the
 * custom separator it can reveal, and whether spaces flank the separator. All three
 * show only in the kind's "Both" mode and join tight, like the Order row above them.
 *
 * The presets are labelled by EXAMPLE, built on the kind's own sample numbers from the
 * formatter's table: "12(10)" says what a name like "Brackets" would leave the reader
 * to picture, and it cannot disagree with what the slot prints tight. The labels show
 * the tight forms, the table's own; spacing is the toggle below, over every preset
 * alike, so the dropdown stays one entry per separator instead of doubling (with the
 * toggle on, the slot prints the label's spaced form).
 *
 * @param {string} prefix Key prefix: 'temp' | 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {string} first Sample of the value that leads by default, e.g. '12'.
 * @param {string} second Sample of the other value, e.g. '10'.
 * @returns {Object[]} The separator select, the custom-separator text field, the spacing
 *     toggle.
 */
function separatorRows(prefix, first, second) {
    var bothWhen = {key: prefix + 'SlotDisplay', eq: 'both'};
    var presets = STATUS_PAIR.SEPARATORS;
    var def = STATUS_PAIR.defaultSeparator(prefix);
    var separators = Object.keys(presets).map(function (value) {
        return [first + presets[value].mid + second + presets[value].end, value];
    }).concat([['Custom', 'custom']]);
    return [{
        // A dropdown, not pills: five choices would be a wide pill row, and the owner
        // asked for a drop-down of presets. Inside the sheet it expands in place.
        type: 'select',
        messageKey: prefix + 'SlotSeparator',
        label: 'Separator',
        defaultValue: def,
        hintByValue: pairFallbackHints(prefix, first, second,
            separators.map(function (option) { return option[1]; })),
        options: separators,
        joinPrevious: true,
        showWhen: bothWhen
    }, {
        // maxlength is the soft UI cap (the browser counts UTF-16 units); the formatter
        // re-applies the limit after dropping what the font can't draw.
        type: 'text',
        messageKey: prefix + 'SlotSeparatorCustom',
        label: 'Custom separator',
        defaultValue: '',
        attributes: {maxlength: STATUS_PAIR.CUSTOM_MAX_CHARS},
        hint: pairCustomHint(prefix, first, second),
        joinPrevious: true,
        showWhen: {all: [bothWhen, {key: prefix + 'SlotSeparator', eq: 'custom'}]}
    }, {
        // Spacing is orthogonal to the separator — the owner asked for 8/8 or 8 / 8
        // "for all of them" — so it is one toggle, not a spaced twin of every preset.
        // Off by default: an absent key keeps the pair tight. The hint (shown while
        // the toggle is on) gives the spaced form of two separators, the kind's
        // default first, built through the formatter's own spaceAround on the kind's
        // samples, so it says plainly that the toggle covers every separator and
        // cannot drift from what the slot prints.
        type: 'toggle',
        messageKey: prefix + 'SlotSeparatorSpaced',
        label: 'Spaces around separator',
        defaultValue: false,
        hintByValue: {
            'true': 'Adds spaces to any separator: ' +
                [presets[def], presets.brackets].map(function (preset) {
                    var spaced = STATUS_PAIR.spaceAround(preset);
                    return first + spaced.mid + second + spaced.end;
                }).join(', ') + '.'
        },
        joinPrevious: true,
        showWhen: bothWhen
    }];
}
/**
 * A day-max slot kind's display rows (UV, wind, gusts, AQI), the sheet's first group
 * (no header, rows joined): the Value selection pills [Now | Day max | Both], the
 * Order and separator rows Both reveals (orderRow, separatorRows), and the mark on a
 * max that has rolled on to tomorrow's peak. In Day max mode the group collapses to
 * Value selection and Tomorrow's peak mark. Global per kind, baked phone-side
 * (status-lines.js formatValue; the numbers are wire-units' dayMaxShown) and on
 * renderSignature(), so a change re-bakes without waiting for the next fetch. The
 * highlight follows the numbers, never their presentation (status-wire.js
 * displayValue).
 *
 * The pills' hint explains the SELECTED mode only — Now, the default, gets none
 * (dayMaxHints). AQI closes the Day max and Both hints on its source's note when that
 * source has no forecast to take a peak from: blocks.js dayMaxHint answers the whole
 * hint then, from the same dayMaxHints table the static hintByValue is built from.
 * @param {string} prefix Key prefix: 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {{noun: string, notes: ?Object}} copy What the kind measures, without an
 *     article ('UV index'), and (AQI only) the source notes: dayMaxHint closes on
 *     byValue[S[key] || fallback] (a leading space; no entry, no note). null for none.
 * @param {string} now Sample current reading for the separator labels, e.g. '3'.
 * @param {string} max Sample peak, e.g. '7'.
 * @returns {Object[]} The rows, in sheet order.
 */
function dayMaxRows(prefix, copy, now, max) {
    var hints = dayMaxHints(copy.noun, now + '/' + max);
    var selection = {
        type: 'segmented',
        messageKey: prefix + 'SlotDisplay',
        label: 'Value selection',
        hintByValue: hints,
        defaultValue: 'current',
        options: [['Now', 'current'], ['Day max', 'max'], ['Both', 'both']]
    };
    if (copy.notes) {
        selection.hintFrom = {resolver: 'dayMaxHint', args: {hints: hints, notes: copy.notes}};
    }
    return [selection, orderRow(prefix, [['Now first', 'now'], ['Max first', 'max']])]
        .concat(separatorRows(prefix, now, max), [{
            // The mark on a max that has rolled on to tomorrow's peak — in Day max AND
            // Both, the two modes that print a max. 'raquo' is the '»' the UV slot
            // printed before this row existed, so it stays the default. Inside the
            // sheet the list expands in place.
            type: 'select',
            messageKey: prefix + 'SlotNextDayMark',
            label: 'Tomorrow\'s peak mark',
            defaultValue: 'raquo',
            hintByValue: {none: 'Tomorrow\'s peak then looks just like today\'s.'},
            options: nextDayMarkOptions(),
            joinPrevious: true,
            showWhen: {key: prefix + 'SlotDisplay', in: ['max', 'both']}
        }]);
}
/**
 * A day-max kind's Day max and Both hints. Each claim is wire-units dayMaxShown's:
 * today's peak (the rest of today, the current hour included) shows while it is still
 * ahead or happening now; then tomorrow's peak, carrying Tomorrow's peak mark, or —
 * unknown or never above 0 — the reading alone. The Both hint never says which number
 * of the pair the peak is: the Order row below it can put the max first. The closing
 * sentence is status-wire displayValue's: the slot's Alert highlighting judges
 * today's numbers only.
 * @param {string} noun What the kind measures, without an article, e.g. 'UV index'.
 * @param {string} sample The kind's sample pair, e.g. '3/7'.
 * @returns {{max: string, both: string}} The two hints.
 */
function dayMaxHints(noun, sample) {
    var never = ' Tomorrow\'s peak never triggers Alert highlighting.';
    return {
        max: 'The highest ' + noun + ' left today, while that peak is still ahead or happening '
            + 'now. After it, tomorrow\'s peak with Tomorrow\'s peak mark, or the reading when '
            + 'tomorrow\'s isn\'t known.' + never,
        both: 'The ' + noun + ' now and the highest left today, like ' + sample + ', while that '
            + 'peak is still ahead or happening now. After it, tomorrow\'s peak takes its place '
            + 'with Tomorrow\'s peak mark, or the reading shows alone when tomorrow\'s isn\'t '
            + 'known.' + never
    };
}
/**
 * Build a slot kind's "Show unit" row — whether its status slot prints the unit after
 * the number. Only the kinds the PHONE bakes can offer it (status-lines.js formats the
 * text); the watch-formatted kinds — distance, heart rate, sleep, battery % — would
 * need the flag on the wire, so they have no such row.
 *
 * The defaults are per kind and deliberately NOT uniform: a kind that prints its unit
 * today ships ON and one that never did ships OFF, so an upgrade changes nothing on
 * screen until someone flips a switch. All six keys ride renderSignature() (render-signature.js),
 * so a flip re-bakes instead of waiting for the next fetch.
 *
 * @param {string} key messageKey, e.g. 'windSlotUnit'.
 * @param {string} withUnit How the slot reads with the unit, e.g. '12kph'.
 * @param {string} without How the same slot reads without it, e.g. '12'.
 * @returns {Object} Toggle item for the kind's edit sheet.
 */
function unitRow(key, withUnit, without) {
    var defaultOn = STATUS_LINE_CATALOG.unitToggleDefault(key);
    return {
        type: 'toggle',
        messageKey: key,
        label: 'Show unit',
        defaultValue: defaultOn,
        // Naming both renderings is the whole hint: "show the unit" alone leaves the
        // reader guessing what the slot ends up looking like, and these slots are
        // narrow enough that the difference is the reason to care. Pass withUnit
        // null for a kind whose unit the Units tab can change (wind, gusts): naming
        // kph there would read as though this toggle also PICKS the unit, and the
        // engine's only value-dependent hint keys off the item's own value, so the
        // example cannot follow windUnits.
        hint: withUnit
            ? 'Prints the unit after the value: ' + withUnit + ' instead of ' +
                without + '.'
            // Wind and gusts: withUnit drops the unit when it doesn't fit, after the
            // direction arrow's byte is reserved (status-lines.js) — so say when.
            : 'Prints the unit after the value when it fits — in a narrow left or right slot, a pair plus the direction arrow leaves no room for it.'
    };
}
// The Bold row is a SLOT-level setting, not a level one: it closes the slot's own rows
// (last in an alert kind's slot sheet, whose levels live in the kind's alert sheet on
// the Alerts tab; right above a goal kind's Goals group) and says how boldly the
// slot prints. The ladder is monotone — danger is always bold (while the kind's
// highlight is on: a switched-off kind has no level), the middle option adds the
// warn/close level, "Always" adds the normal zone too (status_threshold.h ThreshBold).
// The row stays live while the kind's highlight is off, because "Always" needs no
// levels to mean something; it mutes wholesale only under the Watch-tab master row
// (BOLD_ALL_WHEN), which overrides it at pack time. Only the middle option needs a
// level — it goes inert (not away: removing it would let the options-snapping path
// rewrite a stored 'warn' to 'off') while nothing gives the kind one, which the caller
// states: the sheet knows where its kind's level comes from.
/**
 * @param {string} keyStem Kind key stem, e.g. 'Uv' (thresh<Stem>BoldMode).
 * @param {Object} voice GOAL_VOICE or ALERT_VOICE: the middle option's label and the
 *     hints.
 * @param {Object} noLevelWhen showWhen-style predicate: nothing gives the kind a level,
 *     so the middle option goes inert.
 * @returns {Object} The slot sheet's Bold row.
 */
function boldRow(keyStem, voice, noLevelWhen) {
    return {
        type: 'segmented',
        messageKey: 'thresh' + keyStem + 'BoldMode',
        label: 'Bold',
        hintByValue: voice.boldHints,
        defaultValue: 'warn',
        options: [['Off', 'off'], [voice.boldWarnLabel, 'warn'], ['Always', 'always']],
        disabledWhen: BOLD_ALL_WHEN,
        optionDisabledWhen: {warn: noLevelWhen}
    };
}
// A goal kind's level edit sheet (sheetOnly — opened from a status slot's pencil,
// never rendered as a card): the slot's Bold row, then its Goals group. sheetOf
// carries the section-level THRESHOLD_WHEN gate: on a watch that can't render
// highlighting the sheet must not exist (belt-and-braces behind the resolver's env
// gate).
/**
 * @param {string} title Catalog label of the slot kind, e.g. 'Steps'.
 * @param {string} keyStem Kind key stem, e.g. 'Steps' (thresh<Stem>Warn/...).
 * @param {string} hint Per-kind unit/scale hint for the slider (HTML allowed).
 * @param {?Object} gate Extra showWhen for the whole sheet, or null.
 * @returns {Object} Schema section (sheetOnly).
 */
function goalSlotSheet(title, keyStem, hint, gate) {
    // The Goals switch is the kind's one source of a level: the group's
    // highlight-only rows and the Bold row's middle option both go inert with it.
    var offWhen = {not: {key: 'thresh' + keyStem + 'On'}};
    // The slot's rows carry the same gate as the group (gateAll, one pass).
    return sheetOf(keyStem, title, gateAll([boldRow(keyStem, GOAL_VOICE, offWhen)], gate)
        .concat(levelRows(keyStem, GOAL_VOICE, hint, gate, offWhen)));
}
// An alert kind's slot edit sheet, in two groups without headers. First the kind's own
// display rows (the day-max kinds' Value selection group, the wind slots' direction
// arrow and unit). Then the highlight group: the 'Alert highlighting' switch (a divider
// above it), the pointer to the kind's alert sheet on the Alerts tab, where the levels and
// colors it uses live, joined tight, and the Bold row, joined loose. Titled from
// ALERT_KINDS, like that sheet. No gate: an alert kind's slot exists wherever the thresholds do (sheetOf's
// THRESHOLD_WHEN).
/**
 * @param {string} keyStem Alert kind key stem (an ALERT_KINDS entry), e.g. 'Uv'.
 * @param {Object[]} [extraItems] Kind-specific display rows, the sheet's first group,
 *     e.g. the day-max rows and the wind slots' direction arrow. They configure the
 *     SLOT's text, not the highlight — boldSection's extras play the same role on the
 *     level-less kinds.
 * @returns {Object} Schema section (sheetOnly).
 */
function alertSlotSheet(keyStem, extraItems) {
    var title = null, i;
    for (i = 0; i < ALERT_KINDS.length; i++) {
        if (ALERT_KINDS[i].keyStem === keyStem) { title = ALERT_KINDS[i].title; }
    }
    // Runs once at load: a caller naming a kind ALERT_KINDS lacks fails the build/tests
    // here rather than shipping a sheet titled 'null slot'.
    if (title === null) { throw new Error('alertSlotSheet: no ALERT_KINDS entry for ' + keyStem); }
    // The middle option needs a level: the slot's Highlight OR the kind's alert placed on
    // a bar, whose value bolds on this ladder too (status_on_demand.c) — inert only while
    // neither is on.
    var noLevelWhen = {all: [{not: {key: 'thresh' + keyStem + 'On'}},
        {not: onDemandPlacedWhen(alertCodeOf(keyStem))}]};
    var note = alertLevelsNote();
    note.joinPrevious = true;
    var bold = boldRow(keyStem, ALERT_VOICE, noLevelWhen);
    bold.joinPrevious = 'loose';
    return sheetOf(keyStem, title, (extraItems || []).concat([highlightToggle(keyStem), note, bold]));
}
// A weather kind's slot highlight switch — the watch's enable bit for the kind
// (kindConfig), which styles its STATUS SLOTS only: the alert icon shows on the bars the
// alert's Shows on grid picks and draws its warn look and danger fill whether or not
// this is on. It lives in the slot sheet because that is what it styles; the levels
// and colors it uses live in the kind's alert sheet (the Alerts tab). Like the goal
// header's switch, it writes no numbers: a blank pair already means the kind's seed.
/**
 * @param {string} keyStem Kind key stem, e.g. 'Uv' (thresh<Stem>On).
 * @returns {Object} The slot sheet's 'Alert highlighting' toggle.
 */
function highlightToggle(keyStem) {
    return {
        type: 'toggle',
        messageKey: 'thresh' + keyStem + 'On',
        label: 'Alert highlighting',
        // Fill at danger always; at warn the alert sheet's warn look (none /
        // outline / fill — status_threshold_look). Explains the ON value only; where
        // the levels are set is the info box right below. A toggle's value keys its
        // hint as the string 'true', quoted: a bare reserved word as a key is not ES3.
        hintByValue: {
            'true': 'Fills this slot from the danger level on and draws the warn look from warn.'
        },
        defaultValue: false
    };
}
// The five alert kinds' slot sheets carry this pointer instead of the levels group,
// right under the 'Alert highlighting' switch: the levels and colors live in ONE
// place, the kind's alert sheet in the Alert settings card on the Alerts tab (the slot
// sheet opens from the Status slots tab, so the note names the tab, as a tab link: a tap
// closes the sheet and brings the Alerts tab to the front). It opens the tab, not the
// alert's own sheet: the link says "Alerts tab". A fresh object per call, like every
// item.
/**
 * @returns {Object} The info-box staticText in an alert kind's slot sheet.
 */
function alertLevelsNote() {
    return {
        type: 'staticText',
        style: 'info',
        text: 'Alert levels and colors are set in the ' + ALERTS_TAB_LINK + ', under Weather alerts.'
    };
}
// Bold-only edit sheet for a slot kind WITHOUT thresholds (temp, date, city, …):
// the same pencil machinery — the contract's KINDS maps the slot code to this
// sheetId — but the Bold row is the sheet's only standing control: no group
// header, no slider, no colors. Two pills only: these kinds have no warn level,
// so the threshold sheets' middle option would promise a trigger that can never
// fire. 'off' (packs 1) and the unset default 'warn' (packs 0) both render
// non-bold on a level-less kind — it resolves THRESH_LEVEL_NORMAL — so the
// options-snapping of an unset store to 'off' is benign. The battery GLYPH item
// deliberately gets NO sheet: its slot draws a glyph, not text, so a Bold option
// would be a no-op lie (no KINDS entry, hence no pencil either) — the battery
// PERCENTAGE item is a separate text kind and gets a normal bold sheet below.
/**
 * @param {string} title Catalog label of the slot kind, e.g. 'City'.
 * @param {string} keyStem Kind key stem, e.g. 'City' (thresh<Stem>BoldMode).
 * @param {Object} [gate] Extra showWhen mirroring the slot's own availability.
 * @param {Object[]} [extraItems] Kind-specific rows rendered ABOVE the Bold row,
 *     e.g. Temp's Value selection. Bold is the row every slot sheet has, and it
 *     comes last in all of them (the alert kinds' sheets too), so the kind-specific
 *     extras lead.
 * @returns {Object} Schema section (sheetOnly).
 */
function boldSection(title, keyStem, gate, extraItems) {
    var bold = {
        type: 'segmented',
        messageKey: 'thresh' + keyStem + 'BoldMode',
        label: 'Bold',
        // Off is the default and needs no words; Always says how far it reaches.
        hintByValue: {always: BOLD_ALWAYS_HINT},
        defaultValue: 'off',
        options: [['Off', 'off'], ['Always', 'always']],
        disabledWhen: BOLD_ALL_WHEN
    };
    // Bold closes the sheet, as it does in the alert kinds' sheets: the rows that
    // shape what the slot shows come first, then how boldly it prints.
    var items = (extraItems || []).concat([bold]);
    return sheetOf(keyStem, title, gateAll(items, gate));
}
// Color swatches (5 intensity bands) — shown only in the Multicolor hint.
var SWATCHES = '<span style="display:inline-flex;gap:7px;margin-top:6px;align-items:flex-end;">' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#AAAAAA;margin-bottom:3px;"></span>0.1</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#55FFFF;margin-bottom:3px;"></span>0.5</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#00FF00;margin-bottom:3px;"></span>2</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FFFF00;margin-bottom:3px;"></span>10</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FF5555;margin-bottom:3px;"></span>40</span>' + '</span>';
// Bar color hint depends on the selected mode (hintByValue): Multicolor shows the swatches; White doesn't.
var MULTICOLOR_HINT = 'Colors each part differently depending on intensity:' + SWATCHES;
var WHITE_HINT = 'Shows every bar in a single color.';
// Full-width note between the Bars and Bar color controls (its own staticText) so the prose isn't
// cramped in a control's left column. Color watches only; B/W uses BW_LEGEND.
var SCALE_NOTE = 'The bars don\'t scale linearly. They\'re divided into 5 parts, standing for up to 0.1, 0.5, 2, 10 and 40 mm/h of downfall, so light drizzle stays visible while heavy rain still has room to grow.';
// B/W watches hide the color picker (no colors to choose), so this stands in for COLOR_LEGEND
// there: text-only, since height is the only encoding (no color steps to show).
var BW_LEGEND = 'The bars don\'t scale linearly. They\'re divided into 5 parts, standing for up to 0.1, 0.5, 2, 10 and 40 mm/h of downfall.';
// Per-provider "why it's best" note — the picker's hintByValue, so only the selected provider's
// rationale renders. The hinted-row wrap layout flows it around the trigger and gives it the
// full row width below, so the fuller prose no longer needs its own staticText. The short
// tags live in the dropdown option descs; these give the fuller rationale.
var PROVIDER_WHY = {
    dwd: 'Germany\'s national weather service — the most accurate forecasts across Germany and decent across Central Europe (ICON model). No API key needed.',
    metno: 'The service behind yr.no — best across the Nordics with a 2.5 km model, and solid worldwide. No API key needed.',
    openmeteo: 'Automatically picks the best national model for your location (DWD, NOAA, Météo-France, ECMWF…). Free, no API key.',
    openweathermap: 'A popular general-purpose API with solid worldwide coverage. Needs a free API key on the One Call 3.0 plan.',
    tomorrowio: 'Minute-by-minute hyperlocal forecasts worldwide, from proprietary ML models and satellites. Needs a free API key.',
    wunderground: 'A huge crowd-sourced network of 250,000+ personal weather stations — dense local readings, strongest across the US and Europe. No API key needed.',
    yandex: 'Best across Russia and the CIS, using the Meteum machine-learning forecast. Needs an API key.'
};
var RADAR_WHY = {
    dwd: 'Precise weather radar — rain at your exact spot and nearby (~2 km). Germany only.',
    metno: 'Precise weather radar — rain at your exact spot. Nordics only.',
    // Rainbow's terms ask for a "Powered by Rainbow.ai" link wherever its data shows, so
    // both Rainbow why-hints end on it.
    // "Rainbow (limited)": why the shared radar is limited — the developer pays for the
    // calls every user shares, and the rainbow-nowcast proxy caps that account at
    // RAINBOW_MONTHLY_BUDGET upstream calls (DEV.md; default the free 5,000), so past it
    // users get no fresh radar rather than a bill — and the option that lifts it.
    rainbow: 'A worldwide nowcast blending satellite and radar. I pay for the Rainbow calls everyone shares, and with a growing number of users I can only provide a limited number of them, so the shared radar refreshes at most every 30 minutes. Pick “Rainbow (own key)” for a refresh at every update — a key is free. Powered by <a target=\'_blank\' href=\'https://rainbow.ai\'>Rainbow.ai</a>.',
    // "Rainbow (own key)": the same nowcast on the user's own Rainbow account.
    rainbowkey: 'A worldwide nowcast blending satellite and radar, on your own Rainbow key, so it refreshes at every update. A key is free: Rainbow\'s free plan covers 5,000 calls a month. Powered by <a target=\'_blank\' href=\'https://rainbow.ai\'>Rainbow.ai</a>.',
    // Without a key the amber note under the row says what goes missing, so the why-hint
    // here only says whose key and whose budget.
    tomorrowio: 'A precise ML rain nowcast, worldwide. Uses your tomorrow.io API key and counts against the same call budget.'
};
// The radar picker's options in order. desc (3rd tuple slot) = the short "what it's best at"
// tag under each name in the dropdown, mirroring the weather picker. DWD/Met.no are real
// radar; Rainbow/Tomorrow.io are model nowcasts (Tomorrow.io is the precise, worldwide one).
// Scope lives in the desc + "why" note, not the label (keeps the trigger short). Rainbow
// comes twice, one option per radar source (weather/radar-factory.js): the shared proxy
// everyone splits ('rainbow') and the user's own key ('rainbowkey').
var RADAR_PROVIDER_OPTIONS = [
    ['DWD', 'dwd', {desc: 'Best radar in Germany · exact spot + nearby'}],
    ['Met.no', 'metno', {desc: 'Best radar in the Nordics · exact spot'}],
    ['Rainbow (limited)', 'rainbow', {desc: 'Worldwide satellite + radar nowcast · no key, every 30 min'}],
    ['Rainbow (own key)', 'rainbowkey', {desc: 'Worldwide satellite + radar nowcast · needs a free key'}],
    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise ML rain nowcast, worldwide · uses your key'}]
];
// The Weather and Radar provider rows' keyed sources (settings/key-sources.js), which their
// key sheets are built from. The rows' key-status resolvers read the same tables in the page
// by the row's picker, so the rows hand them no args.
var PROVIDER_KEYS = KEY_SOURCES.provider.sources;
var RADAR_KEYS = KEY_SOURCES.radarProvider.sources;
// The tomorrow.io key + budget guard live in a key sheet of whichever picker actually uses
// the key: the General tab's Tomorrow.io sheet (the Edit button after the Weather provider
// dropdown) while it is the WEATHER provider, the Radar tab's Tomorrow.io sheet (the Edit
// button after the Radar provider dropdown) while it is radar-only, so the key never sits
// with the weather provider for a non-weather provider. Both sheets hold the same rows
// (TOMORROWIO_KEY_ROWS) under the same messageKeys, gated apart (like the theme color/B&W
// split). The radar-only gate also needs a running radar (as "Rainbow (own key)"'s sheet
// does): with radar off no Tomorrow.io radar call is made and the picker is hidden.
// The weather sheet's gate is the radar source's sharedSheet condition, so the sheet the
// Radar provider row's Edit button opens while Tomorrow.io is both is the one shown.
var TOMORROWIO_WEATHER_WHEN = {key: RADAR_KEYS.tomorrowio.sharedSheet.key, eq: RADAR_KEYS.tomorrowio.sharedSheet.eq};
var TOMORROWIO_RADAR_ONLY_WHEN = {all: [{key: 'radarProvider', eq: 'tomorrowio'}, {key: 'radarMode', ne: 'off'},
    {key: 'provider', ne: 'tomorrowio'}]};
// "Rainbow (own key)" picked for a running radar: its key sheet's gate. The radarMode
// clause keeps the sheet (and so the Save dialog's way into it) closed with radar off,
// when no Rainbow call is made.
var RAINBOW_OWN_KEY_WHEN = {all: [{key: 'radarProvider', eq: 'rainbowkey'}, {key: 'radarMode', ne: 'off'}]};
// A tap-to-copy button (copy icon) for use inside hint HTML: copies `url` via the engine's delegated
// [data-copy] handler and flashes a "Copied" toast. Used instead of a plain link where tapping is
// useless — e.g. a page that 404s on the mobile site, so users copy the URL and open it on desktop.
// `label` is the accessible name / tooltip; `url` is a trusted constant here (not user input).
function copyBtn(url, label) {
    return '<button type="button" class="copybtn" data-copy="' + url + '" title="' + label + '" aria-label="' + label + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>';
}

/**
 * Per-slot phone-only target date, shown only while its owning slot is Countdown.
 * @param {string} slotKey Owning status-slot message key.
 * @param {Object} [barWhen] Existing Radar/Health bar visibility predicate.
 * @returns {Object} Date-control schema item.
 */
function countdownDateItem(slotKey, barWhen) {
    var countdownWhen = {key: slotKey, eq: 'countdown'};
    return {
        type: 'date',
        messageKey: slotKey + 'Countdown',
        label: 'Countdown date',
        defaultFrom: {resolver: 'todayDate'},
        joinPrevious: true,
        showWhen: barWhen ? {all: [barWhen, countdownWhen]} : countdownWhen
    };
}

/**
 * One status-bar slot select: the identical five-resolver wiring every slot
 * carries (platform-aware default, row dedupe on pick, edit sheet, pencil
 * badge, catalog options) — hand-copied twelve times before this helper.
 * @param {string} slotKey Slot messageKey, e.g. 'statusForecastLeft'.
 * @param {string} position 'left' | 'mid' | 'right'.
 * @param {?Object} barWhen The bar's shared visibility gate (null = always).
 * @param {boolean} joins Whether the row joins the previous one (no divider).
 * @returns {Object} Select item.
 */
function slotItem(slotKey, position, barWhen, joins) {
    var labels = {left: 'Left slot', mid: 'Middle slot', right: 'Right slot'};
    var item = {
        type: 'select',
        messageKey: slotKey,
        label: labels[position],
        defaultFrom: {resolver: 'statusSlotDefault', args: {slotKey: slotKey}},
        onChange: 'dedupeStatusSlot',
        editSheetFrom: {resolver: 'statusSlotEditSheet'},
        editBadgeFrom: {resolver: 'thresholdPenState'},
        optionsFrom: {resolver: 'statusSlot', args: {slotKey: slotKey, position: position}}
    };
    if (barWhen) { item.showWhen = barWhen; }
    if (joins) { item.joinPrevious = true; }
    return item;
}

/**
 * A status bar's seven items — left/mid/right selects, each followed by its countdown
 * companion date row, then its read-only Alerts row (onDemandRow) — all sharing the bar's
 * gate. Mid, right and the Alerts row always join the row above; the left slot joins only when
 * the bar opens with its own intro row.
 * @param {string} prefix Slot-key prefix, e.g. 'statusForecast'.
 * @param {?Object} barWhen The bar's shared visibility gate (null = always).
 * @param {boolean} [leftJoins] The left slot joins the previous row too.
 * @returns {Object[]} Seven schema items in render order.
 */
function barSlots(prefix, barWhen, leftJoins) {
    return [
        slotItem(prefix + 'Left', 'left', barWhen, Boolean(leftJoins)),
        countdownDateItem(prefix + 'Left', barWhen),
        slotItem(prefix + 'Mid', 'mid', barWhen, true),
        countdownDateItem(prefix + 'Mid', barWhen),
        slotItem(prefix + 'Right', 'right', barWhen, true),
        countdownDateItem(prefix + 'Right', barWhen),
        onDemandRow(prefix, barWhen)
    ];
}
// The signup link opens in an external browser (target=_blank). The Development > API Keys page 404s on
// tomorrow.io's MOBILE site, so it gets a copy button instead of a (useless-on-mobile) link — users copy
// the URL and open it in desktop-site mode. See copyBtn() + the engine's [data-copy] handler.
var TOMORROWIO_KEY_HINT = '<a target=\'_blank\' href=\'https://app.tomorrow.io/signup\'>Create a free tomorrow.io account</a> (no credit card needed), then open <b>https://app.tomorrow.io/development/keys</b>' + copyBtn('https://app.tomorrow.io/development/keys', 'Copy the API-keys page link') + ', copy your key and paste it here, then Test it. The free plan is plenty — see the call budget below.<br><b>IMPORTANT: On a phone, tomorrow.io\'s mobile site shows an error (404) on the API-keys page — tap the copy button, then open the link in your browser\'s desktop-site mode.</b>';
var TOMORROWIO_BUDGET_HINT = 'Only offer update intervals that fit the free plan. Turn off to pick any interval — over-budget calls are rejected by tomorrow.io until the limit resets, and the watch keeps its last data.';
// The rows of both Tomorrow.io key sheets, the weather provider's (General tab) and the
// radar-only one (Radar tab): the key field with its Test button, then the budget guard
// with the call-budget read-out between the two (blockBefore). keySheetSection gives each
// sheet's copies that sheet's gate.
var TOMORROWIO_KEY_ROWS = [{
    type: 'text',
    messageKey: 'tomorrowioApiKey',
    label: 'API key',
    defaultValue: '',
    suffixAction: 'testTomorrowioKey',
    suffixLabel: 'Test',
    hint: TOMORROWIO_KEY_HINT
}, {
    type: 'toggle',
    messageKey: 'tomorrowioFitBudget',
    label: 'Fit update interval to rate limit',
    defaultValue: true,
    joinPrevious: 'loose',
    // blockBefore: the usage read-out sits between the API key field and this
    // toggle, joined into the same tomorrow.io group.
    blockBefore: 'tomorrowioBudget',
    hint: TOMORROWIO_BUDGET_HINT
}];
// Rainbow's terms (developer.rainbow.ai, checked 2026-09-25): signup takes payment details, the
// Nowcast API's first 5,000 calls each calendar month are free, then $0.10 per 1,000.
var RAINBOW_KEY_HINT = '<b>How to get a key:</b><br>1. <a target=\'_blank\' href=\'https://developer.rainbow.ai/signup/\'>Sign up at developer.rainbow.ai</a>. Rainbow asks for a credit card, but the first 5,000 calls each month are free.<br>2. Open your <a target=\'_blank\' href=\'https://developer.rainbow.ai/profile\'>profile page</a>' + copyBtn('https://developer.rainbow.ai/profile', 'Copy the profile page link') + ', copy the API key and paste it here.<br>3. Tap Test.<br>Keep "Fit update interval to rate limit" on and the watch stays within the free 5,000 calls.';
var RAINBOW_BUDGET_HINT = 'Only offer update intervals that fit the free 5,000 calls a month. Turn off to pick any interval — Rainbow bills calls past 5,000 to your card at $0.10 per 1,000.';

/**
 * A keyed source's key sheet (sheetOnly; the sheet its key-sources.js entry names for
 * it), opened by the Edit button after its picker while that source is picked. It holds everything about the key — the field with its Test button
 * and verdict line, the hint with its links, any budget read-out and guard — so the
 * picker's card keeps only the pickers. The sheet's title is the source's name, so the
 * key row's label is just "API key". The section and every item share the source's
 * gate: findShownItem picks a key's shown copy by the item's own gate, which keeps the
 * Radar tab's radar-only Tomorrow.io sheet apart from the weather provider's.
 * @param {{sheetId: string, name: string}} source The source's key-table entry (its name
 *   titles the sheet).
 * @param {Object} when The source's gate, set on the section and on every item.
 * @param {Object[]} items The sheet's rows, the key field first (they get `when`).
 * @returns {Object} Schema section (sheetOnly).
 */
function keySheetSection(source, when, items) {
    return {
        sheetOnly: true,
        sheetId: source.sheetId,
        showWhen: when,
        title: source.name,
        items: items.map(function (item) { return Object.assign({}, item, {showWhen: when}); })
    };
}
// The Nighttime card's gates. "Dim backlight" is emery-only: env.colorBacklight
// (config-ui/lib/platform.js) is a fact about the BACKLIGHT, not the screen — only
// emery's board carries the RGB LED driver light_set_color_rgb888() needs, so
// basalt/chalk (colour screen, plain white backlight) are deliberately out. NOT
// capabilities: ['COLOR'], which says "colour screen" and would light the rows up
// there.
var BACKLIGHT_WHEN = {env: 'colorBacklight'};
var BACKLIGHT_ON_WHEN = {all: [BACKLIGHT_WHEN, {key: 'backlightDim', eq: true}]};
// The dim colour's sheet, and the ONE copy of its default. The card row (a `sheet`
// row, which stores nothing) hands the default to its badge resolver so an unset or
// bruised value previews the same colour the sliders open on; the rgb item in the
// sheet is what actually stores it.
var BACKLIGHT_COLOR_SHEET = 'backlightColor';
var BACKLIGHT_COLOR_DEFAULT = '40,10,0';
module.exports = {
    appName: 'WarnWeather',
    themeKey: 'configTheme',
    versionLabel: versionLabel + ' <a href="https://github.com/Toasbi/WarnWeather">GitHub source</a>',
    tabs: [{
        // The Weather tab is content, not configuration: live graphs + a
        // 5-day outlook for the active location, fetched by the page itself
        // (weather-tab*.js). DISPLAY-ONLY: its keys are blob-only and never
        // touch the watch's provider/location or any AppMessage.
        // FIRST in the bar, but not what the page opens on: that stays
        // General unless the user asks for this tab in More > Misc.
        id: 'weather', label: 'Weather', openWhen: {key: 'startOnWeatherTab', eq: true}, sections: [{
            // Collapsed by default (collapsible sections start closed); the
            // header paints the current pick via titleFrom so the closed card
            // reads "PROVIDER · DWD" without opening it.
            id: 'graphsProviderCard',
            title: 'Provider',
            collapsible: true,
            titleFrom: {resolver: 'graphsProviderHeader'},
            items: [{
                type: 'select',
                messageKey: 'graphsProvider',
                label: 'Data source',
                defaultValue: 'auto',
                optionsFrom: {resolver: 'graphsProviderOptions'},
                // A keyed pick whose API key is momentarily empty (rotating a
                // key) is DORMANT, not invalid: render the Auto fallback but
                // keep the stored pick, so re-entering the key restores it
                // instead of a render+Save silently erasing it to 'auto'.
                dormantValues: ['openweathermap', 'tomorrowio'],
                hint: 'Only for this tab’s graphs — the watchface keeps its own provider and location. Keyed providers appear once their API key is set.'
            }]
        }, {
            // Chips + graphs render as ONE card: two untitled sections sharing
            // a groupCard, each contributing its block (hidden items draw
            // nothing but still hydrate/serialize the tab's blob-only keys).
            groupCard: 'weatherMain',
            block: 'weatherLocations',
            items: [{
                type: 'hidden', messageKey: 'graphsLocation', defaultValue: 'current'
            }, {
                type: 'hidden', messageKey: 'savedLocation1', defaultValue: ''
            }, {
                type: 'hidden', messageKey: 'savedLocation2', defaultValue: ''
            }, {
                type: 'hidden', messageKey: 'savedLocation3', defaultValue: ''
            }]
        }, {
            groupCard: 'weatherMain',
            block: 'weatherGraphs',
            items: [{
                // Blob-only: stamped by the graphs block whenever it renders and
                // carried back by the next Save, so the phone knows the tab is in
                // use and keeps its data for the day (weather-tab-cache.js).
                type: 'hidden', messageKey: 'weatherTabSeenAt', defaultValue: 0
            }]
        }]
    }, {
        id: 'general', label: 'General', openDefault: true, sections: [{
            // The fetch-error notices stay first: the panel draws nothing until a fetch
            // fails, and then it is the news the page opens on.
            block: 'noticesPanel',
            items: [{
                type: 'hidden',
                messageKey: 'fetchNoticeAck',
                defaultValue: false
            }]
        }, {
            items: [{
                type: 'select',
                messageKey: 'theme',
                label: 'Theme',
                defaultValue: 'dark',
                hintByValue: {
                    dark: 'Black background, white text/lines (default).',
                    light: 'White background, black text/lines. The graph and rain-bar colors are tuned for it.',
                    bw: 'Renders exactly like a Black & White watch — same colors, same drawing.',
                    'bw-light': 'Renders exactly like a Black & White watch in its Light theme — black on white.'
                },
                options: [['Dark', 'dark'], ['Light', 'light'], ['B&W', 'bw'], ['B&W Inverted', 'bw-light']],
                // Always visible and never renamed. `theme` has always doubled as the
                // day theme: with Theme switching (the Nighttime card) on, that card
                // adds the night one and this row keeps its meaning. It used to be
                // hidden and replaced by a "Day theme" copy of itself, which read as
                // the page renaming a row behind the user's back.
                showWhen: {env: 'color'},
                onChange: 'themeConvert'
            }, {
                type: 'select',
                messageKey: 'theme',
                label: 'Theme',
                defaultValue: 'dark',
                hintByValue: {
                    dark: 'Black background, white text/lines (default).',
                    light: 'White background, black text/lines.'
                },
                options: [['Dark', 'dark'], ['Light', 'light']],
                // aplite compiles the light polarity out (no WW_THEME_POLARITY — the
                // theme sweep pushed the image past the 24 KB launch ceiling), so the
                // picker is hidden there entirely; a choice would be a silent no-op.
                // diorite/flint (also B&W) keep this 2-option slot.
                showWhen: {all: [{not: {env: 'color'}}, {env: 'themePolarity'}]},
                onChange: 'themeConvert'
            }, {
                type: 'segmented', messageKey: 'locationMode', label: 'Location', defaultValue: 'gps', hintByValue: {
                    gps: 'Detect your location automatically via phone GPS.', manual: 'Enter a city or address below.'
                }, options: [['GPS', 'gps'], ['Manual', 'manual']]
            }, {
                type: 'text',
                messageKey: 'location',
                label: 'Manual location',
                defaultValue: '',
                attributes: {placeholder: 'e.g. Manhattan'},
                hint: 'Example: "Manhattan" or "123 Oak St Plainsville KY".',
                showWhen: {key: 'locationMode', eq: 'manual'}
            }, {
                type: 'select',
                messageKey: 'gpsCacheMin',
                label: 'GPS cache',
                defaultValue: '30',
                joinPrevious: 'loose',
                optionsFrom: {interval: 'fetchIntervalMin', ladder: [30, 60, 120, 360, 720, 1440]},
                showWhen: {key: 'locationMode', eq: 'gps'},
                hint: 'How long a GPS fix is reused before re-acquiring. Longer saves battery; shorter keeps your location fresher on the move. The lowest value matches your update interval.'
            }]
        }, {
            // Everything that changes after dark, in one card. Every switch here
            // owns its hours outright — there is no card-level window, so nothing in
            // the card reads or moves another group's times.
            title: 'Nighttime settings', items: [{
                // Each group opens on its own switch row, which carries the group's
                // copy as its hint — the same shape as every other toggle row.
                type: 'toggle',
                messageKey: 'backlightDim',
                label: 'Dim backlight',
                defaultValue: true,
                hint: 'Dim the backlight when it comes on between the hours below, so it is easier on your eyes.',
                showWhen: BACKLIGHT_WHEN
            }, {
                // The dim window, and now the feature's only one — it no longer
                // falls back to anything. Still 0–7: that is the stretch where a
                // full-brightness backlight actually hurts, and starting in the
                // evening would dim the screen for someone still awake in a lit
                // room, which reads as a fault rather than a setting. It is also
                // what night-light.js falls back to when nothing is stored, so the
                // page and the reader agree on an install that never opened this
                // card.
                //
                // First row under its switch — joins it tight.
                type: 'select',
                messageKey: 'backlightDimStartHour',
                label: 'From',
                defaultValue: '0',
                options: HOURS,
                inline: 'backlightDimHours',
                joinPrevious: true,
                showWhen: BACKLIGHT_ON_WHEN
            }, {
                type: 'select',
                messageKey: 'backlightDimEndHour',
                label: 'To',
                defaultValue: '7',
                options: HOURS,
                inline: 'backlightDimHours',
                showWhen: BACKLIGHT_ON_WHEN
            }, {
                // The colour opens in a bottom sheet (the section below) instead of
                // standing in the card: three channel sliders made the Nighttime
                // card's smallest setting its tallest row. What stays here is the
                // colour itself — the badge resolver reports the stored value as a
                // `chip`, which the engine prints as the same swatch-and-hex readout
                // the sheet shows above its sliders, so the card names what the
                // backlight will glow and nothing more. Same surface as the
                // Graph-colors rows (graphColorRow above), which preview two or three
                // colours each and so keep the compact dots.
                //
                // A `sheet` row has no messageKey, and the engine merges the item's
                // absent one UNDER these args — so `key` is the resolver's only way
                // to know which value it is previewing.
                type: 'sheet',
                sheetId: BACKLIGHT_COLOR_SHEET,
                label: 'Color',
                editBadgeFrom: {
                    resolver: 'rgbSwatch',
                    args: {key: 'backlightDimColor', defaultValue: BACKLIGHT_COLOR_DEFAULT}
                },
                // Joins the rows above into ONE block: everything a group reveals when its
                // switch goes on belongs to that switch, so the only lines inside the card
                // are the ones between groups.
                //
                // TIGHT, not 'loose', and that is a card-wide rule rather than this row's
                // taste: a tight join sets the gap to 5px+5px and a loose one leaves the
                // standard 14px+14px, so a group mixing the two steps its rows unevenly (the
                // owner's report: "Enabled hours, from and the color are not evenly spaced").
                // Theme switching's rows were already tight, so every join INSIDE a Nighttime
                // group is tight and the whole card keeps one rhythm. Pinned by the
                // even-spacing test in test/config-schema.test.js.
                joinPrevious: true,
                showWhen: BACKLIGHT_ON_WHEN
            }, {
                // The Theme row in the card above doubles as the day theme and is
                // left exactly as the user set it; enabling this only seeds a night
                // theme (theme-flip.js).
                type: 'toggle',
                messageKey: 'themeAuto',
                label: 'Theme switching',
                defaultValue: false,
                hint: 'Switch between two themes automatically — with the sun, or on a fixed schedule. The phone applies the switch, so it can land a little late while the watch is disconnected.',
                // themePolarity: aplite has nothing to switch between (the light
                // polarity is compiled out there), so the whole group hides.
                showWhen: {env: 'themePolarity'},
                onChange: 'themeAutoPreset'
            }, {
                // No themeConvert here: the stored colour defaults track the DAY
                // theme's polarity; the night flip converts a scratch copy at send
                // time instead (theme-schedule.js). First row under its switch, so
                // both copies join it tight.
                type: 'select',
                messageKey: 'themeNight',
                label: 'Night theme',
                defaultValue: 'dark',
                options: [['Dark', 'dark'], ['Light', 'light'], ['B&W', 'bw'], ['B&W Inverted', 'bw-light']],
                joinPrevious: true,
                showWhen: {all: [{env: 'color'}, {key: 'themeAuto', eq: true}]}
            }, {
                type: 'select',
                messageKey: 'themeNight',
                label: 'Night theme',
                defaultValue: 'dark',
                options: [['Dark', 'dark'], ['Light', 'light']],
                joinPrevious: true,
                showWhen: {all: [{not: {env: 'color'}}, {env: 'themePolarity'}, {key: 'themeAuto', eq: true}]}
            }, {
                // The one mode switch left in the card: sunrise/sunset is a real
                // alternative to a clock window, so it needs somewhere to be chosen.
                // The other two groups just take their hours directly.
                type: 'segmented',
                messageKey: 'themeAutoMode',
                label: 'Enabled hours',
                defaultValue: 'sun',
                // 'manual' is the STORED value for custom hours and predates this
                // control's current labels — relabelled, never renamed, so an install
                // that already picked fixed hours keeps them.
                options: [['Sunrise/sunset', 'sun'], ['Custom', 'manual']],
                // themePolarity too: hidden items keep serializing, but a
                // paired aplite watch must not show orphaned auto-theme rows.
                showWhen: {all: [{env: 'themePolarity'}, {key: 'themeAuto', eq: true}]},
                joinPrevious: true
            }, {
                type: 'select',
                messageKey: 'themeAutoStartHour',
                label: 'From',
                defaultValue: '20',
                options: HOURS,
                inline: 'themeAutoHours',
                joinPrevious: true,
                showWhen: {all: [{env: 'themePolarity'}, {key: 'themeAuto', eq: true}, {key: 'themeAutoMode', eq: 'manual'}]}
            }, {
                type: 'select',
                messageKey: 'themeAutoEndHour',
                label: 'To',
                defaultValue: '7',
                options: HOURS,
                inline: 'themeAutoHours',
                showWhen: {all: [{env: 'themePolarity'}, {key: 'themeAuto', eq: true}, {key: 'themeAutoMode', eq: 'manual'}]}
            }, {
                // "Sending", not "fetching": with the phone-battery slot the saver
                // also suppresses the status micro-send, so the copy has to describe
                // what it stops, not where the data comes from.
                type: 'toggle',
                messageKey: 'sleepNightEnabled',
                label: 'Battery saver',
                defaultValue: true,
                hint: 'Stop sending updates to your watch between the hours below to save battery.'
            }, {
                // sleepStartHour/sleepEndHour, back under the switch that has always
                // owned them: same keys, same options, same '0'/'7' defaults, same
                // gate. Nothing an install has stored means anything different than
                // it did before the Nighttime card existed.
                //
                // First row under its switch — joins it tight.
                type: 'select',
                messageKey: 'sleepStartHour',
                label: 'From',
                defaultValue: '0',
                options: HOURS,
                inline: 'sleepHours',
                joinPrevious: true,
                showWhen: {key: 'sleepNightEnabled', eq: true}
            }, {
                type: 'select',
                messageKey: 'sleepEndHour',
                label: 'To',
                defaultValue: '7',
                options: HOURS,
                inline: 'sleepHours',
                showWhen: {key: 'sleepNightEnabled', eq: true}
            }]
        }, {
            // The Dim backlight colour, alone in its bottom sheet — opened by the
            // "Color" row of the card above and rendered nowhere else (sheetOnly
            // sections are skipped by the tab renderer while hydrate/serialize still
            // walk them, so the key, its "r,g,b" wire format and its default are
            // untouched by the move out of the card).
            //
            // Gated like the row that opens it: a sheet forced open on a watch whose
            // backlight cannot be tinted — or with Dim backlight switched off — must
            // render empty rather than offer a colour that does nothing.
            sheetOnly: true,
            sheetId: BACKLIGHT_COLOR_SHEET,
            title: 'Dim backlight color',
            showWhen: BACKLIGHT_ON_WHEN,
            intro: 'Pick the color the backlight glows during the hours you set for Dim backlight. Lower values dim it further; your watch’s own brightness setting still applies on top.',
            items: [{
                // One "r,g,b" string, each channel 0-255 — the LED takes 8 bits per
                // channel. A dim red by default: the driver scales every channel by
                // the watch's own brightness setting, so the value carries the hue
                // AND how deep the dim goes.
                //
                // No label: the sheet's title already names this control, and the
                // threshold sliders drop theirs for the same reason — a labelled row
                // directly under a title saying the same thing reads as a stutter.
                type: 'rgb',
                messageKey: 'backlightDimColor',
                defaultValue: BACKLIGHT_COLOR_DEFAULT
            }]
        }, {
            title: 'Provider settings', items: [{
                type: 'select',
                messageKey: 'fetchIntervalMin',
                label: 'Update interval',
                defaultValue: '15',
                hint: 'Updates only send what actually changed (deltas), so short intervals like 5 min stay battery friendly.',
                optionsFrom: {resolver: 'fetchIntervalBudget'}
            }, {
                type: 'select',
                messageKey: 'provider',
                label: 'Weather provider',
                defaultValue: 'wunderground',
                onChange: 'clearPollenForProvider',
                // Flags the country-matched option "(Recommended)" (DE→DWD, Nordics→Met.no, else→Open-Meteo),
                // reading the same country→provider map the wizard uses. See blocks.js recommend resolvers.
                recommendFrom: 'recommendedWeatherProvider',
                // Options are alphabetical by name. The 3rd tuple slot's desc is the short "what it's
                // best at" tag shown under each name in the dropdown; the selected provider's fuller
                // rationale renders via hintByValue (PROVIDER_WHY) — the wrap layout flows it around
                // the trigger and full-width below it.
                // Scope (Germany/Nordics) lives in the desc + the "why" note, not the label —
                // the label stays short so the collapsed trigger doesn't overlap the field label.
                // DWD carries a `short` so the trigger reads "DWD" while the sheet keeps the full name.
                hintByValue: PROVIDER_WHY,
                // A provider that needs a key gets an Edit button after the dropdown, opening its
                // key sheet (the sheetOnly sections below this card) — the key field, its Test, the
                // links and any budget guard live there, not on the card. The row shows the key's
                // status (settings/key-status.js, which reads the table key-sources.js keeps
                // for this picker): the button reads "Add key" while the key is empty; under the
                // "why" hint (this row's own PROVIDER_WHY copy, which the engine hands the
                // resolver, so the two cannot drift) a line "Key ••••1234 · ✓ works"; and a key
                // that is missing or known to be rejected puts a dot on this tab and a dialog
                // in front of Save ("Add key" / "Save anyway"). The missing-key note is the
                // staticText right below.
                editSheetFrom: {resolver: 'keySheet'},
                editBadgeFrom: {resolver: 'keyBadge'},
                hintFrom: {resolver: 'keySummaryHint'},
                attentionFrom: {resolver: 'keyAttention'},
                options: [
                    ['Deutscher Wetterdienst', 'dwd', {desc: 'Best in Germany · no key', short: 'DWD'}],
                    ['Met.no', 'metno', {desc: 'Best in the Nordics (behind yr.no) · no key'}],
                    ['Open-Meteo', 'openmeteo', {desc: 'Good automatic national model selection · no key'}],
                    ['OpenWeatherMap', 'openweathermap', {desc: 'Popular general-purpose API, worldwide · needs a free key'}],
                    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise hyperlocal forecasts, worldwide · needs a free key'}],
                    ['Weather Underground', 'wunderground', {desc: 'Crowd-sourced network of 250,000+ local stations · no key'}],
                    ['Yandex Weather', 'yandex', {desc: 'Best across Russia & CIS · needs a key'}]
                ]
            }, {
                // The keyed provider's empty key, said where it cannot be missed: an amber note
                // hugging the row, only while the picked provider's key is blank (textFrom
                // answers '' otherwise and the note is gone, divider and all). A staticText has
                // no messageKey, so its args name the picker.
                type: 'staticText',
                style: 'info',
                joinPrevious: true,
                textFrom: {resolver: 'keyMissingNote', args: {picker: 'provider'}}
            }, {
                type: 'select',
                messageKey: 'aqiSource',
                label: 'AQI provider',
                defaultValue: 'waqi',
                hintByValue: {
                    auto: 'Prefers WAQI and falls back to Open-Meteo when no nearby station is available.',
                    waqi: 'WAQI (aqicn.org) reads real monitoring stations — most accurate, but rural / under-monitored areas may have no nearby station and show "--".',
                    openmeteo: 'Open-Meteo is a global model with coverage everywhere.'
                },
                options: [['Auto', 'auto'], ['WAQI', 'waqi'], ['Open-Meteo', 'openmeteo']]
            }]
        },
        // The keyed weather providers' key sheets, opened by the Edit button after the Weather
        // provider dropdown in the card above and rendered nowhere else (sheetOnly, like the dim
        // colour's sheet). The keys, their trimming and refetch on Save (onbuild.js) and the Test
        // actions are the ones the card's rows carried.
        keySheetSection(PROVIDER_KEYS.openweathermap, {key: 'provider', eq: 'openweathermap'}, [{
            type: 'text',
            messageKey: 'owmApiKey',
            label: 'API key',
            defaultValue: '',
            suffixAction: 'testOwmKey',
            suffixLabel: 'Test',
            hint: '<a href=\'https://openweathermap.org/\'>Register an OpenWeatherMap account</a> and paste your API key here, then Test it. The key must be subscribed to <a href=\'https://openweathermap.org/api/one-call-3\'>One Call API 3.0</a> (it has a free allowance) or fetches fail with a 401.'
        }]),
        // Shown only while tomorrow.io is the WEATHER provider; when it is radar-only the same key
        // + budget guard live in the Radar tab's Tomorrow.io sheet instead (see
        // TOMORROWIO_RADAR_ONLY_WHEN). While it is both, this is the one sheet that holds the
        // key, and the Radar provider row's Edit opens it too (RADAR_KEYS sharedSheet).
        keySheetSection(PROVIDER_KEYS.tomorrowio, TOMORROWIO_WEATHER_WHEN, TOMORROWIO_KEY_ROWS),
        keySheetSection(PROVIDER_KEYS.yandex, {key: 'provider', eq: 'yandex'}, [{
            type: 'text',
            messageKey: 'yandexApiKey',
            label: 'API key',
            defaultValue: '',
            hint: 'Register a Yandex Weather API key at <a href=\'https://yandex.com/dev/weather/\'>yandex.com/dev/weather</a> and paste it here.'
        }]), {
            title: 'Units', items: [{
                type: 'segmented',
                messageKey: 'temperatureUnits',
                label: 'Temperature',
                defaultValue: 'c',
                options: [['°F', 'f'], ['°C', 'c']]
            }, {
                type: 'segmented',
                messageKey: 'aqiScale',
                label: 'Air quality scale',
                defaultValue: 'european',
                options: [['European', 'european'], ['US', 'us']],
                showWhen: {key: 'aqiSource', eq: 'openmeteo'},
                hint: 'Which air-quality index the Open-Meteo source reports. WAQI always uses the US EPA scale.'
            }, {
                type: 'segmented',
                messageKey: 'windUnits',
                label: 'Wind speed',
                defaultValue: 'kph',
                options: [['kph', 'kph'], ['mph', 'mph'], ['Knots', 'knots']],
                hint: 'Unit for the wind and gust status items.'
            }, {
                type: 'segmented',
                messageKey: 'distanceUnits',
                label: 'Distance',
                defaultValue: 'metric',
                options: [['Kilometres', 'metric'], ['Miles', 'imperial']],
                hint: 'Unit for the "Walked distance" status item.'
            }, {
                // Phone-side only (feels-like.js resolvers; fetch-cycle.js hands it to
                // the provider per fetch) and in renderSignature, so a flip refetches.
                type: 'segmented',
                messageKey: 'feelsFormula',
                label: 'Feels-like formula',
                defaultValue: 'provider',
                options: [['Provider', 'provider'], ['Steadman', 'steadman']],
                hintByValue: {
                    provider: 'Uses the feels-like value your weather service reports. For some services it '
                        + 'equals the air temperature in mild weather. Services without one use Steadman.',
                    steadman: 'Calculates feels-like from air temperature, humidity and wind, the same '
                        + 'way on every provider, so it differs from the temperature all year round.'
                }
            }]
        }]
    }, {
        id: 'forecast', label: 'Forecast', sections: [{
            intro: 'The forecast graph looks up to 24 hours ahead. Temperature is always drawn; the metrics and rain bars you pick below join it.',
            // One flat list: each picker's four Draw from rows (lineFromCopies) are
            // spliced in right after its Line style.
            items: [{
                type: 'select',
                messageKey: 'secondaryLine',
                label: 'Main metric',
                defaultValue: 'precip_prob',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric'},
                onChange: 'forecastMetricFill',
                blockBefore: 'forecastPreview',
                blockBeforeSticky: true
            },
            lineStyleCopy('secondaryLine')
            ].concat(lineFromCopies('secondaryLine'), [{
                type: 'toggle',
                messageKey: 'secondaryLineFill',
                // Direction-neutral: with Draw from on Top the fill hangs with its line.
                label: 'Area fill',
                defaultValue: true,
                joinPrevious: true,
                // Feels-like and dew point ride the temperature axis rather than a 0..max scale, so
                // "below the line" is not the area between the curve and a meaningful
                // zero — a fill there would flood the plot up to an arbitrary band
                // floor. The row is hidden for it and the 'forecastMetricFill' hook
                // above clears the stored value; forecast-series.js re-forces false at
                // bake time so a settings blob written before this gate still can't fill.
                // A stripe has no curve to fill below either (line-style.js gates
                // fillOn the same way) — unless this watch ignores the styles, or the
                // metric cannot be a stripe: a stored stripe then lies dormant in the
                // style row (dormantValues — it stays stored) and draws as a line, so
                // the metric is read too, not only the stored style.
                showWhen: {all: [
                    {key: 'secondaryLine', nin: lineStyle.TEMP_AXIS_METRIC_IDS},
                    {any: [{not: LINE_STYLES_WHEN},
                        {key: 'secondaryLineStyle', nin: STRIPE_STYLES},
                        {key: 'secondaryLine', nin: lineStyle.STRIPE_METRIC_IDS}]}
                ]}
            },
            windScaleCopy('secondaryLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('secondaryLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('secondaryLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('secondaryLine'),
            lineShowCopy('secondaryLine', 'wind'),
            lineShowCopy('secondaryLine', 'gust'),
            lineShowCopy('secondaryLine', 'uv'),
            {
                type: 'select',
                messageKey: 'thirdLine',
                label: 'Second metric',
                defaultValue: 'uv',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {off: true, exclude: ['secondaryLine']}}
            },
            lineStyleCopy('thirdLine', true)
            ], lineFromCopies('thirdLine'), [
            windScaleCopy('thirdLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('thirdLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('thirdLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('thirdLine'),
            lineShowCopy('thirdLine', 'wind'),
            lineShowCopy('thirdLine', 'gust'),
            lineShowCopy('thirdLine', 'uv'),
            {
                type: 'select',
                messageKey: 'fourthLine',
                label: 'Third metric',
                defaultValue: 'off',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {off: true, exclude: ['secondaryLine', 'thirdLine']}},
                // Only watches with enough memory carry a third metric line
                // (LINE_STYLES_WHEN — the WW_LINE_STYLE mirror, fail-open for
                // an unknown platform). Row-level hiding, not option-gating,
                // so the stored value is never display-snapped away on a
                // watch that lacks the line.
                showWhen: LINE_STYLES_WHEN
            },
            lineStyleCopy('fourthLine', true)
            ], lineFromCopies('fourthLine'), [
            windScaleCopy('fourthLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('fourthLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('fourthLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('fourthLine'),
            lineShowCopy('fourthLine', 'wind'),
            lineShowCopy('fourthLine', 'gust'),
            lineShowCopy('fourthLine', 'uv'),
            {
                type: 'select',
                messageKey: 'fifthLine',
                label: 'Fourth metric',
                defaultValue: 'off',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {off: true, exclude: ['secondaryLine', 'thirdLine', 'fourthLine']}},
                // Same row-level gate as the third metric (WW_LINE_STYLE mirror).
                showWhen: LINE_STYLES_WHEN
            },
            lineStyleCopy('fifthLine', true)
            ], lineFromCopies('fifthLine'), [
            windScaleCopy('fifthLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('fifthLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('fifthLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('fifthLine'),
            lineShowCopy('fifthLine', 'wind'),
            lineShowCopy('fifthLine', 'gust'),
            lineShowCopy('fifthLine', 'uv'),
            {
                type: 'segmented',
                messageKey: 'barSource',
                label: 'Bars',
                defaultValue: 'rain',
                hintByValue: {rain: 'Adds bars that represent the rain amount in one hour.'},
                options: [['Rain', 'rain'], ['Off', 'off']]
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: SCALE_NOTE,
                capabilities: ['COLOR'],
                showWhen: {all: [{key: 'barSource', eq: 'rain'}, COLOR_THEME_WHEN]}
            }, {
                type: 'staticText',
                joinPrevious: true,
                text: BW_LEGEND,
                // Effective color: shows whenever the display isn't rendering as color —
                // real B&W hardware OR the Black & White theme (bw/bw-light) on a color watch.
                showWhen: {all: [
                    {not: {all: [{env: 'color'}, COLOR_THEME_WHEN]}},
                    {key: 'barSource', eq: 'rain'}
                ]}
            }, {
                type: 'segmented',
                messageKey: 'rainBarColor',
                label: 'Bar color',
                // The DARK-polarity default. The light polarity starts on Solid instead:
                // resolve-ink.js's barColorDefault owns that pair, and theme-convert.js
                // converts a value still holding this one when the Theme control flips
                // polarity. This cannot become a defaultFrom — a defaults-resolver is
                // handed only `env` (platform facts), and the theme is a settings key.
                defaultValue: 'multicolor',
                joinPrevious: true,
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                capabilities: ['COLOR'],
                // VALUE stays 'white' for wire compatibility (the watch resolves it to the
                // right polarity color itself — see rain-tier.js); only the label changes.
                options: [['Multicolor', 'multicolor'], ['Solid', 'white']],
                showWhen: {all: [{key: 'barSource', eq: 'rain'}, COLOR_THEME_WHEN]}
            }, {
                // Bars from [Bottom | Top] (draw-from.js rainBarFrom): while the bars are
                // drawn, on a watch with line styles (the WW_LINE_STYLE mirror the watch's
                // flip sits behind; aplite never hangs them). Joined to Bar color; with
                // that row hidden (B&W) it joins the bar note, which joins Bars.
                type: 'segmented',
                messageKey: 'rainBarFrom',
                label: 'Bars from',
                defaultValue: DRAW_FROM.BOTTOM,
                joinPrevious: true,
                hintByValue: {top: BARS_TOP_HINT},
                options: [['Bottom', DRAW_FROM.BOTTOM], ['Top', DRAW_FROM.TOP]],
                showWhen: {all: [{key: 'barSource', eq: 'rain'}, LINE_STYLES_WHEN]}
            }, {
                type: 'toggle',
                messageKey: 'dayNightShading',
                label: 'Day / night shading',
                defaultValue: true,
                hint: 'Hatches the hours between sunset and sunrise.'
            }])
        }, {
            // One card holding one row per graph metric, plus the night band. Deliberately
            // NOT groupCard: a grouped section renders through renderSectionGroup, which
            // emits no card header, and this card needs its title. buildSectionBody runs
            // before the visibility test, so on a B&W watch the whole card — header
            // included — disappears.
            id: 'graphColors',
            title: 'Graph colors',
            capabilities: ['COLOR'],
            showWhen: COLOR_THEME_WHEN,
            intro: 'One row per metric, plus the night shading. Each row’s colours are remembered separately for the Dark and the Light theme.',
            items: GRAPH_COLOR_ROWS.map(function (row, i) {
                return graphColorRow(row, i > 0);
            })
        }].concat(GRAPH_COLOR_ROWS.map(graphColorSheet))
    }, {
        // aplite compiles the rain-radar view out (WW_RAIN_RADAR undefined — the 24 KB
        // budget can't afford it), so the whole tab is env-hidden there (tab-level
        // showWhen; see platform.js radar env flag). Mirrors the health tab.
        id: 'radar', label: 'Radar', showWhen: {env: 'radar'}, sections: [{
            intro: 'Rain radar is a second view — a precise short-term rain forecast for your location. Set where the view appears in the Layout tab.<br>',
            items: [{
                type: 'radio',
                messageKey: 'radarMode',
                label: 'Radar view',
                defaultValue: 'graph',
                hintByValue: {
                    off: 'Radar is hidden.',
                    // No radar bar or graph in this mode: the rain icon's place is the Rain
                    // sheet's Shows on grid (Alerts tab), not the Layout tab the intro names.
                    // Plain text: a radio's per-value hint, not a tab link.
                    countdown: 'Fetches the radar only for the rain alert, with no radar bar or graph. The rain icon shows on the status bars picked for Rain in the Alerts tab.',
                    status: 'Adds the Radar Status Bar.',
                    graph: 'Adds the Radar Status Bar and the full radar rain graph.'
                },
                // 'Rain alert only' — the VALUE stays 'countdown' (stored + telemetry): the
                // mode fetches radar solely for the rain alert, which an On demand side draws.
                options: [['Off', 'off'], ['Rain alert only', 'countdown'], ['Status bar', 'status'], ['Status + Graph', 'graph']],
                onChange: 'resetStatusRadar'
            }, rainAlertUnshownNote(), {
                type: 'select',
                messageKey: 'radarProvider',
                label: 'Radar provider',
                defaultValue: 'rainbow',
                showWhen: {key: 'radarMode', ne: 'off'},
                // Flags the country-matched option "(Recommended)" (DE→DWD, Nordics→Met.no, else→
                // "Rainbow (limited)"), the same map the wizard uses. See blocks.js recommend
                // resolvers; the bracketed name moves the marker onto the desc line (engine.js).
                recommendFrom: 'recommendedRadarProvider',
                // Two Rainbow options, one per radar source (radar-factory.js): "Rainbow
                // (limited)" ('rainbow') is the shared proxy, at most every 30 min (fetch-cycle.js
                // throttle; builds without a proxy endpoint still offer it and clear the radar);
                // "Rainbow (own key)" ('rainbowkey') is api.rainbow.ai directly on the user's
                // key, at every update, which works without the endpoint. A changed source
                // forces a fetch (index.js).
                // The selected provider's fuller rationale renders via hintByValue (RADAR_WHY),
                // wrapping around the trigger — mirroring the weather picker.
                hintByValue: RADAR_WHY,
                // "Rainbow (own key)" and Tomorrow.io get an Edit button after the dropdown,
                // opening their key sheet (the sheetOnly sections after this one): the key
                // field with its Test, the links, the read-out and the budget guard live
                // there. The row shows the key's status like the Weather provider row
                // (settings/key-status.js, which reads the table key-sources.js keeps for this
                // picker): "Add key" while the key is empty, a line "Key ••••1234 · ✓ works"
                // under the RADAR_WHY hint, and a key that is missing or known to be rejected
                // puts a dot on this tab and a dialog in front of Save ("Add key" / "Save
                // anyway"). The missing-key note is the staticText right below. Tomorrow.io's
                // key is the weather provider's too: while Tomorrow.io is also the weather
                // provider, Edit opens the General tab's Tomorrow.io sheet, the one copy of
                // the key then, and the summary and dot here agree with that row's.
                editSheetFrom: {resolver: 'keySheet'},
                editBadgeFrom: {resolver: 'keyBadge'},
                hintFrom: {resolver: 'keySummaryHint'},
                attentionFrom: {resolver: 'keyAttention'},
                options: RADAR_PROVIDER_OPTIONS
            }, {
                // The own key's empty field, said where it cannot be missed: an amber note
                // hugging the row while "Rainbow (own key)" or Tomorrow.io is picked with no
                // key. For DWD and Met.no the same note says when the last update's location
                // lies outside the picked source's area, or (DWD) inside it with no radar
                // data from DWD, naming one that covers it (radar-coverage.js; the phone's
                // record userData.radarCoverage). textFrom
                // answers '' otherwise. It follows the picker's own gate, so radar off hides
                // it with the row. A staticText has no messageKey, so its args name the picker.
                type: 'staticText',
                style: 'info',
                joinPrevious: true,
                textFrom: {resolver: 'radarProviderNote', args: {picker: 'radarProvider'}},
                showWhen: {key: 'radarMode', ne: 'off'}
            }, {
                // Radar preview now rides the bar-scale note (blockBefore), so it sits BELOW the picker
                // instead of stickied above it; the note stands as separate info text beneath the preview
                // (no joinPrevious). One of SCALE_NOTE (color) / BW_LEGEND (B/W) shows in graph mode.
                type: 'staticText',
                blockBefore: 'radarPreview',
                text: SCALE_NOTE,
                hinted: true,
                capabilities: ['COLOR'],
                showWhen: {all: [{key: 'radarMode', eq: 'graph'}, COLOR_THEME_WHEN]}
            }, {
                type: 'staticText',
                blockBefore: 'radarPreview',
                text: BW_LEGEND,
                hinted: true,
                showWhen: {all: [
                    {not: {all: [{env: 'color'}, COLOR_THEME_WHEN]}},
                    {key: 'radarMode', eq: 'graph'}
                ]}
            }, {
                type: 'segmented',
                messageKey: 'radarColor',
                label: 'Radar color',
                // Dark-polarity default; light starts on Solid (resolve-ink.js's
                // barColorDefault). See rainBarColor above.
                defaultValue: 'multicolor',
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                capabilities: ['COLOR'],
                // VALUE stays 'white' for wire compatibility (the watch resolves it to the
                // right polarity color itself — see rain-tier.js); only the label changes.
                options: [['Multicolor', 'multicolor'], ['Solid', 'white']],
                showWhen: {all: [{key: 'radarMode', eq: 'graph'}, COLOR_THEME_WHEN]}
            }, {
                // Bars from [Bottom | Top] (draw-from.js radarBarFrom): the radar graph's
                // rain bars, the exact spot's and DWD's nearby-area ones together, hang
                // under the time axis (and under the sky rows). Only the graph draws bars;
                // the tab is already radar-gated, and LINE_STYLES_WHEN states the watch
                // side's WW_LINE_STYLE dependency. Joined to Radar color; with that row
                // hidden (B&W) it joins the bar note above it.
                type: 'segmented',
                messageKey: 'radarBarFrom',
                label: 'Bars from',
                defaultValue: DRAW_FROM.BOTTOM,
                joinPrevious: true,
                hintByValue: {top: BARS_TOP_HINT},
                options: [['Bottom', DRAW_FROM.BOTTOM], ['Top', DRAW_FROM.TOP]],
                showWhen: {all: [{key: 'radarMode', eq: 'graph'}, LINE_STYLES_WHEN]}
            }, {
                // The radar's sky rows (radar-sky.js): an extra Open-Meteo request per
                // fetch, on by default (a missing key reads as on everywhere: radar-sky.js
                // skySourceIdFor, index.js, telemetry-settings.js). Only the radar GRAPH draws them,
                // like the no-rain text below; fetch-cycle.js (radarSky.skySourceIdFor) clears
                // them whenever the graph is not shown.
                type: 'toggle',
                messageKey: 'radarSky',
                label: 'Clouds, sun & lightning',
                defaultValue: true,
                hint: 'Two thin stripes under the radar\'s time axis show the next two hours, one cell per quarter hour.<br>Top, clouds: a full stripe means overcast. Thin high cloud, which the sun shines through, counts half.<br>Bottom, sun: a full stripe means sunshine as strong as on a clear day at that time of day, so a low morning sun can be full too.<br>Thin cloud can let the sun through, so both stripes can show at once. A bolt marks expected thunderstorms. Uses Open-Meteo, whatever the radar source.',
                showWhen: {key: 'radarMode', eq: 'graph'}
            }, {
                // Custom quiet-state text: drawn in the radar GRAPH when the nowcast
                // finds no rain in the whole window. Ships visibly with the watch's
                // built-in default so users override the actual message. The UI
                // maxlength is a soft character cap; the phone re-truncates to 24
                // UTF-8 BYTES at pack time. Empty/whitespace-only text shows no line.
                // A 1.23.0 migration moved older empty values (which meant "default")
                // and the untouched old default "No rain ahead" to "You're good :)". Only rain_radar_layer.c
                // draws it, so the field follows the graph ('graph'), not the radar
                // as a whole — in 'status'/'countdown' there is no plot to write on.
                type: 'text',
                messageKey: 'radarNoRainText',
                label: 'No-rain message',
                defaultValue: "You're good :)",
                attributes: {maxlength: 24},
                hint: 'Shown in the radar graph when no rain is coming; the default is “You\'re good :)”. Up to 24 characters; leave it empty to show nothing.',
                showWhen: {key: 'radarMode', eq: 'graph'}
            }]
            // The rain alert's time window (rainCountdownHorizon) used to close this
            // section; it is set in the Rain alert sheet (the Alerts tab) alone.
        },
        // "Rainbow (own key)"'s key sheet, opened by the Edit button after the Radar provider
        // dropdown and rendered nowhere else. The key, its trimming and refetch on Save
        // (onbuild.js), its keeping through Reset (clay-settings.js PRESERVED_SETTING_KEYS)
        // and the Test action are as before; the key never rides the watch wire.
        keySheetSection(RADAR_KEYS.rainbowkey, RAINBOW_OWN_KEY_WHEN, [{
            type: 'text',
            messageKey: 'rainbowApiKey',
            label: 'API key',
            defaultValue: '',
            suffixAction: 'testRainbowKey',
            suffixLabel: 'Test',
            hint: RAINBOW_KEY_HINT
        }, {
            type: 'toggle',
            messageKey: 'rainbowFitBudget',
            label: 'Fit update interval to rate limit',
            defaultValue: true,
            joinPrevious: 'loose',
            // The monthly-usage read-out sits between the key field and this toggle.
            blockBefore: 'rainbowBudget',
            hint: RAINBOW_BUDGET_HINT
        }]),
        // Radar-only Tomorrow.io's key sheet, opened by the Edit button after the Radar provider
        // dropdown and rendered nowhere else: the General tab's Tomorrow.io sheet's rows, same
        // messageKeys, gated apart (TOMORROWIO_RADAR_ONLY_WHEN), so findShownItem keeps the two
        // copies apart. While Tomorrow.io is also the weather provider this sheet is closed and
        // the General tab's holds the key. Trimming and refetch on Save (onbuild.js) and the
        // Test action are the key's, whichever sheet it was typed in.
        keySheetSection(RADAR_KEYS.tomorrowio, TOMORROWIO_RADAR_ONLY_WHEN, TOMORROWIO_KEY_ROWS)]
    }, {
        // aplite has no health sensors — the watch compiles the view out, so the whole
        // tab is env-hidden there (tab-level showWhen; see platform.js health env flag).
        id: 'health', label: 'Health', showWhen: {env: 'health'}, sections: [{
            intro: 'Show your activity on the watchface: today\'s steps, last night\'s sleep, and current heart rate. Where it appears is set in the Layout tab.',
            items: [{
                type: 'radio',
                messageKey: 'healthMode',
                label: 'Health view',
                defaultValue: 'all',
                hintByValue: {
                    off: 'Health is hidden.',
                    slot: 'Lets you put health items (steps, sleep, heart rate, walked distance) in any status bar.',
                    status: 'Adds the Health Status Bar — today\'s steps, last night\'s sleep, and current heart rate. Heart rate needs a watch with a heart-rate sensor.',
                    all: 'Adds the Health Status Bar and a health graph — hourly step bars, a sleep band, and a heart-rate line. Feedback very welcome via <a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a>.'
                },
                options: [['Off', 'off'], ['Status slots only', 'slot'], ['Status bar', 'status'], ['Status + Graph (BETA)', 'all']],
                onChange: 'resetStatusHealth'
            }, {
                type: 'range',
                messageKey: 'hrScale',
                label: 'Heart-rate scale',
                // Kept in lockstep with the watch's own HEALTH_HR_LO/HEALTH_HR_HI
                // (src/c/layers/health_graph_layer.c) and the clay-payload fallback:
                // all three are the same number, so a watch that never received the
                // key draws the same scale as one that did. 180 was the old top; 150
                // keeps a resting-to-brisk-walk day filling the plot instead of
                // hugging the floor, and anything above it still shows as edge dots.
                defaultValue: '40-150',
                min: 30, max: 220, step: 5, minSpan: 50, unit: 'BPM',
                hint: 'The top and bottom of the heart-rate line in the health graph. '
                    + 'A narrower range makes small changes visible; hours outside it '
                    + 'are drawn as dots on the edge.',
                // The HR line lives only in the graph ('all'), and only emery/diorite
                // have a sensor (platform.js HR_PLATFORMS) — on anything else the line
                // is permanently absent, so a scale for it would be inert.
                showWhen: {all: [{env: 'hr'}, {key: 'healthMode', eq: 'all'}]}
            }]
        }]
    }, {
        // The Alerts tab (the owner, 2026-10-01): the Alert settings card, moved off the
        // General tab as it was, between Health and Status slots. Every row opens its
        // item's sheet, which leads with the item's Shows on grid (where it shows, per
        // bar, Left or Right); the Status slots tab's Alerts rows only show the result.
        // aplite has no Alerts (ON_DEMAND_WHEN), so the whole tab is env-hidden there
        // (renderTabBar, renderBody and the attention dots all skip a tab whose showWhen
        // fails). The card (alerts-schema.js cardSection) stores nothing: its sheets and the
        // eight side lists' hidden items close the Status slots tab's sections (renderEditModal
        // finds a sheet on any tab); the end of that tab says why they stay there.
        id: 'alerts', label: 'Alerts', showWhen: ON_DEMAND_WHEN, sections: [alertsSchema.cardSection()]
    }, {
        // Label renamed 'Watch' → 'Status slots' when Time/Calendar moved to the
        // Layout tab; the id stays 'watch' — deep links and tests key on it.
        id: 'watch', label: 'Status slots', sections: [{
            // The intro + the four status-bar sections share one groupCard so they render as a
            // single card (each title becomes an in-card sub-header). Time/Calendar below stay
            // their own cards.
            groupCard: 'watchStatus',
            // The intro's inline reset (introAction) reverts every slot AND the bold
            // settings in one tap (blocks.js resetStatusSlots — the engine injects section
            // intros as raw HTML and dispatches [data-action] clicks globally). Deliberately
            // NOT thresholds-gated: aplite has slots but no bold machinery, and
            // "status bars" stays truthful there either way.
            intro: 'Every view has its own status bar — one row with a left, middle, and right slot you can fill with weather, time, health, and more. Choose what each view shows below. '
                + introAction('resetStatusSlots', 'Reset status bars to defaults'),
            items: [
                // Master bold switch over EVERY slot kind. It lives in the card's
                // title-less intro section — ABOVE the per-bar sub-headers — because
                // it governs all bars, not just the forecast one: 'all' packs each
                // kind's bold cell as always-bold when the threshold blob is built
                // (status-thresholds.js) and leaves the stored per-kind modes
                // untouched — the per-slot Bold rows mute via BOLD_ALL_WHEN
                // meanwhile. A settings-store key only: it rides the packed blob,
                // never an AppMessage key of its own. Same platform gate as the
                // edit sheets — aplite compiles the bold machinery out.
                {
                    type: 'segmented',
                    messageKey: 'statusBoldAll',
                    label: 'Bold values',
                    // "have", not "let": the ES5 guardrail (test/config-es5.test.js)
                    // greps for \blet\s in shipped pkjs source and cannot tell a
                    // string literal from a declaration.
                    // The selected option's meaning only; Per slot says where the choice is.
                    hintByValue: {
                        perSlot: 'Each slot’s edit sheet has its own Bold row.',
                        all: 'Every slot value prints in heavier text.'
                    },
                    defaultValue: 'perSlot',
                    options: [['Per slot', 'perSlot'], ['All', 'all']],
                    showWhen: THRESHOLD_WHEN
                }
            ]
        }, {
            // The bars in the owner's order (2026-10-01: "1: watch status bar 2 weather 3
            // health 4 radar"; before it Forecast, Radar, Health, Watch): the page's order
            // only. on-demand.js BARS (top, forecast, radar, health), the wire and the keys
            // keep theirs, and the save blob carries the same keys (the bars' keys just come
            // out in this order).
            groupCard: 'watchStatus',
            title: 'Watch Status Bar',
            // aplite has no On demand (ON_DEMAND_WHEN): it keeps the bar's fixed battery,
            // quiet-time and Bluetooth rows, and only it. Everywhere else the Battery,
            // Quiet time and Bluetooth items live in the Alert settings card (the Alerts
            // tab), and vibe/btIcons in the Bluetooth sheet (the same keys, gated apart).
            items: barSlots('statusTop', null).concat(gateAll([
                {
                    type: 'toggle', messageKey: 'batteryLowOnly', label: 'Show battery below 10%',
                    defaultValue: true,
                    hint: 'Replaces the top-right slot when your battery drops below 10%.'
                },
                {type: 'toggle', messageKey: 'showQt', label: 'Show quiet time icon', defaultValue: true},
                {
                    type: 'toggle', messageKey: 'vibe', label: 'Vibrate on bluetooth disconnect',
                    defaultValue: false
                },
                {
                    // joinPrevious groups the bluetooth icon select with the vibrate-on-disconnect
                    // toggle above it (no divider between the two bluetooth settings); the divider
                    // stays between "Show quiet time icon" and "Vibrate on bluetooth disconnect".
                    type: 'select',
                    messageKey: 'btIcons',
                    label: 'Show icon for bluetooth',
                    defaultValue: 'disconnected',
                    joinPrevious: 'loose',
                    options: BT_ICON_OPTIONS
                }
            ], {not: ON_DEMAND_WHEN}))
        }, {
            groupCard: 'watchStatus',
            title: 'Forecast Status Bar',
            items: barSlots('statusForecast', null)
        }, {
            groupCard: 'watchStatus',
            title: 'Health Status Bar',
            items: barSlots('statusHealth', HEALTH_BAR_WHEN)
        }, {
            groupCard: 'watchStatus',
            title: 'Radar Status Bar',
            items: barSlots('statusRadar', RADAR_BAR_WHEN)
        },
        // Threshold edit sheets (sheetOnly): reachable only through the pencil next to a
        // status slot whose selected value has thresholds — never rendered as cards here.
        // The AQI day max needs an hourly forecast, which only the Open-Meteo source
        // has: on WAQI's current reading every mode prints that reading alone. The
        // note closes the Day max and Both hints for the source that cannot give a
        // peak — WAQI (the default, so an absent key reads as it), and Auto, which
        // reads WAQI whenever a station answers; Open-Meteo gets none.
        alertSlotSheet('Aqi', dayMaxRows('aqi', {
            noun: 'air quality index',
            notes: {
                key: 'aqiSource',
                fallback: 'waqi',
                byValue: {
                    waqi: ' Your AQI provider (WAQI) has no forecast, so the current reading shows.',
                    auto: ' Auto mostly reads WAQI, which has no forecast — then the current reading shows.'
                }
            }
        }, '42', '58')),
        // Pollen's scale hint rides its levels group, in its alert sheet (the Alerts tab).
        alertSlotSheet('Pollen'),
        // Wind and gust each carry their own direction arrow: the two slots often sit
        // side by side, and one arrow drawn twice is noise — so the choice is per kind,
        // not global. The phone bakes the arrow into the slot text (status-lines.js
        // appends a trailing sentinel byte), and both keys ride renderSignature(), so
        // flipping one re-bakes without waiting for the next fetch.
        // Wind, gusts and AQI carry UV's display modes (dayMaxRows), each kind its own.
        // The arrow and the unit follow the Value selection group as rows of their
        // own (with dividers): they answer to every mode, not to Both's pair rows.
        alertSlotSheet('Wind', dayMaxRows('wind', {noun: 'wind'}, '12', '30').concat([{
            type: 'toggle',
            messageKey: 'windSlotDirection',
            label: 'Show wind direction',
            // ON by default, unlike its gust twin below: a wind speed on its own
            // answers half the question, and the arrow costs no wire bytes. Gusts
            // stay off because the two slots sit side by side in the Radar row's
            // defaults and share one bearing — the same arrow twice on one line.
            // Fresh installs only; an existing watch stores an explicit value and
            // is not rearranged under its owner.
            defaultValue: true,
            hint: WIND_DIRECTION_HINT
        }, unitRow('windSlotUnit', null, null)])),
        alertSlotSheet('Gust', dayMaxRows('gust', {noun: 'gusts'}, '20', '45').concat([{
            type: 'toggle',
            messageKey: 'gustSlotDirection',
            label: 'Show wind direction',
            defaultValue: false,
            hint: WIND_DIRECTION_HINT
        }, unitRow('gustSlotUnit', null, null)])),
        // The UV slot's display mode — the temp slot's tempSlotDisplay pattern: global
        // per-kind, baked phone-side (status-lines.js formatValue), and on
        // renderSignature() so a change re-bakes without waiting for the next fetch.
        // What each mode prints is wire-units' dayMaxShown.
        // It leads the sheet like the wind arrow: it configures the slot, and the
        // highlight follows it (the policy is status-wire.js displayValue's). So
        // do the rows shaping how it reads, which change the text only — the
        // highlight judges the numbers, never their presentation.
        alertSlotSheet('Uv', dayMaxRows('uv', {noun: 'UV index'}, '3', '7')),
        goalSlotSheet('Steps', 'Steps', 'Steps per day.', HEALTH_SLOT_WHEN),
        goalSlotSheet('Sleep', 'Sleep', 'Hours of sleep, e.g. 7.5.', HEALTH_SLOT_WHEN),
        goalSlotSheet('Walked distance', 'Distance', 'Distance walked per day.', HEALTH_SLOT_WHEN),
        // Bold-only sheets for the level-less slot kinds (same pencil, one row —
        // plus the display rows a few kinds add above it: Temp's mode and pair,
        // the units, the date formats). Order and labels mirror the contract's
        // KINDS appendix (wire ids 8..19); the battery GLYPH item is deliberately
        // absent — see boldSection (the battery PERCENTAGE kind sits near the end).
        // "Temperature slot", not the catalog's "Temperature (actual/feels like)":
        // the parenthetical exists to advertise the choice from the dropdown, and
        // repeating it on the sheet that MAKES the choice is noise.
        boldSection('Temperature', 'Temp', null, [{
            // Global per-kind, like the bold modes: one choice covers every slot
            // showing temp. The phone bakes the slot text from it (status-lines.js
            // formatValue) and it rides renderSignature(), so a change re-bakes
            // without waiting for the next fetch. 'both' prints the pair the rows
            // below shape — 12|10, actual first, until someone picks otherwise; a
            // missing feels-like value falls back to the actual temp alone.
            type: 'segmented',
            messageKey: 'tempSlotDisplay',
            label: 'Value selection',
            // The selected mode only; the measured temperature (the default) needs
            // none. The sample pair is printed with the default separator.
            hintByValue: {
                feels: 'What it feels like, by the formula set under General → Units.',
                both: 'The temperature and what it feels like, like 12' +
                    STATUS_PAIR.SEPARATORS[STATUS_PAIR.defaultSeparator('temp')].mid +
                    '10. Order and Separator shape the pair.'
            },
            defaultValue: 'actual',
            options: [['Temp', 'actual'], ['Feels like', 'feels'], ['Both', 'both']],
            // Picking Both clears the degree: "-12|-10" is already 7 of an edge
            // slot's 8 bytes and the sign is two more, so the pair cannot fit.
            // Clearing it here is the fill-vs-feels pattern (forecastMetricFill).
            onChange: 'tempUnitExclusive'
        }, orderRow('temp', [['Temp first', 'actual'], ['Feels like first', 'feels']])]
            .concat(separatorRows('temp', '12', '10'), [
            // The degree sign alone, never °C/°F: the unit is already the Units tab's
            // temperatureUnits choice, and restating it in a three-character slot
            // spends the width on something the user picked once. Off by default —
            // temp slots have never printed a degree sign. Turning it ON while the
            // mode is Both drops the mode back to Temp, the mirror of the hook above;
            // status-lines.js holds the authoritative gate for a blob that predates
            // either. No join: it answers to every mode, not to Both's pair rows.
            Object.assign(unitRow('tempSlotUnit', '12°', '12'),
                { onChange: 'tempUnitExclusive' })])),
        boldSection('Air pressure (hPa)', 'Pressure', null,
            [unitRow('pressureSlotUnit', '1013hPa', '1013')]),
        boldSection('Sunrise/sunset', 'Sun'),
        // The date slot renders TWO different strings, and which one is on screen
        // is the calendar's call, not the slot's (status_row.c format_status_date:
        // calendar views show the day in the grid, so the slot compresses to
        // month + year; no-calendar views carry the full date). One picker per
        // string, each labelled with when it applies. Watch-rendered
        // (SLOT_LIVE_DATE), so the choices ride the Clay message
        // (CLAY_DATE_FORMAT_UINT8) instead of a phone re-bake — no
        // renderSignature entry. Option labels are fixed samples (7 Sep 2026),
        // not today's date: they are format examples, and static strings keep the
        // lists deterministic under test.
        boldSection('Date', 'Date', null, [{
            type: 'radio',
            messageKey: 'dateSlotMonthFormat',
            label: 'Date format with calendar',
            hint: 'Used when a calendar is on screen.',
            defaultValue: 'auto',
            options: [
                ['Sep 2026', 'auto'],
                ['September 2026', 'name'],
                ['09.2026', 'dots'],
                ['09/2026', 'slash'],
                ['2026-09', 'iso']
            ]
        }, {
            type: 'radio',
            messageKey: 'dateSlotFullFormat',
            label: 'Date format without calendar',
            hint: 'Used when no calendar is on screen.',
            defaultValue: 'auto',
            // Sample labels are rendered in the user's effective order, so the
            // list shows exactly what the watch will print (blocks.js).
            optionsFrom: {resolver: 'dateFullFormatOptions'}
        }]),
        boldSection('Calendar week', 'Week'),
        boldSection('City', 'City'),
        // 'd' is a unit like any other here — the countdown reads '5d' today, and
        // dropping it buys a character back on a crowded bar.
        boldSection('Date countdown', 'Countdown', null,
            [unitRow('countdownSlotUnit', '5d', '5')]),
        boldSection('Heart rate', 'Hr', HR_SLOT_WHEN),
        boldSection('Battery percentage', 'BatteryPct'),
        // Dew point shares temperature's degree sign and its reasoning.
        boldSection('Dew point', 'Dew', null, [unitRow('dewSlotUnit', '12°', '12')]),
        // ONE sheet for TWO catalog items: 'phoneBattery' (icon + NN%) and
        // 'phoneBatteryPlain' (NN%, no icon) are separate wire kinds (18/19) so the
        // no-icon variant can't drive City's bold row, but both KINDS entries share
        // key 'PhoneBattery' — and the sheet resolver returns 'thresh' + key
        // (blocks.js statusSlotEditSheet), so both pencils open this sheet and the
        // one mode packs into both cells. Android-only on the slot side; the sheet
        // needs no extra gate, because a slot that can't be chosen never opens it.
        boldSection('Phone battery', 'PhoneBattery')
        // The Alerts tab's sections (alerts-schema.js sheetSections): the eight side lists'
        // hidden items, then the sheets the Alert settings card's rows open, in the card's
        // order. They stay last here though their card is on the Alerts tab: a sheet opens
        // from any tab (renderEditModal), and two of their keys have an earlier copy (vibe
        // and btIcons in aplite's Watch Status Bar). For a key with two items the engine's
        // findItem answers the LAST one in schema order: its onChange (setValue, a text
        // field's commit), its default for a reset (defaultAsStored) and a searchSelect's
        // options. So these sheets' copies own the two keys. The copies agree on both today,
        // so the order binds nothing yet; check findItem's readers before moving the sheets
        // ahead of the other copies.
        // Neither hydrate (every copy writes the same default) nor the save blob's key
        // order (no reader depends on it) is the constraint.
        ].concat(alertsSchema.sheetSections())
    }, {
        id: 'layout', label: 'Layout', sections: [{
            intro: 'How the watchface is arranged, and what a wrist-flick reveals — shown side by side in the preview. What a metric means or how it\'s coloured lives in its own tab.',
            items: [{
                type: 'radio',
                messageKey: 'layoutPreset',
                label: 'Layout preset',
                defaultValue: 'compactCal',
                hintByValue: {
                    fullCal: '3-row calendar. Health and radar appear on wrist-flicks.',
                    compactCal: '2-row calendar. Flick to radar and health as you enable them.',
                    compactDense: 'Compact calendar with two status bars at once — health or radar above the clock, forecast below.',
                    noCal: 'No calendar — a big forecast. Flick to radar and health.',
                    weatherOnly: 'No calendar and no top bar — the rain radar, clock, weather and a big forecast. Flick to health.',
                    custom: 'Build each view yourself — pick its elements and graphs, then order, size and align them.'
                },
                // 'Weather only' draws a different Default view per radar mode
                // (view-cycle.js buildViewCycle: WO_RADAR / WO_RADAR_S / NONE_FC_W /
                // WO_PLAIN), so its hint follows radarMode; the static one above is the
                // Graph text, the default mode's. Every other preset keeps hintByValue.
                // The resolver appends " Flick to health." only while a Health view exists
                // (healthMode status/all on a health watch) — without one the Weather-only
                // cycle is its Default view alone.
                hintFrom: {resolver: 'weatherOnlyHint', args: {byRadar: {
                    graph: 'No calendar and no top bar — the rain radar, clock, weather and a big forecast.',
                    status: 'No calendar and no top bar — the clock, the weather and radar status bars and a big forecast.',
                    countdown: 'No calendar — the top bar, where the rain icon shows by default, then the clock, weather and a big forecast.',
                    off: 'No calendar and no top bar — the clock, weather and a big forecast.'
                }}},
                // Compact-dense only differs from Compact when a health status row OR the
                // radar status row is shown; with both off the two produce identical cycles,
                // so it's hidden then. A stored compactDense lies DORMANT while hidden
                // (dormantValues): the radio displays the compactCal fallback but the
                // stored choice is kept, so it returns when a status row re-enables it —
                // the wire compiles hidden-dense to the identical compactCal cycle, so the
                // watch always matches the display. Order stays constant (compactDense
                // between compactCal and noCal) so toggling health/radar doesn't reshuffle
                // the list. See layoutPresetOptions in blocks.js + engine.resolveRowItem.
                // 'custom' is dormant the same way on aplite (Custom is never offered
                // there; the payload folds it to compactCal, matching the display).
                // Picking custom seeds the per-view keys once (layoutPresetChanged).
                optionsFrom: { resolver: 'layoutPresetOptions' },
                dormantValues: ['compactDense', 'weatherOnly', 'custom'],
                onChange: 'layoutPresetChanged',
                blockBefore: 'layoutPreviewCombined',
                blockBeforeSticky: true
            },
            // The Custom-layout Edit-button row — custom-layout-schema.js.
            customLayout.editRow,
            {
                type: 'toggle',
                messageKey: 'largeGraphFont',
                label: 'Larger graph fonts',
                // ON out of the box: on emery's 200 px screen the taller tier is simply the
                // more readable one at a glance, and it costs no band height (chart.c solves
                // both tiers against the same ink floor). Only a FRESH install -- or an
                // upgrade from before the setting existed, whose missing key seedDefaults
                // backfills -- lands here; a v1.14.0 install already stores its own value,
                // so this is deliberately not migrated.
                defaultValue: true,
                hint: 'Draw the graph axis labels in bigger type.',
                // Emery only: the 200 px screen is the only one with room for a font
                // tier up, and on a 144 px watch the graph left axis is ALREADY drawn
                // at the calendar size (both GOTHIC_18), so there is nothing to step.
                // An unavailable watchInfo leaves env.platform '' and hides the row --
                // fail-closed is right for an emery-only cosmetic toggle.
                showWhen: {env: 'platform', eq: 'emery'}
            }, {
                type: 'toggle',
                messageKey: 'swapClockStatus',
                label: 'Swap clock and status row',
                // ON out of the box: beside the forecast the status row reads as part of the
                // graph, and the clock keeps the top of the screen to itself. Only a FRESH
                // install lands here — an existing one already stores its own value, so this
                // is deliberately not migrated. Still gated to compactCal (showWhen below and
                // view-cycle.js's bake); the other presets ignore it.
                defaultValue: true,
                hint: 'Move the status row below the clock, next to the forecast.',
                // Gated on the preset the radio SHOWS, not merely the stored one: a DORMANT
                // value displays as compactCal (layoutPreset's dormantValues) and compiles
                // as compactCal, swap included (view-cycle.js buildViewCycle, resolvePresetKey).
                // That is a compactDense no status row makes dense — the complement of
                // blocks.js layoutPresetOptions' dense predicate; keep the two in step — and
                // a 'custom' or 'weatherOnly' on aplite, which offers neither.
                showWhen: {any: [
                    {key: 'layoutPreset', eq: 'compactCal'},
                    {all: [{key: 'layoutPreset', eq: 'compactDense'},
                           {key: 'healthMode', in: ['off', 'slot']},
                           {key: 'radarMode', in: ['off', 'countdown']}]},
                    {all: [{key: 'layoutPreset', eq: 'custom'}, {env: 'platform', eq: 'aplite'}]},
                    {all: [{key: 'layoutPreset', eq: 'weatherOnly'}, {env: 'platform', eq: 'aplite'}]}
                ]}
            }, {
                // Last in the section deliberately: the rows above shape what the layout
                // LOOKS like, this one is about when it snaps back. It is also the one row
                // here with no compactCal gate, so ending on it keeps the gated rows
                // together above rather than leaving a hole mid-section when the preset
                // hides them.
                type: 'segmented',
                messageKey: 'viewResetMin',
                label: 'View reset time',
                defaultValue: '2',
                hint: 'Automatically return to the default view after the selected time has passed.',
                options: [['Never', '0'], ['1m', '1'], ['2m', '2'], ['5m', '5'], ['10m', '10']],
                showWhen: {env: 'platform', ne: 'aplite'}
            }]
        },
        // Custom-layout storage (sheetOnly per-view keys) — custom-layout-schema.js.
        customLayout.storageSection,
        {
            // Time and Calendar moved here from the Watch tab (now 'Status slots'):
            // they shape fixed watchface areas, so they read as layout concerns.
            // Items are verbatim — gates and hooks unchanged by the move.
            title: 'Time', items: [{
                type: 'toggle', messageKey: 'timeLeadingZero', label: 'Leading zero', defaultValue: false
            }, {type: 'toggle', messageKey: 'timeShowAmPm', label: 'Show AM / PM', defaultValue: false}, {
                type: 'segmented',
                messageKey: 'axisTimeFormat',
                label: 'Axis time format',
                defaultValue: '24h',
                hint: 'Tip: Settings &gt; Date &amp; Time &gt; Time Format changes the main time format.',
                options: [['12h', '12h'], ['24h', '24h']]
            }, {
                type: 'segmented',
                messageKey: 'timeFont',
                label: 'Main time font',
                defaultValue: 'roboto',
                options: [['Roboto', 'roboto'], ['Leco', 'leco'], ['Bitham', 'bitham']]
            }, {
                type: 'color',
                messageKey: 'colorTime',
                label: 'Main time color',
                defaultValue: 0xFFFFFF,
                capabilities: ['COLOR'],
                showWhen: COLOR_THEME_WHEN
            }]
        }, {
            title: 'Calendar', items: [{
                type: 'segmented',
                messageKey: 'weekStartDay',
                label: 'Start week on',
                defaultValue: 'mon',
                options: [['Sun', 'sun'], ['Mon', 'mon']]
            }, {
                type: 'segmented',
                messageKey: 'firstWeek',
                label: 'First week to display',
                defaultValue: 'prev',
                options: [['Prev', 'prev'], ['Curr', 'curr']]
            }, {
                type: 'color',
                messageKey: 'colorToday',
                label: 'Today highlight',
                defaultValue: 0,
                capabilities: ['COLOR'],
                hint: 'Black (default) means match date color; any other value overrides it.',
                showWhen: COLOR_THEME_WHEN
            }, {
                type: 'color',
                messageKey: 'colorSunday',
                label: 'Sunday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                showWhen: COLOR_THEME_WHEN
            }, {
                type: 'color',
                messageKey: 'colorSaturday',
                label: 'Saturday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                showWhen: COLOR_THEME_WHEN
            }, {type: 'toggle', messageKey: 'holidaysEnabled', label: 'Holiday highlight', defaultValue: true}, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0x0055FF,
                capabilities: ['COLOR'],
                // White is the "no highlight" appearance in dark; the holidaysEnabled
                // toggle owns on/off instead of a special color.
                excludeColors: ['#FFFFFF'],
                joinPrevious: 'loose',
                showWhen: {all: [{key: 'holidaysEnabled', eq: true}, {key: 'theme', eq: 'dark'}]}
            }, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0x0055FF,
                capabilities: ['COLOR'],
                // Black is the "no highlight" appearance in the light theme instead.
                excludeColors: ['#000000'],
                joinPrevious: 'loose',
                showWhen: {all: [{key: 'holidaysEnabled', eq: true}, {key: 'theme', eq: 'light'}]}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayCountry',
                label: 'Country',
                defaultValue: 'DE',
                joinPrevious: true,
                options: holidayData.COUNTRY_OPTIONS,
                showWhen: {key: 'holidaysEnabled', eq: true}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegion',
                label: 'Region',
                defaultValue: 'all',
                joinPrevious: true,
                optionsFrom: {byKey: 'holidayCountry', map: holidayData.REGION_OPTIONS},
                showWhen: {
                    all: [{
                        key: 'holidayCountry',
                        in: Object.keys(holidayData.REGION_OPTIONS)
                    }, {key: 'holidaysEnabled', eq: true}]
                }
            }]
        }]
    }, {
        id: 'more', label: 'More', sections: [{
            title: 'Misc',
            items: [{
                // Page-only, like onboardingDone below: it picks the tab the
                // settings page opens on and never goes near the watch.
                type: 'toggle',
                messageKey: 'startOnWeatherTab',
                label: 'Start on the Weather tab',
                defaultValue: false,
                hint: 'Open this settings page on the Weather tab instead of General.'
            }, {
                type: 'toggle',
                messageKey: 'telemetryEnabled',
                label: 'Share anonymous telemetry',
                defaultValue: true,
                hint: 'Share privacy-respecting weather telemetry to improve reliability and understand usage patterns. Learn more about what gets sent in the <a href="https://github.com/Toasbi/WarnWeather#telemetry">Telemetry section</a>.'
            }, {
                type: 'button',
                label: 'Run setup again',
                action: 'startWizard',
                hint: 'Re-open the first-run setup wizard.'
            }, {
                // Config-UI-only flag: set true when onboarding is finished/skipped so the
                // wizard never auto-opens again. Rides the saved-settings blob (localStorage);
                // NOT a messageKey — never sent to the watch.
                type: 'hidden',
                messageKey: 'onboardingDone',
                defaultValue: false
            }]
        }, {
            title: 'Links', items: [{
                type: 'staticText',
                text: '<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;">' + '<span style="font-size:14.5px;font-weight:600;color:var(--lbl);">Help</span>' + '<a href="https://github.com/Toasbi/WarnWeather/issues">GitHub</a></div>'
            }, {
                type: 'staticText',
                text: '<div style="display:flex;justify-content:space-between;align-items:center;gap:18px;">' + '<span style="font-size:14.5px;font-weight:600;color:var(--lbl);">Support me <3</span>' + '<a href="https://buymeacoffee.com/toaster2"><img alt="Buy me a coffee" style="height:40px;width:auto;display:block;" src="' + BMC_BADGE + '"></a></div>'
            }]
        }, {
            title: 'Advanced', collapsible: true, items: [{
                type: 'segmented',
                messageKey: 'configTheme',
                label: 'Settings Theme',
                defaultValue: 'auto',
                options: [['Auto', 'auto'], ['Light', 'light'], ['Dark', 'dark']],
                hint: 'Auto follows your Pebble app theme. The watchface itself is unaffected.'
            }, {
                type: 'toggle',
                messageKey: 'fetch',
                label: 'Force weather fetch',
                defaultValue: false,
                hint: 'Re-fetch the weather the moment you save.',
                block: 'lastFetch'
            }, {
                type: 'toggle',
                messageKey: 'devStatsEnabled',
                label: 'Enable connection stats',
                defaultValue: false,
                hint: 'Locally records connection events sent to the watch. Events older than 7 days are deleted.'
            }, {
                type: 'toggle',
                messageKey: 'reset',
                label: 'Reset watchface',
                defaultValue: false,
                hint: 'When you save, this erases all settings and cached data and re-runs first-time setup. Your API keys are kept. This cannot be undone.'
            }]
        }, {
            title: 'Connection stats', collapsible: true, block: 'devStats', items: [{
                type: 'toggle',
                messageKey: 'devStatsClear',
                label: 'Clear connection stats',
                defaultValue: false,
                showWhen: {key: 'devStatsEnabled', eq: true}
            }]
        }]
    }]
};
