// src/pkjs/settings/schema.js — ES5, PKJS-parsed. WarnWeather's settings SoT.
var meta = require('../../../package.json');
var BMC_BADGE = require('./bmc-badge.js');
var holidayData = require('./holiday-data.js');
// Single source of the two threshold-highlight color defaults; the same module
// reads these settings back when packing the wire blob (see clay-payload.js).
var STATUS_THRESHOLDS = require('../status-thresholds.js');
// The per-kind "Show unit" defaults come from the catalog's UNIT_TOGGLES
// table (shared with the baker, the reset, and renderSignature).
var STATUS_LINE_CATALOG = require('../status-line-catalog.js');
// The two-value slots' presentation vocabulary: the separator presets, the UV next-day
// marks and the custom separator's length, from the module that PRINTS them into the
// slot text — so every option label is exactly what the watch will show.
var STATUS_PAIR = require('../status-pair.js');
var PRESSURE_SCALE_CURVE_HPA = require('../forecast-series.js').PRESSURE_SCALE_CURVE_HPA;
// The graph-colour vocabulary: the storage key behind every picker, the roles each
// metric actually owns, and the built-in colour each one defaults to. All of it comes
// from line-style.js — the module that RESOLVES these keys when it packs the watch's
// wire — so the settings page cannot offer a colour the renderer doesn't know, miss one
// it does, or carry a transcribed default hex that drifts away from what the graph paints.
var lineStyle = require('../line-style.js');
// The Custom-layout block (the per-view storage items, their sheetOnly section and
// the Edit-button row) lives in its own module so its capability gates are BUILT
// from view-cycle.js's mode lists — the same table buildCustomCycle folds by.
var customLayout = require('./custom-layout-schema.js');
// The same mode lists gate the Alerts card's "no bar shows alerts" notes
// (seatPlacesAlertsWhen), so they fold a custom view's seats as the compiler does.
var VIEW_CYCLE = require('../view-cycle.js');
var versionLabel = 'v' + meta.version + (meta.buildProfile === 'dev' ? ' (dev)' : '');
var HOURS = (function () {
    var o = [], h;
    for (h = 0; h < 24; h += 1) {
        o.push([(h < 10 ? '0' + h : String(h)) + ':00', String(h)]);
    }
    return o;
})();
// The metric and line-style pickers' hints are DERIVED (hintFrom), not static: a
// line's scale depends on its metric AND its style (height for a curve or marks,
// colour strength for a stripe), so the copy and its composition live with the
// resolvers in blocks.js ('forecastMetricHint', 'lineStyleHint'). The metric pickers
// keep only notes true of the metric whatever its style — plus the height wording on a
// watch without style pickers (aplite), so the scale is still explained there.
// Every picker carries the full metric set, feels and dew included: each line has its
// own curve-inset byte (CLAY_CURVE_INSET_UINT8), so any of them can share the
// temperature axis with the temperature curve.
var METRIC_HINT_FROM = {resolver: 'forecastMetricHint'};
// "This watch draws the third metric line and selectable styles at all" — the
// WW_LINE_STYLE mirror (platform.js), one gate for the Third-metric row, every
// line-style picker and the fourth-line scale contexts. Fails open for an
// unknown platform, like every feature-absence capability.
var LINE_STYLES_WHEN = {env: 'lineStyles'};
// The two stripe styles (line-style.js isStripeValue).
var STRIPE_STYLES = ['stripeTop', 'stripeBottom'];
// Per-line style pickers, one under each metric picker.
/**
 * One line-style picker, messageKey lineKey + 'Style'.
 * @param {string} lineKey The metric picker it sits under:
 *   secondaryLine|thirdLine|fourthLine|fifthLine.
 * @param {boolean} [offable] That picker offers Off, which also hides this row.
 * @returns {Object} Schema item.
 */
function lineStyleCopy(lineKey, offable) {
    var messageKey = lineKey + 'Style';
    var when = [LINE_STYLES_WHEN];
    if (offable) { when.push({key: lineKey, ne: 'off'}); }
    // A dropdown, not a segmented row: six styles no longer fit one row on a phone.
    return {
        type: 'select',
        messageKey: messageKey,
        label: 'Line style',
        // The one source of the built-ins (the pre-feature look per line) —
        // this page must not carry a transcribed default that drifts from
        // what the graph paints.
        defaultValue: lineStyle.LINE_STYLE_DEFAULTS[messageKey],
        joinPrevious: true,
        // The scale of THIS line's metric as this style shows it, plus the style's
        // own note (blocks.js 'lineStyleHint').
        hintFrom: {resolver: 'lineStyleHint', args: {metricKey: lineKey}},
        // The six styles, minus the stripes for a metric that cannot be one
        // (blocks.js 'lineStyleOptions', off line-style.js' metricAllowsStripe).
        optionsFrom: {resolver: 'lineStyleOptions', args: {metricKey: lineKey}},
        // A stored stripe on such a metric lies dormant: the row shows the style the
        // watch draws (line-style.js lineStyleValue resolves it the same way for the
        // bake, the preview and telemetry) but the pick stays stored, so trying another
        // metric and coming back to an intensity one brings the stripe back.
        dormantValues: STRIPE_STYLES,
        showWhen: {all: when}
    };
}
// Both metric pickers resolve through blocks.js' 'forecastMetric' options resolver:
// the third line gets Off plus the metrics the secondary line is NOT using (the
// engine's display-snap resets thirdLine if it ever collides — see engine.js), and
// feels-like is dropped on aplite (no temp-axis inset compiled there, and the temp
// slot's Feels/Both control is threshold-gated off aplite too).
// windScale ceilings pre-rendered per wind unit, chosen by showWhen on windUnits
// (§2b). Same descriptive tails as the original single hint; only the ceiling +
// unit change. Ceilings: kph 30/50/70 · mph 19/31/43 · kn 16/27/38.
// The wind ceilings come from THE table the graph scales with (forecast-series'
// WIND_SCALE_KMH) through the same conversion the wind slots display with
// (wire-units kmhToDisplay) — so the hints can no longer drift from the axis
// the way a hand-copied ceiling could. Derived strings pinned by test.
// (preview-forecast.js's preview keeps its own windMax mirror: it runs in the flat
// webview with no require(), documented at its declaration.)
var WIND_SCALE_KMH = require('../forecast-series.js').WIND_SCALE_KMH;
var kmhToDisplay = require('../wire-units.js').kmhToDisplay;
/**
 * @param {string} windUnits 'kph'|'mph'|'knots' (the stored windUnits value).
 * @param {string} unitLabel The label the hint prints, e.g. 'kn'.
 * @returns {{low: string, mid: string, high: string}} Per-scale hint lines.
 */
function windScaleHints(windUnits, unitLabel) {
    function tops(scale, tail) {
        return 'Tops out at ' + kmhToDisplay(WIND_SCALE_KMH[scale], windUnits)
            + ' ' + unitLabel + ' — ' + tail;
    }
    return {
        low: tops('low', 'emphasizes light, gentle winds.'),
        mid: tops('mid', 'general use; gusts visible, typical winds sit mid-graph.'),
        high: tops('high', 'keeps strong gusts from flattening against the top.')
    };
}
var WIND_SCALE_HINTS_KPH = windScaleHints('kph', 'kph');
var WIND_SCALE_HINTS_MPH = windScaleHints('mph', 'mph');
var WIND_SCALE_HINTS_KNOTS = windScaleHints('knots', 'kn');
// The ordered line-contexts every per-metric graph-scale row cascades over: a
// scale row renders under the FIRST context whose picker selects its metric
// family, each later context yielding to every earlier one, and the fourth
// context additionally gated on the watch carrying the line at all
// (LINE_STYLES_WHEN). One list — a future line is one entry here, not four
// hand-edited WHEN families.
var LINE_CONTEXTS = [
    {key: 'secondaryLine'},
    {key: 'thirdLine'},
    {key: 'fourthLine', gates: [LINE_STYLES_WHEN]},
    {key: 'fifthLine', gates: [LINE_STYLES_WHEN]}
];
/**
 * Index of one picker key in LINE_CONTEXTS.
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @returns {number} Its position.
 */
function lineContextIndex(pickerKey) {
    for (var i = 0; i < LINE_CONTEXTS.length; i += 1) {
        if (LINE_CONTEXTS[i].key === pickerKey) { return i; }
    }
    return -1;
}
/**
 * The showWhen conditions ARRAY for one line-context's scale row: the
 * context's gates, then the matcher on its own picker, then a {not: ...} of
 * the matcher on every earlier picker.
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @param {function(string): Object} matchOf Picker key -> matcher leaf.
 * @returns {Array.<Object>} Conditions, for {all: ...} (or bare when single).
 */
function lineContextWhen(pickerKey, matchOf) {
    var index = lineContextIndex(pickerKey);
    var when = (LINE_CONTEXTS[index].gates || []).slice();
    when.push(matchOf(pickerKey));
    for (var i = 0; i < index; i += 1) {
        when.push({not: matchOf(LINE_CONTEXTS[i].key)});
    }
    return when;
}
// One windScale copy: the line-context cascade AND the given windUnits value,
// with the pre-rendered hint set for that unit.
function windScaleCopy(pickerKey, unit, hints) {
    var lineWhen = lineContextWhen(pickerKey, function (key) {
        return {key: key, in: ['wind', 'gust']};
    });
    return {
        type: 'segmented',
        messageKey: 'windScale',
        label: 'Wind graph scale',
        defaultValue: 'mid',
        joinPrevious: true,
        hintByValue: hints,
        options: [['Low', 'low'], ['Mid', 'mid'], ['High', 'high']],
        showWhen: {all: lineWhen.concat([{key: 'windUnits', eq: unit}])}
    };
}
// "A health item can appear in some status slot" — the gate for settings that are
// inert otherwise (the health threshold sub-sections). Mirrors the availability rule
// the slot catalog itself applies (statusLineCatalog.itemAvailable: needsHealth items
// are unavailable when env.health is false OR healthMode is 'off'). Deliberately NOT
// the Health-Status-Bar pickers' {healthMode in [status, all]}: that gates the health
// BAR's existence, while 'slot' mode puts health items in the ordinary bars, where
// their thresholds are just as live.
var HEALTH_SLOT_WHEN = {all: [{env: 'health'}, {key: 'healthMode', ne: 'off'}]};
// "The heart-rate item can appear in some status slot" — HEALTH_SLOT_WHEN plus the
// sensor itself, mirroring the catalog's availability rule for the hr item
// (statusLineCatalog.itemAvailable: needsHealth AND needsHr — env.hr is false on
// health-capable watches without a heart-rate sensor).
var HR_SLOT_WHEN = {all: HEALTH_SLOT_WHEN.all.concat([{env: 'hr'}])};
// "This watch can draw a threshold highlight at all" — a section-level gate on every
// threshold edit sheet. aplite compiles the feature out (no WW_THRESHOLD_HIGHLIGHT:
// its lean status-row twin has no highlight code and its image has no room), so
// offering the settings there would be a sheet that silently does nothing. The
// statusSlotEditSheet resolver (blocks.js) applies the same env gate to the pencil
// trigger, so the sheet is unreachable there too. Platform fact lives in
// config-ui/lib/platform.js.
var THRESHOLD_WHEN = {env: 'thresholds'};
// "The Watch-tab master Bold row overrides every slot" — statusBoldAll 'all' packs
// the bold cell of EVERY kind as always-bold at blob-build time
// (status-thresholds.js buildSettingsBlob) WITHOUT touching the stored per-kind
// thresh<Stem>BoldMode values, so the per-slot Bold rows go inert (disabledWhen —
// muted, not hidden) rather than lying about being in charge; flipping the master
// back to 'perSlot' restores their stored choices.
var BOLD_ALL_WHEN = {key: 'statusBoldAll', eq: 'all'};
// The two capability gates the Radar/Health status bars share — named once
// (the THRESHOLD_WHEN precedent) so a bar's visibility rule lives in one
// constant instead of six inline copies across its slots and countdown rows.
var RADAR_BAR_WHEN = {all: [{env: 'radar'}, {key: 'radarMode', in: ['status', 'graph']}]};
var HEALTH_BAR_WHEN = {all: [{env: 'health'}, {key: 'healthMode', in: ['status', 'all']}]};
// "The theme actually renders color choices" — inlined ~10 times before it had
// a name. (The compound "effectively B&W" check lives in bwLegendItems below.)
var COLOR_THEME_WHEN = {key: 'theme', nin: ['bw', 'bw-light']};

/**
 * Gate every item that has no showWhen of its own — the shared one-pass idiom
 * of the two sheet builders: an item added later cannot forget its gate line,
 * and a caller-supplied row that brings its own showWhen keeps it.
 * @param {Object[]} items Schema items (mutated).
 * @param {?Object} gate showWhen predicate, or null for no gate.
 * @returns {Object[]} The same array.
 */
function gateAll(items, gate) {
    if (gate) {
        items.forEach(function (item) {
            item.showWhen = item.showWhen || gate;
        });
    }
    return items;
}

/**
 * The shared sheet envelope both builders return: a sheetOnly section reachable
 * only through a slot's pencil, keyed thresh<Stem>, gated on the thresholds
 * capability (aplite compiles the machinery out).
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
// them (blocks.js' FORECAST_METRICS — a user reads the two lists together), then the
// full-height night band. `scope` is line-style.js' vocabulary: a metric id, or 'night'.
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
    Fill: 'Fill under the line',
    Night: 'Night fill tint',
    Hatch: 'Night hatch',
    Boundary: 'Dusk / dawn line'
};
var GRAPH_ROLE_HINTS = {
    Fill: 'Only drawn while this is the Main metric and “Fill area below the line” is on.',
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
// Shared intro lines at the top of every level group in an edit sheet (the sheets are
// the only place the levels are explained now that the Watch-tab card is gone). Two
// voices: the weather kinds rise to ALERT LEVELS; the health kinds work toward GOALS
// (`goal` in the contract) — same rises-toward-the-pair machinery, friendlier words.
// Both lead with what the pair IS: the slider is always live (the weather pair also
// sets the day-max hold level, highlighting or not), so the intro must not read as if
// the numbers were the highlight's alone. The weather group has NO switch of its own —
// it sits in the kind's Alert sheet, whose 'Alert' switch shows the icon, while the
// slot's 'Highlight' switch lives in the slot sheet — so its intro says the look
// applies to the alert icon always and to the slot only while that switch is on. The
// goal group keeps its switch (goal kinds have no alert). Neither claims the warn level
// bolds the value — Bold is its own setting, so saying so here could simply be false.
// The outline is "can add": it follows the group's 'Outline on warn' / 'Outline on
// close' toggle (status_alerts.c / status_row.c draw no warn box on a 0x00 accent).
var ALERT_LEVELS_INTRO = 'Warn and danger levels for this value: reaching warn ' +
    'can add an outline, reaching danger fills the alert icon — and the slot, while ' +
    'its Highlight is on.';
// "On color watches": on B&W the outline and fill are drawn in the theme's ink and
// the color pickers below are hidden.
var GOAL_SHEET_INTRO = 'Close and goal levels for this value. The switch ' +
    'celebrates them on the watch: getting close can add an outline, reaching ' +
    'the goal fills the slot. On color watches the colors are yours to change below.';
// The Bold row is a SLOT-level setting, not a level one: it leads the slot sheet
// (above the Goals group; an alert kind's levels live in its Alerts sheet) and stays
// live while the kind's highlight is switched off, because "Always" needs no levels
// to mean something. Only the middle option does —
// it goes inert (not away: removing it would let the options-snapping path
// rewrite a stored 'warn' to 'off') until the kind's highlight is on.
// The hint explains the SELECTED step only (hintByValue), in the sheet's two voices
// (alert levels reached vs goals reached). The level-driven bold — danger / a reached
// goal, and the middle step — reads the kind's level, which the watch zeroes while the
// kind's Highlight (Goals) switch is off (status_row.c slot_level), so the hints say
// "while … is on". 'Always' needs no levels, so its note is the per-kind scope.
var BOLD_ALWAYS_HINT = 'Every status slot showing this value prints it in heavier text.';
var BOLD_HINTS = {
    off: 'Danger still prints bold while Highlight is on.',
    warn: 'Heavier text from the warn level on, while Highlight is on.',
    always: BOLD_ALWAYS_HINT
};
var GOAL_BOLD_HINTS = {
    off: 'A reached goal still prints bold while Goals are on.',
    warn: 'Heavier text once you get close to the goal, while Goals are on.',
    always: BOLD_ALWAYS_HINT
};
// The wind/gust slots' direction arrow. The arrow flies DOWNWIND (the way the wind is
// blowing), not the meteorological "comes from" bearing the providers report — the
// phone flips it before baking — so the copy has to say which way it points, or half
// the readers will read it backwards. Shared by both slots: one arrow, two kinds.
var WIND_DIRECTION_HINT = 'Draws an arrow after the speed, pointing the way the ' +
    'wind is blowing now. Not while Alert shows a peak alone.';
// The two-value slots — Temperature and UV in their "Both" mode — print a pair in one
// slot (12/10, 3/7). How the pair reads is chosen per kind, on the rows pairRows()
// builds below that kind's display pills. The phone bakes the text (status-pair.js,
// through status-lines.js formatValue) and sanitises the custom separator there,
// authoritatively, so the page stores what was typed and needs no hook. An absent key
// reads as the default, so a blob saved before these rows existed keeps printing 12/10.
//
// The formatter's fit rule: a pair wider than its slot's byte cap drops its spaces, and
// one still too wide prints with the plain slash, for that reading only. Only the
// narrow left/right slots ever hit it ('-12 / -10' is 9 bytes of their 8), so the hint
// names them the way the Watch tab's intro does, not as "edge slots".
var PAIR_FALLBACK_HINT = 'In a left or right slot, a pair too wide to fit ' +
    'drops its spaces, then falls back to the slash, and shows only the current value ' +
    'if even that is too wide.';
// The watch draws slot text in its Gothic system fonts, which cover printable ASCII and
// Latin-1 (the slots already print '°' and '»' from them); the formatter keeps
// only those, then the first two. Spaces are kept, not trimmed: ', ' is a real separator.
var PAIR_CUSTOM_HINT = 'Up to ' + STATUS_PAIR.CUSTOM_MAX_CHARS + ' characters, spaces ' +
    'included; empty uses the slash. Only characters the watch font can draw are kept ' +
    '(printable ASCII and Latin-1).';
/**
 * Build the rows that shape a two-value slot's pair: the separator dropdown, the custom
 * separator it can reveal, whether spaces flank the separator, and which value leads.
 * All four show only in the kind's "Both" mode — the one mode that prints a pair — and
 * join the display row tight, the way every group of rows revealed by a control joins
 * that control (Theme switching's Night theme and Enabled hours).
 *
 * The presets are labelled by EXAMPLE, built on the kind's own sample numbers from the
 * formatter's table: "12(10)" says what a name like "Brackets" would leave the reader
 * to picture, and it cannot disagree with what the slot prints tight. The labels show
 * the tight forms, the table's own; spacing is the toggle below, over every preset
 * alike, so the dropdown stays one entry per separator instead of doubling (with the
 * toggle on, the slot prints the label's spaced form).
 *
 * @param {string} prefix Key prefix: 'temp' or 'uv' (tempSlotDisplay, tempSlotSeparator …).
 * @param {string} first Sample of the value that leads by default, e.g. '12'.
 * @param {string} second Sample of the other value, e.g. '10'.
 * @param {Array<Array<string>>} orderOptions The order pills as [label, value]; the
 *     first one is the default (the order the slot has always printed).
 * @returns {Object[]} The separator select, the custom-separator text field, the spacing
 *     toggle, the order pills.
 */
function pairRows(prefix, first, second, orderOptions) {
    var bothWhen = {key: prefix + 'SlotDisplay', eq: 'both'};
    var presets = STATUS_PAIR.SEPARATORS;
    var separators = Object.keys(presets).map(function (value) {
        return [first + presets[value].mid + second + presets[value].end, value];
    });
    return [{
        // A dropdown, not pills: five choices would be a wide pill row, and the owner
        // asked for a drop-down of presets.
        type: 'select',
        messageKey: prefix + 'SlotSeparator',
        label: 'Separator',
        defaultValue: 'slash',
        hint: PAIR_FALLBACK_HINT,
        options: separators.concat([['Custom', 'custom']]),
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
        hint: PAIR_CUSTOM_HINT,
        joinPrevious: true,
        showWhen: {all: [bothWhen, {key: prefix + 'SlotSeparator', eq: 'custom'}]}
    }, {
        // Spacing is orthogonal to the separator — the owner asked for 8/8 or 8 / 8
        // "for all of them" — so it is one toggle, not a spaced twin of every preset.
        // Off by default: an absent key must keep printing the 12/10 the slot always
        // baked. The hint shows the spaced form of two separators, built through the
        // formatter's own spaceAround on the kind's samples, so it says plainly that
        // the toggle covers every separator (not "switch to a spaced slash", which
        // the removed preset was) and cannot drift from what the slot prints.
        type: 'toggle',
        messageKey: prefix + 'SlotSeparatorSpaced',
        label: 'Spaces around separator',
        defaultValue: false,
        hint: 'Adds spaces to any separator: ' +
            [presets.slash, presets.brackets].map(function (preset) {
                var spaced = STATUS_PAIR.spaceAround(preset);
                return first + spaced.mid + second + spaced.end;
            }).join(', ') + '.',
        joinPrevious: true,
        showWhen: bothWhen
    }, {
        type: 'segmented',
        messageKey: prefix + 'SlotOrder',
        label: 'Order',
        defaultValue: orderOptions[0][1],
        options: orderOptions,
        joinPrevious: true,
        showWhen: bothWhen
    }];
}
/**
 * A day-max slot kind's display rows (UV, wind, gusts, AQI): the Now / Alert / Both
 * pills, the pair rows Both reveals (pairRows), and the mark on a max that has rolled
 * on to tomorrow's peak. Global per kind, baked phone-side (status-lines.js
 * formatValue; the numbers are wire-units' dayMaxShown) and on renderSignature(), so a
 * change re-bakes without waiting for the next fetch. The highlight follows the
 * numbers, never their presentation (status-thresholds.js displayValue).
 *
 * 'Alert' (stored 'max', the wire vocabulary is unchanged) names what the mode is for:
 * today's peak holds while it is still ahead or happening now AND while it sits at the
 * kind's warn level or higher, so a slot never goes quiet under a value that still
 * warrants the warning. The pills' hint explains the SELECTED mode only — Now, the
 * default, gets none — and is about what the slot SHOWS (the highlight is explained in
 * the Alerts sheet). It states the warn level as a NUMBER, live (blocks.js dayMaxHint
 * fills dayMaxHints' {level} from the slider, the unit pickers and the AQI
 * source/scale on every render); the static hintByValue is its fallback for a page
 * without the contract module, the same copy with the level named, not numbered.
 * @param {string} prefix Key prefix: 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {string} label The pills' label, e.g. 'UV selection'.
 * @param {{keyStem: string, subject: string, notes: ?Object}} copy The kind's
 *     threshold key stem ('Uv'), the hold sentence's subject ('UV is'), and (AQI only)
 *     the source notes: dayMaxHint closes on byValue[S[key] || fallback] (a leading
 *     space; no entry, no note), the static fallback on `generic`. null for none.
 * @param {string} now Sample current reading for the separator labels, e.g. '3'.
 * @param {string} max Sample peak, e.g. '7'.
 * @returns {Object[]} The rows, in sheet order.
 */
function dayMaxRows(prefix, label, copy, now, max) {
    var hints = dayMaxHints(copy.subject, now + '/' + max);
    var args = {keyStem: copy.keyStem, hints: hints};
    if (copy.notes) { args.notes = copy.notes; }
    // The fallback cannot read the source, so it closes on the source-free note.
    var coda = copy.notes ? copy.notes.generic : '';
    return [{
        type: 'segmented',
        messageKey: prefix + 'SlotDisplay',
        label: label,
        hintByValue: {
            max: fillDayMaxHint(hints.max, DAY_MAX_LEVEL_NAME) + coda,
            both: fillDayMaxHint(hints.both, DAY_MAX_LEVEL_NAME) + coda
        },
        hintFrom: {resolver: 'dayMaxHint', args: args},
        defaultValue: 'current',
        options: [['Now', 'current'], ['Alert', 'max'], ['Both', 'both']]
    }].concat(pairRows(prefix, now, max, [['Now first', 'now'], ['Alert first', 'max']]), [{
        // The mark on a max that has rolled on to tomorrow's peak — in Alert AND
        // Both, the two modes that print a max. 'raquo' is the '»' the UV slot
        // printed before this row existed, so it stays the default.
        type: 'select',
        messageKey: prefix + 'SlotNextDayMark',
        label: 'Tomorrow\'s peak mark',
        defaultValue: 'raquo',
        options: nextDayMarkOptions(),
        joinPrevious: true,
        showWhen: {key: prefix + 'SlotDisplay', in: ['max', 'both']}
    }]);
}
// What the static fallback puts where the live hint prints the number.
var DAY_MAX_LEVEL_NAME = 'your warn level';
/**
 * A day-max kind's Alert and Both hints as templates, '{level}' standing for the
 * warn level (dayMaxHint: '6 (your warn level)'; the fallback: DAY_MAX_LEVEL_NAME).
 * Each claim is wire-units dayMaxShown's: today's peak (the rest of today, the
 * current hour included) holds while ahead, running or at warn or higher — once it
 * is neither ahead nor running it equals the reading, so "{subject} below {level}"
 * is the high hold's own test; then tomorrow's peak shows, marked, or — unknown or
 * never above 0 — the reading alone. Both collapses a held today's peak equal to the
 * reading to one number.
 * @param {string} subject The hold sentence's subject with its verb, e.g. 'UV is'.
 * @param {string} sample The kind's sample pair, e.g. '3/7'.
 * @returns {{max: string, both: string}} The two templates.
 */
function dayMaxHints(subject, sample) {
    var rest = ' below {level}, tomorrow\'s peak shows instead, with the mark chosen below';
    return {
        max: 'Today\'s peak — the highest it gets for the rest of today. Once it has passed and '
            + subject + rest + ', or the current reading if tomorrow\'s isn\'t known.',
        both: 'The reading now and today\'s peak, like ' + sample + ' — one number while they\'re '
            + 'the same. Once today\'s peak has passed and ' + subject + rest
            + ', or the reading alone if tomorrow\'s isn\'t known.'
    };
}
/**
 * @param {string} template A dayMaxHints template.
 * @param {string} level What stands in for '{level}'.
 * @returns {string} The hint.
 */
function fillDayMaxHint(template, level) {
    return template.split('{level}').join(level);
}
/**
 * The UV slot's next-day mark options, labelled on a sample peak of 6 from the
 * formatter's own table, so each label shows where its mark lands (three lead the
 * number, the star trails it). 'none' would print a bare 6, which reads as no choice
 * at all, so it is spelled out.
 * @returns {Array<Array<string>>} [label, value] pairs, the formatter's order.
 */
function nextDayMarkOptions() {
    var marks = STATUS_PAIR.NEXT_DAY_MARKS;
    return Object.keys(marks).map(function (value) {
        return [value === 'none' ? 'No mark' : marks[value].pre + '6' + marks[value].post, value];
    });
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
// A kind's Alert levels (or Goals) group — the part of a level edit sheet that
// configures the levels and their look, not the slot: the group sub-header (title,
// reset — and, for the GOAL kinds only, the Goals switch), a zoned
// dual-thumb slider for the warn/danger pair, and the outline toggle + two color
// pickers. A weather kind's group has no switch: its highlight switch is the slot
// sheet's 'Highlight' row (highlightToggle), and its outline + colors style the alert
// icon whether or not that is on, so they are always live. Values live in the kind's
// DISPLAYED unit (wind unit / km-mi / hours); a blank pair means the kind's seed
// pair (status-thresholds.js resolvedPair), and toggling off keeps the pair — the
// switch alone is the highlight's on/off. The slider's geometry, direction and
// live colors come from the thresholdRange resolver (blocks.js), which reads the
// contract module (status-thresholds.js) — the same source the watch packs with,
// so the UI can never disagree about which way is worse.
// `gate` (optional showWhen) hides kinds that can't appear in any slot (health
// on aplite / with health off); color pickers additionally hide on B&W
// (capability + bw theme).
// The group has ONE home per kind: the goal kinds' slot pencil sheet
// (thresholdSection, below the slot's own rows), and for the five alert kinds the
// Alerts card's sheet (alertSheet) — their slot sheets carry a pointer there instead
// (alertLevelsNote), so every key renders in exactly one place.
/**
 * @param {string} keyStem Kind key stem, e.g. 'Steps' (thresh<Stem>Warn/...).
 * @param {string} hint Per-kind unit/scale hint (HTML allowed).
 * @param {Object} [gate] Extra showWhen for the whole group.
 * @returns {Object[]} The group's items: sub-header, (goal kinds only) the switch,
 *     slider, the two hidden companions, outline toggle, warn color, danger color.
 */
function levelsGroup(keyStem, hint, gate) {
    var onKey = 'thresh' + keyStem + 'On';
    // The health trio reads as GOALS you reach (celebration: green outline when
    // close, fill when reached) — the contract's goal flag drives the wording so it
    // can never disagree with the packing.
    var goal = STATUS_THRESHOLDS.isGoalKind(keyStem);
    // The slider is ALWAYS live: the warn level is not the highlight's alone — the
    // day-max kinds hold today's peak from it whether or not anything is coloured
    // (wire-units dayMaxShown via status-thresholds holdWarn), so it must stay
    // editable with the switch off. For a GOAL kind the highlight-only rows below
    // (outline toggle + color pickers) go VISIBLE but disabled (muted, inert — the
    // sheet shows what turning it on offers) while its switch is off. A weather
    // kind's rows never do: they style its alert icon too, which the slot's switch
    // does not touch. The toggle itself is STORED state — the one source of
    // "highlight on" (kindConfig's enable bit); pre-split blobs were backfilled from
    // their pair by clay-migrations.js — and ON seeds the pair through the
    // thresholdToggle hook when none is stored.
    var offWhen = goal ? {not: {key: onKey}} : undefined;
    var colorWhen = gate ? {all: [gate, COLOR_THEME_WHEN]} : COLOR_THEME_WHEN;
    // Goal kinds only: a weather kind's switch is the slot sheet's highlightToggle.
    var toggle = goal ? {
        type: 'toggle',
        messageKey: onKey,
        // Aria-only: the switch rides the group header, whose intro carries the meaning.
        label: 'Goals',
        defaultValue: false,
        onChange: 'thresholdToggle'
    } : null;
    var range = {
        type: 'range',
        messageKey: 'thresh' + keyStem + 'Warn',
        dangerKey: 'thresh' + keyStem + 'Danger',
        maxKey: 'thresh' + keyStem + 'Max',
        // Title + reset live on the group's sub-header now, so the row itself is
        // label-less: repeating "Alert levels" directly under the header read as a
        // stutter. No disabledWhen: see offWhen above.
        defaultValue: '',
        hint: hint,
        joinPrevious: true,
        rangeFrom: {resolver: 'thresholdRange', args: {keyStem: keyStem}}
    };
    // The group header: title, reset-to-defaults, and (goal kinds) the master on/off
    // switch that used to ride the sheet's title row. The intro hangs off it because
    // it describes the LEVELS, not the rows above them in the sheet.
    var header = {
        type: 'subheader',
        text: goal ? 'Goals' : 'Alert levels',
        toggleKey: goal ? onKey : undefined,
        intro: goal ? GOAL_SHEET_INTRO : ALERT_LEVELS_INTRO,
        // Reverts pair + colors + scale max to the kind's defaults (blocks.js
        // action) — deliberately NOT the pencil sheet's Bold row, which is not part
        // of the group.
        labelAction: {action: 'resetThresholds', arg: keyStem, label: 'Reset to defaults'}
    };
    // Every plain item in the group carries the same gate; applying it in one pass
    // (gateAll) means an item added above cannot forget its gate line. (The outline
    // toggle and color pickers below set showWhen inline instead — they layer the
    // B&W/outline rules on top of the gate.)
    var lead = toggle ? [header, toggle, range] : [header, range];
    gateAll(lead, gate);
    return lead.concat([{
        // Companion storage for the slider's second thumb and its editable scale
        // max: hydrated + serialized but never drawn (the range row renders both).
        type: 'hidden',
        messageKey: 'thresh' + keyStem + 'Danger',
        defaultValue: ''
    }, {
        type: 'hidden',
        messageKey: 'thresh' + keyStem + 'Max',
        defaultValue: ''
    }, {
        // Warn is ALWAYS bold when crossed; the outline is the opt-in extra.
        // Ownership splits by kind (onbuild.js): GOAL kinds derive the toggle
        // from the stored warn color on every open; WEATHER kinds' STORED toggle
        // owns the on/off state and rides every save — onbuild re-derives only
        // to heal legacy colors and keep an auto color tracking the theme fg (a
        // custom pick reads as outline-on either way). Writes go through the
        // thresholdOutlineToggle hook: ON seeds the theme fg, OFF blanks it, and
        // a blank warn color is the wire's no-outline sentinel. Shown on B&W too
        // — outline vs no outline is meaningful without color choice, and there
        // the fg seed is the only on-state.
        type: 'toggle',
        messageKey: 'thresh' + keyStem + 'WarnOutlineOn',
        label: goal ? 'Outline on close' : 'Outline on warn',
        hint: goal
            ? 'Adds an outline to the slot when you get close to the goal.'
            : 'Adds an outline from the warn level on, to the alert icon — and to the slot, while its Highlight is on.',
        // Goal kinds celebrate with the outline ON out of the box; weather warn
        // ships bold-only. (onLoad recomputes goal toggles from the stored color
        // and weather colors from the stored toggle — see above — and the seeded
        // store must agree with the color defaults below, which clay-settings
        // hydrates for the WATCH blob too.)
        defaultValue: goal,
        joinPrevious: true,
        onChange: 'thresholdOutlineToggle',
        showWhen: gate || undefined,
        disabledWhen: offWhen
    }, {
        // Colors hydrate UNSET: the DANGER color auto-tracks the theme fg until
        // customized (onLoad, blocks.js thresholdAutoColor); the WARN color exists
        // only while the outline toggle above is on. The contract's
        // DEFAULT_*_COLOR ints are only the pack-time fallback for settings that
        // never saw this page.
        type: 'color',
        messageKey: 'thresh' + keyStem + 'WarnColor',
        label: goal ? 'Close outline color' : 'Warn outline color',
        // '' = the no-outline wire sentinel, so goal kinds must NOT default to it:
        // seedDefaults hydrates these values into the phone store verbatim, and
        // the watch blob packs whatever is stored. Green = the celebration look.
        defaultValue: goal ? STATUS_THRESHOLDS.DEFAULT_GOAL_HEX : '',
        joinPrevious: true,
        capabilities: ['COLOR'],
        // colorWhen (gate + color-capable theme) composed with the outline
        // toggle — not a hand-rebuilt copy of the same predicate.
        showWhen: {all: [colorWhen, {key: 'thresh' + keyStem + 'WarnOutlineOn'}]},
        disabledWhen: offWhen
    }, {
        type: 'color',
        messageKey: 'thresh' + keyStem + 'DangerColor',
        label: goal ? 'Goal fill color' : 'Danger color',
        defaultValue: goal ? STATUS_THRESHOLDS.DEFAULT_GOAL_HEX : '',
        joinPrevious: true,
        capabilities: ['COLOR'],
        showWhen: colorWhen,
        disabledWhen: offWhen
    }]);
}
// One level edit sheet (sheetOnly — opened from a status slot's pencil, never rendered
// as a card): the slot's Bold row, a weather kind's Highlight switch, the kind's own
// display rows, then its Goals group (levelsGroup above) — or, for an alert kind, the
// pointer to its Alerts sheet.
/**
 * @param {string} title Sub-section title.
 * @param {string} keyStem Kind key stem, e.g. 'Steps' (thresh<Stem>Warn/...).
 * @param {string} hint Per-kind unit/scale hint (HTML allowed).
 * @param {Object} [gate] Extra showWhen for the whole sub-section.
 * @param {Object[]} [extraItems] Kind-specific display rows rendered between the Bold
 *     row and the levels group (or its pointer), e.g. the wind slots' direction arrow.
 *     They configure the SLOT, not the highlight, so they sit above the group —
 *     boldSection's extras play the same role on the level-less kinds.
 * @param {Object[]} [tail] Rows closing the sheet INSTEAD of the kind's levels group
 *     (built from keyStem/hint/gate otherwise) — the alert kinds pass the pointer to
 *     the Alerts card (alertLevelsNote), where their levels live.
 * @returns {Object} Schema section.
 */
function thresholdSection(title, keyStem, hint, gate, extraItems, tail) {
    var onKey = 'thresh' + keyStem + 'On';
    var goal = STATUS_THRESHOLDS.isGoalKind(keyStem);
    // Slot-level, above the group: how boldly the slot prints. The ladder is
    // monotone — danger is always bold (while the kind's highlight is on: a
    // switched-off kind has no level), the middle option adds the warn/close
    // level, "Always" adds the normal zone too (status_threshold.h ThreshBold).
    // Goal kinds relabel the middle option only; the stored value stays 'warn' so
    // the wire keeps one vocabulary. The row stays live while the kind's
    // highlight is off ("Always" needs none); it mutes wholesale only under the
    // Watch-tab master row (BOLD_ALL_WHEN), which overrides it at pack time.
    var bold = {
        type: 'segmented',
        messageKey: 'thresh' + keyStem + 'BoldMode',
        label: 'Bold value',
        hintByValue: goal ? GOAL_BOLD_HINTS : BOLD_HINTS,
        defaultValue: 'warn',
        options: [['Off', 'off'], [goal ? 'Close' : 'Warn', 'warn'], ['Always', 'always']],
        disabledWhen: BOLD_ALL_WHEN,
        optionDisabledWhen: {warn: {not: {key: onKey}}}
    };
    // A weather kind's highlight switch sits right under Bold (a goal kind's rides
    // its Goals header).
    var lead = goal ? [bold] : [bold, highlightToggle(keyStem)];
    var extras = extraItems || [];
    // The slot's rows carry the same gate as the group (gateAll, one pass).
    gateAll(lead.concat(extras), gate);
    // Bold leads every slot sheet; a weather kind's Highlight follows it, then the
    // kind's own display rows, and the Goals group (header + toggle + slider +
    // colors) — or, for an alert kind, the pointer to its Alerts sheet — closes the
    // sheet.
    // sheetOf carries the section-level THRESHOLD_WHEN gate: on a watch that
    // can't render highlighting the sheet must not exist (belt-and-braces
    // behind the resolver's env gate).
    return sheetOf(keyStem, title,
        lead.concat(extras, tail || levelsGroup(keyStem, hint, gate)));
}
// A weather kind's slot highlight switch — the watch's enable bit for the kind
// (kindConfig), which styles its STATUS SLOTS only: the alert icon has its own switch
// (alert<Stem>, in the Alerts sheet) and draws its outline and fill whether or not
// this is on. It lives in the slot sheet because that is what it styles; the levels
// and colors it uses live in the Alerts sheet. ON seeds the pair through the
// thresholdToggle hook when none is stored, as the goal header's switch does.
/**
 * @param {string} keyStem Kind key stem, e.g. 'Uv' (thresh<Stem>On).
 * @returns {Object} The slot sheet's 'Highlight' toggle.
 */
function highlightToggle(keyStem) {
    return {
        type: 'toggle',
        messageKey: 'thresh' + keyStem + 'On',
        label: 'Highlight',
        // Fill at danger always; the warn outline only with the Alerts sheet's
        // 'Outline on warn' (a 0x00 warn accent draws no box — status_row.c).
        hint: 'Fills this slot from the danger level on, and outlines it from warn if “Outline on warn” is on — levels and colors are set under Alerts.',
        defaultValue: false,
        onChange: 'thresholdToggle'
    };
}
// The five alert kinds' slot sheets end on this pointer instead of the levels group:
// the levels and colors live in ONE place, the kind's Alerts sheet (the slot's
// Highlight switch sits above, in this sheet). No link or sheet swap — the engine opens one sheet at a time,
// and the owner asked for the plain note. A fresh object per call, like every item.
/**
 * @returns {Object} The info-box staticText closing an alert kind's slot sheet.
 */
function alertLevelsNote() {
    return {
        type: 'staticText',
        style: 'info',
        text: 'Alert levels and colors are set under Alerts on the Status slots tab.'
    };
}
// The rain alert's gate: the radar has to be fetching (any radarMode but 'off') and
// the watch must not be aplite, which compiles the rain radar — and with it the
// countdown — out (WW_RAIN_RADAR). The platform clause is load-bearing: the Radar
// tab is env-hidden on aplite, the Status slots tab is not.
var RAIN_ALERT_WHEN = {all: [{key: 'radarMode', ne: 'off'}, {env: 'platform', ne: 'aplite'}]};
// The rain alert's two choices, named once: the sheet's rows offer them and the card
// row's hint (blocks.js rainAlertHint) prints the picked ones by these labels.
var RAIN_WINDOW_OPTIONS = [['Within 30 min', '30'], ['Within 60 min', '60'], ['Within 2 hours', '120']];
var RAIN_LOOK_OPTIONS = [['Icon', 'icon'], ['Icon + minutes', 'minutes'], ['Text', 'text']];
/**
 * The rain alert's sheet (sheetId alertRain), opened from the Alerts card's Rain row:
 * the on/off switch on the sheet's sub-header, then the time window and the look,
 * both inert while the switch is off (visible, so the sheet shows what turning it on
 * offers). The switch is stored state of its own (alertRain, default on); the phone
 * sends a horizon of 0 while it is off (clay-payload.js), which the watch reads as
 * "no rain alert" — so the window keeps its value for when the switch comes back.
 * Radar mode 'Rain alert only' ('countdown') fetches the radar for this alert alone,
 * so there the switch is held on: disabled, and forced on by the radarMode hook
 * (reset-status-defaults.js forceRainAlert) when that mode is entered.
 * @returns {Object} Schema section (sheetOnly).
 */
function rainAlertSheet() {
    var offWhen = {not: {key: 'alertRain'}};
    return {
        sheetOnly: true,
        sheetId: 'alertRain',
        showWhen: RAIN_ALERT_WHEN,
        title: 'Rain alert',
        items: [{
            type: 'subheader',
            text: 'Rain alert',
            toggleKey: 'alertRain',
            // The watch shows it while rain falls now, whatever the window, and hides
            // it while the radar is snoozed for the Battery saver hours
            // (rain_countdown.c rain_countdown_format).
            intro: 'Shows the rain drop in the Alerts row while it rains at your location or rain is due within the time window below. '
                + 'Hidden during the Battery saver hours. The radar mode “Rain alert only” keeps it on.'
        }, {
            // Aria-only: the switch rides the sub-header above.
            type: 'toggle',
            messageKey: 'alertRain',
            label: 'Rain alert',
            defaultValue: true,
            disabledWhen: {key: 'radarMode', eq: 'countdown'}
        }, rainAlertUnshownNote(), {
            // The countdown's window, key and default unchanged since it lived on the
            // Radar tab. No Off option: the switch above is the off.
            type: 'select',
            messageKey: 'rainCountdownHorizon',
            label: 'Time window',
            defaultValue: '60',
            hint: 'Rain due further out than this doesn’t trigger the alert. Rain radar forecasts change often, so a shorter window gives fewer false alarms.',
            options: RAIN_WINDOW_OPTIONS,
            disabledWhen: offWhen
        }, {
            // How the rain alert draws. 'text' is the "Rain in 12′" the strip always
            // showed, so an untouched upgrade looks the same. The watch resolves the
            // rain entry itself, so this rides the Clay message (thresholds blob byte
            // 34), not the phone's bake.
            type: 'segmented',
            messageKey: 'rainAlertDisplay',
            label: 'Look',
            defaultValue: 'text',
            options: RAIN_LOOK_OPTIONS,
            // The drop alone describes itself. The two longer looks say what they
            // print and that they shrink on a crowded bar (alert_set_degrade: Text →
            // minutes, then every value and the minutes drop, bar-wide) — news the
            // default Text look's name does not carry, so it gets a hint too.
            hintByValue: {
                minutes: 'The drop with the minutes until the rain starts, or +minutes while it rains. Just the drop when the bar is short on room.',
                text: 'Shortens to the minutes, then to the drop alone, when the bar is short on room.'
            },
            disabledWhen: offWhen
        }]
    };
}
/**
 * One metric alert's sheet (sheetId alert<Stem>), opened from its Alerts card row:
 * the "show this alert" switch on an 'Alert' sub-header — the sheet's ONE switch —
 * the Look, then the kind's levels group — the levels' ONE home (the slot sheet
 * points here), with no switch of its own (the slot's Highlight lives in the slot
 * sheet). The Look goes inert while the switch is off; the levels group never does,
 * because the levels and colors also drive the slots' Alert mode and highlight. The
 * phone bakes an entry into the ALERT_ENTRIES_UINT8 tuple only for a switched-on kind
 * whose day reaches its warn level (status-lines.js bakeAlerts), so the switch and
 * the Look both ride renderSignature(), not the Clay message.
 * @param {string} keyStem Kind key stem, e.g. 'Uv' (alert<Stem>, alert<Stem>Display).
 * @param {string} title The kind's sheet title, e.g. 'UV index'.
 * @param {string} subject The value the intro names, e.g. 'the UV index'.
 * @param {string} hint The levels slider's scale note ('' for none).
 * @param {string} [coda] A closing sentence for the intro (leading space), '' for none.
 * @returns {Object} Schema section (sheetOnly).
 */
function alertSheet(keyStem, title, subject, hint, coda) {
    var key = 'alert' + keyStem;
    return {
        sheetOnly: true,
        sheetId: key,
        showWhen: THRESHOLD_WHEN,
        title: title + ' alert',
        items: [{
            type: 'subheader',
            text: 'Alert',
            toggleKey: key,
            // "reaches … today": the entry fires on the highest value left today, so the
            // morning icon for an afternoon peak is by design (status-thresholds alertValue).
            // `coda` closes it for a kind whose look-ahead depends on its source (AQI).
            intro: 'Shows an icon in the Alerts row when ' + subject + ' reaches your warn level '
                + 'at any point left today, so an afternoon peak shows from the morning on.' + (coda || '')
        }, {
            // Aria-only: the switch rides the sub-header above.
            type: 'toggle',
            messageKey: key,
            label: 'Alert',
            defaultValue: false
        }, {
            type: 'segmented',
            messageKey: key + 'Display',
            label: 'Look',
            defaultValue: 'icon',
            options: [['Icon', 'icon'], ['Icon + value', 'value']],
            // The icon-only look (the default) needs no hint; the value look says what
            // it costs. Values never cost an entry: the row picks its slots at full
            // width (status_row.c alerts_layout), so it takes the neighbor sooner, and
            // a short row drops every value before any icon (alert_set_degrade).
            hintByValue: {
                value: 'Adds the value the alert fires on after the icon. It needs more room: the row takes the neighboring slot sooner, and shows icons only when even that is too narrow.'
            },
            disabledWhen: {not: {key: key}}
        }].concat(levelsGroup(keyStem, hint, null))
    };
}
// The Alerts card's rows and sheets, in the card's order. `subject` feeds the
// sheet intro; Pollen is DWD's alone, like the pollen slot itself.
var ALERT_KINDS = [
    {keyStem: 'Uv', label: 'UV index', title: 'UV index', subject: 'the UV index', icon: 'uv'},
    {keyStem: 'Wind', label: 'Wind speed', title: 'Wind speed', subject: 'the wind speed', icon: 'wind'},
    {keyStem: 'Gust', label: 'Wind gusts', title: 'Wind gusts', subject: 'the gust speed', icon: 'gust'},
    // AQI looks ahead only on an hourly forecast (AQI_DAY_PEAKS): WAQI — the default
    // source, and Auto whenever a station answers — has none, so alertValue judges
    // the current reading. The coda mirrors the slot sheet's source note.
    {keyStem: 'Aqi', label: 'Air quality', title: 'Air quality (AQI)', subject: 'the air quality index',
        icon: 'aqi', coda: ' Looking ahead needs the Open-Meteo AQI provider (General tab); with WAQI '
            + 'the alert judges the current reading.'},
    {keyStem: 'Pollen', label: 'Pollen', title: 'Pollen', subject: 'the pollen index', icon: 'pollen',
        gate: {key: 'provider', eq: 'dwd'},
        hint: 'DWD pollen index 0–3 (half-levels like "2-3" count as 2.5); DWD provider only.'}
];
/**
 * One Alerts card row — every alert, rain included, has this one shape: a badged
 * `sheet` row (icon + label, the alert's live state under the label, its colours as
 * dots, Edit). Nothing on the card is a control; each switch lives in its sheet.
 * @param {string} sheetId The alert's sheet, e.g. 'alertUv'.
 * @param {string} label Row label.
 * @param {string} icon Registered PConf.icons id (status-slot-icons.js).
 * @param {Object} showWhen The row's gate.
 * @param {Object} hintFrom The live-state hint resolver ({resolver, args}).
 * @param {string} keyStem The badge resolver's kind ('Rain' for the rain row).
 * @returns {Object} Schema item.
 */
function alertRow(sheetId, label, icon, showWhen, hintFrom, keyStem) {
    return {
        type: 'sheet',
        sheetId: sheetId,
        label: label,
        icon: icon,
        showWhen: showWhen,
        hintFrom: hintFrom,
        editBadgeFrom: {resolver: 'alertLevelBadge', args: {keyStem: keyStem}}
    };
}
/**
 * The Alerts card's rows: the no-Watch-Status-Bar note (shown only when the Default
 * view has no bar that places alerts), rain (radar-gated), the radar-off note, then
 * the five metric alerts (thresholds-gated — aplite has neither the row nor the
 * levels).
 * @returns {Object[]} The card's items, in order.
 */
function alertCardItems() {
    return [
        {
            // Nothing moves the alerts for the user: the note names the gap and the fix.
            type: 'staticText',
            style: 'info',
            text: 'Your Default view has no Watch Status Bar, so alerts won’t show there — pick a place in another status bar’s Alerts setting.',
            showWhen: {all: [{env: 'platform', ne: 'aplite'}, DEFAULT_VIEW_NO_ALERTS_WHEN]}
        },
        alertRow('alertRain', 'Rain', 'rain', RAIN_ALERT_WHEN,
            {resolver: 'rainAlertHint', args: {windows: RAIN_WINDOW_OPTIONS, looks: RAIN_LOOK_OPTIONS}},
            'Rain'),
        {
            type: 'staticText',
            style: 'info',
            text: 'Turn on the rain radar (Radar tab) to get rain alerts.',
            showWhen: {all: [{key: 'radarMode', eq: 'off'}, {env: 'platform', ne: 'aplite'}]}
        }
    ].concat(ALERT_KINDS.map(function (k) {
        return alertRow('alert' + k.keyStem, k.label, k.icon,
            k.gate ? {all: [THRESHOLD_WHEN, k.gate]} : THRESHOLD_WHEN,
            {resolver: 'alertLevelsHint', args: {keyStem: k.keyStem}}, k.keyStem);
    }));
}
// The per-bar Alerts placement: while an alert is active its icons REPLACE the chosen
// slot of that bar, and a second one when they need the room (the middle slot for Left
// and Right, the left slot for Middle — the right one usually holds the battery). Rides
// the Clay message (thresholds blob byte 35); the default is the contract's own
// (status-thresholds.js barAlertPlace: the top strip Left — where the rain countdown
// always took over — every other bar Off), so an untouched upgrade draws what it drew.
var ALERT_PLACE_HINT = 'While an alert is active the icons replace this slot, and the middle slot too when they need the room.';
// The top strip's Right: the low-battery warning keeps that slot (status_row.c
// alerts_layout moves the row to the middle while battery_override holds).
var ALERT_PLACE_TOP_RIGHT_HINT = ALERT_PLACE_HINT + ' While the low-battery warning shows, they move to the middle slot.';
/**
 * @param {string} bar 'top' | 'forecast' | 'radar' | 'health' (BAR_ALERT_KEYS).
 * @param {?Object} barWhen The bar's own gate (RADAR_BAR_WHEN …), or null.
 * @returns {Object} The bar's 'Alerts' select.
 */
function alertPlaceRow(bar, barWhen) {
    var key = null, i;
    for (i = 0; i < STATUS_THRESHOLDS.BAR_ALERT_KEYS.length; i++) {
        if (STATUS_THRESHOLDS.BAR_ALERT_KEYS[i].bar === bar) { key = STATUS_THRESHOLDS.BAR_ALERT_KEYS[i].key; }
    }
    return {
        type: 'select',
        messageKey: key,
        label: 'Alerts',
        defaultValue: STATUS_THRESHOLDS.barAlertPlace(null, bar),
        options: [['Off', 'off'], ['Left', 'left'], ['Middle', 'middle'], ['Right', 'right']],
        // No hint for Off: there is nothing to explain.
        hintByValue: {
            left: ALERT_PLACE_HINT,
            middle: 'While an alert is active the icons replace this slot, and the left slot too when they need the room.',
            right: bar === 'top' ? ALERT_PLACE_TOP_RIGHT_HINT : ALERT_PLACE_HINT
        },
        showWhen: barWhen ? {all: [THRESHOLD_WHEN, barWhen]} : THRESHOLD_WHEN
    };
}
/**
 * "This bar shows the Alerts row" as a showWhen predicate that resolves exactly as
 * status-thresholds.js barAlertPlace does: a bar whose default is Off (every bar but
 * the top strip) places alerts only on a stored Left/Middle/Right, while the top strip
 * — default Left — places them on anything but an explicit Off (absent or unknown
 * reads as Left). The default is read from the contract, not restated here.
 * @param {string} bar 'top' | 'forecast' | 'radar' | 'health' (BAR_ALERT_KEYS).
 * @returns {Object} The showWhen predicate.
 */
function barPlacesAlertsWhen(bar) {
    var key = null, i;
    for (i = 0; i < STATUS_THRESHOLDS.BAR_ALERT_KEYS.length; i++) {
        if (STATUS_THRESHOLDS.BAR_ALERT_KEYS[i].bar === bar) { key = STATUS_THRESHOLDS.BAR_ALERT_KEYS[i].key; }
    }
    if (STATUS_THRESHOLDS.barAlertPlace(null, bar) !== 'off') { return {key: key, ne: 'off'}; }
    var places = [];
    var all = Object.keys(STATUS_THRESHOLDS.BAR_ALERT_PLACES);
    for (i = 0; i < all.length; i++) {
        if (all[i] !== 'off') { places.push(all[i]); }
    }
    return {key: key, 'in': places};
}
/**
 * Whether a custom view's status seat (viewUpper<i> / viewLower<i>) shows a bar that
 * places alerts: the seat's source, kept only where the compiler keeps it
 * (view-cycle.js buildCustomCycle folds a radar or health seat away without its mode —
 * the same RADAR_ROW_MODES / HEALTH_ROW_MODES tables).
 * @param {string} seatKey The seat's settings key, e.g. 'viewUpper0'.
 * @returns {Object} The showWhen predicate.
 */
function seatPlacesAlertsWhen(seatKey) {
    return {any: [
        {all: [{key: seatKey, eq: 'weather'}, barPlacesAlertsWhen('forecast')]},
        {all: [{key: seatKey, eq: 'radar'}, {key: 'radarMode', 'in': VIEW_CYCLE.RADAR_ROW_MODES},
            barPlacesAlertsWhen('radar')]},
        {all: [{key: seatKey, eq: 'health'}, {key: 'healthMode', 'in': VIEW_CYCLE.HEALTH_ROW_MODES},
            barPlacesAlertsWhen('health')]}
    ]};
}
// The Default view has no Watch Status Bar AND none of the bars it does show places
// alerts — so no alert (rain or metric) is drawn there. Derived from view-cycle.js's
// own inputs: 'Weather only' drops the strip in every radar mode but 'Rain alert only'
// (its Default view is the forecast bar, plus the radar bar in radar mode 'Status');
// a custom layout drops it on its Default view's viewStripOff0, and shows the bars its
// two seats hold. The Alerts card's info box (#3 of the settings audit) says so; the
// watch does not move the alerts on its own.
var DEFAULT_VIEW_NO_ALERTS_WHEN = {any: [
    {all: [{key: 'layoutPreset', eq: 'weatherOnly'}, {key: 'radarMode', ne: 'countdown'},
        {not: {any: [barPlacesAlertsWhen('forecast'),
            {all: [{key: 'radarMode', eq: 'status'}, barPlacesAlertsWhen('radar')]}]}}]},
    {all: [{key: 'layoutPreset', eq: 'custom'}, {key: 'viewStripOff0'},
        {not: {any: [seatPlacesAlertsWhen('viewUpper0'), seatPlacesAlertsWhen('viewLower0')]}}]}
]};
// Radar mode 'Rain alert only' fetches the radar for the rain alert alone, yet no bar
// that exists in that mode places the Alerts row — the top strip, the forecast bar,
// and the health bar while it exists (the radar bar never shows in this mode, so its
// stored placement does not count). Shown in the Rain alert sheet and under the
// radar mode control.
var RAIN_ALERT_UNSHOWN_WHEN = {all: [{key: 'radarMode', eq: 'countdown'}, {env: 'platform', ne: 'aplite'},
    {not: {any: [barPlacesAlertsWhen('top'), barPlacesAlertsWhen('forecast'),
        {all: [HEALTH_BAR_WHEN, barPlacesAlertsWhen('health')]}]}}]};
/**
 * The 'Rain alert only' warning: an info box, shown while RAIN_ALERT_UNSHOWN_WHEN holds.
 * A fresh object per call, like every item.
 * @returns {Object} The info-box staticText.
 */
function rainAlertUnshownNote() {
    return {
        type: 'staticText',
        style: 'info',
        text: 'No status bar shows alerts, so the rain alert won’t appear. Pick a place in a status bar’s Alerts setting.',
        showWhen: RAIN_ALERT_UNSHOWN_WHEN
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
 * @param {Object[]} [extraItems] Kind-specific rows rendered BELOW the Bold row,
 *     e.g. Temp's display mode. Bold is the row every bold-only sheet has, so it
 *     leads and the kind-specific extras follow.
 * @returns {Object} Schema section (sheetOnly).
 */
function boldSection(title, keyStem, gate, extraItems) {
    var bold = {
        type: 'segmented',
        messageKey: 'thresh' + keyStem + 'BoldMode',
        label: 'Bold value',
        // Off is the default and needs no words; Always says how far it reaches.
        hintByValue: {always: BOLD_ALWAYS_HINT},
        defaultValue: 'off',
        options: [['Off', 'off'], ['Always', 'always']],
        disabledWhen: BOLD_ALL_WHEN
    };
    // Bold leads. In every other bold-only sheet it is the only control, so a Temp
    // sheet that opened with its display-mode row put the one row all these sheets
    // share in a different place on the one sheet that has company.
    var items = [bold].concat(extraItems || []);
    return sheetOf(keyStem, title, gateAll(items, gate));
}
// Pressure curve copy, pre-rendered per scale value. Derived from
// forecast-series.PRESSURE_SCALE_CURVE_HPA (the sole source of truth for the numbers)
// at module load, so the settings-screen copy can never drift from it the way a third
// hand-copied set of numbers could (preview-forecast.js's PRESSURE_CURVES is the second copy,
// guarded by its own drift test — see test/config-blocks.test.js). The scale is fixed
// and absolute but piecewise (rain-bar style): the copy quotes the full-detail core;
// readings outside it compress toward 940/1060 instead of clipping.
/**
 * Build one pressureScale hint line from the shared curve table.
 * @param {string} scale 'low'|'mid'|'high'.
 * @param {string} tail Descriptive text appended after the core lead-in.
 * @returns {string} Full hint string.
 */
function pressureHint(scale, tail) {
    var pts = PRESSURE_SCALE_CURVE_HPA[scale];
    return 'Full detail ' + pts[1][0] + '\u2013' + pts[2][0] + ' hPa, extremes compressed instead of cut off — ' + tail;
}
var PRESSURE_SCALE_HINTS = {
    low:  pressureHint('low', 'magnifies the smallest movements.'),
    mid:  pressureHint('mid', 'a typical day\'s swing reads clearly.'),
    high: pressureHint('high', 'keeps storm-depth swings in the detailed range.')
};
/**
 * One pressureScale control for a line-context. Unlike windScaleCopy this needs no
 * per-unit duplication — pressure ships hPa only, so one copy per context is enough.
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @returns {Object} Schema item.
 */
function pressureScaleCopy(pickerKey) {
    var when = lineContextWhen(pickerKey, function (key) {
        return {key: key, eq: 'pressure'};
    });
    return {
        type: 'segmented',
        messageKey: 'pressureScale',
        label: 'Pressure graph scale',
        defaultValue: 'mid',
        joinPrevious: true,
        hintByValue: PRESSURE_SCALE_HINTS,
        // Narrow/Mid/Wide rather than windScale's Low/Mid/High: "Low" next to a
        // pressure graph reads as *low pressure*, not *narrow band*. The stored
        // values stay low|mid|high so the code vocabulary matches windScale.
        options: [['Narrow', 'low'], ['Mid', 'mid'], ['Wide', 'high']],
        showWhen: when.length === 1 ? when[0] : {all: when}
    };
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
    // Rainbow's terms ask for a "Powered by Rainbow.ai" link wherever its data shows.
    // The note says why the shared radar is limited: the developer pays for the calls
    // every user shares, and the rainbow-nowcast proxy caps that account at
    // RAINBOW_MONTHLY_BUDGET upstream calls (DEV.md; default the free 5,000), so past it
    // users get no fresh radar rather than a bill. The "Use your own key" switch under
    // the picker (rainbowOwnKey) moves the radar onto the user's own Rainbow account.
    rainbow: 'A worldwide nowcast blending satellite and radar. I pay for the Rainbow calls everyone shares, and with a growing number of users I can only provide a limited number of them, so the shared radar refreshes at most every 30 minutes. Turn on “Use your own key” for a refresh at every update — a key is free. Powered by <a target=\'_blank\' href=\'https://rainbow.ai\'>Rainbow.ai</a>.',
    tomorrowio: 'A precise ML rain nowcast, worldwide. Uses your tomorrow.io API key (nothing works without one) and counts against the same call budget.'
};
// The radar picker's options in order. desc (3rd tuple slot) = the short "what it's best at"
// tag under each name in the dropdown, mirroring the weather picker. DWD/Met.no are real
// radar; Rainbow/Tomorrow.io are model nowcasts (Tomorrow.io is the precise, worldwide one).
// Scope lives in the desc + "why" note, not the label (keeps the trigger short). Rainbow's
// label is the one that isn't static: the radarProviderOptions resolver (blocks.js) shows it
// as "Rainbow (limited)" until the user's own key is in use.
var RADAR_PROVIDER_OPTIONS = [
    ['DWD', 'dwd', {desc: 'Best radar in Germany · exact spot + nearby'}],
    ['Met.no', 'metno', {desc: 'Best radar in the Nordics · exact spot'}],
    ['Rainbow', 'rainbow', {desc: 'Worldwide satellite + radar nowcast'}],
    ['Tomorrow.io', 'tomorrowio', {desc: 'Precise ML rain nowcast, worldwide · uses your key'}]
];
// The tomorrow.io key + budget guard render under whichever picker actually uses the key:
// the General tab when it's the WEATHER provider, the Radar tab when it's radar-only (so the
// key never sits in the weather section for a non-weather provider). Both contexts reuse the
// same messageKeys (mutually-exclusive showWhen, like the theme color/B&W split).
var TOMORROWIO_WEATHER_WHEN = {key: 'provider', eq: 'tomorrowio'};
var TOMORROWIO_RADAR_ONLY_WHEN = {all: [{key: 'radarProvider', eq: 'tomorrowio'}, {key: 'provider', ne: 'tomorrowio'}]};
// The Rainbow radar's "Use your own key" switch sits under the radar picker while Rainbow
// drives a running radar; the key + budget guard follow it only while the switch is on
// (the runtime then fetches the own-key source, radar-source-id.js). The radarMode clause
// keeps them all hidden with radar off, when no Rainbow call is made.
var RAINBOW_WHEN = {all: [{key: 'radarProvider', eq: 'rainbow'}, {key: 'radarMode', ne: 'off'}]};
var RAINBOW_OWN_KEY_WHEN = {all: [{key: 'radarProvider', eq: 'rainbow'}, {key: 'radarMode', ne: 'off'},
    {key: 'rainbowOwnKey', eq: true}]};
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
 * A status bar's six interleaved items — left/mid/right selects, each followed
 * by its countdown companion date row — all sharing the bar's gate. Mid and
 * right always join the row above; the left slot joins only when the bar opens
 * with its own intro row (the Watch bar's aplite-hidden incoming-rain note).
 * @param {string} prefix Slot-key prefix, e.g. 'statusForecast'.
 * @param {?Object} barWhen The bar's shared visibility gate (null = always).
 * @param {boolean} [leftJoins] The left slot joins the previous row too.
 * @returns {Object[]} Six schema items in render order.
 */
function barSlots(prefix, barWhen, leftJoins) {
    return [
        slotItem(prefix + 'Left', 'left', barWhen, Boolean(leftJoins)),
        countdownDateItem(prefix + 'Left', barWhen),
        slotItem(prefix + 'Mid', 'mid', barWhen, true),
        countdownDateItem(prefix + 'Mid', barWhen),
        slotItem(prefix + 'Right', 'right', barWhen, true),
        countdownDateItem(prefix + 'Right', barWhen)
    ];
}
// The signup link opens in an external browser (target=_blank). The Development > API Keys page 404s on
// tomorrow.io's MOBILE site, so it gets a copy button instead of a (useless-on-mobile) link — users copy
// the URL and open it in desktop-site mode. See copyBtn() + the engine's [data-copy] handler.
var TOMORROWIO_KEY_HINT = '<a target=\'_blank\' href=\'https://app.tomorrow.io/signup\'>Create a free tomorrow.io account</a> (no credit card needed), then open <b>https://app.tomorrow.io/development/keys</b>' + copyBtn('https://app.tomorrow.io/development/keys', 'Copy the API-keys page link') + ', copy your key and paste it here, then Test it. The free plan is plenty — see the call budget below.<br><b>IMPORTANT: On a phone, tomorrow.io\'s mobile site shows an error (404) on the API-keys page — tap the copy button, then open the link in your browser\'s desktop-site mode.</b>';
var TOMORROWIO_BUDGET_HINT = 'Only offer update intervals that fit the free plan. Turn off to pick any interval — over-budget calls are rejected by tomorrow.io until the limit resets, and the watch keeps its last data.';
// Rainbow's terms (developer.rainbow.ai, checked 2026-09-25): signup takes payment details, the
// Nowcast API's first 5,000 calls each calendar month are free, then $0.10 per 1,000.
var RAINBOW_KEY_HINT = '<b>How to get a key:</b><br>1. <a target=\'_blank\' href=\'https://developer.rainbow.ai/signup/\'>Sign up at developer.rainbow.ai</a>. Rainbow asks for a credit card, but the first 5,000 calls each month are free.<br>2. Open your <a target=\'_blank\' href=\'https://developer.rainbow.ai/profile\'>profile page</a>' + copyBtn('https://developer.rainbow.ai/profile', 'Copy the profile page link') + ', copy the API key and paste it here.<br>3. Tap Test.<br>Keep "Fit update interval to rate limit" on and the watch stays within the free 5,000 calls.';
var RAINBOW_BUDGET_HINT = 'Only offer update intervals that fit the free 5,000 calls a month. Turn off to pick any interval — Rainbow bills calls past 5,000 to your card at $0.10 per 1,000.';
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
                type: 'text',
                messageKey: 'owmApiKey',
                label: 'OpenWeatherMap API key',
                defaultValue: '',
                joinPrevious: 'loose',
                suffixAction: 'testOwmKey',
                suffixLabel: 'Test',
                hint: '<a href=\'https://openweathermap.org/\'>Register an OpenWeatherMap account</a> and paste your API key here, then Test it. The key must be subscribed to <a href=\'https://openweathermap.org/api/one-call-3\'>One Call API 3.0</a> (it has a free allowance) or fetches fail with a 401.',
                showWhen: {key: 'provider', eq: 'openweathermap'}
            }, {
                type: 'text',
                messageKey: 'yandexApiKey',
                label: 'Yandex Weather API key',
                defaultValue: '',
                joinPrevious: 'loose',
                hint: 'Register a Yandex Weather API key at <a href=\'https://yandex.com/dev/weather/\'>yandex.com/dev/weather</a> and paste it here.',
                showWhen: {key: 'provider', eq: 'yandex'}
            }, {
                // Shown here only when tomorrow.io is the WEATHER provider; when it's radar-only the
                // same key + budget guard render in the Radar tab instead (see TOMORROWIO_RADAR_ONLY_WHEN).
                type: 'text',
                messageKey: 'tomorrowioApiKey',
                label: 'Tomorrow.io API key',
                defaultValue: '',
                joinPrevious: 'loose',
                suffixAction: 'testTomorrowioKey',
                suffixLabel: 'Test',
                hint: TOMORROWIO_KEY_HINT,
                showWhen: TOMORROWIO_WEATHER_WHEN
            }, {
                type: 'toggle',
                messageKey: 'tomorrowioFitBudget',
                label: 'Fit update interval to rate limit',
                defaultValue: true,
                joinPrevious: 'loose',
                // blockBefore: the usage read-out sits between the API key field and this
                // toggle, joined into the same tomorrow.io group.
                blockBefore: 'tomorrowioBudget',
                hint: TOMORROWIO_BUDGET_HINT,
                showWhen: TOMORROWIO_WEATHER_WHEN
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
        }, {
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
            lineStyleCopy('secondaryLine'),
            {
                type: 'toggle',
                messageKey: 'secondaryLineFill',
                label: 'Fill area below the line',
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
            {
                type: 'select',
                messageKey: 'thirdLine',
                label: 'Second metric',
                defaultValue: 'uv',
                hintFrom: METRIC_HINT_FROM,
                optionsFrom: {resolver: 'forecastMetric', args: {off: true, exclude: ['secondaryLine']}}
            },
            lineStyleCopy('thirdLine', true),
            windScaleCopy('thirdLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('thirdLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('thirdLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('thirdLine'),
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
            lineStyleCopy('fourthLine', true),
            windScaleCopy('fourthLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('fourthLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('fourthLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('fourthLine'),
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
            lineStyleCopy('fifthLine', true),
            windScaleCopy('fifthLine', 'kph', WIND_SCALE_HINTS_KPH),
            windScaleCopy('fifthLine', 'mph', WIND_SCALE_HINTS_MPH),
            windScaleCopy('fifthLine', 'knots', WIND_SCALE_HINTS_KNOTS),
            pressureScaleCopy('fifthLine'),
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
                type: 'toggle',
                messageKey: 'dayNightShading',
                label: 'Day / night shading',
                defaultValue: true,
                hint: 'Hatches the hours between sunset and sunrise.'
            }]
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
                    // No radar bar or graph in this mode: the alert's place is each bar's Alerts
                    // select (Status slots tab), not the Layout tab the intro names.
                    countdown: 'Fetches the radar only for the rain alert — no radar bar or graph. Each status bar’s Alerts setting (Status slots tab) sets where it shows; its time window is under Status slots → Alerts.',
                    status: 'Adds the Radar Status Bar.',
                    graph: 'Adds the Radar Status Bar and the full radar rain graph.'
                },
                // 'Rain alert only' — the VALUE stays 'countdown' (stored + telemetry): the
                // mode fetches radar solely for the rain alert, which the Alerts row draws.
                options: [['Off', 'off'], ['Rain alert only', 'countdown'], ['Status bar', 'status'], ['Status + Graph', 'graph']],
                onChange: 'resetStatusRadar'
            }, rainAlertUnshownNote(), {
                type: 'select',
                messageKey: 'radarProvider',
                label: 'Radar provider',
                defaultValue: 'rainbow',
                showWhen: {key: 'radarMode', ne: 'off'},
                // Flags the country-matched option "(Recommended)" (DE→DWD, Nordics→Met.no, else→Rainbow),
                // the same map the wizard uses. See blocks.js recommend resolvers.
                recommendFrom: 'recommendedRadarProvider',
                // One Rainbow option (id 'rainbow') with a "Use your own key" switch under the
                // picker (rainbowOwnKey). Switch off: the shared proxy, at most every 30 min
                // (fetch-cycle.js throttle); builds without a proxy endpoint still show it and
                // clear the radar. Switch on: api.rainbow.ai directly on the user's key, at
                // every update, which works without the endpoint. radar-source-id.js resolves
                // the pair to the runtime's source id ('rainbow' / 'rainbowkey').
                // The selected provider's fuller rationale renders via hintByValue (RADAR_WHY),
                // wrapping around the trigger — mirroring the weather picker.
                hintByValue: RADAR_WHY,
                // RADAR_PROVIDER_OPTIONS through a resolver so the Rainbow option can say which
                // key it runs on: "Rainbow (limited)" on the shared one, "Rainbow" once the switch
                // is on AND a key is entered (blocks.js radarProviderOptions). The label follows
                // the switch at once (a toggle re-renders the page) and the key field when it
                // commits — blur/Enter (the engine relabels triggers in place on a text commit).
                optionsFrom: {resolver: 'radarProviderOptions', args: {options: RADAR_PROVIDER_OPTIONS}}
            }, {
                // Rainbow on the user's own key instead of the shared one. Phone-only (never on the
                // watch wire): radar-source-id.js turns Rainbow + this switch into the 'rainbowkey'
                // source, and flipping it changes that source, so index.js forces a fetch on Save.
                type: 'toggle',
                messageKey: 'rainbowOwnKey',
                label: 'Use your own key',
                defaultValue: false,
                joinPrevious: 'loose',
                hint: 'Refreshes the radar at every update on your own Rainbow key instead of every 30 minutes. '
                    + 'A key is free: Rainbow\'s free plan covers 5,000 calls a month.',
                showWhen: RAINBOW_WHEN
            }, {
                // The user's own Rainbow key, shown while "Use your own key" is on. Never on the
                // watch wire; kept through Reset (clay-settings.js PRESERVED_SETTING_KEYS), trimmed
                // + refetch-forcing on Save (onbuild.js).
                type: 'text',
                messageKey: 'rainbowApiKey',
                label: 'Rainbow API key',
                defaultValue: '',
                joinPrevious: 'loose',
                suffixAction: 'testRainbowKey',
                suffixLabel: 'Test',
                hint: RAINBOW_KEY_HINT,
                showWhen: RAINBOW_OWN_KEY_WHEN
            }, {
                type: 'toggle',
                messageKey: 'rainbowFitBudget',
                label: 'Fit update interval to rate limit',
                defaultValue: true,
                joinPrevious: 'loose',
                // The monthly-usage read-out sits between the key field and this toggle.
                blockBefore: 'rainbowBudget',
                hint: RAINBOW_BUDGET_HINT,
                showWhen: RAINBOW_OWN_KEY_WHEN
            }, {
                // Tomorrow.io key + budget guard, radar-only: shown here (under the radar picker) when
                // tomorrow.io drives the radar but is NOT the weather provider, so the key isn't orphaned
                // in the weather section. Same messageKeys as the General-tab pair (mutually exclusive).
                type: 'text',
                messageKey: 'tomorrowioApiKey',
                label: 'Tomorrow.io API key',
                defaultValue: '',
                joinPrevious: 'loose',
                suffixAction: 'testTomorrowioKey',
                suffixLabel: 'Test',
                hint: TOMORROWIO_KEY_HINT,
                showWhen: TOMORROWIO_RADAR_ONLY_WHEN
            }, {
                type: 'toggle',
                messageKey: 'tomorrowioFitBudget',
                label: 'Fit update interval to rate limit',
                defaultValue: true,
                joinPrevious: 'loose',
                blockBefore: 'tomorrowioBudget',
                hint: TOMORROWIO_BUDGET_HINT,
                showWhen: TOMORROWIO_RADAR_ONLY_WHEN
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
                // The radar's sky rows (radar-sky.js): an extra Open-Meteo request per
                // fetch, on by default (a missing key reads as on everywhere: radar-sky.js
                // skySourceIdFor, index.js, telemetry.js). Only the radar GRAPH draws them,
                // like the no-rain text below; fetch-cycle.js (radarSky.skySourceIdFor) clears
                // them whenever the graph is not shown.
                type: 'toggle',
                messageKey: 'radarSky',
                label: 'Clouds, sun & lightning',
                defaultValue: true,
                hint: 'Adds two thin stripes under the radar\'s time axis: cloud cover and sunshine for the next two hours, with a lightning bolt where thunderstorms are expected. Uses Open-Meteo, whatever the radar source.',
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
            // The rain countdown's time window (rainCountdownHorizon) used to close this
            // section; it moved to the Status slots tab's Alerts card, next to the
            // other alerts. One key, one row: the engine has no deep links, and two
            // live copies of a key would be a first.
        }]
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
        // Label renamed 'Watch' → 'Status slots' when Time/Calendar moved to the
        // Layout tab; the id stays 'watch' — deep links and tests key on it.
        id: 'watch', label: 'Status slots', sections: [{
            // The Alerts card: a card of its own, ABOVE the status card. Six rows of one
            // shape (alertCardItems — icon, label, the alert's live state, Edit); every
            // switch, level and look lives in the alert's sheet. Where the icons show is
            // per bar (each bar's 'Alerts' select in the card below). Every row carries
            // its own gate; the section-level showWhen is only their union, because a
            // section with an intro never counts as empty (engine buildSectionBody) —
            // without it the title and intro would outlive their rows on aplite, which
            // has neither the rain radar nor the Alerts row. The reset chip reverts the
            // alerts' switches and looks and the rain time window (blocks.js
            // resetAlerts); the levels keep their own reset in each sheet, the
            // placements ride the status card's reset. The intro states the icon's look
            // as the watch draws it (status_alerts.c): a danger box always, a warn box
            // only on a set warn accent ('Outline on warn'), whatever the slot's
            // Highlight; the rain drop is tinted per tier on color and never boxed.
            title: 'Alerts',
            showWhen: {any: [THRESHOLD_WHEN, {env: 'platform', ne: 'aplite'}]},
            intro: 'One icon per active alert — filled at danger, and outlined at warn if its “Outline on warn” is on. On color watches the rain drop takes the radar’s rain color. Each status bar below chooses where they appear.'
                + ' <button type="button" class="txt-act-btn" data-action="resetAlerts">Reset alerts to defaults</button>',
            items: alertCardItems()
        }, {
            // The intro + the four status-bar sections share one groupCard so they render as a
            // single card (each title becomes an in-card sub-header). Time/Calendar below stay
            // their own cards.
            groupCard: 'watchStatus',
            // The intro's reset chip reverts every slot AND the bold settings in one
            // tap (blocks.js resetStatusSlots — the engine injects section intros as
            // raw HTML and dispatches [data-action] clicks globally). Deliberately
            // NOT thresholds-gated: aplite has slots but no bold machinery, and
            // "status bars" stays truthful there either way.
            intro: 'Every view has its own status bar — one row with a left, middle, and right slot you can fill with weather, time, health, and more. Choose what each view shows below.'
                + ' <button type="button" class="txt-act-btn" data-action="resetStatusSlots">Reset status bars to defaults</button>',
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
                        perSlot: 'Each slot’s edit sheet sets its own Bold value.',
                        all: 'Every slot value prints in heavier text.'
                    },
                    defaultValue: 'perSlot',
                    options: [['Per slot', 'perSlot'], ['All', 'all']],
                    showWhen: THRESHOLD_WHEN
                }
            ]
        }, {
            groupCard: 'watchStatus',
            title: 'Forecast Status Bar',
            items: barSlots('statusForecast', null).concat([alertPlaceRow('forecast', null)])
        }, {
            groupCard: 'watchStatus',
            title: 'Radar Status Bar',
            items: barSlots('statusRadar', RADAR_BAR_WHEN).concat([alertPlaceRow('radar', RADAR_BAR_WHEN)])
        }, {
            groupCard: 'watchStatus',
            title: 'Health Status Bar',
            items: barSlots('statusHealth', HEALTH_BAR_WHEN).concat([alertPlaceRow('health', HEALTH_BAR_WHEN)])
        }, {
            groupCard: 'watchStatus',
            title: 'Watch Status Bar',
            // No takeover note here any more: the bar's own Alerts select below explains
            // each placement by value, and a note above the slots said the same thing
            // (and got the Middle case wrong).
            items: barSlots('statusTop', null).concat([
                alertPlaceRow('top', null),
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
                    options: [['Disconnected', 'disconnected'], ['Connected', 'connected'], ['Both', 'both'], ['None', 'none']]
                }
            ])
        },
        // Threshold edit sheets (sheetOnly): reachable only through the pencil next to a
        // status slot whose selected value has thresholds — never rendered as cards here.
        // The AQI day max needs an hourly forecast, which only the Open-Meteo source
        // has: on WAQI's current reading every mode prints that reading alone. The
        // note closes the Alert and Both hints for the source that cannot give a
        // peak — WAQI (the default, so an absent key reads as it), and Auto, which
        // reads WAQI whenever a station answers; Open-Meteo gets none.
        thresholdSection('Air quality (AQI)', 'Aqi', '', null, dayMaxRows('aqi', 'AQI selection', {
            keyStem: 'Aqi',
            subject: 'the AQI is',
            notes: {
                key: 'aqiSource',
                fallback: 'waqi',
                byValue: {
                    waqi: ' Your AQI provider (WAQI) has no forecast, so the current reading shows.',
                    auto: ' Auto mostly reads WAQI, which has no forecast — then the current reading shows.'
                },
                generic: ' The peak needs the Open-Meteo AQI provider (General tab).'
            }
        }, '42', '58'), [alertLevelsNote()]),
        // Pollen's scale hint rides its levels group, in the Alerts card's sheet.
        thresholdSection('Pollen', 'Pollen', '', null, null, [alertLevelsNote()]),
        // Wind and gust each carry their own direction arrow: the two slots often sit
        // side by side, and one arrow drawn twice is noise — so the choice is per kind,
        // not global. The phone bakes the arrow into the slot text (status-lines.js
        // appends a trailing sentinel byte), and both keys ride renderSignature(), so
        // flipping one re-bakes without waiting for the next fetch.
        // Wind, gusts and AQI carry UV's display modes (dayMaxRows), each kind its own.
        thresholdSection('Wind speed', 'Wind', '', null, dayMaxRows('wind', 'Wind selection', {
            keyStem: 'Wind',
            subject: 'the wind is'
        }, '12', '30').concat([{
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
        }, unitRow('windSlotUnit', null, null)]), [alertLevelsNote()]),
        thresholdSection('Wind gusts', 'Gust', '', null, dayMaxRows('gust', 'Gust selection', {
            keyStem: 'Gust',
            subject: 'gusts are'
        }, '20', '45').concat([{
            type: 'toggle',
            messageKey: 'gustSlotDirection',
            label: 'Show wind direction',
            defaultValue: false,
            hint: WIND_DIRECTION_HINT
        }, unitRow('gustSlotUnit', null, null)]), [alertLevelsNote()]),
        // The UV slot's display mode — the temp slot's tempSlotDisplay pattern: global
        // per-kind, baked phone-side (status-lines.js formatValue), and on
        // renderSignature() so a change re-bakes without waiting for the next fetch.
        // What each mode prints is wire-units' dayMaxShown.
        // It sits between Bold and the levels pointer like the wind arrow: it configures
        // the slot, and the highlight follows it (the policy is status-thresholds.js
        // displayValue's). So do the rows shaping how it reads, which change the
        // text only — the highlight judges the numbers, never their presentation.
        thresholdSection('UV index', 'Uv', '', null, dayMaxRows('uv', 'UV selection', {
            keyStem: 'Uv',
            subject: 'UV is'
        }, '3', '7'), [alertLevelsNote()]),
        thresholdSection('Steps', 'Steps',
            'Steps per day.', HEALTH_SLOT_WHEN),
        thresholdSection('Sleep', 'Sleep',
            'Hours of sleep, e.g. 7.5.', HEALTH_SLOT_WHEN),
        thresholdSection('Walked distance', 'Distance',
            'Distance walked per day.', HEALTH_SLOT_WHEN),
        // Bold-only sheets for the level-less slot kinds (same pencil, one row —
        // plus the display rows a few kinds add below it: Temp's mode and pair,
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
            // below shape — 12/10, actual first, until someone picks otherwise; a
            // missing feels-like value falls back to the actual temp alone.
            type: 'segmented',
            messageKey: 'tempSlotDisplay',
            label: 'Temperature selection',
            // The selected mode only; the measured temperature (the default) needs none.
            hintByValue: {
                feels: 'What it feels like, by the formula set under General → Units.',
                both: 'Both, like 12/10 — choose the separator and order below.'
            },
            defaultValue: 'actual',
            options: [['Temp', 'actual'], ['Feels like', 'feels'], ['Both', 'both']],
            // Picking Both clears the degree: "-12/-10" is already 7 of an edge
            // slot's 8 bytes and the sign is two more, so the pair cannot fit.
            // Clearing it here is the fill-vs-feels pattern (forecastMetricFill).
            onChange: 'tempUnitExclusive'
        }].concat(pairRows('temp', '12', '10',
            [['Temp first', 'actual'], ['Feels like first', 'feels']]), [
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
        boldSection('Phone battery', 'PhoneBattery'),
        // The Alerts card's sheets (sheetOnly, opened from the card's rows), in the
        // card's row order: rain, then one per metric alert kind holding its switch,
        // its Look and its levels (the levels' one home).
        rainAlertSheet()].concat(ALERT_KINDS.map(function (k) {
            return alertSheet(k.keyStem, k.title, k.subject, k.hint || '', k.coda || '');
        }))
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
                    countdown: 'No calendar — the top bar, where the rain alert shows by default, then the clock, weather and a big forecast.',
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
