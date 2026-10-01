#pragma once

// The status slots' short forms: what a slot switches to when On demand items need
// its room (1.24.0 spec §5.6). Header-only (static inline, no .c file) and pure, like
// date_format.h, so test/c/status_short_text_test.c pins every family without an
// emulator. Everything is derived on the watch from the slot's resolved text plus its
// kind and icon: the phone never bakes a variant, and the forms cost no wire byte.
// The one fact the text cannot give is the date's day of the month ("07.09.26" does
// not say which number is the day), so the caller passes it.
//
// A slot's short family runs widest first, each member built on the one before:
//  - a pair drops its spaces: "12 | 10" -> "12|10", "3 / 7" -> "3/7";
//  - a reading drops its unit: the degree, kph / mph / kn, hPa, the countdown's d,
//    km / mi;
//  - wind and gusts then drop their direction arrow, a suffix beside the text
//    (status_short_member flags it);
//  - the date shortens a four-digit year in its format's own shape ("Sep '26",
//    "07.09.26"; never the month), and outside a calendar view ends on the day of
//    the month ("7");
//  - steps drop their tenths ("12.3k" -> "12k", never rounded up), sleep its minutes
//    ("7h32" -> "7h"; under an hour it has none, as "0h" would read as no sleep);
//  - the Watch battery glyph drops its bolt lane while the watch is not charging
//    (the lane is empty then);
//  - the city abbreviates its shortest word, then all but its longest ("Frankfurt am
//    Main" -> "Frankfurt a. Main" -> "Frankfurt a. M."), and its last member is
//    elastic: the full name, which the layout may ellipsize down to 3 characters +
//    "…" ("Fra…").
// The week (already "W40"), sunrise/sunset, heart rate, pollen, the Watch battery
// percentage and the phone battery have no short form: they hide at their turn. A
// battery number shows whole or not at all; its % is never dropped (owner,
// 2026-09-30).
//
// Written for size — the app image comes out of the heap on every platform — so the
// caller asks for one member at a time (status_short_member) and gets that one
// computed, the transforms work in place, and the city finds its two rungs in one
// pass over its words. NOT ON APLITE: the callers are On demand's
// (layers/status_on_demand.c, behind WW_ON_DEMAND) and the host tests, so aplite never
// compiles a body.

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "status_line.h"

// The Watch battery glyph's bolt lane in front of its body: battery_draw.c's
// BATTERY_POWER_ICON_W (7) + ICON_SPACING (3), pinned by
// test/battery-item-lockstep.test.js. Empty while the watch is not charging.
#define STATUS_SHORT_BATTERY_LANE_W 10
// The elastic city's floor: this many code points, then the ellipsis.
#define STATUS_SHORT_FLOOR_CPS 3
#define STATUS_SHORT_ELLIPSIS "\xE2\x80\xA6"
// Holds any member: none is longer than the full text (at most STATUS_TEXT_MID_MAX
// bytes), and the floor is at most 3 code points (12 B) + the ellipsis.
#define STATUS_SHORT_CAP (STATUS_TEXT_MID_MAX + 1)

// What a short member is beside its text: status_short_member's flags (0: no member).
#define SST_MEMBER 1u      // the member exists
#define SST_NO_SUFFIX 2u   // drawn without the slot's suffix (the wind arrow)
#define SST_NO_LANE 4u     // the Watch battery glyph without its bolt lane
#define SST_ELASTIC 8u     // may ellipsize down to its floor (status_short_floor)

static inline bool sst_is_digit(char c) {
    return c >= '0' && c <= '9';
}

// The byte length of the code point `s` starts with, at most `left`.
static inline int sst_cp_len(const char *s, int left) {
    unsigned char c = (unsigned char)s[0];
    int n = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
    return n > left ? left : n;
}

// The code points in the first `n` bytes of `s`.
static inline int sst_cps(const char *s, int n) {
    int count = 0;
    for (int i = 0; i < n; i++) {
        if (((unsigned char)s[i] & 0xC0) != 0x80) { count++; }
    }
    return count;
}

static inline bool sst_copy(char *out, size_t cap, const char *src, size_t n) {
    if (n + 1 > cap) { return false; }
    memcpy(out, src, n);
    out[n] = '\0';
    return true;
}

// The phone-baked (SLOT_TEXT) kinds, by icon, whose pair drops its spaces ...
#define SST_PAIR_ICONS ((1u << STATUS_ICON_TEMP) | (1u << STATUS_ICON_UV) \
    | (1u << STATUS_ICON_AQI) | (1u << STATUS_ICON_WIND) | (1u << STATUS_ICON_GUST))
// ... and whose reading drops its unit: the degree, kph / mph / kn, hPa, the
// countdown's d.
#define SST_UNIT_ICONS ((1u << STATUS_ICON_TEMP) | (1u << STATUS_ICON_DEWPOINT) \
    | (1u << STATUS_ICON_WIND) | (1u << STATUS_ICON_GUST) | (1u << STATUS_ICON_PRESSURE) \
    | (1u << STATUS_ICON_COUNTDOWN))

static inline bool sst_text_icon(uint8_t kind, uint8_t icon, uint32_t icons) {
    return kind == SLOT_TEXT && icon < 32 && ((icons >> icon) & 1u);
}

// A unit's byte: a letter, or one of the degree's two (C2 B0).
static inline bool sst_unit_byte(char c) {
    unsigned char u = (unsigned char)c;
    return ((u | 0x20) >= 'a' && (u | 0x20) <= 'z') || u == 0xC2 || u == 0xB0;
}

// Step `t` of a slot's chain, applied to `s` in place (a `cap`-byte buffer); true when
// it changed the text. The chain runs in this order, each step on the text the ones
// before left:
//  0  a pair's spaces go: "12 | 10" -> "12|10", "12 / 30kph" -> "12/30kph";
//  1  the unit goes — the trailing run of unit bytes (sst_unit_byte) of a kind that
//     has one, and only after a reading: "now" and "--" keep theirs, and a mark stays
//     ("12/30*kph" -> "12/30*");
//  2  the date's four-digit year shortens in its format's own shape — "'26" after a
//     space ("Sep '26", "Sep 7, '26", "7. Sep '26"), the century dropped after '.' or
//     '/' ("09.26", "07.09.26"), as the two-digit formats already print it; none for a
//     year-first ISO date or a text without exactly one four-digit run;
//  3  outside a calendar view (`mday` > 0), the date becomes the day of the month
//     (no zero pad, clamped like date_format_clamped_tm);
//  4  steps drop their tenths: "12.3k" -> "12k" (truncated, never rounded up);
//  5  sleep drops its minutes: "7h32" -> "7h"; none under an hour ("0h45").
static inline bool sst_apply(uint8_t kind, uint8_t icon, uint8_t mday, int t, char *s,
                             size_t cap) {
    int len = (int)strlen(s);
    switch (t) {
        case 0: {
            if (!sst_text_icon(kind, icon, SST_PAIR_ICONS)) { return false; }
            int n = 0;
            for (int i = 0; i < len; i++) {
                if (s[i] != ' ') { s[n++] = s[i]; }
            }
            s[n] = '\0';
            return n < len;
        }
        case 1: {
            if (!sst_text_icon(kind, icon, SST_UNIT_ICONS) && kind != SLOT_LIVE_DISTANCE
                    && kind != SLOT_LIVE_DISTANCE_MI) {
                return false;
            }
            int n = len;
            while (n > 0 && sst_unit_byte(s[n - 1])) { n--; }
            bool reading = false;
            for (int i = 0; i < n; i++) { reading = reading || sst_is_digit(s[i]); }
            if (n == len || !reading) { return false; }
            s[n] = '\0';
            return true;
        }
        case 2: {
            if (kind != SLOT_LIVE_DATE) { return false; }
            int start = -1;
            for (int i = 0; i < len;) {
                int j = i;
                while (j < len && sst_is_digit(s[j])) { j++; }
                if (j - i == 4) {
                    if (start >= 0) { return false; }
                    start = i;
                }
                i = j > i ? j : i + 1;
            }
            if (start <= 0) { return false; }
            int drop = 2;
            if (s[start - 1] == ' ') {
                s[start++] = '\'';   // "2026" -> "'026", then the 0 goes
                drop = 1;
            } else if (s[start - 1] != '.' && s[start - 1] != '/') {
                return false;
            }
            memmove(s + start, s + start + drop, (size_t)(len - start - drop + 1));
            return true;
        }
        case 3: {
            if (kind != SLOT_LIVE_DATE || mday == 0) { return false; }
            int n = snprintf(s, cap, "%d", mday > 31 ? 31 : mday);
            return n > 0 && (size_t)n < cap;
        }
        case 4:
            if (kind != SLOT_LIVE_STEPS || len < 4 || s[len - 1] != 'k' || s[len - 3] != '.'
                    || !sst_is_digit(s[len - 2])) {
                return false;
            }
            s[len - 3] = 'k';
            s[len - 2] = '\0';
            return true;
        case 5: {
            // A loop, not strchr: that would link newlib's 200-byte one into the image.
            int h = 1;
            while (h < len && s[h] != 'h') { h++; }
            // Under an hour ("0h45": the hours are never zero-padded) there is none: "0h"
            // would read as no sleep at all.
            if (kind != SLOT_LIVE_SLEEP || h >= len - 1 || s[0] == '0') { return false; }
            s[h + 1] = '\0';
            return true;
        }
        default:
            return false;
    }
}
#define SST_STEPS 6

// --- the city's word ladder -------------------------------------------------------

// The next word of `s` at or after byte `i` (words split on the ASCII space; a
// hyphenated word is one word): its first byte, with its end in *end. None left:
// the returned start equals *end.
static inline int sst_word(const char *s, int i, int *end) {
    while (s[i] == ' ') { i++; }
    int j = i;
    while (s[j] != '\0' && s[j] != ' ') { j++; }
    *end = j;
    return i;
}

// The code points of the word [at, end) when the ladder may abbreviate it — a letter
// first (ASCII, or any non-ASCII code point), at least two code points, and not
// already an initial and a dot — else 0.
static inline int sst_word_cps(const char *s, int at, int end) {
    unsigned char c = (unsigned char)s[at];
    bool letter = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c >= 0xC0;
    int first = sst_cp_len(s + at, end - at);
    int cps = sst_cps(s + at, end - at);
    if (!letter || cps < 2 || (end - at == first + 1 && s[at + first] == '.')) { return 0; }
    return cps;
}

// Member `v` of the city's family into `out`: its flags, 0 for none. The ladder
// abbreviates words to their first code point and a dot in its order — the shortest
// first, the leftmost first on a tie — until only the longest is whole; the watch
// draws two of its rungs. Rung 1 abbreviates the first word in that order, which takes
// two abbreviable words; rung 2 every abbreviable word but the last in that order (the
// longest, the rightmost on a tie), which takes three: with two, rung 1 is that form
// already. Then the elastic member, the full name, which exists only when it has more
// than STATUS_SHORT_FLOOR_CPS code points to ellipsize.
static inline uint8_t sst_city_member(const char *s, uint8_t v, char *out, size_t cap) {
    const int len = (int)strlen(s);
    int words = 0;   // the abbreviable words
    int first = -1;  // the first of them in the ladder's order, and the last
    int last = -1;
    int first_cps = 0x7FFF;
    int last_cps = 0;
    int end;
    for (int w = sst_word(s, 0, &end); w < end; w = sst_word(s, end, &end)) {
        int cps = sst_word_cps(s, w, end);
        if (cps == 0) { continue; }
        words++;
        if (cps < first_cps) { first_cps = cps; first = w; }
        if (cps >= last_cps) { last_cps = cps; last = w; }
    }
    const int rungs = words > 3 ? 2 : words - 1;
    if (v > rungs) {
        return v == (rungs > 0 ? rungs : 0) + 1 && sst_cps(s, len) > STATUS_SHORT_FLOOR_CPS
            && sst_copy(out, cap, s, (size_t)len) ? (SST_MEMBER | SST_ELASTIC) : 0;
    }
    size_t n = 0;
    int from = 0;   // the next byte of `s` to copy
    for (int w = sst_word(s, 0, &end); w <= len; w = sst_word(s, end, &end)) {
        // The bytes up to the word, or the whole word when it stays; an abbreviated
        // one keeps its first code point, then its dot.
        bool abbr = w < end && sst_word_cps(s, w, end) > 0 && (v == 1 ? w == first : w != last);
        int upto = abbr ? w + sst_cp_len(s + w, end - w) : end;
        if (n + (size_t)(upto - from) + (abbr ? 2 : 1) > cap) { return 0; }
        memcpy(out + n, s + from, (size_t)(upto - from));
        n += (size_t)(upto - from);
        if (abbr) { out[n++] = '.'; }
        from = end;
        if (w == end) { break; }
    }
    out[n] = '\0';
    return SST_MEMBER;
}

// --- the families ------------------------------------------------------------------

// The city is the one slot kind whose last member is elastic.
static inline bool status_short_elastic(uint8_t kind, uint8_t icon) {
    return kind == SLOT_TEXT && icon == STATUS_ICON_NONE;
}

// The elastic city's floor: its first STATUS_SHORT_FLOOR_CPS code points and the
// ellipsis ("Fra…"). False for a name that short: there is nothing to ellipsize.
static inline bool status_short_floor(const char *full, char *out, size_t cap) {
    int len = (int)strlen(full);
    int at = 0;
    for (int cps = 0; at < len && cps < STATUS_SHORT_FLOOR_CPS; cps++) {
        at += sst_cp_len(full + at, len - at);
    }
    if (at >= len || (size_t)at + sizeof(STATUS_SHORT_ELLIPSIS) > cap) { return false; }
    memcpy(out, full, (size_t)at);
    memcpy(out + at, STATUS_SHORT_ELLIPSIS, sizeof(STATUS_SHORT_ELLIPSIS));
    return true;
}

// Member `v` (1 = the first short member) of the short family of a slot of `kind` /
// `icon` whose full text is `full`, widest first: its text into `out` and its flags
// (SST_*), 0 when there is none — the members run 1, 2, … up to the first 0 (none at
// all: the slot hides at its turn). The text members — the chain's steps that change
// the text (sst_apply), or the city's rungs and its elastic name (sst_city_member) —
// then, for a slot with a `suffix` (the wind arrow), the last text drawn without it.
// The Watch battery glyph has one member, its text unchanged and without its bolt
// lane, and only while it is not `charging`. `mday` is today's day of the month for a
// date outside a calendar view, 0 in one. No family has more than OD_VARIANTS - 1
// members (on_demand.h), which test/c/status_short_text_test.c holds every kind to.
static inline uint8_t status_short_member(uint8_t kind, uint8_t icon, uint8_t mday,
                                          const char *full, bool suffix, bool charging,
                                          uint8_t v, char *out, size_t cap) {
    if (!full || !out || v == 0) { return 0; }
    if (status_short_elastic(kind, icon)) { return sst_city_member(full, v, out, cap); }
    if (!sst_copy(out, cap, full, strlen(full))) { return 0; }
    if (kind == SLOT_LIVE_BATTERY) {
        return v == 1 && !charging ? (SST_MEMBER | SST_NO_LANE) : 0;
    }
    uint8_t found = 0;
    for (int t = 0; t < SST_STEPS; t++) {
        if (sst_apply(kind, icon, mday, t, out, cap) && ++found == v) { return SST_MEMBER; }
    }
    return suffix && found + 1 == v ? (SST_MEMBER | SST_NO_SUFFIX) : 0;
}
