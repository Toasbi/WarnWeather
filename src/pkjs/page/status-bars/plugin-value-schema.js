// src/pkjs/page/status-bars/plugin-value-schema.js — ES5, PKJS-parsed. The Plugin value slots'
// dialogs (status-line-catalog.js 'pluginValue'), split out of schema.js like
// weather-sources-schema.js: the plugin, which of its values the slot shows, the icon before it
// and how often it is read, then the line with the value read last. The rows' lists, their hints,
// the icons' pictures and that line are plugin-value-page.js'. Plain CommonJS: the schema is built
// in PKJS and reaches the page as data.
//
// A dialog for each slot, as the phone battery's (schema.js phoneBatterySlotSheet): a slot's
// plugin, value, icon and Updates are its own (status-line-catalog.js pluginValueKeys), so each
// slot that holds the item shows a value of its own. The engine hands a dialog's rows no word of
// the slot that opened it, so each names its slot to its resolvers (args.slotKey), and the slot's
// Edit button opens its own (status-line-catalog.js pluginValueSheet). No row stores its default
// (plugin-value-page.js pluginValueDefault): a slot without a pick keeps no setting of it, which
// plugin-values.js reads as none. The icon is its Look, so the dialog has no other, and no Bold:
// the item has no bold kind (status_threshold_kind_for_slot answers -1 for its icon ids). The
// dialogs' words are the page's too, written there once for all of them: they ride the page's
// URL (test/settings/adapter/settings-url-budget.test.js).

var catalog = require('../../status-bars/domain/status-line-catalog.js');
var gates = require('../settings/schema-gates.js');

/**
 * A row's default, which a save never stores (plugin-value-page.js pluginValueDefault): the one
 * plugin-values.js reads where the slot keeps none.
 * @param {string} name The pick's part ('plugin', 'id', 'icon' or 'every': plugin-values.js
 *   PICK_DEFAULTS).
 * @returns {Object} The row's defaultFrom.
 */
function unstored(name) {
    return {resolver: 'pluginValueDefault', args: {name: name}, sticky: false};
}

/**
 * One slot's Plugin value dialog: the note while Muninn is picked, then the Plugin, the Value of
 * it, its Icon and Updates, then the value read last. Each row opens its list over the dialog
 * (engine renderPickSheet): a phone can list a dozen plugins and each up to 24 values
 * (plugin-value-list.js).
 * @param {function(string, string, Object[], string): Object} sheetOf schema.js sheetOf: a slot
 *   dialog's envelope (gated where the watch has slot dialogs).
 * @param {string} slotKey The slot's settings key, e.g. 'statusTopRight'.
 * @returns {Object} Schema section (sheetOnly), the slot's (catalog pluginValueSheet).
 */
function slotDialog(sheetOf, slotKey) {
    var keys = catalog.pluginValueKeys(slotKey);
    var slot = {slotKey: slotKey};
    // The rows after Plugin, while one is picked.
    var picked = {key: keys.plugin, ne: ''};
    // While the plugin picked is Muninn: a note that the Watch battery slot shows its estimate by
    // itself (plugin-value-page.js muninnNote). A card of its own in the info look, above the
    // Plugin row (the owner's, 2026-11-23).
    var note = gates.noteCards('Days left from Muninn', {resolver: 'pluginValueMuninnNote'},
        {when: 'pluginValueFromMuninn', args: slot});
    return sheetOf('PluginValue', 'Plugin value', note.concat([{
        type: 'select',
        messageKey: keys.plugin,
        label: 'Plugin',
        defaultFrom: unstored('plugin'),
        // The plugins the phone listed as the page opened, after None.
        optionsFrom: {resolver: 'pluginValuePlugins', args: slot},
        hintFrom: {resolver: 'pluginValuePluginHint', args: slot},
        // A new plugin starts on its first value.
        onChange: 'pluginValuePluginPicked'
    }, {
        type: 'select',
        messageKey: keys.id,
        label: 'Value',
        defaultFrom: unstored('id'),
        optionsFrom: {resolver: 'pluginValueIds', args: slot},
        hintFrom: {resolver: 'pluginValueIdHint', args: slot},
        // A value that is neither on nor off leaves an icon that turns for None.
        onChange: 'pluginValueIdPicked',
        showWhen: picked
    }, {
        // The icon before the value (plugin-values.js ICON_FORMS), each choice drawn as the watch
        // draws it; one that turns is for a value that is on or off.
        type: 'select',
        messageKey: keys.icon,
        label: 'Icon',
        defaultFrom: unstored('icon'),
        optionsFrom: {resolver: 'pluginValueIcons', args: slot},
        hintFrom: {resolver: 'pluginValueIconHint', args: slot},
        pictureFrom: {resolver: 'pluginValueIconPicture', glyph: true},
        showWhen: picked
    }, {
        type: 'select',
        messageKey: keys.every,
        label: 'Updates',
        defaultFrom: unstored('every'),
        optionsFrom: {resolver: 'pluginValueEveries'},
        hintFrom: {resolver: 'pluginValueEveryHint'},
        showWhen: picked
    }, {
        // The value read last and when, or that none is yet: a row like the others, its
        // line in the hint's grey.
        type: 'readout',
        label: 'Last value',
        hintFrom: {resolver: 'pluginValueLast', args: slot},
        showWhen: picked
    }]), catalog.pluginValueSheet(slotKey));
}

/**
 * Every slot's Plugin value dialog (slotDialog), the four bars' and bars 4 to 6's, in the
 * catalog's line order.
 * @param {function(string, string, Object[], string): Object} sheetOf schema.js sheetOf.
 * @returns {Object[]} Schema sections (sheetOnly).
 */
function dialogSections(sheetOf) {
    var sheets = [];
    catalog.ALL_LINES.forEach(function (line) {
        line.slots.forEach(function (slotKey) { sheets.push(slotDialog(sheetOf, slotKey)); });
    });
    return sheets;
}

module.exports = {
    dialogSections: dialogSections
};
