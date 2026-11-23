// src/pkjs/status-bars/domain/plugin-values.js
//
// The Plugin value status slot ('pluginValue', status-line-catalog.js): a value another app's
// plugin serves, which the user picks in the slot's dialog. The source is the item's, so every
// slot that holds it shows the same value. Here: the source the settings pick, how often it is
// read, how long a value read from it shows, and the text the slot prints.
//
// The settings page loads this file too (window.PluginValues): the dialog's last value and the
// bars' pictures print the text the bake prints, and the dialog names each value with labelOf.
// Every byte of it rides the page's URL, so what only the phone needs is elsewhere: the reading
// is plugin-reader.js' (readingOf), when it is read again and the value a read keeps
// plugin-value-reads.js', and the dialog's list plugin-value-list.js'.
//
// Pure. ES5 only (aplite PKJS).
(function () {
    var slotText = (typeof require !== 'undefined')
        ? require('./slot-text.js') : window.SlotText;

    var MINUTE_MS = 60 * 1000;
    var HOUR_MS = 60 * MINUTE_MS;

    /** The Updates row's choices, in minutes, and the one a slot starts on. */
    var EVERY_CHOICES = ['30', '60', '180', '360'];
    var EVERY_DEFAULT = '60';

    /** A value shows for three Updates intervals after it was read, and at least this long. */
    var SHOWN_AT_LEAST_MS = 3 * HOUR_MS;

    /**
     * The longest the plugin's own word on when it has something new (validUntilMs) keeps the
     * next read away, and keeps its value shown.
     */
    var LONGEST_WAIT_MS = 12 * HOUR_MS;

    /**
     * The source the settings pick (pluginValuePlugin, pluginValueReading).
     * @param {?Object} settings Settings.
     * @returns {?{plugin: string, id: string, category: string, item: string, property: string,
     *   key: string}} The source, or null while none is picked. `key` names it whole, plugin
     *   and value, for the records kept of it.
     */
    function sourceOf(settings) {
        var plugin = settings && settings.pluginValuePlugin;
        var id = settings && settings.pluginValueReading;
        var parts = typeof id === 'string' ? id.split('/') : [];
        if (typeof plugin !== 'string' || !plugin || parts.length !== 3
                || !parts[0] || !parts[1] || !parts[2]) {
            return null;
        }
        return { plugin: plugin, id: id, category: parts[0], item: parts[1], property: parts[2],
            key: plugin + '/' + id };
    }

    /**
     * @param {?Object} settings Settings.
     * @returns {number} How often the value is read (the Updates row, pluginValueEvery), in ms.
     */
    function everyMs(settings) {
        var every = settings && settings.pluginValueEvery;
        return Number(EVERY_CHOICES.indexOf(every) !== -1 ? every : EVERY_DEFAULT) * MINUTE_MS;
    }

    /**
     * @param {*} text A text as a plugin sent it.
     * @returns {string} The text on one line: control characters (the short form's separator
     *   among them, status_line.h STATUS_TEXT_ALT_SEP) and runs of spaces as one space,
     *   trimmed; '' for none.
     */
    function oneLine(text) {
        return typeof text === 'string'
            ? text.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').replace(/^ | $/g, '') : '';
    }

    /**
     * A number as the slot prints it: one decimal under 10, none from 10 up.
     * @param {number} n The number.
     * @returns {string}
     */
    function numberText(n) {
        var tenths = Math.round(n * 10) / 10;
        return String(Math.abs(tenths) < 10 ? tenths : Math.round(n));
    }

    /**
     * The text the slot prints of a reading: its short text; else its number, with its unit
     * where the slot has the room ('%' and a unit that starts with the degree sign attach, any
     * other follows a space); else its long text. The bake cuts it to the slot's cap as any
     * text.
     * @param {?{short: ?string, number: ?number, unit: ?string, long: ?string}} reading The
     *   reading (plugin-reader.js readingOf), or null for none.
     * @param {number} cap The slot's byte cap.
     * @returns {string} The text; '--' for none.
     */
    function textFor(reading, cap) {
        var short = oneLine(reading && reading.short);
        var unit;
        if (short) { return short; }
        if (reading && typeof reading.number === 'number' && isFinite(reading.number)) {
            unit = oneLine(reading.unit);
            return slotText.withUnit(numberText(reading.number),
                unit && unit !== '%' && unit.charAt(0) !== '\u00b0' ? ' ' + unit : unit, cap);
        }
        return oneLine(reading && reading.long) || '--';
    }

    /**
     * The reading the slot shows of a value at an instant: the value of the source the settings
     * pick, until three Updates intervals (at least SHOWN_AT_LEAST_MS) after it was read, or
     * until the plugin said it holds, whichever is later, but no more than LONGEST_WAIT_MS on.
     * @param {?Object} value The value kept (plugin-value-reads.js valueOf), or null.
     * @param {?Object} settings Settings.
     * @param {number} nowMs The instant, in epoch milliseconds.
     * @returns {?Object} The reading, or null: none kept, another source's, or too old.
     */
    function shownReading(value, settings, nowMs) {
        var source = sourceOf(settings);
        var until;
        if (!value || !source || value.source !== source.key) { return null; }
        until = value.at + Math.max(3 * everyMs(settings), SHOWN_AT_LEAST_MS);
        if (value.validUntil !== null) {
            until = Math.max(until, Math.min(value.validUntil, value.at + LONGEST_WAIT_MS));
        }
        return nowMs < until ? value.reading : null;
    }

    /**
     * A property's name as the dialog lists it: 'battery_level' reads 'Battery level',
     * 'daysRemaining' 'Days remaining'; a word in capitals stays as it is ('UV index'). The
     * dialog names a value of a plugin that serves more than one item after both
     * ('location: uv_index' reads 'Location: uv index').
     * @param {string} name The name.
     * @returns {string}
     */
    function labelOf(name) {
        var words = String(name).replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z0-9]+)([A-Z][a-z])/g, '$1 $2').replace(/[_\-\s]+/g, ' ')
            .replace(/^ | $/g, '').split(' ');
        var text = words.map(function (w) {
            return w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase();
        }).join(' ');
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    var api = {
        EVERY_CHOICES: EVERY_CHOICES,
        EVERY_DEFAULT: EVERY_DEFAULT,
        SHOWN_AT_LEAST_MS: SHOWN_AT_LEAST_MS,
        LONGEST_WAIT_MS: LONGEST_WAIT_MS,
        sourceOf: sourceOf,
        everyMs: everyMs,
        oneLine: oneLine,
        textFor: textFor,
        shownReading: shownReading,
        labelOf: labelOf
    };

    // Dual-context export, the tail of status-line-catalog.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PluginValues = api;
    }
})();
