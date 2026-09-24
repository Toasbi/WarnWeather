// src/pkjs/settings/custom-layout-schema.js — ES5, PKJS-parsed. The Custom-layout
// block of the settings schema, split out of schema.js: the per-view storage items
// (the editor's contract), the sheetOnly section hosting them, and the Edit-button
// row. Plain CommonJS with an unguarded require(), exactly like schema.js itself —
// the schema is evaluated at build time / in PKJS, never as a flat browser file.
// Split so the capability gates can be BUILT from view-cycle.js's mode lists:
// one table, three consumers (compiler, editor, these sheets).
var viewCycle = require('../view-cycle.js');

// ── Custom layout: per-view keys (the editor's storage contract) ────────────
// One item per element choice per view slot (0 = Default, 1-2 = flicks). They live
// in a sheetOnly section so the tab renderer skips them while hydrate/serialize
// keep them in the settings blob; the Custom-layout editor (view-editor.js)
// renders its own reorderable rows from these keys and opens the engine's select
// sheets on them. Key names + string values are the compiler contract — see
// buildCustomCycle in src/pkjs/view-cycle.js. Capability gating is
// visible-but-inert (optionDisabledWhen), mirroring the compiler's folds; the WHEN
// predicates are built from view-cycle.js's mode lists (RADAR_CHART_MODES & co. —
// the same arrays buildCustomCycle's capabilities() reads), so the sheets can
// never drift from the compiler: chart seats need radarMode 'graph'; the radar
// status source needs status|graph; a health graph body needs healthMode 'all';
// health rows need status|all.
var VIEW_RADAR_CHART_WHEN = {key: 'radarMode', in: viewCycle.RADAR_CHART_MODES};
var VIEW_RADAR_ROW_WHEN = {key: 'radarMode', in: viewCycle.RADAR_ROW_MODES};
var VIEW_HEALTH_ROW_WHEN = {key: 'healthMode', in: viewCycle.HEALTH_ROW_MODES};
var VIEW_HEALTH_BODY_WHEN = {key: 'healthMode', in: viewCycle.HEALTH_BODY_MODES};
// No 'Off' entry: removal is the editor row's ✕ button — a duplicate Off pick in
// the sheet would be a second way to do the same thing. 'off' stays a legal STORED
// value (what ✕ writes); the sheet is only openable while the row is present.
var VIEW_SRC_OPTIONS = [['Weather', 'weather'],
                        ['Radar', 'radar'], ['Health', 'health']];
var VIEW_SRC_GATES = {
    radar: {not: VIEW_RADAR_ROW_WHEN},
    health: {not: VIEW_HEALTH_ROW_WHEN}
};

/**
 * The per-view custom-layout items for view slot `i`.
 * @param {number} i View slot (0 = Default, 1-2 = flicks).
 * @returns {Object[]} Schema items.
 */
function customViewItems(i) {
    var items = [{
        type: 'radio', messageKey: 'viewTop' + i, label: 'Top area',
        defaultValue: 'cal2',
        // No 'Nothing' entry: removal is the editor row's ✕ button; 'none' stays a
        // legal STORED value (what ✕ writes). A graph here (custom layout v2) is the
        // same graph as the Graph row's — one seat per kind; the editor moves it.
        options: [['Calendar — 3 rows', 'cal3'], ['Calendar — 2 rows', 'cal2'],
                  ['Rain radar', 'radar'], ['Forecast graph', 'forecast'],
                  ['Health graph', 'health']],
        optionDisabledWhen: {radar: {not: VIEW_RADAR_CHART_WHEN},
                             health: {not: VIEW_HEALTH_BODY_WHEN}}
    }, {
        type: 'radio', messageKey: 'viewBody' + i, label: 'Graph',
        defaultValue: 'forecast',
        options: [['Forecast graph', 'forecast'], ['Health graph', 'health'],
                  ['Rain radar', 'radar']],
        optionDisabledWhen: {health: {not: VIEW_HEALTH_BODY_WHEN},
                             radar: {not: VIEW_RADAR_CHART_WHEN}}
    }, {
        type: 'radio', messageKey: 'viewUpper' + i, label: 'Status bar',
        defaultValue: i === 0 ? 'weather' : 'off',
        options: VIEW_SRC_OPTIONS, optionDisabledWhen: VIEW_SRC_GATES
    }, {
        type: 'radio', messageKey: 'viewLower' + i, label: 'Second status bar',
        defaultValue: 'off',
        options: VIEW_SRC_OPTIONS, optionDisabledWhen: VIEW_SRC_GATES
    }, {
        // Machine value the editor's ▲▼ buttons write (a STACK_ORDERS sequence
        // string, e.g. 'CTAB'); never opened as a sheet.
        type: 'hidden', messageKey: 'viewOrder' + i, defaultValue: 'TACB'
    }, {
        // The editor's inline segmented controls write these three (never sheets).
        // Top-area size — read only for a radar/graph top: '2'|'3'|'4'|'fill'.
        type: 'hidden', messageKey: 'viewTopSize' + i, defaultValue: '3'
    }, {
        // Graph-band size: '2'|'3'|'4'|'fill' (fill = the space left, today's graph).
        type: 'hidden', messageKey: 'viewBodySize' + i, defaultValue: 'fill'
    }, {
        // Position of a stack nothing fills: 'clock'|'top'|'center'|'bottom'.
        type: 'hidden', messageKey: 'viewAlign' + i, defaultValue: 'clock'
    }];
    if (i > 0) {   // the Default view always keeps its clock and top bar
        items.push({type: 'hidden', messageKey: 'viewClockOff' + i, defaultValue: false});
        items.push({type: 'hidden', messageKey: 'viewStripOff' + i, defaultValue: false});
    }
    return items;
}

// A standard settings row with the outlined Edit button on the right
// (the per-slot edit-sheet look), not a full-width button. staticText
// + [data-action] is the shipped idiom for an action inside a row
// (the "Reset status bars" row); the engine dispatches it globally.
// Layout/typography live in shell.html's .row-action* classes.
var editRow = {
    type: 'staticText',
    // hint copy rides inside the row: staticText items don't render `hint`.
    text: '<div class="row-action">'
        + '<span class="row-action-title">Custom layout'
        + '<span class="row-action-sub">Choose what each view shows, where, and how big.</span></span>'
        + '<button type="button" class="thr-btn" data-action="openViewEditor"'
        + ' aria-label="Edit the custom layout">Edit</button></div>',
    // Platform-gated like the option itself: a DORMANT stored 'custom'
    // (set on a colour watch, then the phone pairs an aplite) displays
    // the compactCal fallback — the editor row must not leak in
    // beside it. ne keeps the unknown-platform case capable, matching
    // layoutPresetOptions and the clay-payload gate.
    showWhen: {all: [{key: 'layoutPreset', eq: 'custom'},
                     {env: 'platform', ne: 'aplite'}]}
};

// Custom-layout storage (see customViewItems above): sheetOnly keeps the
// items out of the tab while their sheets stay openable and their values
// hydrate/serialize with the blob. viewCount = how many views exist;
// customLayoutSeeded latches the one-time preset copy.
var storageSection = {
    sheetOnly: true,
    sheetId: 'viewEditKeys',
    title: 'Custom layout',
    items: [
        {type: 'hidden', messageKey: 'viewCount', defaultValue: '1'},
        {type: 'hidden', messageKey: 'customLayoutSeeded', defaultValue: false}
    ].concat(customViewItems(0), customViewItems(1), customViewItems(2))
};

module.exports = {
    customViewItems: customViewItems,
    editRow: editRow,
    storageSection: storageSection
};
