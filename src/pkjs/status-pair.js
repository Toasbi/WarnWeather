// src/pkjs/status-pair.js — how a two-value status slot presents its pair.
//
// Two slot kinds can show two readings at once: Temperature in 'both' mode
// (actual and feels-like) and UV in 'both' mode (now and the peak still ahead).
// Which reading comes first, what stands between the two, and how UV marks a peak
// that is tomorrow's are per-kind settings (each kind's Edit sheet); this module
// turns them into the text status-lines.js bakes. Phone-side only: the watch
// receives finished slot text, so no wire field or C change rides with it.
//
// An ABSENT setting means its default, and the defaults reproduce what the slot
// baked before these settings existed, byte for byte: '12/10', '3/7', '5/»6'.
// The numbers themselves are not decided here -- wire-units' uvShown picks them,
// and status-thresholds judges those same numbers, so no presentation choice can
// move a highlight. ES5 only (aplite PKJS).

var catalog = require('./status-line-catalog.js');
var utf8 = require('./utf8.js');

// Marks the UV slot's peak as tomorrow's (Latin-1, like status-lines' DEGREE: the
// watch's system fonts carry it) -- the default next-day mark. Worst case
// '11/»12' is 7 of the edge slot's 8 bytes.
var UV_NEXT_DAY = '»';

// The separator presets: what stands between the two readings (`mid`) and what
// closes the pair (`end` -- only the brackets need one). 'slash' is the default
// AND the fit rule's fallback (see joinPair). U+00B7 is the middle dot: Latin-1,
// two UTF-8 bytes. 'custom' is not a row here: its `mid` is the user's own text.
var SEPARATORS = {
    slash: { mid: '/', end: '' },
    spaced: { mid: ' / ', end: '' },
    brackets: { mid: ' (', end: ')' },
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
 * @param {*} separator stored separator setting, e.g. 'spaced'
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
 * Join two readings with the chosen separator -- or with the plain slash when
 * the styled pair would not fit the slot.
 *
 * The fit rule falls back rather than letting packLine's utf8Truncate have the
 * overflow, because truncation would chop the SECOND READING: '-12 / -10' on an
 * 8-byte edge slot would ship as '-12 / -1', a wrong number that looks like a
 * right one. The slash form is the narrowest there is and fits every realistic
 * pair ('-12/-10', '11/»12': 7 bytes), so a preset that cannot fit a corner
 * degrades to the default for that reading only. Order and next-day mark are
 * already in `first`/`second`, so the fallback keeps both.
 *
 * @param {string} first the reading shown first
 * @param {string} second the reading shown second
 * @param {*} separator stored separator setting (absent = 'slash')
 * @param {*} custom stored custom separator text
 * @param {number} [cap] the slot's byte cap; defaults to the narrow edge cap
 * @returns {string} e.g. '12/10', '12 / 10', '12 (10)'
 */
function joinPair(first, second, separator, custom, cap) {
    var preset = presetFor(separator, custom);
    var text = first + preset.mid + second + preset.end;
    var limit = typeof cap === 'number' ? cap : catalog.CAPS.EDGE_TEXT_MAX;
    return utf8.byteLength(text) <= limit
        ? text : first + SEPARATORS.slash.mid + second;
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
 * (tempSlotOrder, absent = actual first), joined by the user's separator. Bare
 * numbers in and out -- 'both' never carries the degree (formatValue's gate).
 * @param {string} actual the formatted actual temperature
 * @param {string} feels the formatted feels-like temperature
 * @param {Object} settings Clay settings blob (tempSlotSeparator,
 *   tempSlotSeparatorCustom, tempSlotOrder)
 * @param {number} [cap] the slot's byte cap
 * @returns {string} e.g. '12/10', or '10 (12)' feels-first in brackets
 */
function formatTempPair(actual, feels, settings, cap) {
    var s = settings || {};
    var feelsFirst = s.tempSlotOrder === 'feels';
    return joinPair(feelsFirst ? feels : actual, feelsFirst ? actual : feels,
        s.tempSlotSeparator, s.tempSlotSeparatorCustom, cap);
}

/**
 * The UV slot's text for the numbers wire-units' uvShown picked, in every mode.
 * The next-day mark goes on the peak wherever it shows -- alone in 'max' mode,
 * paired in 'both' -- and the pair takes the user's order (uvSlotOrder, absent =
 * now first) and separator. No peak known renders the current reading alone,
 * never '3/--'.
 * @param {{now: ?number, peak: ?number, nextDay: boolean}} uv uvShown's result
 *   (non-null: the caller renders '--' for no UV at all)
 * @param {Object} settings Clay settings blob (uvSlotSeparator,
 *   uvSlotSeparatorCustom, uvSlotOrder, uvSlotNextDayMark)
 * @param {number} [cap] the slot's byte cap
 * @returns {string} e.g. '3', '7', '»6', '3/7', '5/»6'
 */
function formatUv(uv, settings, cap) {
    var s = settings || {};
    if (uv.peak === null) { return String(uv.now); }
    var peak = uv.nextDay ? markNextDay(String(uv.peak), s.uvSlotNextDayMark)
        : String(uv.peak);
    if (uv.now === null) { return peak; }
    var now = String(uv.now);
    var maxFirst = s.uvSlotOrder === 'max';
    return joinPair(maxFirst ? peak : now, maxFirst ? now : peak,
        s.uvSlotSeparator, s.uvSlotSeparatorCustom, cap);
}

module.exports = {
    UV_NEXT_DAY: UV_NEXT_DAY,
    SEPARATORS: SEPARATORS,
    NEXT_DAY_MARKS: NEXT_DAY_MARKS,
    CUSTOM_MAX_CHARS: CUSTOM_MAX_CHARS,
    sanitizeCustom: sanitizeCustom,
    joinPair: joinPair,
    markNextDay: markNextDay,
    formatTempPair: formatTempPair,
    formatUv: formatUv
};
