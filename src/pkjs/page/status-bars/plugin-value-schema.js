// src/pkjs/page/status-bars/plugin-value-schema.js — ES5, PKJS-parsed. The Plugin value slots'
// dialogs (status-line-catalog.js 'pluginValue'), split out of schema.js like
// weather-sources-schema.js: the plugin, which of its values the slot shows and of which thing
// where it offers it for more than one, its Look (the text, an icon before it or the icon alone),
// the icon, the label for a value that is on or off and how often it is read, then the line with
// the value read last. The rows' lists, their hints, the icons' pictures and that line are
// plugin-value-page.js'. Plain CommonJS: the schema is built in PKJS and reaches the page as data.
//
// A dialog for each slot, as the phone battery's (schema.js phoneBatterySlotSheet): a slot's
// plugin, value, instance, Look, icon, label and Updates are its own (status-line-catalog.js
// pluginValueKeys), so each slot that holds the item shows a value of its own. The engine hands a
// dialog's rows no word of the slot that opened it, so each names its slot to its resolvers and
// its change's hooks (args.slotKey, onChangeArgs), and the slot's Edit button opens its own
// (status-line-catalog.js pluginValueSheet). No row stores its default (sticky: false): a slot
// without a pick keeps no setting of it, which plugin-values.js reads as none (PICK_DEFAULTS).
// Bold closes the dialog as in every slot's: the item's, one setting for every slot that holds it
// (status-thresholds.js KINDS 'pluginValue', kind 21), as the phone battery's is, so its hint says
// so. The dialogs' words are the page's, written there once for all of them, the Look's and Bold's
// too: they ride the page's URL (test/settings/adapter/settings-url-budget.test.js).

var catalog = require('../../status-bars/domain/status-line-catalog.js');
var DEFAULTS = require('../../status-bars/domain/plugin-values.js').PICK_DEFAULTS;
var gates = require('../settings/schema-gates.js');
var boldOnlyRow = require('../alerts/level-rows-schema.js').boldOnlyRow;

/**
 * One slot's Plugin value dialog: the note while Muninn is picked, then the Plugin, the Value of
 * it, Which, its Look, Icon, Label and Updates, the value read last, and Bold. Each list opens over the
 * dialog (engine renderPickSheet): a phone can list a dozen plugins and each up to 24 values
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
    // The Icon row, in a Look with an icon; Bold, in one with text.
    var withIcon = {all: [picked, {key: keys.look, ne: 'text'}]};
    var withText = {all: [picked, {key: keys.look, ne: 'icon'}]};
    // While the plugin picked is Muninn: a note that the Watch battery slot shows its estimate by
    // itself (plugin-value-page.js muninnNote). A card of its own in the info look, above the
    // Plugin row (the owner's, 2026-11-23).
    var note = gates.noteCards('Days left from Muninn', {resolver: 'pluginValueMuninnNote'},
        {when: 'pluginValueFromMuninn', args: slot});
    // Bold, in a Look with text: its hints say that it sets every slot's (plugin-value-page.js
    // boldHint).
    var bold = gates.alsoWhen([boldOnlyRow('PluginValue', {resolver: 'pluginValueBoldHint'})], withText);
    return sheetOf('PluginValue', 'Plugin value', note.concat([{
        type: 'select',
        messageKey: keys.plugin,
        label: 'Plugin',
        defaultValue: DEFAULTS.plugin,
        sticky: false,
        // The plugins the phone listed as the page opened, after None.
        optionsFrom: {resolver: 'pluginValuePlugins', args: slot},
        hintFrom: {resolver: 'pluginValuePluginHint', args: slot},
        // A new plugin starts on its first value.
        onChange: 'pluginValuePluginPicked',
        onChangeArgs: slot
    }, {
        type: 'select',
        messageKey: keys.id,
        label: 'Value',
        defaultValue: DEFAULTS.id,
        sticky: false,
        optionsFrom: {resolver: 'pluginValueIds', args: slot},
        hintFrom: {resolver: 'pluginValueIdHint', args: slot},
        // Another value takes no label typed for the one before, and a value that is neither on
        // nor off takes no Look or icon that would stay off.
        onChange: 'pluginValueIdPicked',
        onChangeArgs: slot,
        showWhen: picked
    }, {
        // Which of the source's instances the slot shows, for a value the plugin offers for more
        // than one thing (a room's lights, a stock): the first that has the value, or one by its
        // name, as the slot's last read named them (plugin-value-page.js whichShown).
        type: 'select',
        messageKey: keys.instance,
        label: 'Which',
        defaultValue: DEFAULTS.instance,
        sticky: false,
        optionsFrom: {resolver: 'pluginValueInstances', args: slot},
        hintFrom: {resolver: 'pluginValueInstanceHint', args: slot},
        showWhen: {when: 'pluginValueWhichShown', args: slot}
    }, {
        // As the other slots' Look rows offer it (plugin-values.js LOOKS). The icon alone is for
        // a value that is on or off, which an icon that turns shows by itself.
        type: 'segmented',
        messageKey: keys.look,
        label: 'Look',
        defaultValue: DEFAULTS.look,
        sticky: false,
        optionsFrom: {resolver: 'pluginValueLooks'},
        optionDisabledWhen: {icon: {when: 'pluginValueNeither', args: slot}},
        hintFrom: {resolver: 'pluginValueLookHint', args: slot},
        onChange: 'pluginValueFit',
        onChangeArgs: slot,
        showWhen: picked
    }, {
        // The icon (plugin-values.js ICON_FORMS), each choice drawn as the watch draws it; one
        // that turns is for a value that is on or off, and the only kind the Icon look offers.
        type: 'select',
        messageKey: keys.icon,
        label: 'Icon',
        defaultValue: DEFAULTS.icon,
        sticky: false,
        optionsFrom: {resolver: 'pluginValueIcons', args: slot},
        hintFrom: {resolver: 'pluginValueIconHint', args: slot},
        pictureFrom: {resolver: 'pluginValueIconPicture', glyph: true},
        showWhen: withIcon
    }, {
        // The user's word for a value that is on or off, which the slot prints beside an icon
        // that turns in place of the value's text (plugin-values.js labelText): the row shows
        // only there (plugin-value-page.js labelShown), and takes no more than the slot prints.
        type: 'text',
        messageKey: keys.label,
        label: 'Label',
        defaultValue: DEFAULTS.label,
        sticky: false,
        attributes: {maxlength: catalog.textCapOf(slotKey)},
        hintFrom: {resolver: 'pluginValueLabelHint'},
        showWhen: {when: 'pluginValueLabelShown', args: slot}
    }, {
        type: 'select',
        messageKey: keys.every,
        label: 'Updates',
        defaultValue: DEFAULTS.every,
        sticky: false,
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
    }].concat(bold)), catalog.pluginValueSheet(slotKey));
}

/**
 * Every slot's Plugin value dialog (slotDialog), the four bars' and bars 4 to 6's, in the
 * catalog's line order.
 * @param {function(string, string, Object[], string): Object} sheetOf schema.js sheetOf.
 * @returns {Object[]} Schema sections (sheetOnly).
 */
function dialogSections(sheetOf) {
    return catalog.everySlotKey().map(function (slotKey) { return slotDialog(sheetOf, slotKey); });
}

module.exports = {
    dialogSections: dialogSections
};
