// src/pkjs/city-ladder.js — the city's word ladder, the phone's twin of the watch's.
//
// A city name's abbreviated forms, widest first: its words are split on the ASCII
// space (a hyphenated word is one word), and the ones that start with a letter and are
// not already an initial are abbreviated to their first character and a dot, shortest
// first (the leftmost first on a tie), until only the longest is whole. "Frankfurt am
// Main" -> "Frankfurt a. Main" -> "Frankfurt a. M.".
//
// The watch walks the same ladder (src/c/appendix/status_short_text.h,
// sst_city_member) when On demand needs a status slot's room. The phone walks it
// before an edge slot's 8-byte cap (status-lines.js packLine), so an edge city
// arrives as the first form that fits ("B. Soden") instead of cut short ("Bad Sode").
// test/city-ladder.test.js runs this twin over the C test's vector table
// (test/c/status_short_text_test.c, CITY_VECTORS), which holds both to one table.
// ES5 only (aplite PKJS).

var utf8 = require('./utf8.js');

/**
 * The code points of a string, a surrogate pair kept whole.
 * @param {string} str Input string.
 * @returns {string[]} One entry per code point.
 */
function codePoints(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      var lo = str.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        out.push(str.substr(i, 2));
        i++;
        continue;
      }
    }
    out.push(str.charAt(i));
  }
  return out;
}

/**
 * Whether a word's first code point reads as a letter the way the watch reads it: an
 * ASCII letter, or any non-ASCII code point (a UTF-8 lead byte of 0xC0 or more).
 * @param {string} cp The word's first code point.
 * @returns {boolean}
 */
function isLetter(cp) {
  var c = cp.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c >= 0x80;
}

/**
 * The city's ladder: the name itself, then its abbreviated forms widest first.
 * @param {*} city The city name; anything but a string reads as ''.
 * @returns {string[]} e.g. ['New York', 'N. York']; a single word gives just itself
 */
function members(city) {
  var text = typeof city === 'string' ? city : '';
  // The space-separated parts; '' for the gap between two spaces, so joining them with
  // one space gives the name back byte for byte. Every word is ranked, as on the
  // watch (sst_rank walks them all).
  var parts = text.split(' ');
  var cps = [];
  var order = [];
  for (var p = 0; p < parts.length; p++) {
    if (parts[p] === '') { continue; }
    cps[p] = codePoints(parts[p]);
    var cp = cps[p];
    var initial = cp.length === 2 && cp[1] === '.';
    if (!isLetter(cp[0]) || cp.length < 2 || initial) { continue; }
    // Insert by length, after every word as short: a tie keeps the leftmost first.
    var at = order.length;
    while (at > 0 && cps[order[at - 1]].length > cp.length) { at--; }
    order.splice(at, 0, p);
  }
  var out = [text];
  var current = parts.slice();
  for (var step = 0; step + 1 < order.length; step++) {
    current[order[step]] = cps[order[step]][0] + '.';
    out.push(current.join(' '));
  }
  return out;
}

/**
 * The city text an edge slot of `cap` bytes gets: the first form of the ladder that
 * fits (the full name included), else its last form, which packLine then cuts at the
 * cap as before.
 * @param {*} city The city name.
 * @param {number} cap The slot's byte cap.
 * @returns {string}
 */
function fit(city, cap) {
  var forms = members(city);
  for (var i = 0; i < forms.length; i++) {
    if (utf8.byteLength(forms[i]) <= cap) { return forms[i]; }
  }
  return forms[forms.length - 1];
}

module.exports = {
  members: members,
  fit: fit
};
