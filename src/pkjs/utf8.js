// src/pkjs/utf8.js — the ONE UTF-8 byte engine for the two wire byte-budgets.
//
// status-lines.js packs slot text as raw UTF-8 bytes (the watch renders byte
// arrays) and clay-payload.js caps a settings STRING by its encoded size; both
// used to carry their own surrogate-pair state machine, with a subtly
// different lone-surrogate policy (substitute U+FFFD vs count-as-3-and-keep).
// The policies AGREE on the only thing the budgets care about — U+FFFD encodes
// to 3 bytes, exactly what a lone surrogate is charged — so one walker serves
// both: `bytes` carries the FFFD-substituted encoding (what a renderer should
// see), while truncateToByteCap's `str` is the ORIGINAL prefix (a string
// consumer keeps its own chars). ES5 only (aplite PKJS).

/**
 * Resolve the code point at index i, with lone surrogates read as U+FFFD.
 * @param {string} str Input string.
 * @param {number} i UTF-16 index.
 * @returns {{cp: number, units: number}} Code point + UTF-16 units consumed.
 */
function codePointAt(str, i) {
    var c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
        var lo = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
            return { cp: 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00), units: 2 };
        }
        return { cp: 0xFFFD, units: 1 };
    }
    if (c >= 0xDC00 && c <= 0xDFFF) {
        return { cp: 0xFFFD, units: 1 };
    }
    return { cp: c, units: 1 };
}

/**
 * @param {number[]} out Byte array to append to (mutated).
 * @param {number} cp Code point.
 * @returns {void}
 */
function pushCodePoint(out, cp) {
    if (cp < 0x80) {
        out.push(cp);
    } else if (cp < 0x800) {
        out.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
        out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    } else {
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    }
}

/**
 * @param {string} str Input string.
 * @returns {number[]} UTF-8 bytes (lone surrogates as U+FFFD).
 */
function encode(str) {
    var out = [];
    var i = 0;
    var r;
    while (i < str.length) {
        r = codePointAt(str, i);
        pushCodePoint(out, r.cp);
        i += r.units;
    }
    return out;
}

/**
 * @param {string} str Input string.
 * @returns {number} Encoded UTF-8 byte length.
 */
function byteLength(str) {
    return encode(str).length;
}

/**
 * Longest prefix of `str` that encodes to at most `cap` bytes, chopped at a
 * code-point boundary (a surrogate pair is kept or dropped whole).
 * @param {string} str Input string.
 * @param {number} cap Byte budget.
 * @returns {{str: string, bytes: number[]}} The ORIGINAL prefix and its
 *   (FFFD-substituted) encoding.
 */
function truncateToByteCap(str, cap) {
    var out = [];
    var i = 0;
    var r;
    var before;
    while (i < str.length) {
        r = codePointAt(str, i);
        before = out.length;
        pushCodePoint(out, r.cp);
        if (out.length > cap) {
            out.length = before;
            break;
        }
        i += r.units;
    }
    return { str: str.slice(0, i), bytes: out };
}

module.exports = {
    encode: encode,
    byteLength: byteLength,
    truncateToByteCap: truncateToByteCap
};
