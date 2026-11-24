// src/pkjs/page/status-bars/plugin-value-schema.js — ES5, PKJS-parsed. The Plugin value slot's
// dialog (status-line-catalog.js 'pluginValue'), split out of schema.js like
// weather-sources-schema.js: the plugin, which of its values the slot shows, the icon before it
// and how often it is read, then the line with the value read last. The rows' lists, their hints,
// the icons' pictures and that line are plugin-value-page.js'. Plain CommonJS: the schema is built
// in PKJS and reaches the page as data.
//
// One dialog for every slot that holds the item: its source and icon are the item's settings
// (pluginValuePlugin, pluginValueId, pluginValueIcon and pluginValueEvery, which resetStatusSlots
// clears with the slots: status-line-catalog.js pluginValueSettingKeys), so every such slot shows
// the same value. The icon is its Look, so the dialog has no other, and no Bold: the item has no
// bold kind (status_threshold_kind_for_slot answers -1 for its icon ids).

var batteryDays = require('../../status-bars/domain/battery-days.js');
var pluginValues = require('../../status-bars/domain/plugin-values.js');
var gates = require('../settings/schema-gates.js');

// The rows after Plugin, while one is picked.
var PICKED_WHEN = {key: 'pluginValuePlugin', ne: ''};

// The Updates row's choices (plugin-values.js EVERY_CHOICES, in minutes).
var EVERY_LABELS = {'30': 'Every 30 minutes', '60': 'Every hour', '180': 'Every 3 hours', '360': 'Every 6 hours'};

// What a read costs (plugin-reader.js): the Pebble app runs the other app's plugin, and asks
// again for each permission that app is still waiting for.
var EVERY_HINT = 'Each read runs the other app\'s plugin on your phone. If that app asked for a permission '
    + 'you haven\'t answered yet, your phone asks you again.';

// While the plugin picked is Muninn (plugin-value-page.js fromMuninn): a note that the Watch
// battery slot shows its estimate by itself, ending on the steps every how-to for it ends on
// (battery-days.js DAYS_STEPS). A card of its own in the info look, above the Plugin row (the
// owner's, 2026-11-23).
var MUNINN_WHEN = {when: 'pluginValueFromMuninn'};
var MUNINN_NOTE = 'The Watch battery slot can show Muninn\'s estimate by itself: the days your watch has left, '
    + 'alone or beside its charge. Put the Watch battery in any slot, tap its Edit button, ' + batteryDays.DAYS_STEPS;

/**
 * The Plugin value slot's dialog: the note while Muninn is picked, then the Plugin, the Value
 * of it, its Icon and Updates, then the value read last. Each row opens its list over the dialog (engine
 * renderPickSheet): a phone can list a dozen plugins and each up to 24 values
 * (plugin-value-list.js).
 * @param {function(string, string, Object[]): Object} sheetOf schema.js sheetOf: a slot
 *   dialog's envelope (thresh<Stem>, gated where the watch has slot dialogs).
 * @returns {Object} Schema section (sheetOnly), 'threshPluginValue'.
 */
function dialogSection(sheetOf) {
    return sheetOf('PluginValue', 'Plugin value', gates.noteCards('Days left from Muninn', MUNINN_NOTE,
        MUNINN_WHEN).concat([{
        type: 'select',
        messageKey: 'pluginValuePlugin',
        label: 'Plugin',
        defaultValue: '',
        // The plugins the phone listed as the page opened, after None.
        optionsFrom: {resolver: 'pluginValuePlugins'},
        hintFrom: {resolver: 'pluginValuePluginHint'},
        // A new plugin starts on its first value.
        onChange: 'pluginValuePluginPicked'
    }, {
        type: 'select',
        messageKey: 'pluginValueId',
        label: 'Value',
        defaultValue: '',
        optionsFrom: {resolver: 'pluginValueIds'},
        hintFrom: {resolver: 'pluginValueIdHint'},
        // A value that is neither on nor off leaves an icon that turns for None.
        onChange: 'pluginValueIdPicked',
        showWhen: PICKED_WHEN
    }, {
        // The icon before the value (plugin-values.js ICON_FORMS), each choice drawn as the watch
        // draws it; one that turns is for a value that is on or off.
        type: 'select',
        messageKey: 'pluginValueIcon',
        label: 'Icon',
        defaultValue: pluginValues.ICON_DEFAULT,
        optionsFrom: {resolver: 'pluginValueIcons'},
        hintFrom: {resolver: 'pluginValueIconHint'},
        pictureFrom: {resolver: 'pluginValueIconPicture', glyph: true},
        showWhen: PICKED_WHEN
    }, {
        type: 'select',
        messageKey: 'pluginValueEvery',
        label: 'Updates',
        hint: EVERY_HINT,
        defaultValue: pluginValues.EVERY_DEFAULT,
        options: pluginValues.EVERY_CHOICES.map(function (every) { return [EVERY_LABELS[every], every]; }),
        showWhen: PICKED_WHEN
    }, {
        // The value read last and when, or that none is yet: a row like the others, its
        // line in the hint's grey.
        type: 'readout',
        label: 'Last value',
        hintFrom: {resolver: 'pluginValueLast'},
        showWhen: PICKED_WHEN
    }]));
}

module.exports = {
    dialogSection: dialogSection
};
