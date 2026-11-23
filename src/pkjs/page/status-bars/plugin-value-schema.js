// src/pkjs/page/status-bars/plugin-value-schema.js — ES5, PKJS-parsed. The Plugin value slot's
// dialog (status-line-catalog.js 'pluginValue'), split out of schema.js like
// weather-sources-schema.js: the plugin, which of its values the slot shows and how often it is
// read, then the line with the value read last. The rows' lists, their hints and that line are
// plugin-value-page.js'. Plain CommonJS: the schema is built in PKJS and reaches the page as data.
//
// One dialog for every slot that holds the item: its source is the item's setting
// (pluginValueSettingKeys), so every such slot shows the same value. The slot prints text
// alone, so the dialog has no Look, and no Bold either: the item has no bold kind
// (status_threshold_kind_for_slot answers -1 for its icon id).

var catalog = require('../../status-bars/domain/status-line-catalog.js');
var pluginValues = require('../../status-bars/domain/plugin-values.js');

// The settings the rows store: the plugin, its value and how often it is read.
var KEYS = catalog.pluginValueSettingKeys();
var PLUGIN_KEY = KEYS[0];
var READING_KEY = KEYS[1];
var EVERY_KEY = KEYS[2];

// The rows after Plugin, while one is picked.
var PICKED_WHEN = {key: PLUGIN_KEY, ne: ''};

// The Updates row's choices (plugin-values.js EVERY_CHOICES, in minutes).
var EVERY_LABELS = {'30': 'Every 30 minutes', '60': 'Every hour', '180': 'Every 3 hours', '360': 'Every 6 hours'};

// What a read costs (plugin-reader.js): the Pebble app runs the other app's plugin, and asks
// again for each permission that app is still waiting for.
var EVERY_HINT = 'Each read runs the other app\'s plugin on your phone. If that app asked for a permission '
    + 'you haven\'t answered yet, your phone asks you again.';

/**
 * The Plugin value slot's dialog: the Plugin, the Value of it and Updates, then the value read
 * last. Plugin and Value open their lists over the dialog (bottomSheet), as the Weather dialog's
 * pickers do: a phone can list a dozen plugins and each up to 16 values.
 * @param {function(string, string, Object[]): Object} sheetOf schema.js sheetOf: a slot
 *   dialog's envelope (thresh<Stem>, gated where the watch has slot dialogs).
 * @returns {Object} Schema section (sheetOnly), 'threshPluginValue'.
 */
function dialogSection(sheetOf) {
    return sheetOf('PluginValue', 'Plugin value', [{
        type: 'select',
        bottomSheet: true,
        messageKey: PLUGIN_KEY,
        label: 'Plugin',
        defaultValue: '',
        // The plugins the phone listed as the page opened, after None.
        optionsFrom: {resolver: 'pluginValuePlugins'},
        hintFrom: {resolver: 'pluginValuePluginHint'},
        // A new plugin starts on its first value.
        onChange: 'pluginValuePluginPicked'
    }, {
        type: 'select',
        bottomSheet: true,
        messageKey: READING_KEY,
        label: 'Value',
        defaultValue: '',
        optionsFrom: {resolver: 'pluginValueReadings'},
        hintFrom: {resolver: 'pluginValueReadingHint'},
        showWhen: PICKED_WHEN
    }, {
        type: 'select',
        messageKey: EVERY_KEY,
        label: 'Updates',
        hint: EVERY_HINT,
        defaultValue: pluginValues.EVERY_DEFAULT,
        options: pluginValues.EVERY_CHOICES.map(function (every) { return [EVERY_LABELS[every], every]; }),
        showWhen: PICKED_WHEN
    }, {
        // The value read last and when, or that none is yet.
        type: 'staticText',
        textFrom: {resolver: 'pluginValueLast'},
        showWhen: PICKED_WHEN
    }]);
}

module.exports = {
    dialogSection: dialogSection
};
