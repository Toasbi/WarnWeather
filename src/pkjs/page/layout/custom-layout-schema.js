// src/pkjs/page/layout/custom-layout-schema.js — ES5, PKJS-parsed. The custom layout's
// block of the settings schema, split out of schema.js: the per-view storage items (the
// screens' storage, screens.js) and the sheetOnly section hosting them, with the modes
// worked out from the screens. Plain CommonJS, exactly like schema.js itself — the schema
// is evaluated at build time / in PKJS, never as a flat browser file.

// ── Custom layout: per-view keys (the screens' storage contract) ────────────
// One hidden item per key per view slot (0 = Default, 1-2 = flicks), in a sheetOnly
// section so the tab renderer skips them while hydrate/serialize keep them in the
// settings blob. The screen editor (screens-page.js, through screens.js compileKeys)
// writes them one screen at a time; nothing on the page shows them as rows. Key names
// and string values are the compiler contract: buildCustomCycle in view-cycle.js, whose
// folds follow the modes worked out from the screens (screens.js deriveModes).
/**
 * The per-view custom-layout items for view slot `i`.
 * @param {number} i View slot (0 = Default, 1-2 = flicks).
 * @returns {Object[]} Schema items.
 */
function customViewItems(i) {
    var items = [
        // The top area: 'cal' (its 2 or 3 rows in viewTopSize), 'radar', 'forecast' or
        // 'health' (a graph on top), 'none'. 'cal2' / 'cal3' remain legal stored values
        // from older builds.
        {type: 'hidden', messageKey: 'viewTop' + i, defaultValue: 'cal'},
        // The graph at the bottom: 'forecast', 'health', 'radar' or 'none'.
        {type: 'hidden', messageKey: 'viewBody' + i, defaultValue: 'forecast'},
        // The two status bars: 'weather' (the Forecast bar), 'radar', 'health' or 'off'.
        {type: 'hidden', messageKey: 'viewUpper' + i, defaultValue: i === 0 ? 'weather' : 'off'},
        {type: 'hidden', messageKey: 'viewLower' + i, defaultValue: 'off'},
        // The bands' order: a STACK_ORDERS sequence string, e.g. 'CTAB'.
        {type: 'hidden', messageKey: 'viewOrder' + i, defaultValue: 'TACB'},
        // Top-area size — read only for a radar/graph top: '2'|'3'|'4'|'fill'.
        {type: 'hidden', messageKey: 'viewTopSize' + i, defaultValue: '3'},
        // Graph-band size: '2'|'3'|'4'|'fill' (fill = the space left, today's graph).
        {type: 'hidden', messageKey: 'viewBodySize' + i, defaultValue: 'fill'},
        // Position of a stack nothing fills: 'clock'|'top'|'center'|'bottom'.
        {type: 'hidden', messageKey: 'viewAlign' + i, defaultValue: 'clock'},
        // The forecast graph's graph style: '1'|'2'|'3' (Pebble Time 2; graph-styles.js).
        {type: 'hidden', messageKey: 'viewStyle' + i, defaultValue: '1'},
        // The screen's name ('' = its place's: Default, Flick 1, Flick 2). The page's own:
        // never compiled, never sent to the watch, never in telemetry (screens.js nameOf).
        {type: 'hidden', messageKey: 'viewName' + i, defaultValue: ''}
    ];
    // The Default view always keeps its clock; any view may drop its top bar.
    if (i > 0) { items.push({type: 'hidden', messageKey: 'viewClockOff' + i, defaultValue: false}); }
    items.push({type: 'hidden', messageKey: 'viewStripOff' + i, defaultValue: false});
    return items;
}

// Custom-layout storage (see customViewItems above): sheetOnly keeps the
// items out of the tab while their sheets stay openable and their values
// hydrate/serialize with the blob. viewCount = how many views exist;
// customLayoutSeeded latched 2.5's one-time preset copy (its Custom entry seeded
// the view keys from the preset left unless the latch was set). 2.6 reads it no
// more, but still sets it wherever a preset turns custom (screens-page.js
// ensureCustom, the 2.6 migration), so an install taken back to 2.5 keeps its
// screens when it re-enters Custom.
var storageSection = {
    sheetOnly: true,
    sheetId: 'viewEditKeys',
    title: 'Custom layout',
    items: [
        {type: 'hidden', messageKey: 'viewCount', defaultValue: '1'},
        {type: 'hidden', messageKey: 'customLayoutSeeded', defaultValue: false},
        // The modes the screens need (screens.js deriveModes): written on every screen edit
        // and on Save (screens-page.js), read by the phone, the watch and the page's gates.
        // A new install starts on the Default screen alone with the rain alert on its Watch
        // bar (2.6): the rain alert's radar, no health. An existing install that lacks
        // either key keeps the three screens it had (clay-settings.js upgradeBackfill:
        // 'graph' and 'all'); the readers' absent radarMode is that same 'graph', the radar
        // as it was before the key existed.
        {type: 'hidden', messageKey: 'radarMode', defaultValue: 'countdown'},
        {type: 'hidden', messageKey: 'healthMode', defaultValue: 'off'},
        // The screen editor's Rows and Size picker (screens-page.js opens it over the editor from
        // a row's dropdown): the calendar's rows or a graph's size, titled by the row ("Calendar
        // rows"), a size with no room greyed out. Page-only (uiOnly); '' is dormant, so the sheet
        // opens on the row's own size.
        {
            type: 'select',
            messageKey: 'screenRowSize',
            uiOnly: true,
            label: 'Size',
            sheetTitleBy: {resolver: 'screenRowSizeTitle'},
            defaultValue: '',
            dormantValues: [''],
            optionsFrom: {resolver: 'screenRowSizeOptions'},
            onChange: 'screenRowSizePicked'
        }
    ].concat(customViewItems(0), customViewItems(1), customViewItems(2))
};

module.exports = {
    customViewItems: customViewItems,
    storageSection: storageSection
};
