// src/pkjs/status-bars/domain/plugin-values.js
//
// The Plugin value status slot ('pluginValue', status-line-catalog.js): a value another app's
// plugin serves, which the user picks in the slot's dialog. The source is the item's, so every
// slot that holds it shows the same value. Here: the source the settings pick, the values of
// which plugins the slot can show (the dialog's lists), how long a value read from it shows,
// and the text the slot prints.
//
// The reading itself is plugin-reader.js' (readingOf), and when it is read again
// plugin-value-reads.js'. The settings page loads this file too (window.PluginValues): the
// dialog's last value and the bars' pictures print the text the bake prints.
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

    /** The dialog's caps: the plugins it lists, the values of each, a name's length. */
    var MAX_PLUGINS = 12;
    var MAX_VALUES = 16;
    var MAX_NAME = 32;

    /** The shapes the slot prints. A property needs one of them to be listed. */
    var TEXT_SHAPES = ['shortText', 'numericValue', 'longText'];

    /**
     * @param {string} category The source's category.
     * @param {string} item Its item.
     * @param {string} property The property.
     * @returns {string} The value's id, as the settings keep it: 'category/item/property'.
     */
    function valueId(category, item, property) {
        return category + '/' + item + '/' + property;
    }

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
     * A value as stored, checked: the source it was read from, its reading, when it was read
     * and until when the plugin said it holds.
     * @param {*} value What was stored (parsed JSON).
     * @returns {?{source: string, reading: Object, at: number, validUntil: ?number}} The value,
     *   or null when it is none.
     */
    function valueOf(value) {
        var r = value && value.reading;
        /**
         * @param {*} v A text field.
         * @returns {?string} It, when it is a text.
         */
        function text(v) { return typeof v === 'string' && v ? v : null; }
        if (!value || typeof value.source !== 'string' || !r || typeof r !== 'object'
                || typeof value.at !== 'number' || !isFinite(value.at) || value.at <= 0) {
            return null;
        }
        var reading = { short: text(r.short), long: text(r.long), unit: text(r.unit),
            number: typeof r.number === 'number' && isFinite(r.number) ? r.number : null };
        if (reading.short === null && reading.number === null && reading.long === null) { return null; }
        return { source: value.source, reading: reading, at: value.at,
            validUntil: typeof value.validUntil === 'number' && isFinite(value.validUntil)
                && value.validUntil > 0 ? value.validUntil : null };
    }

    /**
     * @param {?Object} a A reading (plugin-reader.js readingOf, or valueOf's), or null.
     * @param {?Object} b Another, or null.
     * @returns {boolean} Whether the two say the same, field by field: a reading's fields come
     *   in another order once it has been through storage.
     */
    function sameReading(a, b) {
        if (!a || !b) { return !a && !b; }
        return a.short === b.short && a.number === b.number && a.unit === b.unit && a.long === b.long;
    }

    /**
     * The reading the slot shows of a value at an instant: the value of the source the settings
     * pick, until three Updates intervals (at least SHOWN_AT_LEAST_MS) after it was read, or
     * until the plugin said it holds, whichever is later, but no more than LONGEST_WAIT_MS on.
     * @param {?Object} value The value kept (valueOf), or null.
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
     * A property's or an item's name as the dialog lists it: 'battery_level' reads 'Battery
     * level', 'daysRemaining' 'Days remaining'; a word in capitals stays as it is ('UV index').
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

    /**
     * @param {string} text A name.
     * @returns {string} It, cut to MAX_NAME characters.
     */
    function capped(text) {
        return text.length > MAX_NAME ? text.slice(0, MAX_NAME - 1) + '\u2026' : text;
    }

    /**
     * @param {Object} source A source's declaration.
     * @param {string[]} permissions The permissions this app declares.
     * @returns {boolean} Whether this app may read it without being asked for a permission it
     *   never declared: every caller permission it names is one this app declares (one that
     *   another plugin defines never is).
     */
    function readableBy(source, permissions) {
        var asks = Array.isArray(source.callerPermissions) ? source.callerPermissions : [];
        for (var i = 0; i < asks.length; i++) {
            var p = asks[i];
            var name = typeof p === 'string' ? p : p && !p.plugin ? p.name : null;
            if (typeof name !== 'string' || permissions.indexOf(name) === -1) { return false; }
        }
        return true;
    }

    /**
     * @param {*} shapes A property's declared shapes.
     * @returns {boolean} Whether the slot can print it.
     */
    function printable(shapes) {
        if (!Array.isArray(shapes)) { return false; }
        for (var i = 0; i < TEXT_SHAPES.length; i++) {
            if (shapes.indexOf(TEXT_SHAPES[i]) !== -1) { return true; }
        }
        return false;
    }

    /**
     * The values each plugin on the phone offers that the slot can show, for the dialog's
     * Plugin and Value lists: a property its source declares a text or a number for, of a
     * source this app may read (readableBy), of any plugin but this app's own. Up to
     * MAX_PLUGINS plugins with MAX_VALUES values each, names cut to MAX_NAME characters; a
     * plugin with none is left out. A value's label is its property's name made readable, after
     * its item's where the plugin serves more than one.
     * @param {*} plugins What Pebble.enumeratePlugins() returned.
     * @param {string[]} permissions The permissions this app declares (package.json
     *   usesPermissions' names).
     * @param {string} ownUuid This app's uuid.
     * @returns {Array<{uuid: string, name: string, values: Array<{id: string, label: string,
     *   multiple: boolean}>}>}
     */
    function readableSources(plugins, permissions, ownUuid) {
        var out = [];
        if (!Array.isArray(plugins)) { return out; }
        for (var p = 0; p < plugins.length && out.length < MAX_PLUGINS; p++) {
            var plugin = plugins[p];
            if (!plugin || typeof plugin.uuid !== 'string' || !plugin.uuid
                    || plugin.uuid.toLowerCase() === String(ownUuid).toLowerCase()) {
                continue;
            }
            var sources = Array.isArray(plugin.sources) ? plugin.sources : [];
            var found = [];
            var items = {};
            for (var s = 0; s < sources.length; s++) {
                var src = sources[s];
                if (!src || typeof src.category !== 'string' || !Array.isArray(src.items)
                        || !readableBy(src, permissions)) {
                    continue;
                }
                var props = src.properties && typeof src.properties === 'object' ? src.properties : {};
                for (var i = 0; i < src.items.length; i++) {
                    if (typeof src.items[i] !== 'string') { continue; }
                    for (var name in props) {
                        if (Object.prototype.hasOwnProperty.call(props, name) && printable(props[name])) {
                            items[src.category + '/' + src.items[i]] = true;
                            found.push({ item: src.items[i], property: name, multiple: Boolean(src.supportsMultiple),
                                id: valueId(src.category, src.items[i], name) });
                        }
                    }
                }
            }
            var several = Object.keys(items).length > 1;
            var values = found.slice(0, MAX_VALUES).map(function (v) {
                var label = labelOf(v.property);
                if (several) {
                    label = labelOf(v.item) + ': '
                        + (/^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));
                }
                return { id: v.id, label: capped(label), multiple: v.multiple };
            });
            if (values.length) {
                out.push({ uuid: plugin.uuid, name: capped(oneLine(plugin.name) || plugin.uuid), values: values });
            }
        }
        return out;
    }

    var api = {
        EVERY_CHOICES: EVERY_CHOICES,
        EVERY_DEFAULT: EVERY_DEFAULT,
        SHOWN_AT_LEAST_MS: SHOWN_AT_LEAST_MS,
        LONGEST_WAIT_MS: LONGEST_WAIT_MS,
        MAX_PLUGINS: MAX_PLUGINS,
        MAX_VALUES: MAX_VALUES,
        MAX_NAME: MAX_NAME,
        sourceOf: sourceOf,
        everyMs: everyMs,
        textFor: textFor,
        valueOf: valueOf,
        sameReading: sameReading,
        shownReading: shownReading,
        labelOf: labelOf,
        readableSources: readableSources
    };

    // Dual-context export, the tail of status-line-catalog.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.PluginValues = api;
    }
})();
