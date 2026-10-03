// src/pkjs/settings/schema-gates.js — ES5, PKJS-parsed. The gates and copy links the
// settings schema's modules share, split out of schema.js so the modules that build parts
// of the schema (schema.js, level-rows-schema.js, alerts-schema.js and
// forecast-lines-schema.js) can read them without requiring each other: the named
// showWhen predicates (the capability gates and the setting gates several rows repeat),
// the one-pass gateAll, the link that brings a tab to the front and the link row a reset
// rides. Plain CommonJS with an
// unguarded require(), like schema.js itself (custom-layout-schema.js's precedent): the
// schema is evaluated in PKJS and injected into the page as data, never concatenated into
// it as a flat browser file.
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
// "This watch draws On demand items" — every On demand row, card and sheet. aplite
// compiles the feature out (no WW_ON_DEMAND) and keeps its fixed quiet-time and
// Bluetooth indicators and the low-battery takeover, whose rows its Watch Status Bar
// keeps under the opposite gate.
var ON_DEMAND_WHEN = {env: 'onDemand'};
/**
 * A link in copy that brings a tab to the front (engine.js [data-goto-tab]: from the tab
 * body or from inside a sheet, which closes; never to a tab whose showWhen hides it). Same
 * markup and look as an inline text link (shell.html .txt-link).
 * @param {string} tab The tab's id, e.g. 'alerts'.
 * @param {string} label The link's text (a constant here, printed as is).
 * @returns {string} The link's HTML.
 */
function tabLink(tab, label) {
    return '<button type="button" class="txt-link" data-goto-tab="' + tab + '">' + label + '</button>';
}
// "This watch reports its battery charge in 5 % steps" (emery): the Battery item's warn
// level steps by 5 there and by 10 everywhere else.
var FINE_BATTERY_WHEN = {env: 'fineBattery'};
// "The Watch-tab master Bold row overrides every slot" — statusBoldAll 'all' packs
// the bold cell of EVERY kind as always-bold at blob-build time
// (status-wire.js buildSettingsBlob) WITHOUT touching the stored per-kind
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
// a name. (The compound "effectively B&W" check is the BW_LEGEND rows' showWhen in
// schema.js.)
var COLOR_THEME_WHEN = {key: 'theme', nin: ['bw', 'bw-light']};
// "This watch draws the third metric line and selectable styles at all" — the
// WW_LINE_STYLE mirror (platform.js), one gate for the Third- and Fourth-metric rows
// and every line-style picker (the rows under those pickers ask lineRow, which reads
// the same fact). Fails open for an unknown platform, like every feature-absence
// capability.
var LINE_STYLES_WHEN = {env: 'lineStyles'};

/**
 * Gate every item that has no showWhen of its own — the sheet and group
 * builders' one-pass idiom: an item added later cannot forget its gate line,
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
 * A link row (a `button` drawn as a line of link text, engine.js chevronRow): a reset,
 * e.g. the About alerts card's.
 * @param {string} action A registered PConf.actions id, e.g. 'resetOnDemand'.
 * @param {string} label The link's text.
 * @returns {Object} Schema item.
 */
function linkRow(action, label) {
    return {type: 'button', style: 'link', action: action, label: label};
}

module.exports = {
    HEALTH_SLOT_WHEN: HEALTH_SLOT_WHEN,
    HR_SLOT_WHEN: HR_SLOT_WHEN,
    THRESHOLD_WHEN: THRESHOLD_WHEN,
    ON_DEMAND_WHEN: ON_DEMAND_WHEN,
    FINE_BATTERY_WHEN: FINE_BATTERY_WHEN,
    BOLD_ALL_WHEN: BOLD_ALL_WHEN,
    RADAR_BAR_WHEN: RADAR_BAR_WHEN,
    HEALTH_BAR_WHEN: HEALTH_BAR_WHEN,
    COLOR_THEME_WHEN: COLOR_THEME_WHEN,
    LINE_STYLES_WHEN: LINE_STYLES_WHEN,
    gateAll: gateAll,
    tabLink: tabLink,
    linkRow: linkRow
};
