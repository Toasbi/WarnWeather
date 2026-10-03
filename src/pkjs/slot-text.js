// src/pkjs/slot-text.js — how a phone-baked status slot prints its numbers: the
// per-kind unit (and whether it fits), the temperature slot's three modes, the day-max
// kinds' text, the sun slot's clock, the countdown's days and the calendar week.
// status-lines.js formats every slot through it, and the settings page loads it too
// (window.SlotText), so the Status bars tab's preview prints a sample exactly the
// way the bake prints the real reading.
//
// Pure: settings and already-picked numbers in, text out — the payload decoding
// (which reading, '--' for none) stays in status-lines.js. ES5 only (aplite PKJS).
(function () {
    var catalog = (typeof require !== 'undefined')
        ? require('./status-line-catalog.js') : window.StatusLineCatalog;
    var utf8 = (typeof require !== 'undefined') ? require('./utf8.js') : window.Utf8;
    var statusPair = (typeof require !== 'undefined')
        ? require('./status-pair.js') : window.StatusPair;

    // The DEGREE SIGN ALONE for the temperature and dew-point slots -- never '°C' /
    // '°F'. The letter would only repeat the global temperature-unit setting, and
    // these are the two units that cost TWO UTF-8 bytes instead of one, which is what
    // makes the edge-slot cap a real constraint (see withUnit).
    var DEGREE = '°';

    /**
     * Whether one slot's per-kind "Show unit" toggle is on.
     * An ABSENT key means the kind's default: the four slots that show a unit today
     * (wind, gust, pressure, countdown) default on and the two bare ones (temp, dew)
     * default off, so a settings blob written before this feature renders exactly as
     * it always did.
     * @param {Object} settings Clay settings blob
     * @param {string} key the toggle's settings key, e.g. 'windSlotUnit'
     * @returns {boolean}
     */
    function unitEnabled(settings, key) {
        var v = settings ? settings[key] : undefined;
        // The shipped default comes from the catalog's UNIT_TOGGLES table — the one
        // home for key+default, shared with schema.js's rows, resetStatusSlots and
        // renderSignature, so the page's claim and the bake can never desynchronize.
        return (typeof v === 'undefined' || v === null)
            ? catalog.unitToggleDefault(key) : Boolean(v);
    }

    /**
     * Append a unit to a slot value, but only when the result still fits the slot.
     *
     * The cap guard lives HERE rather than in packLine because the unit is part of
     * the value's presentation and this module is the only place that knows which
     * unit each kind carries. packLine's utf8Truncate would otherwise chop an
     * overlong unit back off at the code-point boundary -- the two-byte degree would
     * VANISH whole, so an over-cap slot would look untouched while silently ignoring
     * the user's setting. Dropping the unit deliberately makes that the same visible
     * outcome, arrived at on purpose and testable.
     *
     * @param {string} value the bare formatted value
     * @param {string} unit the unit to append; '' when the toggle is off
     * @param {number} [cap] the slot's byte cap; defaults to the narrow edge cap
     * @returns {string} value + unit when it fits the cap, else value alone
     */
    function withUnit(value, unit, cap) {
        if (!unit) { return value; }
        var limit = typeof cap === 'number' ? cap : catalog.CAPS.EDGE_TEXT_MAX;
        var combined = value + unit;
        return utf8.byteLength(combined) <= limit ? combined : value;
    }

    /**
     * The label of the user's wind unit. The number itself is wire-units' (dayMaxShown,
     * via kmhToDisplay), which the thresholds read too, so the two can never round apart.
     * @param {Object} settings Clay settings blob (reads windUnits)
     * @returns {string} 'kph', 'mph' or 'kn'
     */
    function windUnitLabel(settings) {
        var unit = settings && settings.windUnits;
        if (unit === 'mph') { return 'mph'; }
        if (unit === 'knots') { return 'kn'; }
        return 'kph';
    }

    // Per day-max kind, its unit label (the kinds absent here print none).
    var DAY_MAX_UNIT_LABELS = { wind: windUnitLabel, gust: windUnitLabel };

    /**
     * The unit a day-max slot appends: wind and gusts their wind-unit label while
     * their "Show unit" toggle is on; UV and AQI none (their icon carries it).
     * @param {string} code a day-max kind
     * @param {Object} settings Clay settings blob
     * @returns {string} e.g. 'kph', or ''
     */
    function dayMaxUnit(code, settings) {
        var label = DAY_MAX_UNIT_LABELS[code];
        return label && unitEnabled(settings, code + 'SlotUnit') ? label(settings) : '';
    }

    /**
     * Convert an internal °F temperature to the display unit as a bare number.
     * Shared by the actual and feels-like halves of the temp slot and by the dew
     * point slot, so all three ride the identical conversion/rounding path.
     * Rounds LAST, in both units: CURRENT_TEMP, FEELS_CURRENT and DEW_TREND all carry
     * the provider's unrounded reading (so the °C conversion rounds once rather than
     * twice — a whole-°F pre-round put 0.3 °C at "1" and could show a dew point above
     * the air temperature), and an unrounded °F would render as "53.6" — four
     * characters of nonsense in an 8-byte slot.
     * @param {number} vF temperature in °F
     * @param {Object} settings Clay settings blob (reads temperatureUnits)
     * @returns {string} e.g. "20" or "-12"
     */
    function formatTemp(vF, settings) {
        var t = vF;
        if (settings.temperatureUnits !== 'f') {
            t = (t - 32) * 5 / 9;
        }
        return String(Math.round(t));
    }

    /**
     * The temperature slot's text in its Value selection (tempSlotDisplay, absent =
     * 'actual'): the measured temperature, what it feels like, or both as a pair in
     * the user's order and separator (status-pair.js formatTempPair).
     *
     * The degree is the kind's "Show unit" toggle (tempSlotUnit, off by default: the
     * thermometer icon already says "temperature") and answers to it in every mode.
     * A single reading takes it when it fits (withUnit). A pair puts it on BOTH
     * readings ('12°|10°') — one degree on the second reading alone would read as
     * though only that one were a temperature — and keeps it when that pair still
     * fits the slot; otherwise the pair prints bare. A middle slot always has the
     * room; a left or right slot (8 bytes) holds it only for single-digit readings,
     * as '12°|10°' is 9 bytes.
     *
     * @param {string} actual the formatted actual temperature (formatTemp)
     * @param {?string} feels the formatted feels-like temperature; null when unknown,
     *   which every mode falls back from to the actual temperature alone -- never
     *   '--/--' or '12/--'
     * @param {Object} settings Clay settings blob
     * @param {number} [cap] the slot's byte cap; defaults to the narrow edge cap
     * @returns {string} e.g. '18', '16°', '18|16', '18°|16°'
     */
    function tempText(actual, feels, settings, cap) {
        var s = settings || {};
        var mode = s.tempSlotDisplay;
        var degree = unitEnabled(s, 'tempSlotUnit') ? DEGREE : '';
        if (feels !== null && typeof feels !== 'undefined') {
            if (mode === 'feels') { return withUnit(feels, degree, cap); }
            if (mode === 'both') {
                var limit = typeof cap === 'number' ? cap : catalog.CAPS.EDGE_TEXT_MAX;
                if (degree) {
                    var marked = statusPair.formatTempPair(actual + degree, feels + degree, s, cap);
                    if (utf8.byteLength(marked) <= limit) { return marked; }
                }
                return statusPair.formatTempPair(actual, feels, s, cap);
            }
        }
        return withUnit(actual, degree, cap);
    }

    /**
     * A day-max slot's text (UV, wind, gusts, AQI) for the numbers wire-units'
     * dayMaxShown picked: the reading, the peak or the pair (status-pair.js
     * formatPeak), or the pair a merged weather alert made, then the kind's unit when
     * the whole text still fits ('12/30kph'). The unit gives way to the direction
     * arrow, which packLine appends after the text into a free byte: '12/30' + arrow,
     * never '12/30kph' without one.
     * @param {string} code a day-max kind: 'uv' | 'wind' | 'gust' | 'aqi'
     * @param {?{now: ?number, peak: ?number, nextDay: boolean}} shown the picked
     *   numbers; null with no reading (then `merged` is non-null)
     * @param {?string} merged the merged alert pair (status-pair.js mergeAlert); null
     *   for none
     * @param {Object} settings Clay settings blob
     * @param {number} [cap] the slot's byte cap; defaults to the narrow edge cap
     * @returns {string} e.g. '3', '»6', '3/7', '12/30kph'
     */
    function dayMaxText(code, shown, merged, settings, cap) {
        var limit = typeof cap === 'number' ? cap : catalog.CAPS.EDGE_TEXT_MAX;
        var arrowByte = (settings[code + 'SlotDirection'] && shown && shown.now !== null) ? 1 : 0;
        return withUnit(merged !== null ? merged : statusPair.formatPeak(code, shown, settings, cap),
            dayMaxUnit(code, settings), limit - arrowByte);
    }

    /**
     * @param {number} n
     * @returns {string} a two-digit decimal string
     */
    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    /**
     * Compact clock string for the sun slot. Hour conversion and leading-zero
     * handling mirror config_format_time in src/c/appendix/config.c. The optional
     * lowercase marker is the compact equivalent of time_layer.c's AM/PM layer.
     * @param {number} h local hour, 0..23
     * @param {number} m minute, 0..59
     * @param {Object} settings Clay settings blob (axisTimeFormat, timeShowAmPm,
     *   timeLeadingZero)
     * @returns {string} e.g. "17:04", "5:04p", or "05:04p"
     */
    function clockText(h, m, settings) {
        var displayHour = h;
        var marker = '';
        if (settings.axisTimeFormat === '12h') {
            displayHour = h % 12;
            if (displayHour === 0) { displayHour = 12; }
            if (settings.timeShowAmPm) { marker = h < 12 ? 'a' : 'p'; }
        }
        var hourText = settings.timeLeadingZero ? pad2(displayHour) : String(displayHour);
        return hourText + ':' + pad2(m) + marker;
    }

    /**
     * Parse YYYY-MM-DD at local midnight, returning fallback for malformed or
     * normalized-away dates such as 2028-02-31.
     * @param {*} value Stored settings value.
     * @param {Date} fallback Valid local-midnight fallback.
     * @returns {Date} Parsed local-midnight date or fallback.
     */
    function parseCountdownDate(value, fallback) {
        var parts = typeof value === 'string' ? value.split('-') : [];
        if (parts.length !== 3 || !/^\d{4}$/.test(parts[0])
                || !/^\d{2}$/.test(parts[1]) || !/^\d{2}$/.test(parts[2])) {
            return fallback;
        }
        var year = parseInt(parts[0], 10);
        var month = parseInt(parts[1], 10);
        var day = parseInt(parts[2], 10);
        var parsed = new Date(1970, 0, 1);
        parsed.setFullYear(year, month - 1, day);
        if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1
                || parsed.getDate() !== day) {
            return fallback;
        }
        return parsed;
    }

    /**
     * Format whole local calendar days until a target date.
     * 'now' and '--' never take the unit: neither is a count of days.
     * @param {*} targetValue Stored YYYY-MM-DD target.
     * @param {Date} [now] Current local time; injectable for tests.
     * @param {boolean} [showUnit] Whether countdownSlotUnit is on; absent = its default (on).
     * @param {number} [cap] The slot's byte cap.
     * @returns {string} Nd for future, now for today, -- for passed.
     */
    function formatCountdown(targetValue, now, showUnit, cap) {
        var current = now || new Date();
        var today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
        var target = parseCountdownDate(targetValue, today);
        var days = Math.round((target.getTime() - today.getTime()) / 86400000);
        if (days < 0) { return '--'; }
        if (days === 0) { return 'now'; }
        return withUnit(String(days), showUnit === false ? '' : 'd', cap);
    }

    /**
     * ISO-8601 week number (1..53) for a local date. Mirrors the watch-side iso_week()
     * used on non-aplite so the phone-baked aplite week matches other platforms.
     * @param {Date} d local date
     * @returns {number}
     */
    function isoWeek(d) {
        var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        var day = (t.getUTCDay() + 6) % 7;               // Mon=0 .. Sun=6
        t.setUTCDate(t.getUTCDate() - day + 3);           // Thursday of this ISO week
        var firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
        var fday = (firstThursday.getUTCDay() + 6) % 7;
        firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
        return 1 + Math.round((t - firstThursday) / 604800000); // 7*24*3600*1000
    }

    var api = {
        DEGREE: DEGREE,
        unitEnabled: unitEnabled,
        withUnit: withUnit,
        windUnitLabel: windUnitLabel,
        dayMaxUnit: dayMaxUnit,
        formatTemp: formatTemp,
        tempText: tempText,
        dayMaxText: dayMaxText,
        pad2: pad2,
        clockText: clockText,
        formatCountdown: formatCountdown,
        isoWeek: isoWeek
    };

    // Dual-context export, the tail of status-line-catalog.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.SlotText = api;
    }
})();
