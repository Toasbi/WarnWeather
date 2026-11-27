// src/pkjs/status-bars/domain/plugin-values.js
//
// The Plugin value status slot ('pluginValue', status-line-catalog.js): a value another app's
// plugin serves, which the user picks in the slot's dialog. Each slot that holds it picks its own
// (pickOf). Here: the source a slot picks, how often it is read, how long a value read from it
// shows, and what the slot draws of it in its Look: the text it prints, the icon before it, or
// either alone, and the user's label beside an icon that shows a value on or off.
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
    var catalog = node ? require('./status-line-catalog.js') : window.StatusLineCatalog;
    var slotText = node ? require('./slot-text.js') : window.SlotText;
    var utf8 = node ? require('../../lib/utf8.js') : window.Utf8;

    var MINUTE_MS = 60 * 1000;
    var HOUR_MS = 60 * MINUTE_MS;

    /** The Updates row's choices, in minutes, and the one a slot starts on. */
    var EVERY_CHOICES = ['15', '30', '60', '180', '360'];
    var EVERY_DEFAULT = '60';

    /**
     * The Look row's choices (a pick's look), as the other slots' Look rows name them: the icon
     * before the value's text, the text alone, where a slot starts, or the icon alone, which only
     * an icon that turns with a value that is on or off can show.
     */
    var LOOKS = ['both', 'text', 'icon'];
    var LOOK_DEFAULT = 'text';

    /**
     * The Icon row's choices (a pick's icon), in its order, and the icon each draws: one that
     * turns with a value that is on or off has its on form and its off form, one that stays the
     * same its one form. The Switch is where a slot starts: it turns, so it shows in every Look.
     */
    var ICONS = catalog.ICONS;
    var ICON_FORMS = {
        'switch': [ICONS.PV_SWITCH, ICONS.PV_SWITCH_OFF],
        wifi: [ICONS.PV_WIFI, ICONS.PV_WIFI_OFF],
        bluetooth: [ICONS.PV_BT, ICONS.PV_BT_OFF],
        plug: [ICONS.PV_PLUG],
        phone: [ICONS.PV_PHONE],
        calendar: [ICONS.PV_CALENDAR]
    };
    var ICON_DEFAULT = 'switch';

    /**
     * What a slot picks where it keeps no setting of its own (PluginValuePick): no plugin, the
     * first of the source's instances that has the value, the text alone, the Switch for the
     * Looks with an icon, no label and the Updates a slot starts on. Its dialog's rows show these
     * and never store them (page/status-bars/plugin-value-schema.js).
     */
    var PICK_DEFAULTS = { plugin: '', id: '', instance: '', look: LOOK_DEFAULT, icon: ICON_DEFAULT, label: '',
        every: EVERY_DEFAULT };

    /**
     * The longest id kept of one of a source's instances (a Hue room, a Google Home device, a
     * weather location), which a slot's dialog's Which row picks: longer than any real one.
     */
    var MAX_INSTANCE_ID = 64;

    /**
     * The property whose short text names one of a source's instances, as the plugin guide has
     * every source name its instances, which a list of them shows: the Which row's names
     * (plugin-reader.js instancesOf).
     */
    var INSTANCE_NAME = 'name';

    /**
     * The items, by 'category/item', whose instances come in the order of time, the first the
     * one that matters: the next event, the newest notification, the song heard last. A slot
     * shows the first, and its dialog offers no other (whichMayOffer).
     */
    var FIRST_ONLY = ['calendar/event', 'notifications/notification', 'music/identified'];

    /**
     * @param {string} category A source's category. @param {string} item Its item.
     * @returns {boolean} Whether its instances come in the order of time, the first the one that
     *   matters (FIRST_ONLY).
     */
    function firstOnly(category, item) {
        return FIRST_ONLY.indexOf(category + '/' + item) !== -1;
    }

    /**
     * @param {{category: string, item: string, property: string}} source A source (sourceOf) of
     *   a plugin's own value.
     * @returns {boolean} Whether its dialog may offer the Which row, where the plugin serves its
     *   source for more than one thing: not for the instances' name, which labels them, nor for
     *   an item whose first instance is the one that matters (firstOnly). Only then do its reads
     *   ask for the instances' names, which the row lists (plugin-value-source.js readOf): a
     *   calendar names each event by its title.
     */
    function whichMayOffer(source) {
        return source.property !== INSTANCE_NAME && !firstOnly(source.category, source.item);
    }

    /**
     * @param {*} id An instance's id, as a plugin sent it or a slot picks it.
     * @returns {boolean} Whether a slot can pick it: a text of 1 to MAX_INSTANCE_ID characters
     *   that a source's key can hold (sourceOf writes it as a URI component, which a lone
     *   surrogate is not).
     */
    function instanceIdOk(id) {
        if (typeof id !== 'string' || id === '' || id.length > MAX_INSTANCE_ID) { return false; }
        try {
            encodeURIComponent(id);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * @param {*} one An instance as the phone keeps it for the Which row (plugin-value-list.js
     *   instancesKept).
     * @returns {boolean} Whether the row can list it: an id a slot can pick (instanceIdOk) and a
     *   name.
     */
    function keptInstance(one) {
        return Boolean(one) && instanceIdOk(one.id) && typeof one.name === 'string' && one.name !== '';
    }

    /**
     * What goes between a source's plugin and the instance it picks in the source's key (sourceOf):
     * no uuid has it, and the instance's id is written after it as a URI component, so it holds
     * no '/' and the key's parts stay where every reader of it looks (plugin-value-reads.js pathOf).
     */
    var INSTANCE_MARK = '#';

    /**
     * Why the Value row greys out a complication (plugin-value-list.js complicationsFor), besides
     * a permission's name: a permission another app's plugin defines (the Pebble app keys it
     * '<uuid>:<Name>', plugin-reads.js undeclared), which this app can never declare.
     */
    var ANOTHER_APPS = ':';

    /**
     * And where no plugin serving it offers it in a form the slot prints, such as a series or a
     * picture.
     */
    var UNPRINTABLE = '#';

    /** A value shows for three Updates intervals after it was read, and at least this long. */
    var SHOWN_AT_LEAST_MS = 3 * HOUR_MS;

    /**
     * The longest the plugin's own word on when it has something new (validUntilMs) keeps the
     * next read away, and keeps its value shown.
     */
    var LONGEST_WAIT_MS = 12 * HOUR_MS;

    /**
     * The Pebble app's Preferences plugin. Its complications source lists the user's
     * complications: the readings they picked in the Pebble app for every watchface to show
     * (complications.js). The slot can show one of them, by its place in that list.
     */
    var PREFERENCES = '00000000-0000-0000-0001-000000000009';

    /**
     * A value's id, as a slot's settings keep it (a pick's id) and sourceOf takes it apart.
     * @param {string} category Its source's category. @param {string} item Its item.
     * @param {string} property Its property.
     * @returns {string} 'category/item/property'.
     */
    function valueId(category, item, property) {
        return category + '/' + item + '/' + property;
    }

    /**
     * A complication's id, as a slot's settings keep it (a pick's id, beside the Preferences plugin):
     * a value's id of the complications source (complications.js SOURCE), with its place in the
     * user's list in the property's place. One digit: ten places, more than the Pebble app has
     * (five).
     * @param {number|string} position Its place, 0 for the first.
     * @returns {string} 'preferences/complications/<place>'.
     */
    function complicationId(position) {
        return valueId('preferences', 'complications', position);
    }

    /**
     * What a slot picks for the Plugin value: its settings (status-line-catalog.js
     * pluginValueKeys), each as stored, which the rest of this file reads.
     * @typedef {Object} PluginValuePick
     * @property {*} plugin The plugin's uuid ('' or absent for none).
     * @property {*} id The value of it (valueId's, or complicationId's).
     * @property {*} instance The id of the instance of its source it shows ('' or absent for the
     *   first that has the value), as the plugin names it: the Which row's choice.
     * @property {*} look The Look row's choice (a LOOKS entry).
     * @property {*} icon The Icon row's choice (an ICON_FORMS name).
     * @property {*} label The Label row's text, as the user typed it.
     * @property {*} every The Updates row's choice (an EVERY_CHOICES entry).
     */

    /**
     * @param {?Object} settings Settings.
     * @param {string} slotKey A slot's settings key, e.g. 'statusTopMid'.
     * @returns {PluginValuePick} What the slot picks for the Plugin value.
     */
    function pickOf(settings, slotKey) {
        var keys = catalog.pluginValueKeys(slotKey);
        var s = settings || {};
        var pick = {};
        Object.keys(keys).forEach(function (part) { pick[part] = s[keys[part]]; });
        return pick;
    }

    /**
     * The source a slot picks (its plugin, the value of it: valueId's, and which of the source's
     * instances).
     * @param {?PluginValuePick} pick What the slot picks (pickOf).
     * @returns {?{plugin: string, id: string, category: string, item: string, property: string,
     *   instance: string, key: string, complication: ?number}} The source, or null while none is
     *   picked. `instance` is the id of the instance it picks, '' for the first that has the value,
     *   and for a complication, which names its own. `key` names it whole, plugin, instance and
     *   value, for the records kept of it. `complication` is the place of the complication it
     *   picks (complicationId), or null for a value of a plugin's own.
     */
    function sourceOf(pick) {
        var plugin = pick && pick.plugin;
        var id = pick && pick.id;
        var parts = typeof id === 'string' ? id.split('/') : [];
        var complication;
        var instance;
        if (typeof plugin !== 'string' || !plugin || parts.length !== 3
                || !parts[0] || !parts[1] || !parts[2]) {
            return null;
        }
        complication = plugin.toLowerCase() === PREFERENCES && id === complicationId(parts[2])
            && /^[0-9]$/.test(parts[2]) ? Number(parts[2]) : null;
        instance = complication === null && instanceIdOk(pick.instance) ? pick.instance : '';
        return { plugin: plugin, id: id, category: parts[0], item: parts[1], property: parts[2],
            instance: instance, complication: complication,
            key: plugin + (instance ? INSTANCE_MARK + encodeURIComponent(instance) : '') + '/' + id };
    }

    /** What ends a text cut short (fitText): the ellipsis, which the watch's fonts draw. */
    var CUT_MARK = '\u2026';

    /**
     * The categories whose every item is the Index's plumbing: where a plugin offers the Index a
     * place for notes, reminders or chats (the plugin guide's destinations). So is an item named
     * PLUMBING_ITEM: whether such a place is set up.
     */
    var PLUMBING_CATEGORIES = ['notes', 'reminders', 'agent'];
    var PLUMBING_ITEM = 'configured';

    /**
     * The last words (wordsOf) of a property that is no value to show: an identifier, a link, a
     * file's path, an app's package, an account, a secret, a position, or a machine's code.
     */
    var NOT_A_VALUE_ENDS = ['id', 'ids', 'uuid', 'url', 'uri', 'link', 'href', 'path', 'package', 'account', 'email',
        'token', 'key', 'address', 'coordinates', 'latitude', 'longitude', 'lat', 'lon', 'lng', 'code'];

    /**
     * The properties, whole (wordsOf), that are no value to show: how sure a position is, a
     * machine's words for what something is or can do, and a place's offset from UTC.
     */
    var NOT_A_VALUE_NAMES = ['accuracy', 'accuracy meters', 'type', 'kind', 'capabilities', 'utc offset'];

    /**
     * @param {string} name A property's name.
     * @returns {string[]} Its words as they are written: split at '_', '-', blanks and the
     *   capital of a camelCase word ('accuracyMeters' is 'accuracy', 'Meters'; 'UVIndex' is
     *   'UV', 'Index'; '5G' stays whole). The Value row names a value by them
     *   (plugin-value-page.js labelOf), and tells by them what is no value to show (notAValue).
     */
    function wordsOf(name) {
        return String(name).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z0-9]+)([A-Z][a-z])/g, '$1 $2')
            .split(/[\s_\-]+/).filter(Boolean);
    }

    /**
     * @param {string} category A source's category. @param {string} item One of its items.
     * @returns {boolean} Whether the item is the Index's plumbing (PLUMBING_CATEGORIES,
     *   PLUMBING_ITEM), no value to show.
     */
    function plumbing(category, item) {
        return PLUMBING_CATEGORIES.indexOf(category) !== -1 || item === PLUMBING_ITEM;
    }

    /**
     * @param {string} category A source's category. @param {string} item One of its items.
     * @param {string} property One of its properties.
     * @param {boolean} multiple Whether the source serves more than one instance.
     * @returns {boolean} Whether the property is no value to show: the Index's plumbing
     *   (plumbing), one whose name says it is none (NOT_A_VALUE_ENDS, NOT_A_VALUE_NAMES), or the
     *   name of a source's one instance, which labels it, the same text always (the plugin guide:
     *   an instance's name is what to show for it in a list of them).
     */
    function notAValue(category, item, property, multiple) {
        var words = wordsOf(property).map(function (w) { return w.toLowerCase(); });
        var whole = words.join(' ');
        return plumbing(category, item) || NOT_A_VALUE_ENDS.indexOf(words[words.length - 1]) !== -1
            || NOT_A_VALUE_NAMES.indexOf(whole) !== -1 || (!multiple && whole === INSTANCE_NAME);
    }

    /**
     * @param {{plugin: string, category: string, item: string}} source A source (sourceOf) of a
     *   plugin's own value, or a read of it that names its plugin.
     * @returns {string} The plugin's item it is a value of, the one key the instances a read
     *   brings of it are kept by (plugin-value-source.js keepInstances), pruned by and read by on
     *   the page: 'plugin/category/item', the plugin's uuid in lower case.
     */
    function itemKeyOf(source) {
        return source.plugin.toLowerCase() + '/' + source.category + '/' + source.item;
    }

    /**
     * @param {?Object} value A value kept (plugin-value-reads.js valueOf), or null.
     * @param {?Object} source A source (sourceOf), or null.
     * @returns {boolean} Whether the value was read from the source. A complication's value names
     *   the reading it was read from after the complication's own key (plugin-value-source.js),
     *   and it is the place's reading now wherever this judges it: the phone keeps it only while
     *   the place names that reading (plugin-read-schedule.js consider) and hands the settings
     *   page no other (plugin-value-source.js forPage).
     */
    function readFrom(value, source) {
        return Boolean(value) && Boolean(source) && (value.source === source.key
            || (source.complication !== null && value.source.indexOf(source.key + '/') === 0));
    }

    /**
     * @param {?PluginValuePick} pick What a slot picks (pickOf).
     * @returns {number} How often its value is read (the Updates row), in ms.
     */
    function everyMs(pick) {
        var every = pick && pick.every;
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
     * A state (a boolean the plugin sent without words of its own for it), as the slot prints
     * it: lowercase.
     */
    var ON = 'on';
    var OFF = 'off';

    /**
     * A short text that is only a clock time, as a plugin sends one beside the timestamp it
     * prints: '09:15', '7:55 AM', '19.30'. Its hours, minutes and the a or p of a 12 hour clock.
     */
    var CLOCK_ONLY = /^(\d{1,2})[:.](\d{2})(?: ?([AaPp])\.?[Mm]\.?)?$/;

    /**
     * @param {string} short A short text that is only a clock time (CLOCK_ONLY).
     * @param {Date} at The moment beside it.
     * @returns {boolean} Whether it is the moment's time on the phone's clock, as the Calendar
     *   writes an event's start. A weather plugin writes a place's sunrise on that place's clock,
     *   which is no time here.
     */
    function clockHere(short, at) {
        var clock = CLOCK_ONLY.exec(short);
        var hours = Number(clock[1]);
        if (clock[3]) { hours = hours % 12 + (clock[3].toLowerCase() === 'p' ? 12 : 0); }
        return hours === at.getHours() && Number(clock[2]) === at.getMinutes();
    }

    var DAY_MS = 24 * HOUR_MS;

    /**
     * What the slot prints of a reading's short text beside its moment (textFor): the moment
     * itself where the text is only its clock time here (clockHere), so it is in the user's
     * clock format and carries its day on another (slot-text.js momentText), where the
     * Calendar's '09:15' would pass for today's; a clock time of another place as the plugin
     * wrote it ('06:30', Tokyo's sunrise); the words on the moment's own day, and its day on any
     * other (slot-text.js dayText: 'Sat', '30 Nov'), where they would say the same of every day
     * ('All day'). A moment at 00:00 UTC beside words is a day's, as the Pebble app sends an
     * all-day event's: its day is the one in UTC, which in local time would be the evening
     * before, west of it.
     * @param {string} short The short text, on one line (oneLine). @param {number} ms The moment,
     *   in epoch milliseconds. @param {number} cap The slot's byte cap.
     * @param {Object} settings Settings: the clock's format. @param {number} nowMs Now, in epoch
     *   milliseconds, whose local date is today's.
     * @returns {string}
     */
    function shortBesideMoment(short, ms, cap, settings, nowMs) {
        var at = new Date(ms);
        var now;
        if (CLOCK_ONLY.test(short)) {
            return clockHere(short, at) ? slotText.momentText(ms, nowMs, settings, cap) : short;
        }
        now = new Date(nowMs);
        if (ms % DAY_MS !== 0) {
            return at.toDateString() === now.toDateString() ? short : slotText.momentText(ms, nowMs, settings, cap);
        }
        return at.getUTCFullYear() === now.getFullYear() && at.getUTCMonth() === now.getMonth()
            && at.getUTCDate() === now.getDate() ? short
            : slotText.dayText(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), nowMs);
    }

    /** A text's last number, with the separators between its digits: '189.84', '1,234.5', '7'. */
    var LAST_NUMBER = /\d+(?:[.,]\d+)*(?=\D*$)/;

    /**
     * A number written with a dot that may be a clock time or a date: an hour and its minutes
     * ('19.45', '9.05'), or a day and its month ('27.11').
     */
    var TIME_OR_DATE = /^(?:[1-9]|[01]\d|2[0-3])\.[0-5]\d$|^(?:0?[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])$/;

    /**
     * A sign of what a number measures, which no clock time or date carries, right before a
     * number or right after it, a blank between at most: '€', '$', '£', '¥', '%', '°'.
     */
    var SIGN_BEFORE = /[\u20ac$\u00a3\u00a5%\u00b0] ?$/;
    var SIGN_AFTER = /^ ?[\u20ac$\u00a3\u00a5%\u00b0]/;

    /** The end of a group of thousands before a number's last: a digit and a blank or an apostrophe. */
    var GROUP_BEFORE = /\d[ \u00a0\u202f'\u2019]$/;

    /**
     * A number rounded half up to fewer decimals, its separators as they were.
     * @param {string} number A number (LAST_NUMBER) whose last separator is its decimal one.
     * @param {number} dot Where that separator is. @param {number} keep The decimals it keeps,
     *   fewer than it has.
     * @returns {?string} e.g. ('189.84', 3, 1) → '189.8', ('189.84', 3, 0) → '190', ('9,999.5', 5,
     *   0) → '10,000'; null where the carry would make a first group of four digits ('999,999.5'),
     *   which would group the number wrongly.
     */
    function roundedNumber(number, dot, keep) {
        var chars = number.slice(0, keep ? dot + 1 + keep : dot).split('');
        var i = chars.length - 1;
        var group;
        if (number.charAt(dot + 1 + keep) < '5') { return chars.join(''); }
        // Every 9 turns 0 and carries one on; a separator passes it on.
        while (i >= 0 && !/[0-8]/.test(chars[i])) {
            if (chars[i] === '9') { chars[i] = '0'; }
            i -= 1;
        }
        if (i >= 0) {
            chars[i] = String(Number(chars[i]) + 1);
            return chars.join('');
        }
        group = number.search(/[.,]/);
        return group < dot && group === 3 ? null : '1' + chars.join('');
    }

    /**
     * @param {string} number A text's last number (LAST_NUMBER).
     * @param {number} dot Where its last separator is, or -1 for none.
     * @param {string} before The text before it. @param {string} after The text after it.
     * @returns {boolean} Whether the separator is sure to set off decimals. Not where the number
     *   has none; uses it twice ('1,234,567' groups thousands); has it alone before three digits,
     *   after a whole of one to three that does not start with 0 ('1.234' is 1234 in German);
     *   follows a group of thousands set off by a blank (GROUP_BEFORE: '19 999,96'); or may be a
     *   clock time or a date (TIME_OR_DATE: '19.45', '27.11') with no sign of a measure beside
     *   it (SIGN_BEFORE, SIGN_AFTER: '21.46 °C' is a temperature).
     */
    function sureDecimals(number, dot, before, after) {
        return dot >= 0 && number.indexOf(number.charAt(dot)) === dot
            && !(number.length - dot === 4 && /^[1-9]\d{0,2}$/.test(number.slice(0, dot)))
            && !GROUP_BEFORE.test(before)
            && (SIGN_BEFORE.test(before) || SIGN_AFTER.test(after) || !TIME_OR_DATE.test(number));
    }

    /**
     * A text with its last number rounded to the fewest decimals it must lose to fit the cap
     * ('€189.84' → '€189.8', '€1189.84' → '€1190'), where a cut would print another number.
     * @param {string} text The text, on one line. @param {number} cap The slot's byte cap.
     * @returns {?string} null where no rounding fits, and where the number's decimals are not
     *   sure (sureDecimals).
     */
    function roundedToFit(text, cap) {
        var match = LAST_NUMBER.exec(text);
        var number = match ? match[0] : '';
        var before = match ? text.slice(0, match.index) : '';
        var after = match ? text.slice(match.index + number.length) : '';
        var dot = Math.max(number.lastIndexOf('.'), number.lastIndexOf(','));
        var keep;
        var rounded;
        if (!sureDecimals(number, dot, before, after)) { return null; }
        for (keep = number.length - dot - 2; keep >= 0; keep -= 1) {
            rounded = roundedNumber(number, dot, keep);
            if (rounded === null) { return null; }
            rounded = before + rounded + after;
            if (utf8.byteLength(rounded) <= cap) { return rounded; }
        }
        return null;
    }

    /**
     * A text as a slot prints it within its cap: whole where it fits; else with its number
     * rounded (roundedToFit); else cut at a character's edge, with no blank or separator left at
     * its end and an ellipsis after it (CUT_MARK), so that it reads as cut ('Partly cloudy' →
     * 'Partl…', '+CHF 11189.84' → '+CHF…').
     * @param {string} text The text, on one line. @param {number} cap The slot's byte cap.
     * @returns {string}
     */
    function fitText(text, cap) {
        var kept;
        if (utf8.byteLength(text) <= cap) { return text; }
        kept = roundedToFit(text, cap);
        if (kept !== null) { return kept; }
        kept = utf8.truncateToByteCap(text, cap - utf8.byteLength(CUT_MARK)).str.replace(/[\s,.;:\/-]+$/, '');
        return kept ? kept + CUT_MARK : utf8.truncateToByteCap(text, cap).str;
    }

    /**
     * The text the slot prints of a reading, from the first of its shapes in this order:
     *   1. Its short text: the plugin's own words for a small space, which say more than the
     *      shape beside them can ('Off' beside a boolean). The Pebble app's own plugin screens
     *      show it first too. Beside a moment, only while it says more (shortBesideMoment): a
     *      clock time gives way to the moment, words on another day to its day.
     *   2. Its moment, as a clock time in the user's 12/24 h setting, as the sun slot prints
     *      sunrise, with its day on another day than the one the slot is baked for (slot-text.js
     *      momentText: 'Sat 9:15', '23:10 4 Dec'): a timestamp, which the plugin API leaves to the watch to
     *      show in the user's format, or a number its name says is a moment
     *      (plugin-value-reads.js momentOf). Before the number: the slot is read every 15
     *      minutes at most, and a moment stays true between reads where a count towards it does
     *      not.
     *   3. Its number, with its unit where the slot has the room (a unit that starts with '%'
     *      or the degree sign attaches, any other follows a space).
     *   4. Its state, on or off.
     *   5. Its long text, last: it is written for a screen with room, and the slot cuts it.
     * Fit to the slot's cap (fitText): a number rounded, else cut with an ellipsis, the same on
     * the settings page as on the watch.
     * @param {?{short: ?string, time: ?number, number: ?number, unit: ?string, state: ?boolean,
     *   long: ?string}} reading The reading of a value kept (plugin-value-reads.js valueOf), or
     *   null for none.
     * @param {number} cap The slot's byte cap.
     * @param {?Object} [settings] Settings: the clock's format (axisTimeFormat, timeShowAmPm,
     *   timeLeadingZero); absent, 24 hours.
     * @param {number} [nowMs] The instant the slot is baked for, in epoch milliseconds, whose
     *   local date is today's for a moment (needed for a reading with one).
     * @returns {string} The text; '--' for none.
     */
    function textFor(reading, cap, settings, nowMs) {
        var r = reading || {};
        var short = oneLine(r.short);
        var unit;
        var text;
        if (short) {
            text = typeof r.time === 'number' ? shortBesideMoment(short, r.time, cap, settings || {}, nowMs) : short;
        } else if (typeof r.time === 'number') {
            text = slotText.momentText(r.time, nowMs, settings || {}, cap);
        } else if (typeof r.number === 'number') {
            unit = oneLine(r.unit);
            text = slotText.withUnit(numberText(r.number),
                unit && unit.charAt(0) !== '%' && unit.charAt(0) !== '\u00b0' ? ' ' + unit : unit, cap);
        } else if (typeof r.state === 'boolean') {
            text = r.state ? ON : OFF;
        } else {
            text = oneLine(r.long) || '--';
        }
        return fitText(text, cap);
    }

    /**
     * @param {?PluginValuePick} pick What a slot picks (pickOf).
     * @returns {string} Its Look row's choice: a LOOKS entry, the text alone by default and for
     *   one it does not know.
     */
    function lookOf(pick) {
        var look = pick && pick.look;
        return LOOKS.indexOf(look) !== -1 ? look : LOOK_DEFAULT;
    }

    /**
     * @param {?PluginValuePick} pick What a slot picks (pickOf).
     * @returns {boolean} Whether its Look draws an icon: Icon + text and Icon.
     */
    function drawsIcon(pick) {
        return lookOf(pick) !== 'text';
    }

    /**
     * @param {?PluginValuePick} pick What a slot picks (pickOf).
     * @returns {boolean} Whether its Look prints the value's text: Icon + text and Text.
     */
    function printsText(pick) {
        return lookOf(pick) !== 'icon';
    }

    /**
     * @param {string} name An ICON_FORMS name.
     * @returns {boolean} Whether the icon turns with a value that is on or off: it has an on form
     *   and an off form.
     */
    function turns(name) {
        return ICON_FORMS[name].length > 1;
    }

    /**
     * @param {boolean} turning The icons that turn (turns), or those that stay the same.
     * @returns {string[]} Their names, in the Icon row's order (ICON_FORMS).
     */
    function iconsThat(turning) {
        return Object.keys(ICON_FORMS).filter(function (name) { return turns(name) === turning; });
    }

    /**
     * @param {*} name An Icon row's choice.
     * @returns {string[]} The icon's forms (ICON_FORMS), on before off; none for a name that is
     *   no icon (a group's header, the None of a page from before the Look).
     */
    function formsOf(name) {
        return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICON_FORMS, name)
            ? ICON_FORMS[name] : [];
    }

    /**
     * @param {?PluginValuePick} pick What a slot picks (pickOf).
     * @returns {string} Its Icon row's choice: an ICON_FORMS name, the Switch by default and for
     *   one it does not know (formsOf).
     */
    function iconName(pick) {
        var name = pick && pick.icon;
        return formsOf(name).length ? name : ICON_DEFAULT;
    }

    /**
     * The icon the slot draws (iconName), in the Looks with one: one that turns in its on form
     * while the value is on, and in its off form while it is off, too old or not read; one that
     * stays the same as it is.
     * @param {?PluginValuePick} pick What the slot picks (pickOf).
     * @param {?{state: ?boolean}} reading The reading the slot shows (shownReading), or null.
     * @returns {number} The STATUS_ICON_* id the bake packs: the one that loads no drawing in the
     *   Text look.
     */
    function iconId(pick, reading) {
        if (!drawsIcon(pick)) { return ICONS.PLUGIN_TEXT; }
        var forms = ICON_FORMS[iconName(pick)];
        return forms[reading && reading.state === true ? 0 : forms.length - 1];
    }

    /**
     * @param {?PluginValuePick} pick What a slot picks (pickOf).
     * @returns {boolean} Whether its Look prints its label (the Label row) in place of a value
     *   that is on or off: Icon + text with an icon that turns, which shows whether the value is
     *   on. Anywhere else the text is all that shows it.
     */
    function showsLabel(pick) {
        return lookOf(pick) === 'both' && turns(iconName(pick));
    }

    /**
     * @param {?PluginValuePick} pick What a slot picks (pickOf).
     * @returns {string} The label it prints in place of a value that is on or off (showsLabel),
     *   on one line (oneLine); '' for none, or where it does not show.
     */
    function labelText(pick) {
        return showsLabel(pick) ? oneLine(pick.label) : '';
    }

    /**
     * The text the slot prints of the reading it shows (textFor): none in the Icon look, where
     * the icon alone shows the value (the watch draws a glyph with no text by itself), and its
     * label in place of a value that is on or off (labelText), cut as the bake cuts any text.
     * While it shows none, '--' in every Look, so an icon in its off form never passes for a
     * value that is off.
     * @param {?PluginValuePick} pick What the slot picks (pickOf).
     * @param {?Object} reading The reading the slot shows (shownReading), or null.
     * @param {number} cap The slot's bytes. @param {?Object} settings Settings: the clock's format.
     * @param {number} nowMs Now, in epoch milliseconds.
     * @returns {string}
     */
    function slotTextOf(pick, reading, cap, settings, nowMs) {
        var label = reading && typeof reading.state === 'boolean' ? labelText(pick) : '';
        // Cut after a word: no blank left at the end.
        if (label) { return oneLine(utf8.truncateToByteCap(label, cap).str); }
        return printsText(pick) || !reading ? textFor(reading, cap, settings, nowMs) : '';
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
     * The reading a slot shows of a value at an instant: the value of the source it picks
     * (readFrom), until three of its Updates intervals (at least SHOWN_AT_LEAST_MS) after it was
     * read, or until the plugin said it holds, whichever is later, but no more than
     * LONGEST_WAIT_MS on.
     * @param {?Object} value The value kept (plugin-value-reads.js valueOf), or null.
     * @param {?PluginValuePick} pick What the slot picks (pickOf).
     * @param {number} nowMs The instant, in epoch milliseconds.
     * @returns {?Object} The reading, or null: none kept, another source's, or too old.
     */
    function shownReading(value, pick, nowMs) {
        if (!readFrom(value, sourceOf(pick))) { return null; }
        return nowMs < heldUntil(value.at, Math.max(3 * everyMs(pick), SHOWN_AT_LEAST_MS),
            value.validUntil) ? value.reading : null;
    }

    var api = {
        EVERY_CHOICES: EVERY_CHOICES,
        LOOKS: LOOKS,
        LOOK_DEFAULT: LOOK_DEFAULT,
        ICON_FORMS: ICON_FORMS,
        ICON_DEFAULT: ICON_DEFAULT,
        PICK_DEFAULTS: PICK_DEFAULTS,
        MAX_INSTANCE_ID: MAX_INSTANCE_ID,
        INSTANCE_NAME: INSTANCE_NAME,
        PREFERENCES: PREFERENCES,
        ANOTHER_APPS: ANOTHER_APPS,
        UNPRINTABLE: UNPRINTABLE,
        valueId: valueId,
        complicationId: complicationId,
        pickOf: pickOf,
        sourceOf: sourceOf,
        whichMayOffer: whichMayOffer,
        instanceIdOk: instanceIdOk,
        keptInstance: keptInstance,
        itemKeyOf: itemKeyOf,
        readFrom: readFrom,
        everyMs: everyMs,
        oneLine: oneLine,
        wordsOf: wordsOf,
        plumbing: plumbing,
        notAValue: notAValue,
        textFor: textFor,
        lookOf: lookOf,
        drawsIcon: drawsIcon,
        printsText: printsText,
        turns: turns,
        iconsThat: iconsThat,
        formsOf: formsOf,
        iconName: iconName,
        iconId: iconId,
        showsLabel: showsLabel,
        labelText: labelText,
        slotTextOf: slotTextOf,
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
