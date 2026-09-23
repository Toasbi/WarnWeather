// src/pkjs/status-pair.js — how a two-value status slot presents its pair.
//
// Two kinds of slot can show two readings at once: Temperature in 'both' mode
// (actual and feels-like), and the day-max kinds -- UV, wind, gusts and AQI -- in
// 'both' mode (now and the day's peak: today's until the reading drops below it,
// then tomorrow's).
// Which reading comes first, what stands between the two (and whether spaces flank
// it), and how UV marks a peak that is tomorrow's are per-kind settings (each
// kind's Edit sheet); this module turns them into the text status-lines.js bakes. Phone-side only: the watch
// receives finished slot text, so no wire field or C change rides with it.
//
// An ABSENT setting means its default, and the defaults reproduce what the slot
// baked before these settings existed, byte for byte: '12/10', '3/7', '5/»6'.
// The numbers themselves are not decided here -- wire-units' dayMaxShown picks them,
// and status-thresholds judges those same numbers, so no presentation choice can
// move a highlight. ES5 only (aplite PKJS).

var catalog = require('./status-line-catalog.js');
var utf8 = require('./utf8.js');

// Marks the UV slot's peak as tomorrow's (Latin-1, like status-lines' DEGREE: the
// watch's system fonts carry it) -- the default next-day mark. Worst case
// '11/»12' is 7 of the edge slot's 8 bytes.
var UV_NEXT_DAY = '»';

// The separator presets, tight: what stands between the two readings (`mid`) and
// what closes the pair (`end` -- only the brackets need one). Spacing is not a
// preset but its own per-kind toggle over every one of them (see spaceAround):
// '12/10' or '12 / 10', '12(10)' or '12 (10)'. 'slash' is the default AND the fit
// rule's last resort (see joinPair). U+00B7 is the middle dot: Latin-1, two UTF-8
// bytes. 'custom' is not a row here: its `mid` is the user's own text.
var SEPARATORS = {
    slash: { mid: '/', end: '' },
    brackets: { mid: '(', end: ')' },
    dot: { mid: '·', end: '' },
    bar: { mid: '|', end: '' }
};

// A custom separator keeps at most this many characters.
var CUSTOM_MAX_CHARS = 2;

// The UV peak's next-day marks: a prefix or a suffix around the number.
// 'raquo' is the default and reproduces the '»6' the slot always baked.
var NEXT_DAY_MARKS = {
    raquo: { pre: UV_NEXT_DAY, post: '' },
    gt: { pre: '>', post: '' },
    plus: { pre: '+', post: '' },
    star: { pre: '', post: '*' },
    none: { pre: '', post: '' }
};

/**
 * Own-property lookup, so a stored value like 'constructor' can never resolve
 * to something off Object.prototype.
 * @param {Object} table SEPARATORS or NEXT_DAY_MARKS
 * @param {*} key stored setting value
 * @returns {boolean}
 */
function has(table, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * Reduce a user-typed custom separator to what the watch can draw.
 *
 * Keeps printable ASCII (U+0020..U+007E) and printable Latin-1 (U+00A1..U+00FF)
 * -- what the watch's Gothic system fonts carry, and the range the slot already
 * relies on for '°' and '»' -- and drops everything else: control characters (a
 * NUL would end the watch's C string mid-slot), DEL, the C1 block, the no-break
 * space, and anything past Latin-1, emoji included (each half of a surrogate
 * pair falls outside the range on its own). Then the first CUSTOM_MAX_CHARS
 * survivors. Never trimmed: spaces are meaningful, ', ' is a valid separator.
 *
 * @param {*} value stored custom separator text
 * @returns {string} the drawable prefix; '' for a non-string or nothing drawable
 */
function sanitizeCustom(value) {
    if (typeof value !== 'string') { return ''; }
    var out = '';
    for (var i = 0; i < value.length && out.length < CUSTOM_MAX_CHARS; i++) {
        var c = value.charCodeAt(i);
        if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA1 && c <= 0xFF)) {
            out += value.charAt(i);
        }
    }
    return out;
}

/**
 * Resolve a stored separator setting to its preset. Absent, unknown, or a
 * 'custom' whose text sanitizes to nothing all read as the slash.
 * @param {*} separator stored separator setting, e.g. 'brackets'
 * @param {*} custom stored custom separator text (read only for 'custom')
 * @returns {{mid: string, end: string}}
 */
function presetFor(separator, custom) {
    if (separator === 'custom') {
        var text = sanitizeCustom(custom);
        return text ? { mid: text, end: '' } : SEPARATORS.slash;
    }
    return has(SEPARATORS, separator) ? SEPARATORS[separator] : SEPARATORS.slash;
}

/**
 * The spaced form of a preset: one space before the separator and one after it,
 * except where the preset already has one there (a custom ', ' keeps its own
 * trailing space rather than growing a second) and after an opening bracket,
 * whose reading sits inside it: '12 (10)', never '12 ( 10 )'.
 * @param {{mid: string, end: string}} preset a resolved preset
 * @returns {{mid: string, end: string}}
 */
function spaceAround(preset) {
    var mid = preset.mid;
    var lead = mid.charAt(0) === ' ' ? '' : ' ';
    var trail = (preset.end || mid.charAt(mid.length - 1) === ' ') ? '' : ' ';
    return { mid: lead + mid + trail, end: preset.end };
}

/**
 * Join two readings with the chosen separator -- spaced when asked, and
 * narrowed step by step when the styled pair would not fit the slot.
 *
 * The fit rule narrows rather than letting packLine's utf8Truncate have the
 * overflow, because truncation would chop the SECOND READING: '-12 / -10' on an
 * 8-byte edge slot would ship as '-12 / -1', a wrong number that looks like a
 * right one. So a pair too wide for its slot first drops the spaces (keeping the
 * user's separator: '-12 (-10)' -> '-12(-10)'), and one still too wide takes the
 * plain slash, the narrowest form there is, which fits every realistic pair
 * ('-12/-10', '11/»12': 7 bytes). Each step applies to that reading only. Order
 * and next-day mark are already in `first`/`second`, so every step keeps both.
 *
 * @param {string} first the reading shown first
 * @param {string} second the reading shown second
 * @param {*} separator stored separator setting (absent = 'slash')
 * @param {*} custom stored custom separator text
 * @param {*} spaced stored spacing toggle (absent = tight)
 * @param {number} [cap] the slot's byte cap; defaults to the narrow edge cap
 * @returns {string} e.g. '12/10', '12 / 10', '12 (10)'
 */
function joinPair(first, second, separator, custom, spaced, cap) {
    var preset = presetFor(separator, custom);
    var limit = typeof cap === 'number' ? cap : catalog.CAPS.EDGE_TEXT_MAX;
    var forms = Boolean(spaced) ? [spaceAround(preset), preset] : [preset];
    for (var i = 0; i < forms.length; i++) {
        var text = first + forms[i].mid + second + forms[i].end;
        if (utf8.byteLength(text) <= limit) { return text; }
    }
    return first + SEPARATORS.slash.mid + second;
}

/**
 * Mark a UV peak as tomorrow's. Absent or unknown = the default '»' prefix.
 * @param {string} value the formatted peak
 * @param {*} mark stored uvSlotNextDayMark
 * @returns {string} e.g. '»6', '>6', '+6', '6*', or '6' for 'none'
 */
function markNextDay(value, mark) {
    var m = has(NEXT_DAY_MARKS, mark) ? NEXT_DAY_MARKS[mark] : NEXT_DAY_MARKS.raquo;
    return m.pre + value + m.post;
}

/**
 * The temperature slot's 'both' text: actual and feels-like in the user's order
 * (tempSlotOrder, absent = actual first), joined by the user's separator, spaced
 * or tight (tempSlotSeparatorSpaced, absent = tight). Bare numbers in and out --
 * 'both' never carries the degree (formatValue's gate).
 * @param {string} actual the formatted actual temperature
 * @param {string} feels the formatted feels-like temperature
 * @param {Object} settings Clay settings blob (tempSlotSeparator,
 *   tempSlotSeparatorCustom, tempSlotSeparatorSpaced, tempSlotOrder)
 * @param {number} [cap] the slot's byte cap
 * @returns {string} e.g. '12/10', or '10 (12)' feels-first in spaced brackets
 */
function formatTempPair(actual, feels, settings, cap) {
    var s = settings || {};
    var feelsFirst = s.tempSlotOrder === 'feels';
    return joinPair(feelsFirst ? feels : actual, feelsFirst ? actual : feels,
        s.tempSlotSeparator, s.tempSlotSeparatorCustom, s.tempSlotSeparatorSpaced, cap);
}

/**
 * A day-max slot's text for the numbers wire-units' dayMaxShown picked, in every
 * mode. The next-day mark goes on the peak wherever it shows
 * -- alone in 'max' mode, paired in 'both' -- and the pair takes the kind's own
 * order (<prefix>SlotOrder, absent = now first), separator and spacing. No peak
 * known renders the current reading alone, never '3/--'.
 * @param {string} prefix the kind's settings prefix: 'uv' | 'wind' | 'gust' | 'aqi'
 * @param {{now: ?number, peak: ?number, nextDay: boolean}} shown the picked numbers
 *   (non-null: the caller renders '--' for no reading at all)
 * @param {Object} settings Clay settings blob (<prefix>SlotSeparator,
 *   <prefix>SlotSeparatorCustom, <prefix>SlotSeparatorSpaced, <prefix>SlotOrder,
 *   <prefix>SlotNextDayMark)
 * @param {number} [cap] the slot's byte cap
 * @returns {string} e.g. '3', '7', '»6', '3/7', '5/»6'
 */
function formatPeak(prefix, shown, settings, cap) {
    var s = settings || {};
    if (shown.peak === null) { return String(shown.now); }
    var peak = shown.nextDay ? markNextDay(String(shown.peak), s[prefix + 'SlotNextDayMark'])
        : String(shown.peak);
    if (shown.now === null) { return peak; }
    var now = String(shown.now);
    var maxFirst = s[prefix + 'SlotOrder'] === 'max';
    var text = joinPair(maxFirst ? peak : now, maxFirst ? now : peak,
        s[prefix + 'SlotSeparator'], s[prefix + 'SlotSeparatorCustom'],
        s[prefix + 'SlotSeparatorSpaced'], cap);
    // Three-digit readings (gusts, AQI) can outgrow even the plain slash with a
    // mark: '152/»178' is 9 bytes, and truncation would print the false peak
    // '152/»17'. The current reading alone is the honest fallback -- the same
    // one every mode takes when no peak is known.
    var limit = typeof cap === 'number' ? cap : catalog.CAPS.EDGE_TEXT_MAX;
    return utf8.byteLength(text) <= limit ? text : now;
}


module.exports = {
    UV_NEXT_DAY: UV_NEXT_DAY,
    SEPARATORS: SEPARATORS,
    NEXT_DAY_MARKS: NEXT_DAY_MARKS,
    CUSTOM_MAX_CHARS: CUSTOM_MAX_CHARS,
    sanitizeCustom: sanitizeCustom,
    spaceAround: spaceAround,
    joinPair: joinPair,
    markNextDay: markNextDay,
    formatTempPair: formatTempPair,
    formatPeak: formatPeak
};
