// src/pkjs/status-bars/domain/plugin-values.js
//
// The Plugin value status slot ('pluginValue', status-line-catalog.js): a value another app's
// plugin serves, which the user picks in the slot's dialog. The source is the item's, so every
// slot that holds it shows the same value. Here: the source the settings pick, how often it is
// read, how long a value read from it shows, and the text the slot prints.
//
// The settings page loads this file too (window.PluginValues): the dialog's last value and the
// bars' pictures print the text the bake prints, and the dialog's rows store the ids valueId
// makes. Every byte of it rides the page's URL, so what only one side needs is elsewhere: the
// reading is plugin-reader.js' (readingOf), when it is read again and the value a read keeps
// plugin-value-reads.js', the dialog's list plugin-value-list.js', and its labels
// page/status-bars/plugin-value-page.js'.
//
// Pure. ES5 only (aplite PKJS).
(function () {
    var node = typeof require !== 'undefined';
    var slotText = node ? require('./slot-text.js') : window.SlotText;
    var utf8 = node ? require('../../lib/utf8.js') : window.Utf8;

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
     * A value's id, as the settings keep it (pluginValueId) and sourceOf takes it apart.
     * @param {string} category Its source's category. @param {string} item Its item.
     * @param {string} property Its property.
     * @returns {string} 'category/item/property'.
     */
    function valueId(category, item, property) {
        return category + '/' + item + '/' + property;
    }

    /**
     * The source the settings pick (pluginValuePlugin, pluginValueId: valueId's).
     * @param {?Object} settings Settings.
     * @returns {?{plugin: string, id: string, category: string, item: string, property: string,
     *   key: string}} The source, or null while none is picked. `key` names it whole, plugin
     *   and value, for the records kept of it.
     */
    function sourceOf(settings) {
        var plugin = settings && settings.pluginValuePlugin;
        var id = settings && settings.pluginValueId;
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

    /** A state (a boolean the plugin sent without words of its own for it), as the slot prints it. */
    var YES = 'Yes';
    var NO = 'No';

    /**
     * The text the slot prints of a reading, from the first of its shapes in this order:
     *   1. Its short text: the plugin's own words for a small space, which say more than the
     *      shape beside them can ('All day' beside the midnight timestamp of an all-day event,
     *      'Off' beside a boolean). The Pebble app's own plugin screens show it first too.
     *   2. Its moment, as a clock time in the user's 12/24 h setting, as the sun slot prints
     *      sunrise (slot-text.js clockText): a timestamp, which the plugin API leaves to the
     *      watch to show in the user's format, or a number its name says is a moment
     *      (plugin-value-reads.js momentOf). Before the number: the slot is read every half
     *      hour at most, and a moment stays true between reads where a count towards it does not.
     *   3. Its number, with its unit where the slot has the room ('%' and a unit that starts
     *      with the degree sign attach, any other follows a space).
     *   4. Its state, Yes or No.
     *   5. Its long text, last: it is written for a screen with room, and the slot cuts it.
     * Cut to the slot's cap at a character's edge, as the bake cuts any text, so the settings
     * page prints what the watch does.
     * @param {?{short: ?string, time: ?number, number: ?number, unit: ?string, state: ?boolean,
     *   long: ?string}} reading The reading of a value kept (plugin-value-reads.js valueOf), or
     *   null for none.
     * @param {number} cap The slot's byte cap.
     * @param {?Object} [settings] Settings: the clock's format (axisTimeFormat, timeShowAmPm,
     *   timeLeadingZero); absent, 24 hours.
     * @returns {string} The text; '--' for none.
     */
    function textFor(reading, cap, settings) {
        var r = reading || {};
        var short = oneLine(r.short);
        var unit;
        var text;
        var at;
        if (short) {
            text = short;
        } else if (typeof r.time === 'number') {
            at = new Date(r.time);
            text = slotText.clockText(at.getHours(), at.getMinutes(), settings || {});
        } else if (typeof r.number === 'number') {
            unit = oneLine(r.unit);
            text = slotText.withUnit(numberText(r.number),
                unit && unit !== '%' && unit.charAt(0) !== '\u00b0' ? ' ' + unit : unit, cap);
        } else if (typeof r.state === 'boolean') {
            text = r.state ? YES : NO;
        } else {
            text = oneLine(r.long) || '--';
        }
        return utf8.truncateToByteCap(text, cap).str;
    }

    /**
     * Until when something read at an instant holds: a wait after it, or until the plugin said
     * it holds, whichever is later, but no more than LONGEST_WAIT_MS on. The rule both of when a
     * value is read again (plugin-value-reads.js nextReadAt) and of how long it shows.
     * @param {number} at When it was read, in epoch milliseconds.
     * @param {number} waitMs The wait.
     * @param {?number} validUntil Until when the plugin said it holds, or null.
     * @returns {number} The instant, in epoch milliseconds.
     */
    function heldUntil(at, waitMs, validUntil) {
        var until = at + waitMs;
        return validUntil === null ? until : Math.max(until, Math.min(validUntil, at + LONGEST_WAIT_MS));
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
        if (!value || !source || value.source !== source.key) { return null; }
        return nowMs < heldUntil(value.at, Math.max(3 * everyMs(settings), SHOWN_AT_LEAST_MS),
            value.validUntil) ? value.reading : null;
    }

    var api = {
        EVERY_CHOICES: EVERY_CHOICES,
        EVERY_DEFAULT: EVERY_DEFAULT,
        valueId: valueId,
        sourceOf: sourceOf,
        everyMs: everyMs,
        oneLine: oneLine,
        textFor: textFor,
        heldUntil: heldUntil,
        shownReading: shownReading
    };

    // Dual-context export, the tail of status-line-catalog.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PluginValues = api;
    }
})();
