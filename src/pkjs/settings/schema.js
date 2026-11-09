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
// Bars from [Bottom | Top]: the values, from the module whose reading the wire packs
// (weather/graph-wire.js).
var DRAW_FROM = require('../draw-from.js');
// The forecast's left axis options (emery only): their keys and values.
var FORECAST_AXIS = require('../forecast-axis.js');
// The long time span's whole hours (the Forecast card's intro names the most it shows).
var spanHours = require('../forecast-span-hours.js');
// The keyed sources of the Weather and Radar provider pickers (their names, key sheets and
// key fields): the key sheets are built from it here, and the rows' key-status resolvers
// read it in the page (key-status.js).
var KEY_SOURCES = require('./key-sources.js');
// The custom layout's storage (the per-view keys the screens are written to, in a
// sheetOnly section, and the modes worked out from them) lives in its own module.
var customLayout = require('./custom-layout-schema.js');
// The gates and copy links the schema's modules share (settings/schema-gates.js): the
// named capability and setting gates, the one-pass gateAll, the link that brings a tab to
// the front and the link row a reset rides.
var gates = require('./schema-gates.js');
var HEALTH_SLOT_WHEN = gates.HEALTH_SLOT_WHEN;
var HR_SLOT_WHEN = gates.HR_SLOT_WHEN;
var THRESHOLD_WHEN = gates.THRESHOLD_WHEN;
var ON_DEMAND_WHEN = gates.ON_DEMAND_WHEN;
var BOLD_MASTER_WHEN = gates.BOLD_MASTER_WHEN;
var RADAR_BAR_WHEN = gates.RADAR_BAR_WHEN;
var HEALTH_BAR_WHEN = gates.HEALTH_BAR_WHEN;
var extraBarWhen = gates.extraBarWhen;
var COLOR_THEME_WHEN = gates.COLOR_THEME_WHEN;
var LINE_STYLES_WHEN = gates.LINE_STYLES_WHEN;
var EMERY_WHEN = gates.EMERY_WHEN;
var GRAPH_STYLES_WHEN = gates.GRAPH_STYLES_WHEN;
var gateAll = gates.gateAll;
var tabLink = gates.tabLink;
var linkRow = gates.linkRow;
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
var ON_DEMAND = require('../on-demand.js');
// The longest name a bar, a screen or a graph keeps (screens.js cleanName).
var SCREENS = require('../screens.js');
var NAME_MAX = SCREENS.NAME_MAX;
var ALERT_KINDS = alertsSchema.ALERT_KINDS;
var ALERT_DAYS_OPTIONS = alertsSchema.ALERT_DAYS_OPTIONS;
var BT_ICON_OPTIONS = alertsSchema.BT_ICON_OPTIONS;
var alertCodeOf = alertsSchema.alertCodeOf;
var onDemandPlacedWhen = alertsSchema.onDemandPlacedWhen;
var onDemandRow = alertsSchema.onDemandRow;
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
 * section reachable only through a slot's Edit button, keyed thresh<Stem>, gated on
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

// The nine rows of the Graph colors dialog, each opening its own sheet. The eight metrics
// come first, labelled and ordered exactly like the Main/Second metric pickers offer
// them (forecast-hints.js' FORECAST_METRICS — a user reads the two lists together), then
// the full-height night band. `scope` is line-style.js' vocabulary: a metric id or 'night'.
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
    Boundary: 'Day line'
};
var GRAPH_ROLE_HINTS = {
    Fill: 'Only drawn while this is the Main metric and “Area fill” is on.',
    Night: 'Colors the filled area during the night hours. Until you pick a color here, it uses the fill color.',
    Hatch: 'Only drawn while “Day / night shading” is on.',
    Boundary: 'The line at midnight. Only drawn while “Day / night shading” is on.'
};

/**
 * One graph colour = TWO picker rows on the same label, gated on the theme's polarity
 * so exactly one is ever visible and a Dark <-> Light switch never loses a tuned set
 * (the colorUSFederal idiom below). The default is the CONCRETE built-in from
 * line-style.js, so the picker opens with the colour the graph draws today already
 * highlighted — there is no "Auto" sentinel to name any more.
 * @param {string} scope A metric id or 'night' (line-style.js' graphColorKey vocabulary).
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
 * One row of the Graph colors dialog: label, a preview of the colours behind it, a chevron.
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
var WIND_DIRECTION_HINT = 'Draws an arrow after the speed that points the way the ' +
    'wind is blowing now. No arrow is drawn while Day max shows a peak on its own.';
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
    var tail = prefix === 'temp' ? '.' : ', then shows the reading alone.';
    var hint = 'If the pair doesn\'t fit, the slot drops the spaces first, then switches to ' +
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
    var empty = def === 'slash' ? 'Leave it empty to use the slash'
        : 'Leave it empty to print ' + first + preset.mid + second + preset.end;
    return 'Up to ' + STATUS_PAIR.CUSTOM_MAX_CHARS + ' characters, spaces included. ' +
        empty + '. The watch keeps only the characters its font can draw ' +
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
        more: true,
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
        more: true,
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
        more: true,
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
        more: true,
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
 * The pills' hint explains the SELECTED mode only — Now gets none (dayMaxHints).
 * Now is the default except where the kind's copy names another: wind and gusts
 * ship on Both (fresh installs and a reset; a stored pick is never rewritten, and
 * clay-settings.js upgradeBackfill gives an upgrader without the key Now). AQI closes
 * the Day max and Both hints on its source's note when that source has no forecast
 * to take a peak from: blocks.js dayMaxHint answers the whole hint then, from the
 * row's own hintByValue entry (the engine's args.staticHint).
 * @param {string} prefix Key prefix: 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {{noun: string, notes: ?Object, display: ?string}} copy What the kind
 *     measures, without an article ('UV index'), (AQI only) the source notes:
 *     dayMaxHint closes on byValue[S[key] || fallback] (a leading space; no entry, no
 *     note), null for none, and the Value selection default ('current' when absent).
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
        defaultValue: copy.display || 'current',
        options: [['Now', 'current'], ['Day max', 'max'], ['Both', 'both']]
    };
    if (copy.notes) {
        selection.hintFrom = {resolver: 'dayMaxHint', args: {notes: copy.notes}};
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
            hintByValue: {none: 'Tomorrow\'s peak then looks the same as today\'s.'},
            options: nextDayMarkOptions(),
            joinPrevious: true,
            more: true,
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
        max: 'Shows the highest ' + noun + ' left today while that peak is still ahead or happening '
            + 'now. After it, the slot shows tomorrow\'s peak with Tomorrow\'s peak mark, or the '
            + 'current reading if tomorrow\'s isn\'t known.' + never,
        both: 'Shows the ' + noun + ' now and the highest left today, like ' + sample + ', while that '
            + 'peak is still ahead or happening now. After it, tomorrow\'s peak takes its place '
            + 'with Tomorrow\'s peak mark, or the current reading shows alone if tomorrow\'s isn\'t '
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
        // null for a kind whose unit Setup › Units can change (wind, gusts): naming
        // kph there would read as though this toggle also PICKS the unit, and the
        // engine's only value-dependent hint keys off the item's own value, so the
        // example cannot follow windUnits.
        hint: withUnit
            ? 'Prints the unit after the value: ' + withUnit + ' instead of ' +
                without + '.'
            // Wind and gusts: withUnit drops the unit when it doesn't fit, after the
            // direction arrow's byte is reserved (status-lines.js) — so say when.
            : 'Prints the unit after the value when it fits. In a narrow left or right slot, a pair plus the direction arrow leaves no room for it.'
    };
}
// The Bold row is a SLOT-level setting, not a level one: it closes the slot's own rows
// (last in an alert kind's slot sheet, whose levels live in the kind's alert sheet on
// the Alerts tab; right above a goal kind's Goals group) and says how boldly the
// slot prints. The ladder is monotone — danger is always bold (while the kind's
// highlight is on: a switched-off kind has no level), the middle option adds the
// warn/close level, "Always" adds the normal zone too (status_threshold.h ThreshBold).
// The row stays live while the kind's highlight is off, because "Always" needs no
// levels to mean something; it mutes wholesale only under the Status bars tab's master row
// (BOLD_MASTER_WHEN), which overrides it at pack time. Only the middle option needs a
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
        disabledWhen: BOLD_MASTER_WHEN,
        optionDisabledWhen: {warn: noLevelWhen}
    };
}
// A goal kind's level edit sheet (sheetOnly — opened from a status slot's Edit button,
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
    var bold = boldRow(keyStem, ALERT_VOICE, noLevelWhen);
    // Two cards: the slot's own rows (the kind's display rows, Bold), then Alert
    // highlighting — its switch, and the row that opens the kind's alert dialog, where
    // the levels and colours the highlight uses are set.
    return sheetOf(keyStem, title, (extraItems || []).concat([bold,
        {type: 'subheader', text: 'Alert highlighting'},
        highlightToggle(keyStem), alertLevelsRow(keyStem)]));
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
            'true': 'Fills this slot when the value reaches the danger level, and draws the warn look when it reaches the warn level.'
        },
        defaultValue: false
    };
}
// The five alert kinds' slot dialogs carry this row instead of the levels group, right
// under the 'Alert highlighting' switch: the levels and colors live in ONE place, the
// kind's alert dialog on the Alerts tab, and the row opens it on top of the slot dialog
// (‹ comes back). Its summary is the levels the dialog opens on (blocks.js
// alertLevelsHint, as on the Alerts tab's row). Only where the Alerts exist (aplite has
// neither them nor slot dialogs). A fresh object per call, like every item.
/**
 * @param {string} keyStem Alert kind key stem, e.g. 'Uv'.
 * @returns {Object} The nav row in an alert kind's slot dialog.
 */
function alertLevelsRow(keyStem) {
    return {
        type: 'sheet',
        sheetId: 'alert' + keyStem,
        label: 'Alert levels and colors',
        navNote: 'Alerts',
        hintFrom: {resolver: 'alertLevelsHint', args: {keyStem: keyStem, days: ALERT_DAYS_OPTIONS, levelsOnly: true}},
        showWhen: ON_DEMAND_WHEN
    };
}
// Bold-only edit sheet for a slot kind WITHOUT thresholds (temp, date, city, …):
// the same Edit-button machinery — the contract's KINDS maps the slot code to this
// sheetId — but the Bold row is the sheet's only standing control: no group
// header, no slider, no colors. Two pills only: these kinds have no warn level,
// so the threshold sheets' middle option would promise a trigger that can never
// fire. 'off' (packs 1) and the unset default 'warn' (packs 0) both render
// non-bold on a level-less kind — it resolves THRESH_LEVEL_NORMAL — so the
// options-snapping of an unset store to 'off' is benign. The battery GLYPH item
// deliberately gets NO sheet: its slot draws a glyph, not text, so a Bold option
// would be a no-op lie (no KINDS entry, hence no Edit button either) — the battery
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
        disabledWhen: BOLD_MASTER_WHEN
    };
    // Bold closes the sheet, as it does in the alert kinds' sheets: the rows that
    // shape what the slot shows come first, then how boldly it prints.
    var items = (extraItems || []).concat([bold]);
    return sheetOf(keyStem, title, gateAll(items, gate));
}
// Color swatches (5 intensity bands) — shown only in the Multicolor hint.
var SWATCHES = '<span style="display:inline-flex;gap:7px;margin-top:6px;align-items:flex-end;">' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#AAAAAA;margin-bottom:3px;"></span>0.1</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#55FFFF;margin-bottom:3px;"></span>0.5</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#00FF00;margin-bottom:3px;"></span>2</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FFFF00;margin-bottom:3px;"></span>10</span>' + '<span style="text-align:center;font-size:10px;"><span style="display:block;width:17px;height:8px;border-radius:2px;background:#FF5555;margin-bottom:3px;"></span>40</span>' + '</span>';
// Bar color hint depends on the selected mode (hintByValue): Multicolor shows the swatches; White doesn't.
var MULTICOLOR_HINT = 'Colors each part of a bar by how heavy the rain is:' + SWATCHES;
var WHITE_HINT = 'Shows every bar in a single color.';
// Full-width note between the Bars and Bar color controls (its own staticText) so the prose isn't
// cramped in a control's left column. Color watches only; B/W uses BW_LEGEND.
var SCALE_NOTE = 'The bars don\'t scale linearly. Their height is split into 5 parts, for rain up to 0.1, 0.5, 2, 10 and 40 mm/h, so light drizzle stays visible and heavy rain still has room to grow.';
// B/W watches hide the color picker (no colors to choose), so this stands in for COLOR_LEGEND
// there: text-only, since height is the only encoding (no color steps to show).
var BW_LEGEND = 'The bars don\'t scale linearly. Their height is split into 5 parts, for rain up to 0.1, 0.5, 2, 10 and 40 mm/h.';
// Per-provider "why it's best" note — the picker's hintByValue, so only the selected provider's
// rationale renders. The hinted-row wrap layout flows it around the trigger and gives it the
// full row width below, so the fuller prose no longer needs its own staticText. The short
// tags live in the dropdown option descs; these give the fuller rationale.
var PROVIDER_WHY = {
    dwd: 'Germany\'s national weather service, with the most accurate forecasts in Germany and decent ones across Central Europe (ICON model). No API key needed.',
    metno: 'The service behind yr.no. Best in the Nordics, with a 2.5 km model, and solid worldwide. No API key needed.',
    openmeteo: 'Automatically picks the best national model for your location (DWD, NOAA, Météo-France, ECMWF…). Free, no API key.',
    openweathermap: 'A popular general-purpose API with solid worldwide coverage. Needs a free API key on the One Call 3.0 plan.',
    tomorrowio: 'Minute-by-minute forecasts for your exact location, worldwide, from its own machine-learning models and satellites. Needs a free API key.',
    wunderground: 'A crowd-sourced network of 250,000+ personal weather stations, with many readings close to you. Strongest in the US and Europe. No API key needed.',
    yandex: 'Best across Russia and the CIS, using the Meteum machine-learning forecast. Needs an API key.'
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
// The Weather and Radar providers' keyed sources (settings/key-sources.js), which their
// key sheets are built from. The key-status resolvers on the pickers' rows read the same
// tables in the page by the picker, so the rows' args name at most the picker.
var PROVIDER_KEYS = KEY_SOURCES.provider.sources;
var RADAR_KEYS = KEY_SOURCES.radarProvider.sources;
// The tomorrow.io key + budget guard live in a key sheet of whichever picker actually uses
// the key: Setup's Tomorrow.io sheet (the key row under the Weather provider) while it is
// the WEATHER provider, the Rain radar pane's Tomorrow.io sheet (the key row under the
// Radar provider) while it is radar-only, so the key never sits with the weather
// provider for a non-weather provider. Both sheets hold the same rows
// (TOMORROWIO_KEY_ROWS) under the same messageKeys, gated apart (like the theme color/B&W
// split). The radar-only gate also needs a running radar (as "Rainbow (own key)"'s sheet
// does): with radar off no Tomorrow.io radar call is made and the picker is hidden.
// The weather sheet's gate is the radar source's sharedSheet condition, and the radar-only
// sheet's its negation, so the sheet the key row under the Radar provider opens while
// Tomorrow.io is both is the one shown, and the other is gated off exactly then.
var TOMORROWIO_SHARED = RADAR_KEYS.tomorrowio.sharedSheet;
var TOMORROWIO_WEATHER_WHEN = {key: TOMORROWIO_SHARED.key, eq: TOMORROWIO_SHARED.eq};
var TOMORROWIO_RADAR_ONLY_WHEN = {all: [{key: 'radarProvider', eq: 'tomorrowio'}, {key: 'radarEnabled', ne: false},
    {key: TOMORROWIO_SHARED.key, ne: TOMORROWIO_SHARED.eq}]};
// "Rainbow (own key)" picked for a running radar: its key sheet's gate. The radarEnabled
// clause keeps the sheet closed with the radar off (Setup › Data sources); while it is on, a
// key can go in before a screen uses the radar. The Save dialog asks for the key only while a
// Rainbow call is made (screens-page.js radarKeyAttention).
var RAINBOW_OWN_KEY_WHEN = {all: [{key: 'radarProvider', eq: 'rainbowkey'}, {key: 'radarEnabled', ne: false}]};
// Setup's Rain radar picker: each source's "why", shown with the picked one. Rainbow's
// terms ask for a "Powered by Rainbow.ai" link wherever its data shows, so both Rainbow
// hints end on it. Off says nothing more than its own line ("No rain radar and no rain
// alert"), so it has none.
var RAINBOW_LINK = 'Powered by <a target=\'_blank\' href=\'https://rainbow.ai\'>Rainbow.ai</a>.';
var RADAR_SOURCE_HINTS = {
    dwd: 'Precise weather radar that shows rain at your exact spot and nearby (about 2 km). Germany only.',
    metno: 'Precise weather radar that shows rain at your exact spot. Nordics only.',
    // "Rainbow (limited)": the calls every user shares are the developer's (the
    // rainbow-nowcast proxy caps them at RAINBOW_MONTHLY_BUDGET upstream calls, DEV.md), so
    // the shared radar refreshes at most every 30 minutes. "Rainbow (own key)" lifts it.
    rainbow: 'Refreshes at most every 30 minutes. ' + RAINBOW_LINK,
    // "Rainbow (own key)": the same nowcast on the user's own Rainbow account.
    rainbowkey: 'A worldwide nowcast from satellite and radar data. It uses your own Rainbow key, so it refreshes at '
        + 'every update. A key is free: Rainbow\'s free plan covers 5,000 calls a month. ' + RAINBOW_LINK,
    // Without a key the amber note under the row says what goes missing, so the hint here
    // only says whose key and whose budget.
    tomorrowio: 'A precise rain nowcast from machine-learning models, worldwide. It uses your tomorrow.io API key '
        + 'and counts against that key\'s call budget.'
};
// The radar's on-state rows (its key row and its coverage note) and the picker itself: a
// watch with the radar (not aplite).
var RADAR_ON_WHEN = {all: [{env: 'radar'}, {key: 'radarEnabled', ne: false}]};
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
 * carries (platform-aware default, row dedupe on pick, edit sheet, Edit-button
 * badge, catalog options) — hand-copied twelve times before this helper.
 * @param {string} slotKey Slot messageKey, e.g. 'statusForecastLeft'.
 * @param {string} position 'left' | 'mid' | 'right'.
 * @param {?Object} barWhen The bar's shared visibility gate (null = always).
 * @param {boolean} joins Whether the row joins the previous one (no divider).
 * @returns {Object} Select item.
 */
function slotItem(slotKey, position, barWhen, joins) {
    var labels = {left: 'Left slot', mid: 'Middle slot', right: 'Right slot'};
    var prefix = slotKey.replace(/(Left|Mid|Right)$/, '');
    var bar = ON_DEMAND.PAGE_BARS.filter(function (b) { return b.prefix === prefix; })[0];
    var item = {
        type: 'select',
        messageKey: slotKey,
        label: labels[position],
        // The picker names the bar too, by its name (screens.js barName): it also opens from a
        // tap on the slot in the tab's pinned preview (preview-status-bars.js), away from the
        // bar's card.
        sheetTitle: bar.name + ' · ' + labels[position],
        sheetTitleBy: {resolver: 'barSlotTitle', args: {bar: bar.bar, label: labels[position]}},
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
/**
 * A status bar's dialog (the owner's pick, 2026-11-09): the Status bars tab's Your status bars card
 * lists the bars (screens-page.js barsCard) and a tap on a name opens the bar's dialog
 * (screens.js barSheet). Titled by the bar's name (titleBy: screens.js barName), which the
 * title renames (rename: an OK button stores it; the Watch bar keeps its name); the bar's
 * picture pinned on top with where it shows (block 'barPicture'); then the Slots card, the three
 * slots and the Alerts row, all behind the bar's gate.
 * @param {Object} b The bar's on-demand.js BARS entry.
 * @param {?Object} when The bar's gate (null = always).
 * @param {Array<Object>} [tail] Items after the Alerts row: aplite's Watch bar its icons card, a bar 4
 *   to 6 its Delete status bar (drawn under the Slots card).
 * @returns {Object} Schema section (sheetOnly).
 */
function barDialog(b, when, tail) {
    var sheet = SCREENS.barSheet(b.bar);
    var sec = {
        sheetOnly: true,
        sheetId: sheet,
        id: sheet,
        title: b.name,
        titleBy: {resolver: 'barName', args: {bar: b.bar}},
        pinBlock: 'barPicture',
        items: [{type: 'subheader', text: 'Slots'}].concat(barSlots(b.prefix, when), tail || [])
    };
    // Each bar's name (screens.js THE NAMES): '' for its own, NAME_MAX characters at most, a
    // hidden item of the tab's (barKeysSection). Page-only: never compiled or sent.
    if (b.bar !== 'top') { sec.rename = {key: b.prefix + 'Name', label: 'Status bar name', placeholder: b.name, maxlength: NAME_MAX}; }
    if (when) { sec.showWhen = when; }
    return sec;
}

/**
 * A bar 4 to 6's dialog (Pebble Time 2, made by New status bar): the other bars' dialog, then Delete status bar
 * under its card, as the screen editor's Delete screen (style 'delete', engine buildCards;
 * screens-page.js deleteBar: every screen that shows it drops the row; the Your status bars card's
 * Undo puts it back).
 * @param {Object} b Its on-demand.js BARS entry.
 * @returns {Object} Schema section (sheetOnly).
 */
function extraBarDialog(b) {
    return barDialog(b, extraBarWhen(b.prefix), [{
        type: 'button', style: 'delete', action: 'deleteBar', actionArg: b.bar, label: 'Delete status bar'
    }]);
}

/**
 * The bars' keys with no row of their own: the made flags of bars 4 to 6 (<prefix>Made: New status bar
 * sets one, Delete status bar clears it; the phone reads them, view-cycle.js barMade) and every bar's
 * name but the Watch bar's (<prefix>Name, which a bar's dialog's title renames: screens-page.js
 * barRenamed cleans it). Blob-only: sheetOnly keeps it off the tab.
 * @returns {Object} Schema section (sheetOnly, never opened).
 */
function barKeysSection() {
    return {
        sheetOnly: true,
        sheetId: 'barKeys',
        items: ON_DEMAND.EXTRA_BARS.map(function (b) {
            return {type: 'hidden', messageKey: b.prefix + 'Made', defaultValue: false};
        }).concat(ON_DEMAND.PAGE_BARS.filter(function (b) { return b.bar !== 'top'; }).map(function (b) {
            return {type: 'hidden', messageKey: b.prefix + 'Name', defaultValue: '', onChange: 'barRenamed'};
        }))
    };
}
// The signup link opens in an external browser (target=_blank). The Development > API Keys page 404s on
// tomorrow.io's MOBILE site, so it gets a copy button instead of a (useless-on-mobile) link — users copy
// the URL and open it in desktop-site mode. See copyBtn() + the engine's [data-copy] handler.
var TOMORROWIO_KEY_HINT = '<a target=\'_blank\' href=\'https://app.tomorrow.io/signup\'>Create a free tomorrow.io account</a> (no credit card needed), then open <b>https://app.tomorrow.io/development/keys</b>' + copyBtn('https://app.tomorrow.io/development/keys', 'Copy the API-keys page link') + ', copy your key, paste it here and tap Test. The free plan is enough. See the call budget below.<br><b>IMPORTANT: On a phone, tomorrow.io\'s mobile site shows an error (404) on the API-keys page. Tap the copy button, then open the link in your browser\'s desktop-site mode.</b>';
var TOMORROWIO_BUDGET_HINT = 'Offers only the update intervals that fit the free plan. Turn it off to pick any interval. Tomorrow.io then rejects the calls over the limit until it resets, and the watch keeps its last data.';
// The rows of both Tomorrow.io key sheets, the weather provider's (Setup › Data sources) and
// the radar-only one (Graphs › Rain radar): the key field with its Test button, then the
// budget guard with the call-budget read-out between the two (blockBefore).
// keySheetSection gives each sheet's copies that sheet's gate.
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
var RAINBOW_BUDGET_HINT = 'Offers only the update intervals that fit the free 5,000 calls a month. Turn it off to pick any interval. Rainbow bills calls past 5,000 to your card at $0.10 per 1,000.';

/**
 * A keyed source's key sheet (sheetOnly; the sheet its key-sources.js entry names for
 * it), opened by the key row under its picker ("<Name> API key", keyRow) while that source
 * is picked. It holds everything about the key — the field with its Test button and verdict
 * line, the hint with its links, any budget read-out and guard — so the picker's card
 * carries just that one key row for it. The sheet's title is the source's name, so the key
 * field's label is just "API key". The section and every item share the source's gate:
 * findShownItem picks a key's shown copy by the item's own gate, which keeps the Rain radar
 * pane's radar-only Tomorrow.io sheet apart from the weather provider's.
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
// The Theme & night card's backlight gates. "Dim backlight" is emery-only: env.colorBacklight
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
// ── The restructured page's building blocks ────────────────────────────────────
// Six tabs: Weather · Watchface · Status bars · Alerts · Graphs · Setup. Every item and
// its messageKey, default and gates are the ones the earlier tabs carried; what moved is
// where they render. Hints are the rows' info text (under each row, engine.js), intros
// the cards' and dialogs' (under the header); with Setup › Misc › Hide info text on, both
// sit behind a '?' instead. Rarely-changed rows sit behind each card's "More options"
// (`more: true`).

// The Night hours row and its per-feature twins. In shared mode (the default) ONE
// From–To row stands for the three hour pairs (Dim backlight, Night theme's custom hours,
// Battery saver) and a change to it writes all three (blocks.js nightHoursSync); "Separate
// hours" (a page-only toggle, read off the pairs as the page opens: blocks.js
// nightHoursSeparate) brings back one From–To per feature. Both page-only keys are
// uiOnly: never stored, never sent — the three stored pairs stay the only truth.
var NIGHT_SEPARATE_WHEN = {key: 'nightHoursSeparate', eq: true};
var NIGHT_SHARED_WHEN = {not: NIGHT_SEPARATE_WHEN};
// At least one night feature reads its hours (night-hours.js PAIRS[].inUse): Dim backlight
// on, the Night theme on custom hours, or the Battery saver on. The shared Night hours row
// shows only then — with nothing using it, a pick would land nowhere, and the old page hid
// each feature's hours while it was off.
var NIGHT_IN_USE_WHEN = {any: [BACKLIGHT_ON_WHEN,
    {all: [{env: 'themePolarity'}, {key: 'themeAuto', eq: true}, {key: 'themeAutoMode', eq: 'manual'}]},
    {key: 'sleepNightEnabled', eq: true}]};
var NIGHT_SHARED_ROW_WHEN = {all: [NIGHT_SHARED_WHEN, NIGHT_IN_USE_WHEN]};
// Separate hours means something only where two features have hours to differ in: the
// Night theme (themePolarity) or Dim backlight (colorBacklight) beside the Battery saver.
var NIGHT_SPLITTABLE_WHEN = {any: [{env: 'themePolarity'}, {env: 'colorBacklight'}]};
/**
 * A From–To row's two pickers (an inline group carrying a groupLabel, engine.js
 * renderHoursGroup): the stored start and end hour of one feature.
 * @param {string} startKey The start hour's key.
 * @param {string} endKey The end hour's key.
 * @param {string} startDefault Its default.
 * @param {string} endDefault Its default.
 * @param {Object} when The row's gate.
 * @returns {Object[]} The two items.
 */
function hoursPair(startKey, endKey, startDefault, endDefault, when) {
    var group = startKey + 'Hours';
    return [{
        type: 'select',
        messageKey: startKey,
        label: 'From',
        groupLabel: 'From – To',
        indent: true,
        defaultValue: startDefault,
        options: HOURS,
        inline: group,
        joinPrevious: true,
        showWhen: when
    }, {
        type: 'select',
        messageKey: endKey,
        label: 'To',
        defaultValue: endDefault,
        options: HOURS,
        inline: group,
        showWhen: when
    }];
}

// The tabs' and cards' intros.
// The screens and their switching: aplite has no flick cycle at all (WW_VIEW_CYCLE is
// compiled out), so it keeps one screen and a plain Layout choice.
var VIEW_FLICK_WHEN = {env: 'platform', ne: 'aplite'};
// The forecast's Forecast length row: emery only (platform.js isForecastSpanPlatform, the
// env.forecastSpan fact), hidden on an unknown watch (fail closed: the 640 / 536 B
// inboxes of every other watch cannot take the long span's 68-hour bundle).
var FORECAST_SPAN_WHEN = {env: 'forecastSpan'};
// The owner's text (2026-11-06). The tap is said twice on purpose: the bars' own line under
// them (preview-status-bars.js) and here, because a tap on a picture was not obvious.
var STATUS_INTRO = 'Each status bar has a left, middle and right slot. Tap a slot to change it, or tap a bar’s name for '
    + 'the rest of its settings.';
// "up to 66": a full feed on the whole screen (the Left axis values On graph or Off).
var FORECAST_INTRO = 'The forecast graph shows up to 24 hours ahead. On Pebble Time 2 you can pick 12, 24 or up to '
    + String(spanHours.wholeHours(spanHours.FULL_HOURS, spanHours.SCREEN_W)) + ' hours under Forecast length. '
    + 'Temperature is always drawn, and the metrics and rain bars you pick below are added to it.';
var GRAPH_COLORS_INTRO = 'There is a row for each metric and one for the night shading. Each row keeps '
    + 'separate colors for the Dark and the Light theme.';

// The forecast graph's four lines: each a nav row on the Graphs tab (its metric and
// style as the summary, its line colour as the swatch) opening the line's own dialog.
var GRAPH_LINES = [
    {key: 'secondaryLine', sheetId: 'lineMain', label: 'Main metric'},
    {key: 'thirdLine', sheetId: 'lineSecond', label: 'Second metric'},
    {key: 'fourthLine', sheetId: 'lineThird', label: 'Third metric', gate: LINE_STYLES_WHEN},
    {key: 'fifthLine', sheetId: 'lineFourth', label: 'Fourth metric', gate: LINE_STYLES_WHEN}
];
// The colour sheet of each metric, by its id (the Graph colors dialog's rows).
var GRAPH_COLOR_SHEETS = (function () {
    var out = {};
    GRAPH_COLOR_ROWS.forEach(function (row) { out[row.scope] = {sheetId: row.sheetId, label: row.label}; });
    return out;
}());
/**
 * A line's nav row on the Graphs tab.
 * @param {Object} line A GRAPH_LINES entry.
 * @returns {Object} Schema item.
 */
function lineRow(line) {
    var row = {
        type: 'sheet',
        sheetId: line.sheetId,
        label: line.label,
        hintFrom: {resolver: 'lineSummary', args: {lineKey: line.key, main: line.key === 'secondaryLine'}},
        editBadgeFrom: {resolver: 'lineSwatch', args: {lineKey: line.key}}
    };
    if (line.gate) { row.showWhen = line.gate; }
    return row;
}
/**
 * The row in a line's dialog that opens the colours of the metric the line draws (the
 * Graph colors dialog's sheet for that metric, nested): "Precipitation % colors".
 * @param {string} lineKey The line's picker key.
 * @returns {Object} Schema item.
 */
function lineColorsRow(lineKey) {
    return {
        type: 'sheet',
        label: 'Colors',
        editSheetFrom: {resolver: 'lineColorSheet', args: {messageKey: lineKey, sheets: GRAPH_COLOR_SHEETS}},
        labelFrom: {resolver: 'lineColorLabel', args: {lineKey: lineKey, sheets: GRAPH_COLOR_SHEETS}},
        editBadgeFrom: {resolver: 'lineSwatch', args: {lineKey: lineKey, all: true}},
        capabilities: ['COLOR'],
        showWhen: {all: [COLOR_THEME_WHEN, {key: lineKey, ne: 'off'}]}
    };
}
/**
 * One line's dialog: its metric, style, Draw from, (the Main metric) fill, the scale and
 * Visible values rows its metric has, and its colours — the rows the old Forecast tab
 * stacked under that picker, in that order. The rows stand apart here (their
 * joinPrevious was the four lines' shared card's rhythm), and the graph preview stays
 * pinned above them.
 * @param {Object} line A GRAPH_LINES entry.
 * @param {Object[]} rows The line's rows, picker first.
 * @returns {Object} Schema section (sheetOnly).
 */
function lineSheet(line, rows) {
    var sec = {
        sheetOnly: true,
        sheetId: line.sheetId,
        title: line.label,
        pinBlock: 'forecastPreview',
        items: rows.map(function (item) {
            var copy = Object.assign({}, item);
            delete copy.joinPrevious;
            return copy;
        }).concat([lineColorsRow(line.key)])
    };
    if (line.gate) { sec.showWhen = line.gate; }
    return sec;
}

/**
 * The row under a source picker that opens its API key's dialog (the key-status table's
 * sheet for the picked source, settings/key-sources.js; hidden for a source without a
 * key): "<Name> API key", the key's status as its summary ("Key ••••1234 · ✓ works", or
 * "No key"). The row has no messageKey, so its args name the picker.
 * @param {string} picker The picker's messageKey ('provider' / 'radarProvider').
 * @param {?Object} when The row's gate, or null.
 * @returns {Object} Schema item.
 */
function keyRow(picker, when) {
    var keyArgs = {picker: picker};
    var row = {
        type: 'sheet',
        label: 'API key',
        indent: true,
        editSheetFrom: {resolver: 'keySheet', args: keyArgs},
        labelFrom: {resolver: 'keyRowLabel', args: keyArgs},
        hintFrom: {resolver: 'keyRowSummary', args: keyArgs}
    };
    if (when) { row.showWhen = when; }
    return row;
}

module.exports = {
    appName: 'WarnWeather',
    themeKey: 'configTheme',
    // The Misc card's "Hide info text" (page-only): the engine draws the hints and intros
    // in view while it is off, and behind '?' buttons once it is on.
    infoIconsKey: 'hideInfoText',
    versionLabel: versionLabel + ' <a href="https://github.com/Toasbi/WarnWeather">GitHub source</a>',
    tabs: [{
        // The Weather tab is content, not configuration: live graphs + a
        // 5-day outlook for the active location, fetched by the page itself
        // (weather-tab*.js). DISPLAY-ONLY: its keys are blob-only and never
        // touch the watch's provider/location or any AppMessage.
        // FIRST in the bar, but not what the page opens on: that stays
        // Watchface unless the user asks for this tab in Setup › Misc.
        id: 'weather', label: 'Weather', icon: 'tab-weather', openWhen: {key: 'startOnWeatherTab', eq: true}, sections: [{
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
                hint: 'Used only for this tab’s graphs. The watchface keeps its own provider and location. Providers that need an API key appear once their key is set.'
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
                // A stamp (item.stamp): it never lights Save, and Revert leaves it be.
                type: 'hidden', messageKey: 'weatherTabSeenAt', defaultValue: 0, stamp: true
            }]
        }]
    }, {
        // Watchface — what decides how the face looks: the screens and how the watch switches
        // them, the theme and what changes at night, the time and the calendar. The page opens
        // here. The watch stays pinned at the top while the Screens and Screen switching cards
        // scroll under it; past them it scrolls away with the page (owner, 2026-10-04).
        id: 'watchface', label: 'Watchface', icon: 'tab-watchface', openDefault: true, pinBlock: 'watchPreview', pinBare: true,
        pinThrough: 'screenSwitching', sections: [{
            // The fetch-error notices stay first, above the pinned layout preview: the
            // panel draws nothing until a fetch fails, and then it is the news the page
            // opens on.
            block: 'noticesPanel',
            beforePin: true,
            items: [{
                type: 'hidden',
                messageKey: 'fetchNoticeAck',
                defaultValue: false
            }]
        }, {
            // The screens (screens-page.js): one row per screen, what it shows, a ✕ on each
            // flick screen and "+ Add screen". The pinned watch above draws them and opens
            // each one's editor on a tap (preview-watch.js). aplite has no screens.
            id: 'screens',
            title: 'Screens',
            block: 'screensCard',
            showWhen: VIEW_FLICK_WHEN,
            items: []
        }, {
            // aplite keeps a plain Layout choice: its watch draws one screen, a preset (a
            // stored custom layout or another preset runs as Compact calendar there,
            // view-cycle.js presetKeyFor / resolveViewCycle, and displays as it).
            id: 'layout',
            title: 'Layout',
            showWhen: {env: 'platform', eq: 'aplite'},
            items: [{
                type: 'radio',
                messageKey: 'layoutPreset',
                label: 'Layout',
                defaultValue: 'compactCal',
                hintByValue: {
                    fullCal: 'Shows a calendar with 3 rows.',
                    compactCal: 'Shows a calendar with 2 rows.',
                    noCal: 'No calendar, so the forecast graph is bigger.'
                },
                // The three calendars (screens-page.js apliteLayouts). Derived only so the
                // engine's dormant fallback applies: a stored compactDense, Weather only or
                // custom layout, which aplite runs as Compact calendar (view-cycle.js
                // presetKeyFor), shows as Compact calendar and stays stored.
                optionsFrom: {resolver: 'apliteLayouts'},
                dormantValues: ['compactDense', 'weatherOnly', 'custom']
            }, {
                type: 'toggle',
                messageKey: 'swapClockStatus',
                label: 'Swap clock and status row',
                // ON out of the box: beside the forecast the status row reads as part of the
                // graph, and the clock keeps the top of the screen to itself. Compact
                // calendar only: the radio shows it for a dormant value too.
                defaultValue: true,
                hint: 'Move the status row below the clock, next to the forecast.',
                more: true,
                showWhen: {key: 'layoutPreset', nin: ['fullCal', 'noCal']}
            }]
        }, {
            // How the watch switches screens, once there is a screen to flick to.
            id: 'screenSwitching',
            title: 'Screen switching',
            showWhen: {all: [VIEW_FLICK_WHEN, {when: 'manyScreens'}]},
            items: [{
                type: 'toggle',
                messageKey: 'doubleFlick',
                label: 'Double flick to switch',
                // OFF: one flick switches, as it always has. A fresh install lands here, and
                // an upgrade too (seedDefaults backfills the missing key); off leaves
                // CLAY_VIEW_RESET_MIN's word unchanged, so an upgrade resends nothing.
                defaultValue: false,
                hint: 'Switch only on a second flick within a few seconds of the first.'
            }, {
                type: 'segmented',
                messageKey: 'viewResetMin',
                label: 'Back to Default after',
                defaultValue: '2',
                options: [['Never', '0'], ['1m', '1'], ['2m', '2'], ['5m', '5'], ['10m', '10']]
            }]
        },
        // Custom-layout storage (sheetOnly per-view keys) — custom-layout-schema.js.
        customLayout.storageSection,
        {
            // The theme and everything that changes after dark, in one card. ONE Night hours
            // row drives all three night features (their hours are written together); under
            // More options, Separate hours gives each its own From–To again.
            id: 'themeNight',
            title: 'Theme & night',
            items: [{
                // Doubles as the day theme while Theme switching is on, and the page never
                // calls it that: a row renamed behind the user's back is worse than no name.
                type: 'select',
                messageKey: 'theme',
                label: 'Theme',
                defaultValue: 'dark',
                hintByValue: {
                    dark: 'White text and lines on a black background (the default).',
                    light: 'Black text and lines on a white background. The graph and rain-bar colors are tuned for it.',
                    bw: 'Looks exactly like a Black & White watch: the same colors, drawn the same way.',
                    'bw-light': 'Looks exactly like a Black & White watch in its Light theme: black on white.'
                },
                options: [['Dark', 'dark'], ['Light', 'light'], ['B&W', 'bw'], ['B&W Inverted', 'bw-light']],
                // Always visible and never renamed. `theme` has always doubled as the
                // day theme: with the Night theme on, that row adds the night one and this
                // row keeps its meaning.
                showWhen: {env: 'color'},
                onChange: 'themeConvert',
                // The colours it converts count as defaults, not picks, for More options.
                convertsDefaults: true
            }, {
                type: 'select',
                messageKey: 'theme',
                label: 'Theme',
                defaultValue: 'dark',
                hintByValue: {
                    dark: 'White text and lines on a black background (the default).',
                    light: 'Black text and lines on a white background.'
                },
                options: [['Dark', 'dark'], ['Light', 'light']],
                // aplite compiles the light polarity out (no WW_THEME_POLARITY — the
                // theme sweep pushed the image past the 24 KB launch ceiling), so the
                // picker is hidden there entirely; a choice would be a silent no-op.
                // diorite/flint (also B&W) keep this 2-option slot.
                showWhen: {all: [{not: {env: 'color'}}, {env: 'themePolarity'}]},
                onChange: 'themeConvert',
                convertsDefaults: true
            }, {
                // The shared Night hours: page-only pickers (uiOnly — never stored) that
                // open on the hours the night features already use (night-hours.js
                // nightHoursValue) and write the pairs of the features in use on a pick
                // (nightHoursSync). Shown while one of them is in use.
                type: 'select',
                uiOnly: true,
                messageKey: 'nightHoursFrom',
                label: 'From',
                groupLabel: 'Night hours',
                defaultValue: '0',
                options: HOURS,
                inline: 'nightHours',
                initFrom: {resolver: 'nightHoursValue', args: {end: false}},
                onChange: 'nightHoursSync',
                hint: 'Used by Dim backlight, Night theme and Battery saver.',
                hintFrom: {resolver: 'nightHoursHint'},
                showWhen: NIGHT_SHARED_ROW_WHEN
            }, {
                type: 'select',
                uiOnly: true,
                messageKey: 'nightHoursTo',
                label: 'To',
                defaultValue: '7',
                options: HOURS,
                inline: 'nightHours',
                initFrom: {resolver: 'nightHoursValue', args: {end: true}},
                onChange: 'nightHoursSync',
                showWhen: NIGHT_SHARED_ROW_WHEN
            }, {
                type: 'toggle',
                messageKey: 'backlightDim',
                label: 'Dim backlight',
                defaultValue: true,
                hint: 'Dim the backlight when it comes on between the hours below, so it is easier on your eyes.',
                hintFrom: {resolver: 'nightFeatureHint', args: {
                    shared: 'Dim the backlight when it comes on during Night hours, so it is easier on your eyes.'}},
                onChange: 'nightFeatureOn',
                // "Dim backlight" is emery-only: env.colorBacklight is a fact about the
                // BACKLIGHT (only emery's board carries the RGB LED driver).
                showWhen: BACKLIGHT_WHEN
            }].concat(hoursPair('backlightDimStartHour', 'backlightDimEndHour', '0', '7',
                {all: [BACKLIGHT_ON_WHEN, NIGHT_SEPARATE_WHEN]}), [{
                // The Theme row above doubles as the day theme and is left exactly as the
                // user set it; enabling this only seeds a night theme (theme-flip.js).
                type: 'toggle',
                messageKey: 'themeAuto',
                label: 'Night theme',
                defaultValue: false,
                hint: 'Switch between two themes automatically, at sunrise and sunset or at fixed hours. The phone makes the switch, so it can happen a little late while the watch is disconnected.',
                // themePolarity: aplite has nothing to switch between.
                showWhen: {env: 'themePolarity'},
                // Seeds a night theme on first enable (theme-convert.js), and joins the shared
                // Night hours (night-hours.js).
                onChange: ['themeAutoPreset', 'nightFeatureOn']
            }, {
                // No themeConvert here: the stored colour defaults track the DAY
                // theme's polarity; the night flip converts a scratch copy at send
                // time instead (theme-schedule.js).
                type: 'select',
                messageKey: 'themeNight',
                label: 'Theme at night',
                defaultValue: 'dark',
                options: [['Dark', 'dark'], ['Light', 'light'], ['B&W', 'bw'], ['B&W Inverted', 'bw-light']],
                indent: true,
                joinPrevious: true,
                showWhen: {all: [{env: 'color'}, {key: 'themeAuto', eq: true}]}
            }, {
                type: 'select',
                messageKey: 'themeNight',
                label: 'Theme at night',
                defaultValue: 'dark',
                options: [['Dark', 'dark'], ['Light', 'light']],
                indent: true,
                joinPrevious: true,
                showWhen: {all: [{not: {env: 'color'}}, {env: 'themePolarity'}, {key: 'themeAuto', eq: true}]}
            }, {
                // When the night theme holds. 'manual' is the STORED value for custom
                // hours — relabelled, never renamed: with the shared Night hours it reads
                // "Night hours", with Separate hours "Custom" (its own From–To below).
                type: 'segmented',
                messageKey: 'themeAutoMode',
                label: 'Hours',
                defaultValue: 'sun',
                options: [['Night hours', 'manual'], ['Sunrise/sunset', 'sun']],
                indent: true,
                joinPrevious: true,
                onChange: 'nightFeatureOn',
                showWhen: {all: [{env: 'themePolarity'}, {key: 'themeAuto', eq: true}, NIGHT_SHARED_WHEN]}
            }, {
                type: 'segmented',
                messageKey: 'themeAutoMode',
                label: 'Hours',
                defaultValue: 'sun',
                options: [['Sunrise/sunset', 'sun'], ['Custom', 'manual']],
                indent: true,
                joinPrevious: true,
                onChange: 'nightFeatureOn',
                showWhen: {all: [{env: 'themePolarity'}, {key: 'themeAuto', eq: true}, NIGHT_SEPARATE_WHEN]}
            }].concat(hoursPair('themeAutoStartHour', 'themeAutoEndHour', '20', '7',
                {all: [{env: 'themePolarity'}, {key: 'themeAuto', eq: true}, {key: 'themeAutoMode', eq: 'manual'},
                    NIGHT_SEPARATE_WHEN]}), [{
                // "Sending", not "fetching": with the phone-battery slot the saver
                // also suppresses the status micro-send, so the copy has to describe
                // what it stops, not where the data comes from.
                type: 'toggle',
                messageKey: 'sleepNightEnabled',
                label: 'Battery saver',
                defaultValue: true,
                hint: 'Stop sending updates to your watch between the hours below to save battery.',
                hintFrom: {resolver: 'nightFeatureHint', args: {
                    shared: 'Stop sending updates to your watch during Night hours to save battery.'}},
                onChange: 'nightFeatureOn'
            }].concat(hoursPair('sleepStartHour', 'sleepEndHour', '0', '7',
                {all: [{key: 'sleepNightEnabled', eq: true}, NIGHT_SEPARATE_WHEN]}), [{
                // Page-only (uiOnly): on as the page opens when the night features in use
                // keep different hours (night-hours.js nightHoursSeparate). Off copies the
                // Night hours into the pairs in use; back on before another Night hours
                // pick, they get their own hours back (nightHoursMode).
                type: 'toggle',
                uiOnly: true,
                messageKey: 'nightHoursSeparate',
                label: 'Separate hours',
                defaultValue: false,
                hint: 'Give each feature its own hours.',
                initFrom: {resolver: 'nightHoursSeparate'},
                onChange: 'nightHoursMode',
                more: true,
                showWhen: {all: [NIGHT_SPLITTABLE_WHEN, NIGHT_IN_USE_WHEN]}
            }, {
                // The dim colour opens in its own dialog (three channel sliders); the row
                // shows the colour itself (the badge's chip). A `sheet` row has no
                // messageKey, so `key` is the resolver's only way to know which value it
                // is previewing.
                type: 'sheet',
                sheetId: BACKLIGHT_COLOR_SHEET,
                label: 'Dim backlight color',
                editBadgeFrom: {
                    resolver: 'rgbSwatch',
                    args: {key: 'backlightDimColor', defaultValue: BACKLIGHT_COLOR_DEFAULT}
                },
                more: true,
                showWhen: BACKLIGHT_ON_WHEN
            }])))
        }, {
            // The Dim backlight colour, alone in its dialog — opened by the row above and
            // rendered nowhere else (sheetOnly sections are skipped by the tab renderer
            // while hydrate/serialize still walk them).
            //
            // Gated like the row that opens it: a dialog forced open on a watch whose
            // backlight cannot be tinted — or with Dim backlight switched off — must
            // render empty rather than offer a colour that does nothing.
            sheetOnly: true,
            sheetId: BACKLIGHT_COLOR_SHEET,
            title: 'Dim backlight color',
            showWhen: BACKLIGHT_ON_WHEN,
            intro: 'Pick the color the backlight glows during the hours you set for Dim backlight. Lower values dim it further. Your watch’s own brightness setting still applies on top.',
            items: [{
                // One "r,g,b" string, each channel 0-255 — the LED takes 8 bits per
                // channel. A dim red by default: the driver scales every channel by
                // the watch's own brightness setting, so the value carries the hue
                // AND how deep the dim goes.
                //
                // No label: the dialog's title already names this control.
                type: 'rgb',
                messageKey: 'backlightDimColor',
                defaultValue: BACKLIGHT_COLOR_DEFAULT
            }]
        }, {
            id: 'time',
            title: 'Time', items: [{
                type: 'toggle', messageKey: 'timeLeadingZero', label: 'Leading zero', defaultValue: false
            }, {
                // Each face as the watch draws the time in it (preview-watch.js fontPicture):
                // the pinned preview has scrolled away by this card.
                type: 'radio',
                messageKey: 'timeFont',
                label: 'Clock font',
                defaultValue: 'roboto',
                options: [['Roboto', 'roboto'], ['Leco', 'leco'], ['Bitham', 'bitham']],
                pictureFrom: { resolver: 'timeFontPicture' }
            }, {
                type: 'toggle', messageKey: 'timeShowAmPm', label: 'Show AM / PM', defaultValue: false, more: true
            }, {
                type: 'segmented',
                messageKey: 'axisTimeFormat',
                label: 'Axis time format',
                defaultValue: '24h',
                hint: 'The big clock follows the watch\'s own setting: Settings &gt; Date &amp; Time &gt; Time Format on the watch.',
                options: [['12h', '12h'], ['24h', '24h']],
                more: true
            }, {
                type: 'color',
                messageKey: 'colorTime',
                label: 'Clock color',
                defaultValue: 0xFFFFFF,
                capabilities: ['COLOR'],
                more: true,
                showWhen: COLOR_THEME_WHEN
            }]
        }, {
            id: 'calendar',
            title: 'Calendar', items: [{
                type: 'segmented',
                messageKey: 'weekStartDay',
                label: 'Start week on',
                defaultValue: 'mon',
                options: [['Sun', 'sun'], ['Mon', 'mon']]
            }, {type: 'toggle', messageKey: 'holidaysEnabled', label: 'Holiday highlight', defaultValue: true}, {
                type: 'searchSelect',
                messageKey: 'holidayCountry',
                label: 'Country',
                defaultValue: 'DE',
                indent: true,
                joinPrevious: true,
                options: holidayData.COUNTRY_OPTIONS,
                showWhen: {key: 'holidaysEnabled', eq: true}
            }, {
                type: 'searchSelect',
                messageKey: 'holidayRegion',
                label: 'Region',
                defaultValue: 'all',
                indent: true,
                joinPrevious: true,
                optionsFrom: {byKey: 'holidayCountry', map: holidayData.REGION_OPTIONS},
                showWhen: {
                    all: [{
                        key: 'holidayCountry',
                        in: Object.keys(holidayData.REGION_OPTIONS)
                    }, {key: 'holidaysEnabled', eq: true}]
                }
            }, {
                type: 'segmented',
                messageKey: 'firstWeek',
                label: 'First week to display',
                defaultValue: 'prev',
                options: [['Last week', 'prev'], ['This week', 'curr']],
                more: true
            }, {
                type: 'color',
                messageKey: 'colorToday',
                label: 'Today highlight',
                defaultValue: 0,
                capabilities: ['COLOR'],
                hint: 'Black (the default) uses the date color. Any other color replaces it.',
                more: true,
                showWhen: COLOR_THEME_WHEN
            }, {
                type: 'color',
                messageKey: 'colorSunday',
                label: 'Sunday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                more: true,
                showWhen: COLOR_THEME_WHEN
            }, {
                type: 'color',
                messageKey: 'colorSaturday',
                label: 'Saturday color',
                defaultValue: 0xFF0055,
                capabilities: ['COLOR'],
                more: true,
                showWhen: COLOR_THEME_WHEN
            }, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0x0055FF,
                capabilities: ['COLOR'],
                // White is the "no highlight" appearance in dark; the holidaysEnabled
                // toggle owns on/off instead of a special color.
                excludeColors: ['#FFFFFF'],
                more: true,
                showWhen: {all: [{key: 'holidaysEnabled', eq: true}, {key: 'theme', eq: 'dark'}]}
            }, {
                type: 'color',
                messageKey: 'colorUSFederal',
                label: 'Holiday color',
                defaultValue: 0x0055FF,
                capabilities: ['COLOR'],
                // Black is the "no highlight" appearance in the light theme instead.
                excludeColors: ['#000000'],
                more: true,
                showWhen: {all: [{key: 'holidaysEnabled', eq: true}, {key: 'theme', eq: 'light'}]}
            }]
        }]
    }, {
        // Status bars — only the bars and their slots (the id stays 'watch': links and
        // tests key on it). Where alerts sit at a bar's edges is the Alerts tab's; each
        // bar's Alerts row shows them and opens it. All active bars stay pinned at the top.
        id: 'watch', label: 'Status bars', short: 'Status', icon: 'tab-status', sections: [{
            // Your status bars (screens-page.js barsCard, the owner's pick, 2026-11-09): every bar the
            // watch has, a bar no screen shows too, so any bar can go onto any screen. Each is
            // its name, the screens that show it and its picture, a tap on a slot changing it and
            // a tap on the name opening the bar's dialog (barDialog below); then New status bar.
            id: 'yourBars',
            title: 'Your status bars',
            intro: STATUS_INTRO,
            block: 'barsList',
            items: []
        }, {
            id: 'statusAll',
            title: 'All status bars',
            items: [
                // Master bold switch over EVERY slot kind: 'all' packs each kind's bold
                // cell as always-bold when the threshold blob is built, 'off' as Off
                // (status-wire.js buildSettingsBlob), and both leave the stored per-kind
                // modes untouched — the per-slot Bold rows mute via BOLD_MASTER_WHEN
                // meanwhile. A settings-store key only: it rides the packed blob, never an
                // AppMessage key of its own. Same platform gate as the slot dialogs —
                // aplite compiles the bold machinery out. In view, not under More options
                // (the owner, 2026-11-06), and in the order of the slots' own Bold ladder.
                {
                    type: 'segmented',
                    messageKey: 'statusBoldAll',
                    label: 'Bold values',
                    // The selected option's meaning only; Per slot says where the choice is.
                    // Off is a slot's own Off: the watch prints danger bold in its filled box.
                    hintByValue: {
                        off: 'No slot value prints bold, except at its danger level or a reached goal.',
                        perSlot: 'Each slot’s dialog has its own Bold row.',
                        all: 'Every slot value prints in heavier text.'
                    },
                    defaultValue: 'perSlot',
                    options: [['Off', 'off'], ['Per slot', 'perSlot'], ['All', 'all']],
                    showWhen: THRESHOLD_WHEN
                },
                // The reset reverts every slot AND the bold settings in one tap (blocks.js
                // resetStatusSlots); last under More options (owner, 2026-10-04). Deliberately
                // NOT thresholds-gated: aplite has slots but no bold machinery, and "status
                // bars" stays truthful there either way.
                linkRow('resetStatusSlots', 'Reset status bars to defaults', true)
            ]
        },
        // The bars' dialogs in the page's order (on-demand.js PAGE_BARS): Watch, Forecast,
        // Health, Radar, then bars 4 to 6 (Pebble Time 2) once New status bar made them; on-demand.js
        // BARS, the wire and the keys keep theirs.
        // aplite has no On demand (ON_DEMAND_WHEN): the Watch bar's dialog keeps its fixed
        // battery, quiet-time and Bluetooth rows there, and only there. Everywhere else the
        // Battery, Quiet time and Bluetooth items live on the Alerts tab, and vibe/btIcons in the
        // Bluetooth dialog (the same keys, gated apart).
        barDialog(ON_DEMAND.PAGE_BARS[0], null, gateAll([{type: 'subheader', text: 'Icons and vibration'}, 
                {
                    type: 'toggle', messageKey: 'batteryLowOnly', label: 'Show battery below 10%',
                    defaultValue: true,
                    hint: 'Replaces the top-right slot when your battery drops below 10%.'
                },
                {type: 'toggle', messageKey: 'showQt', label: 'Show quiet time icon', defaultValue: true},
                {
                    // ON out of the box (2.2.0): a lost phone link is the moment the
                    // watch stops updating, and the buzz is the only way to notice it
                    // without looking. Mirrors the Alerts › Bluetooth sheet's copy.
                    type: 'toggle', messageKey: 'vibe', label: 'Vibrate on bluetooth disconnect',
                    defaultValue: true
                },
                {
                    // joinPrevious groups the bluetooth icon select with the vibrate-on-disconnect
                    // toggle above it (no divider between the two bluetooth settings).
                    type: 'select',
                    messageKey: 'btIcons',
                    label: 'Show icon for bluetooth',
                    defaultValue: 'disconnected',
                    joinPrevious: 'loose',
                    options: BT_ICON_OPTIONS
                }
            ], {not: ON_DEMAND_WHEN})),
        barDialog(ON_DEMAND.PAGE_BARS[1], null),
        barDialog(ON_DEMAND.PAGE_BARS[2], HEALTH_BAR_WHEN),
        barDialog(ON_DEMAND.PAGE_BARS[3], RADAR_BAR_WHEN),
        extraBarDialog(ON_DEMAND.PAGE_BARS[4]),
        extraBarDialog(ON_DEMAND.PAGE_BARS[5]),
        extraBarDialog(ON_DEMAND.PAGE_BARS[6]),
        barKeysSection(),
        // Slot dialogs (sheetOnly): reachable only through the Edit button next to a
        // status slot whose selected value has a dialog — never rendered as cards here.
        // Each keeps the bars pinned above it.
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
                    auto: ' Auto mostly reads WAQI, which has no forecast, so the current reading shows.'
                }
            }
        }, '42', '58')),
        alertSlotSheet('Pollen'),
        // Wind and gust each carry their own direction arrow: the two slots often sit
        // side by side, and one arrow drawn twice is noise — so the choice is per kind,
        // not global. The phone bakes the arrow into the slot text (status-lines.js
        // appends a trailing sentinel byte), and both keys ride renderSignature(), so
        // flipping one re-bakes without waiting for the next fetch.
        // Wind, gusts and AQI carry UV's display modes (dayMaxRows), each kind its own.
        // The arrow and the unit follow the Value selection group as rows of their
        // own (with dividers): they answer to every mode, not to Both's pair rows.
        // Wind and gusts ship on Both (now / the day's peak) with no unit: the pair
        // answers the question at a glance and the unit would not leave it room.
        alertSlotSheet('Wind', dayMaxRows('wind', {noun: 'wind', display: 'both'}, '12', '30').concat([{
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
        alertSlotSheet('Gust', dayMaxRows('gust', {noun: 'gusts', display: 'both'}, '20', '45').concat([{
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
        alertSlotSheet('Uv', dayMaxRows('uv', {noun: 'UV index'}, '3', '7')),
        goalSlotSheet('Steps', 'Steps', 'Steps per day.', HEALTH_SLOT_WHEN),
        goalSlotSheet('Sleep', 'Sleep', 'Hours of sleep, e.g. 7.5.', HEALTH_SLOT_WHEN),
        goalSlotSheet('Walked distance', 'Distance', 'Distance walked per day.', HEALTH_SLOT_WHEN),
        // Bold-only dialogs for the level-less slot kinds (one row — plus the display
        // rows a few kinds add above it: Temp's mode and pair, the units, the date
        // formats). Order and labels mirror the contract's KINDS appendix (wire ids
        // 8..19); the battery GLYPH item is deliberately absent — see boldSection.
        // "Temperature slot", not the catalog's "Temperature (actual/feels like)": the
        // parenthetical exists to advertise the choice from the dropdown, and repeating
        // it on the dialog that MAKES the choice is noise.
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
                feels: 'Shows the feels-like temperature, using the formula set under Setup › Units.',
                both: 'Shows the temperature and the feels-like temperature, like 12' +
                    STATUS_PAIR.SEPARATORS[STATUS_PAIR.defaultSeparator('temp')].mid +
                    '10. Order and Separator set how the pair looks.'
            },
            defaultValue: 'actual',
            options: [['Temp', 'actual'], ['Feels like', 'feels'], ['Both', 'both']]
        }, orderRow('temp', [['Temp first', 'actual'], ['Feels like first', 'feels']])]
            .concat(separatorRows('temp', '12', '10'), [
            // The degree sign alone, never °C/°F: the unit is already Setup › Units'
            // temperatureUnits choice, and restating it in a three-character slot
            // spends the width on something the user picked once. Off by default —
            // temp slots have never printed a degree sign. Independent of Value
            // selection (the owner, 2026-10-03): Both puts it on both readings while
            // the pair fits the slot (slot-text.js tempText), so its hint says when.
            Object.assign(unitRow('tempSlotUnit', '12°', '12'), {
                hint: 'Prints the unit after the value: 12° instead of 12. With Both, '
                    + 'each value gets one, like 12°' + STATUS_PAIR.SEPARATORS[
                        STATUS_PAIR.defaultSeparator('temp')].mid + '10°, if the pair '
                    + 'fits the slot. It always fits in the middle slot. In a left or right '
                    + 'slot, only short pairs like 8°' + STATUS_PAIR.SEPARATORS[
                        STATUS_PAIR.defaultSeparator('temp')].mid + '6° fit.'
            })])),
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
        // ONE dialog for TWO catalog items: 'phoneBattery' (icon + NN%) and
        // 'phoneBatteryPlain' (NN%, no icon) are separate wire kinds (18/19) so the
        // no-icon variant can't drive City's bold row, but both KINDS entries share
        // key 'PhoneBattery' — and the sheet resolver returns 'thresh' + key
        // (blocks.js statusSlotEditSheet), so both Edit buttons open this dialog and the
        // one mode packs into both cells. Android-only on the slot side; the dialog
        // needs no extra gate, because a slot that can't be chosen never opens it.
        boldSection('Phone battery', 'PhoneBattery')
        ].map(function (sec) {
            // Every slot dialog keeps the bars pinned above its rows: the bar it was opened
            // from, a bar's dialog (preview-status-bars.js statusBarsPreview). The bars' own
            // dialogs pin their bar (barDialog).
            if (sec.sheetOnly && !sec.pinBlock) { sec.pinBlock = 'statusBarsPreview'; }
            return sec;
        })
    }, {
        // Alerts — one tab owns every alert: when it fires, how it looks, and which bar
        // edge shows it. Every row opens its alert's dialog, which leads with its Shows on
        // card (per bar, Left or Right). aplite has no Alerts (ON_DEMAND_WHEN), so the
        // whole tab is env-hidden there.
        // The tab's cards and the dialogs behind them (alerts-schema.js): About alerts with
        // its reset, System info and Weather alerts, then the eight side lists' hidden
        // items and the alert dialogs, in the tab's order — Battery, Bluetooth, Quiet time,
        // Sleep, rain, then one per metric alert kind holding its Shows on grid, levels,
        // Look and Days (the levels' one home). Two of their keys have an earlier copy
        // (vibe and btIcons in aplite's Watch Status Bar, on the Status bars tab). For a
        // key with two items the engine's findItem answers the LAST one in schema order:
        // its onChange (setValue, a text field's commit), its default for a reset
        // (defaultAsStored) and a searchSelect's options. So these dialogs' copies own the
        // two keys. The copies agree on both today, so the order binds nothing yet; check
        // findItem's readers before moving this tab ahead of the Status bars tab.
        id: 'alerts', label: 'Alerts', icon: 'tab-alerts', showWhen: ON_DEMAND_WHEN,
        sections: alertsSchema.cardSections().concat(alertsSchema.sheetSections())
    }, {
        // Graphs — the forecast graph, the rain radar and the health graph behind one
        // switch, the matching live preview pinned under it. Every graph dialog repeats
        // the preview at its top so colour and style edits show as they are made.
        id: 'graphs', label: 'Graphs', icon: 'tab-graphs', panes: [
            {id: 'forecast', label: 'Forecast', pinBlock: 'forecastPreview'},
            // aplite compiles the rain-radar view out (WW_RAIN_RADAR undefined).
            {id: 'radar', label: 'Rain radar', pinBlock: 'radarPreview', showWhen: {env: 'radar'}},
            // The health graph's one setting is the heart-rate line's scale: only the
            // heart-rate watches have one (platform.js HR_PLATFORMS).
            {id: 'health', label: 'Health', pinBlock: 'healthPreview', showWhen: {all: [{env: 'health'}, {env: 'hr'}]}}
        ], sections: [{
            // The Your graphs card (Pebble Time 2; settings/graph-styles-page.js, where a graph is
            // a graph style): a row per graph, the picked one the graph the preview and every card
            // below show (the page swaps its values into the flat keys while the pane shows it),
            // its name renamed in place; New graph, the screens it shows on, and Delete under the
            // card. The pick is a page-only key the rows set (no row of its own). Under the pane
            // switcher, above the pinned preview (abovePin), so it scrolls away with the switcher.
            pane: 'forecast',
            id: 'graphStyle',
            title: 'Your graphs',
            abovePin: true,
            showWhen: GRAPH_STYLES_WHEN,
            items: [{
                type: 'hidden',
                messageKey: 'graphStylePick',
                uiOnly: true,
                defaultValue: '1',
                initFrom: {resolver: 'graphStyleOnOpen'}
            }, {
                // Delete <the picked graph>, any but the first, under the card as the screen
                // editor's Delete screen (style 'delete', engine buildCards); the card's Undo puts
                // it back (graph-styles-page.js deletePicked).
                type: 'button',
                style: 'delete',
                action: 'deleteGraphStyle',
                label: 'Delete graph',
                labelFrom: {resolver: 'graphDeleteLabel'},
                showWhen: {when: 'graphDeletable'}
            }],
            block: 'graphStyleCards'
        }, {
            pane: 'forecast',
            id: 'lines',
            title: 'Lines',
            intro: FORECAST_INTRO,
            items: GRAPH_LINES.map(lineRow)
        }, {
            pane: 'forecast',
            id: 'bars',
            title: 'Rain bars',
            items: [{
                type: 'segmented',
                messageKey: 'barSource',
                label: 'Bars',
                defaultValue: 'rain',
                hintByValue: {rain: 'Adds bars that show how much rain falls in each hour.'},
                // With the bars on, the scale note (colour) or the B&W legend joins the
                // hint (blocks.js colorNoteHint).
                hintFrom: {resolver: 'colorNoteHint', args: {colorNote: SCALE_NOTE, bwNote: BW_LEGEND}},
                options: [['Rain', 'rain'], ['Off', 'off']]
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
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                capabilities: ['COLOR'],
                // VALUE stays 'white' for wire compatibility (the watch resolves it to the
                // right polarity color itself — see rain-tier.js); only the label changes.
                options: [['Multicolor', 'multicolor'], ['Solid', 'white']],
                more: true,
                showWhen: {all: [{key: 'barSource', eq: 'rain'}, COLOR_THEME_WHEN]}
            }, {
                // Bars from [Bottom | Top] (draw-from.js rainBarFrom): while the bars are
                // drawn, on a watch with line styles (the WW_LINE_STYLE mirror the watch's
                // flip sits behind; aplite never hangs them).
                type: 'segmented',
                messageKey: 'rainBarFrom',
                label: 'Bars from',
                defaultValue: DRAW_FROM.BOTTOM,
                hintByValue: {top: BARS_TOP_HINT},
                options: [['Bottom', DRAW_FROM.BOTTOM], ['Top', DRAW_FROM.TOP]],
                more: true,
                showWhen: {all: [{key: 'barSource', eq: 'rain'}, LINE_STYLES_WHEN]}
            }]
        }, {
            // Other: the graph-wide rows that belong to no line and no bars. Every watch shows
            // the card (the shading is everywhere); Forecast length is emery's alone.
            //
            // Forecast length (emery only): how many hours the forecast graph looks ahead. The phone
            // fetches and sends 14, 24 (26 with no left axis) or 68 hourly points
            // (src/pkjs/forecast-span.js); the watch's grid follows the count it receives and
            // fills the plot's width, so the hours on screen follow the layout
            // (src/c/appendix/forecast_span.h). '48' is the long span's stored token. Its label
            // names the whole hours the watch will show for the picked weather provider and the
            // layout (forecastSpanOptions, src/pkjs/forecast-span-hours.js spanOptions); the
            // stored value never moves.
            // The default is the long span, a new install's; setup starts a new install on the
            // Clean look, which takes it too (settings/wizard-forecast.js FIRST_RUN; the
            // defaults are none of the looks on emery). An existing install without the key
            // keeps the 24 h it had (clay-settings.js upgradeBackfill), and an absent value still
            // reads 24 h (forecast-span-hours.js storedHours).
            // Every other watch keeps 24 h, whatever the key holds: the 640 B / 536 B inboxes
            // cannot take the long span's 68-hour bundle and the 64 KB images have no room. A
            // changed span re-fetches (render-signature.js). Not `more`: the span frames the
            // whole graph.
            pane: 'forecast',
            id: 'other',
            title: 'Other',
            items: [{
                type: 'toggle',
                messageKey: 'dayNightShading',
                label: 'Day / night shading',
                defaultValue: true,
                hint: 'Hatches the hours between sunset and sunrise and draws a line at midnight.',
                // On a colour theme the hint also says where the colours are set.
                hintFrom: {resolver: 'colorNoteHint', args: {
                    colorNote: 'Set their colors under Graph colors › Night shading. '
                        + 'A color that matches the background hides it.'
                }}
            }, {
                type: 'segmented',
                messageKey: 'forecastHours',
                label: 'Forecast length',
                defaultValue: '48',
                hintByValue: {
                    '12': 'The next 12 hours, in wider columns.',
                    '24': 'The next 24 hours.',
                    '48': 'As many hours as your weather provider\'s hourly forecast covers and the '
                        + 'graph can fit, in narrow columns. The number of hours depends on the provider '
                        + 'and the graph\'s layout.'
                },
                optionsFrom: {resolver: 'forecastSpanOptions'},
                showWhen: FORECAST_SPAN_WHEN
            }]
        }, {
            // Left axis, emery only (owner, 2026-10-09): where the high / low values go
            // (On axis: beside the axis line on the left, today's look; On graph: the high one
            // under its point, the low one over its own; Off: none; the last two draw no left
            // axis at all, so the graph starts at the screen's left edge) and whether they name
            // the whole temperature scale. The axis line and the numbers' outline follow the place (the 2.2.0 betas
            // had a row each; a beta's stored 'beside' reads as 'axis', the default).
            // src/pkjs/forecast-axis.js is the one reading (wire bits on the
            // CLAY_LARGE_GRAPH_FONT word, the scale bake, the 24 h span's 26 hours, the
            // preview); the watch's rules live in src/c/appendix/temp_axis_pad.h (THE NUMBERS
            // ON THE GRAPH) and forecast_layer.c. The scale is `more`: its card opens by itself
            // when it differs from its default. A dormant scale (the
            // numbers off, or no feels-like / dew point line) is kept and sent as the default,
            // so it never costs a resend. At 24 h, moving the numbers between On axis and the
            // other two re-fetches: the hours sent follow (forecast-span.js hours()).
            pane: 'forecast',
            id: 'axis',
            title: 'Left axis',
            showWhen: EMERY_WHEN,
            items: [{
                type: 'segmented',
                messageKey: FORECAST_AXIS.KEYS.numbers,
                label: 'Left axis values',
                // On graph out of the box since 2.6 (2.6's Clean graph; setup's Clean
                // look keeps it). An existing install that lacks the key keeps its axis
                // (clay-settings.js upgradeBackfill).
                defaultValue: FORECAST_AXIS.GRAPH,
                options: [['On axis', FORECAST_AXIS.AXIS], ['On graph', FORECAST_AXIS.GRAPH],
                    ['Off', FORECAST_AXIS.OFF]],
                hintByValue: {
                    graph: 'Removes the left axis and draws the high and low values on the graph.',
                    off: 'Removes the left axis and the high and low values.'
                },
                showWhen: EMERY_WHEN
            }, {
                // Gated on a drawn feels-like or dew point line (when-resolvers.js
                // tempAxisLineDrawn): without one the scale is the air temperature's own.
                // Changes what the phone bakes into TEMP_MIN / TEMP_MAX, so a flip re-fetches
                // (render-signature.js).
                type: 'toggle',
                messageKey: FORECAST_AXIS.KEYS.scale,
                label: 'High/low includes feels-like & dew point',
                defaultValue: false,
                hint: 'The high and low values come from all temperature lines on the graph, not '
                    + 'only the air temperature.',
                more: true,
                showWhen: {all: [EMERY_WHEN, {key: FORECAST_AXIS.KEYS.numbers, ne: FORECAST_AXIS.OFF},
                    {when: 'tempAxisLineDrawn'}]}
            }, {
                type: 'toggle',
                messageKey: 'largeGraphFont',
                label: 'Larger graph fonts',
                // ON out of the box: on emery's 200 px screen the taller tier is simply the
                // more readable one at a glance, and it costs no band height (chart.c solves
                // both tiers against the same ink floor). Only a FRESH install -- or an
                // upgrade from before the setting existed, whose missing key seedDefaults
                // backfills -- lands here; a v1.14.0 install already stores its own value.
                defaultValue: true,
                hint: 'Draw the graph axis labels in bigger type.',
                more: true,
                // Emery only (the card's gate): on a 144 px watch the graph's left axis is
                // already drawn at the calendar size, so there is nothing to step.
                showWhen: {env: 'platform', eq: 'emery'}
            }]
        }, {
            // The Graph colors row, a card of its own: one dialog holding one row per graph
            // metric plus the night band, each opening that row's colours. B&W watches and
            // themes have no colours to pick, so the card is gone there.
            pane: 'forecast',
            id: 'graphColorsCard',
            capabilities: ['COLOR'],
            showWhen: COLOR_THEME_WHEN,
            items: [{
                type: 'sheet',
                sheetId: 'graphColors',
                label: 'Graph colors',
                hint: 'Pick the colors of each metric and of the night shading.',
                navNote: String(GRAPH_COLOR_ROWS.length),
                capabilities: ['COLOR']
            }]
        }, {
            sheetOnly: true,
            sheetId: 'graphColors',
            title: 'Graph colors',
            capabilities: ['COLOR'],
            showWhen: COLOR_THEME_WHEN,
            intro: GRAPH_COLORS_INTRO,
            pinBlock: 'forecastPreview',
            items: GRAPH_COLOR_ROWS.map(function (row) {
                return graphColorRow(row, false);
            }).concat([linkRow('resetAllGraphColors', 'Reset graph colors to defaults')])
        }, {
            // Graph styles 2 and 3 (Pebble Time 2): their names and their values of the keys a
            // style holds, one JSON string (src/pkjs/graph-styles.js parse). The flat keys are the
            // first style, so an install without the key has one style and nothing migrates.
            // Blob-only: sheetOnly keeps it off the tab; it hydrates and serializes with the blob.
            // With it the two page-only pickers that have no row of their own: New graph, which
            // draws its templates and graphs (pictureFrom; the card's New graph opens its sheet, a
            // pick makes the graph), and the screen editor's graph, a plain list of your graphs
            // and a copy of the screen's (screens-page.js opens it over the editor; the owner's,
            // 2026-11-09). Their '' and stale values are dormant, so the sheets open with nothing
            // ticked.
            sheetOnly: true,
            sheetId: 'graphStyleKeys',
            title: 'Graph styles',
            items: [{type: 'hidden', messageKey: 'graphStyles', defaultValue: ''}, {
                type: 'select',
                messageKey: 'graphStyleNewFrom',
                uiOnly: true,
                label: 'New graph',
                sheetTitle: 'New graph',
                sheetLead: 'Start from a template. You get your own copy, and the template stays as it is.',
                defaultValue: '',
                dormantValues: [''],
                optionsFrom: {resolver: 'graphStyleStarts'},
                pictureFrom: {resolver: 'graphStylePicture'},
                onChange: 'graphStyleCreate'
            }, {
                type: 'select',
                messageKey: 'screenGraphStyle',
                uiOnly: true,
                label: 'Graph',
                sheetTitle: 'Graph on this screen',
                sheetLead: 'Pick the graph this screen shows. To start one from a template, use New graph on the Graphs tab.',
                defaultValue: '1',
                optionsFrom: {resolver: 'graphStyleOptions', args: {screen: true}},
                onChange: 'screenGraphStylePicked'
            }]
        }].concat(GRAPH_COLOR_ROWS.map(function (row) {
            var sheet = graphColorSheet(row);
            sheet.pinBlock = 'forecastPreview';
            return sheet;
        }), [
            // The four lines' dialogs: each picker with the rows the old Forecast tab
            // stacked under it (style, Draw from, fill, scales, Visible values).
            lineSheet(GRAPH_LINES[0], [{
                type: 'select',
                messageKey: 'secondaryLine',
                label: 'Metric',
                defaultValue: 'precip_prob',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {key: 'secondaryLine'}},
                onChange: 'forecastMetricFill'
            },
            lineStyleCopy('secondaryLine')
            ].concat(lineFromCopies('secondaryLine'), [{
                type: 'toggle',
                messageKey: 'secondaryLineFill',
                // Direction-neutral: with Draw from on Top the fill hangs with its line.
                label: 'Area fill',
                defaultValue: true,
                // Feels-like and dew point ride the temperature axis rather than a 0..max
                // scale, so "below the line" is not the area between the curve and a
                // meaningful zero — a fill there would flood the plot up to an arbitrary
                // band floor. The row is hidden for it and the 'forecastMetricFill' hook
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
            lineShowCopy('secondaryLine', 'uv')])),
            lineSheet(GRAPH_LINES[1], [{
                type: 'select',
                messageKey: 'thirdLine',
                label: 'Metric',
                // Off out of the box since 2.6 (2.6's Clean graph: the rain chance alone; on
                // emery setup then starts a new install on Clean's cloud stripe). An
                // existing install that lacks the key keeps its UV dots (clay-settings.js
                // upgradeBackfill).
                defaultValue: 'off',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {key: 'thirdLine', off: true, exclude: ['secondaryLine']}}
            },
            lineStyleCopy('thirdLine', true)
            ].concat(lineFromCopies('thirdLine'), [
            windScaleCopy('thirdLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('thirdLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('thirdLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('thirdLine'),
            lineShowCopy('thirdLine', 'wind'),
            lineShowCopy('thirdLine', 'gust'),
            lineShowCopy('thirdLine', 'uv')])),
            lineSheet(GRAPH_LINES[2], [{
                type: 'select',
                messageKey: 'fourthLine',
                label: 'Metric',
                defaultValue: 'off',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {key: 'fourthLine', off: true,
                    exclude: ['secondaryLine', 'thirdLine']}},
                // Only watches with enough memory carry a third metric line
                // (LINE_STYLES_WHEN — the WW_LINE_STYLE mirror, fail-open for
                // an unknown platform). Row-level hiding, not option-gating,
                // so the stored value is never display-snapped away on a
                // watch that lacks the line.
                showWhen: LINE_STYLES_WHEN
            },
            lineStyleCopy('fourthLine', true)
            ].concat(lineFromCopies('fourthLine'), [
            windScaleCopy('fourthLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('fourthLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('fourthLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('fourthLine'),
            lineShowCopy('fourthLine', 'wind'),
            lineShowCopy('fourthLine', 'gust'),
            lineShowCopy('fourthLine', 'uv')])),
            lineSheet(GRAPH_LINES[3], [{
                type: 'select',
                messageKey: 'fifthLine',
                label: 'Metric',
                defaultValue: 'off',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {key: 'fifthLine', off: true,
                    exclude: ['secondaryLine', 'thirdLine', 'fourthLine']}},
                // Same row-level gate as the third metric (WW_LINE_STYLE mirror).
                showWhen: LINE_STYLES_WHEN
            },
            lineStyleCopy('fifthLine', true)
            ].concat(lineFromCopies('fifthLine'), [
            windScaleCopy('fifthLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('fifthLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('fifthLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('fifthLine'),
            lineShowCopy('fifthLine', 'wind'),
            lineShowCopy('fifthLine', 'gust'),
            lineShowCopy('fifthLine', 'uv')])),
            {
            // ── Rain radar pane ──
            pane: 'radar',
            id: 'radar',
            showWhen: {env: 'radar'},
            items: [{
                // With the radar off there is nothing to set up here: say where it goes back
                // on (its source lives in Setup › Data sources).
                type: 'staticText',
                style: 'info',
                text: 'The rain radar is off. Turn it on in ' + tabLink('setup', 'Setup › Data sources') + '.',
                showWhen: {key: 'radarEnabled', eq: false}
            }, {
                // On, but no screen shows the rain radar: its look has nothing to show yet.
                type: 'staticText',
                style: 'info',
                text: 'No screen shows the rain radar. Add it to a screen on the '
                    + tabLink('watchface', 'Watchface tab') + '.',
                showWhen: {all: [{key: 'radarEnabled', ne: false}, {key: 'radarMode', ne: 'graph'}]}
            }, {
                // The rain radar's Off, kept apart from its source (2.6): off, the phone fetches
                // no radar and radarProvider stays the source a turn back on restores. radarMode
                // follows the screens and this (screens.js deriveModes); the 2.6 migration sets it
                // from the radarMode an install had (migrations/screens.js).
                type: 'hidden',
                messageKey: 'radarEnabled',
                defaultValue: true
            }, {
                // The rain radar's source, stored on its own: Setup's Rain radar picker
                // (radarSource, page-only) writes it, and Off leaves it as it is.
                type: 'hidden',
                messageKey: 'radarProvider',
                defaultValue: 'rainbow'
            }, {
                type: 'segmented',
                messageKey: 'radarColor',
                label: 'Radar color',
                // Dark-polarity default; light starts on Solid (resolve-ink.js's
                // barColorDefault). See rainBarColor above.
                defaultValue: 'multicolor',
                hintByValue: {multicolor: MULTICOLOR_HINT, white: WHITE_HINT},
                // The bar-scale note follows the colour's own words (the engine hands the
                // resolver the hintByValue entry as args.staticHint).
                hintFrom: {resolver: 'radarColorHint', args: {note: SCALE_NOTE}},
                capabilities: ['COLOR'],
                // VALUE stays 'white' for wire compatibility (the watch resolves it to the
                // right polarity color itself — see rain-tier.js); only the label changes.
                options: [['Multicolor', 'multicolor'], ['Solid', 'white']],
                showWhen: {all: [{key: 'radarMode', eq: 'graph'}, COLOR_THEME_WHEN]}
            }, {
                // B&W watches and themes have no Radar color row: the legend stands alone.
                type: 'staticText',
                text: BW_LEGEND,
                hinted: true,
                showWhen: {all: [
                    {not: {all: [{env: 'color'}, COLOR_THEME_WHEN]}},
                    {key: 'radarMode', eq: 'graph'}
                ]}
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
                hint: 'Two thin stripes under the radar\'s time axis show the next two hours, one cell per quarter hour.<br>The top stripe shows clouds: a full stripe means overcast. Thin high cloud, which the sun shines through, counts half.<br>The bottom stripe shows sun: a full stripe means sunshine as strong as on a clear day at that time of day, so a low morning sun can be full too.<br>Thin cloud can let the sun through, so both stripes can show at once. A bolt marks expected thunderstorms. This data comes from Open-Meteo, whatever the radar source.',
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
                hint: 'Shown in the radar graph when no rain is coming. The default is “You\'re good :)”. Up to 24 characters. Leave it empty to show nothing.',
                showWhen: {key: 'radarMode', eq: 'graph'}
            }, {
                // Bars from [Bottom | Top] (draw-from.js radarBarFrom): the radar graph's
                // rain bars, the exact spot's and DWD's nearby-area ones together, hang
                // under the time axis (and under the sky rows). Only the graph draws bars;
                // LINE_STYLES_WHEN states the watch side's WW_LINE_STYLE dependency.
                type: 'segmented',
                messageKey: 'radarBarFrom',
                label: 'Bars from',
                defaultValue: DRAW_FROM.BOTTOM,
                hintByValue: {top: BARS_TOP_HINT},
                options: [['Bottom', DRAW_FROM.BOTTOM], ['Top', DRAW_FROM.TOP]],
                more: true,
                showWhen: {all: [{key: 'radarMode', eq: 'graph'}, LINE_STYLES_WHEN]}
            }]
            // The rain alert's time window (rainCountdownHorizon) used to close this
            // section; it is set in the Rain alert dialog (Alerts › Rain) alone.
        },
        {
            // ── Health pane ── the heart-rate line's scale (the health graph's one setting).
            pane: 'health',
            id: 'healthGraph',
            showWhen: {env: 'health'},
            items: [{
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
                hint: 'Sets the top and bottom of the heart-rate line in the health graph. '
                    + 'A narrower range makes small changes visible. Hours outside the range '
                    + 'are drawn as dots on the edge.',
                // The HR line lives only in the graph ('all'), and only emery/diorite
                // have a sensor (platform.js HR_PLATFORMS) — on anything else the line
                // is permanently absent, so a scale for it would be inert.
                showWhen: {all: [{env: 'hr'}, {key: 'healthMode', eq: 'all'}]}
            }, {
                type: 'staticText',
                style: 'info',
                text: 'The heart-rate line is part of the health graph. Add the Health graph to a screen on the '
                    + tabLink('watchface', 'Watchface tab') + '.',
                showWhen: {all: [{env: 'hr'}, {key: 'healthMode', ne: 'all'}]}
            }]
        }])
    }, {
        // Setup — what is set once: location, the data sources, units, and the Misc and
        // Advanced items.
        id: 'setup', label: 'Setup', icon: 'tab-setup', sections: [{
            id: 'location',
            title: 'Location',
            items: [{
                type: 'segmented', messageKey: 'locationMode', label: 'Location', defaultValue: 'gps', hintByValue: {
                    gps: 'Finds your location automatically with the phone\'s GPS.', manual: 'Enter a city or address below.'
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
                optionsFrom: {interval: 'fetchIntervalMin', ladder: [30, 60, 120, 360, 720, 1440]},
                more: true,
                showWhen: {key: 'locationMode', eq: 'gps'},
                hint: 'Sets how long a GPS position is reused before the phone gets a new one. Longer saves battery; shorter keeps your location up to date when you move. The shortest option matches your update interval.'
            }]
        }, {
            // Where the data comes from: the weather, the rain radar, the air quality, and how
            // often the phone asks.
            id: 'dataSources',
            title: 'Data sources',
            items: [{
                type: 'select',
                messageKey: 'provider',
                label: 'Weather',
                defaultValue: 'wunderground',
                onChange: 'clearPollenForProvider',
                // Flags the country-matched option "(Recommended)" (DE→DWD, Nordics→Met.no, else→Open-Meteo),
                // reading the same country→provider map the wizard uses. See blocks.js recommend resolvers.
                recommendFrom: 'recommendedWeatherProvider',
                // Options are alphabetical by name. The 3rd tuple slot's desc is the short "what it's
                // best at" tag shown under each name in the dropdown; the selected provider's fuller
                // rationale is the row's info text (PROVIDER_WHY).
                // DWD carries a `short` so the trigger reads "DWD" while the list keeps the full name.
                hintByValue: PROVIDER_WHY,
                // A provider that needs a key gets its key row under this one (keyRow), which
                // opens its key dialog — the key field, its Test, the links and any budget
                // guard live there. A key that is missing or known to be rejected puts a dot
                // on this tab and a dialog in front of Save ("Add key" / "Save anyway"). The
                // missing-key note is the staticText right below.
                attentionFrom: {resolver: 'keyAttention'},
                options: [
                    ['Deutscher Wetterdienst', 'dwd', {desc: 'Best in Germany · no key', short: 'DWD'}],
                    ['Met.no', 'metno', {desc: 'Best in the Nordics (behind yr.no) · no key'}],
                    ['Open-Meteo', 'openmeteo', {desc: 'Picks the best national model · no key'}],
                    ['OpenWeatherMap', 'openweathermap', {desc: 'Popular general-purpose API, worldwide · needs a free key'}],
                    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise local forecasts, worldwide · needs a free key'}],
                    ['Weather Underground', 'wunderground', {desc: 'Crowd-sourced network of 250,000+ local stations · no key'}],
                    ['Yandex Weather', 'yandex', {desc: 'Best across Russia & CIS · needs a key'}]
                ]
            }, {
                // The keyed provider's empty key, said where it cannot be missed: an amber note
                // hugging the row, only while the picked provider's key is blank (textFrom
                // answers '' otherwise and the note is gone, divider and all).
                type: 'staticText',
                style: 'info',
                joinPrevious: true,
                textFrom: {resolver: 'keyMissingNote', args: {picker: 'provider'}}
            }, keyRow('provider', null), {
                // The rain radar's source, or Off (screens-page.js): a page-only picker over
                // radarEnabled and radarProvider, so Off keeps the source and turning the radar
                // on again restores it. Flags the country-matched source "(Recommended)"
                // (blocks.js recommend resolvers). A keyed source with a key missing or known
                // to be rejected puts a dot on this tab and a dialog in front of Save (its key
                // row, below the note, opens its dialog); with the radar off no call is made,
                // so it asks nothing then. A changed source forces a fetch (index.js).
                type: 'select',
                uiOnly: true,
                messageKey: 'radarSource',
                label: 'Rain radar',
                defaultValue: 'rainbow',
                initFrom: {resolver: 'radarSourceValue'},
                onChange: 'radarSourcePicked',
                recommendFrom: 'recommendedRadarProvider',
                hintByValue: RADAR_SOURCE_HINTS,
                attentionFrom: {resolver: 'radarKeyAttention'},
                options: [['Off', 'off', {desc: 'No rain radar and no rain alert'}]].concat(RADAR_PROVIDER_OPTIONS),
                showWhen: {env: 'radar'}
            }, {
                // The own key's empty field, said where it cannot be missed: an amber note
                // hugging the row while "Rainbow (own key)" or Tomorrow.io is picked with no
                // key. For DWD and Met.no the same note says when the last update's location
                // lies outside the picked source's area, or (DWD) inside it with no radar
                // data from DWD, naming one that covers it (radar-coverage.js; the phone's
                // record userData.radarCoverage). textFrom answers '' otherwise.
                type: 'staticText',
                style: 'info',
                joinPrevious: true,
                textFrom: {resolver: 'radarProviderNote', args: {picker: 'radarProvider'}},
                showWhen: RADAR_ON_WHEN
            }, keyRow('radarProvider', RADAR_ON_WHEN), {
                type: 'select',
                messageKey: 'aqiSource',
                label: 'Air quality',
                defaultValue: 'waqi',
                hintByValue: {
                    auto: 'Uses WAQI, or Open-Meteo when no WAQI station is nearby.',
                    waqi: 'WAQI (aqicn.org) reads real monitoring stations, which is the most accurate. Rural areas and areas with few stations may have no station nearby and show "--".',
                    openmeteo: 'Open-Meteo uses a global model, so it covers every location.'
                },
                options: [['Auto', 'auto'], ['WAQI', 'waqi'], ['Open-Meteo', 'openmeteo']]
            }, {
                type: 'select',
                messageKey: 'fetchIntervalMin',
                label: 'Update interval',
                defaultValue: '15',
                hint: 'Each update sends only what changed, so short intervals like 5 min use little battery.',
                // While the Battery saver is on (Watchface › Theme & night), its hours pause
                // the updates: said here, from its hours (screens-page.js).
                hintFrom: {resolver: 'batterySaverPauseHint'},
                optionsFrom: {resolver: 'fetchIntervalBudget'}
            }]
        },
        // The keyed weather providers' key dialogs, opened by the key row under the Weather
        // provider and rendered nowhere else (sheetOnly). The keys, their trimming and
        // refetch on Save (onbuild.js) and the Test actions are the ones the card's rows
        // carried.
        keySheetSection(PROVIDER_KEYS.openweathermap, {key: 'provider', eq: 'openweathermap'}, [{
            type: 'text',
            messageKey: 'owmApiKey',
            label: 'API key',
            defaultValue: '',
            suffixAction: 'testOwmKey',
            suffixLabel: 'Test',
            hint: '<a href=\'https://openweathermap.org/\'>Register an OpenWeatherMap account</a> and paste your API key here, then tap Test. The key must be subscribed to <a href=\'https://openweathermap.org/api/one-call-3\'>One Call API 3.0</a> (it has a free allowance), or weather updates fail with error 401.'
        }]),
        // Shown only while tomorrow.io is the WEATHER provider; when it is radar-only the same key
        // + budget guard live in the Rain radar pane's Tomorrow.io dialog instead (see
        // TOMORROWIO_RADAR_ONLY_WHEN). While it is both, this is the one dialog that holds the
        // key, and the Radar provider's key row opens it too (RADAR_KEYS sharedSheet).
        keySheetSection(PROVIDER_KEYS.tomorrowio, TOMORROWIO_WEATHER_WHEN, TOMORROWIO_KEY_ROWS),
        keySheetSection(PROVIDER_KEYS.yandex, {key: 'provider', eq: 'yandex'}, [{
            type: 'text',
            messageKey: 'yandexApiKey',
            label: 'API key',
            defaultValue: '',
            hint: 'Register a Yandex Weather API key at <a href=\'https://yandex.com/dev/weather/\'>yandex.com/dev/weather</a> and paste it here.'
        }]),
        // "Rainbow (own key)"'s key dialog, opened by its key row under the Rain radar picker
        // (Data sources, above) and rendered nowhere else. The key, its trimming and refetch on Save
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
        // Radar-only Tomorrow.io's key dialog: Setup's Tomorrow.io dialog's rows, same
        // messageKeys, gated apart (TOMORROWIO_RADAR_ONLY_WHEN), so findShownItem keeps
        // the two copies apart. While Tomorrow.io is also the weather provider this dialog
        // is closed and Setup's holds the key.
        keySheetSection(RADAR_KEYS.tomorrowio, TOMORROWIO_RADAR_ONLY_WHEN, TOMORROWIO_KEY_ROWS),
        {
            id: 'units',
            title: 'Units', items: [{
                type: 'segmented',
                messageKey: 'temperatureUnits',
                label: 'Temperature',
                defaultValue: 'c',
                options: [['°F', 'f'], ['°C', 'c']]
            }, {
                type: 'segmented',
                messageKey: 'windUnits',
                label: 'Wind speed',
                defaultValue: 'kph',
                options: [['kph', 'kph'], ['mph', 'mph'], ['Knots', 'knots']],
                hint: 'The wind and gust slots in the status bars use this unit.'
            }, {
                type: 'segmented',
                messageKey: 'distanceUnits',
                label: 'Distance',
                defaultValue: 'metric',
                options: [['Kilometers', 'metric'], ['Miles', 'imperial']],
                hint: 'The "Walked distance" slot in the status bars uses this unit.'
            }, {
                type: 'segmented',
                messageKey: 'aqiScale',
                label: 'Air quality scale',
                defaultValue: 'european',
                options: [['European', 'european'], ['US', 'us']],
                more: true,
                showWhen: {key: 'aqiSource', eq: 'openmeteo'},
                hint: 'Sets which air quality index the Open-Meteo source reports. WAQI always uses the US EPA scale.'
            }, {
                // Phone-side only (feels-like.js resolvers; fetch-cycle.js hands it to
                // the provider per fetch) and in renderSignature, so a flip refetches.
                type: 'segmented',
                messageKey: 'feelsFormula',
                label: 'Feels-like formula',
                defaultValue: 'provider',
                options: [['Provider', 'provider'], ['Steadman', 'steadman']],
                more: true,
                hintByValue: {
                    provider: 'Uses the feels-like value your weather service reports. For some services it '
                        + 'equals the air temperature in mild weather. Services without one use Steadman.',
                    steadman: 'Calculates feels-like from air temperature, humidity and wind, the same '
                        + 'way on every provider, so it differs from the temperature all year round.'
                }
            }]
        }, {
            id: 'about',
            title: 'Misc',
            items: [{
                // Page-only, like onboardingDone below: it picks the tab the
                // settings page opens on and never goes near the watch.
                type: 'toggle',
                messageKey: 'startOnWeatherTab',
                label: 'Start on the Weather tab',
                defaultValue: false,
                hint: 'Open this settings page on the Weather tab instead of Watchface.'
            }, {
                // Page-only too (the schema's infoIconsKey): how this page shows its
                // explanations. Never read by the watch-side JS.
                type: 'toggle',
                messageKey: 'hideInfoText',
                label: 'Hide info text',
                defaultValue: false,
                hint: 'Show a ? beside each setting instead of its explanation. Tap the ? to read it.'
            }, {
                type: 'toggle',
                messageKey: 'telemetryEnabled',
                label: 'Share anonymous telemetry',
                defaultValue: true,
                hint: 'Sends anonymous data about weather updates and how the watchface is used, to improve reliability. See what is sent in the <a href="https://github.com/Toasbi/WarnWeather#telemetry">Telemetry section</a>.'
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
            }, {
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
                hint: 'Sets the theme of this settings page. Auto follows your Pebble app theme. The watchface is not affected.'
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
                hint: 'Records connection events sent to the watch, on this phone only. Events older than 7 days are deleted.'
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

// Every row of a key the graph styles share (graph-styles.js SHARED: what the phone bakes into
// the weather data, and Larger graph fonts, a watch-wide tier) says so while more than one style
// exists (graph-styles-page.js 'graphStyleShared'), wherever the row sits. One pass, so a row
// added later cannot miss it.
require('../config-ui/lib/schema-walk.js').eachItem(module.exports, function (item) {
    if (require('../graph-styles.js').SHARED.indexOf(item.messageKey) !== -1) {
        item.hintTailFrom = {resolver: 'graphStyleShared'};
    }
});
