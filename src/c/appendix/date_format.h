#pragma once

// Pure date-slot formatters for SLOT_LIVE_DATE — header-only (static functions, no
// .c file), like status_icon_size.h: plain libc string composition with no SDK
// binding, so the host test (test/c/date_format_test.c) pins every format string
// without an emulator. The only caller is status_row.c's format_status_date,
// which aplite never compiles (its frozen lean twin status_row_aplite.c keeps
// the hardcoded "%b %Y" / dd.mm.yy formats), so nothing here needs a platform
// guard.
//
// Month names come from strftime in the app's default locale — the app never
// calls setlocale(), so they are ENGLISH on every firmware language (Sep,
// September), matching the pre-setting "%b %Y" behavior. That also bounds the
// widths: the longest output is "September 2026" (15 B incl. NUL) against the
// callers' 20 B slot cap, and "%b" is always 3 chars against mon_name[8]. If
// setlocale ever arrives, revisit both buffers — localized names can overflow
// them, and the strftime()==0 guards below only keep the failure terminated,
// not pretty.

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

// Wire vocabulary for CLAY_DATE_FORMAT_UINT8, byte [0] — how the date slot
// prints while a calendar is on screen (the grid already shows the day, so the
// slot carries month + year). APPEND-ONLY: the byte values ride the Clay message
// and persist in the Config blob, so a retired value keeps its slot. Lockstep
// with MONTH_FORMAT_CODES in src/pkjs/calendar/domain/date-format.js (index = wire value),
// machine-checked by test/page/calendar/date-format-contract.test.js.
enum DateMonthFormat {
    DATE_MONTH_AUTO = 0,   // "Sep 2026" (%b %Y) — the pre-setting behavior
    DATE_MONTH_NAME = 1,   // "September 2026" (%B %Y)
    DATE_MONTH_DOTS = 2,   // "09.2026"
    DATE_MONTH_SLASH = 3,  // "09/2026"
    DATE_MONTH_ISO = 4,    // "2026-09"
    DATE_MONTH_DOTSYY = 5, // "09.26" (the owner's, 2026-11-14)
    DATE_MONTH_NOYEAR = 6, // "Sep", the month alone (the owner's, 2026-11-14)
};

// Wire vocabulary for CLAY_DATE_FORMAT_UINT8, byte [1] — how the date slot
// prints with no calendar on screen (the slot carries the full date). Same
// append-only / lockstep rules as above (FULL_FORMAT_CODES in date-format.js).
// month_first is the country-derived order the Auto format has always used
// (Config.date_month_first, US -> month first); the day-bearing formats below
// follow it too, so one Holiday-region choice orders every variant.
enum DateFullFormat {
    DATE_FULL_AUTO = 0,      // "07.09.26" / "09.07.26" — the pre-setting behavior
    DATE_FULL_LONG = 1,      // "07.09.2026" / "09.07.2026"
    DATE_FULL_NOYEAR = 2,    // "7.9." / "9.7."
    DATE_FULL_SLASH = 3,     // "7/9/26" / "9/7/26"
    DATE_FULL_ISO = 4,       // "2026-09-07" (fixed — ISO has one order)
    DATE_FULL_TEXT = 5,      // "7 Sep" / "Sep 7"
    DATE_FULL_TEXTYEAR = 6,  // "7. Sep 2026" / "Sep 7, 2026"
};

// What a date format falls back to where its slot cannot show the date whole: the shorter
// format, one of the list's own, that the row swaps in before it cuts the date with an
// ellipsis (status_row.c: the date slot's short form; status_row_layout.h
// status_row_swap_short_forms), and that On demand takes as the date's short member
// (status_short_text.h). DATE_FORMAT_NONE where no shorter one exists. Each keeps its
// format's way of writing and the month (never a bare day number): the month names drop
// the year ("Sep"), the numeric month + year formats take the two-digit year ("09.26"), the
// numeric full dates take the day and month alone ("7.9.", in the region's order) and the
// written-out date drops its year ("7 Sep"). Lockstep: date-format.js MONTH_SHORT /
// FULL_SHORT, held to the pins of test/c/date_format_test.c by
// test/page/calendar/date-format-contract.test.js.
#define DATE_FORMAT_NONE 0xFF
// The longest short form ("31.12.", "27 Sep", "Sep 27"), without its NUL.
#define DATE_FORMAT_SHORT_MAX 6

static inline uint8_t date_format_month_short(uint8_t fmt) {
    switch (fmt) {
        case DATE_MONTH_DOTS:
        case DATE_MONTH_SLASH:
        case DATE_MONTH_ISO:
            return DATE_MONTH_DOTSYY;
        case DATE_MONTH_DOTSYY:
        case DATE_MONTH_NOYEAR:
            return DATE_FORMAT_NONE;
        default:   // Auto (an unknown byte reads as Auto) and the month's name
            return DATE_MONTH_NOYEAR;
    }
}

static inline uint8_t date_format_full_short(uint8_t fmt) {
    switch (fmt) {
        case DATE_FULL_NOYEAR:
        case DATE_FULL_TEXT:
            return DATE_FORMAT_NONE;
        case DATE_FULL_TEXTYEAR:
            return DATE_FULL_TEXT;
        default:   // Auto (an unknown byte reads as Auto), Long, Slash and ISO
            return DATE_FULL_NOYEAR;
    }
}

// A copy of tm with the day/month fields clamped into range. The original
// formatter clamped its derived ints so a torn tm from a boot-race read could
// not print "00.00.00"; the copy extends the same defence to the strftime
// paths, where an out-of-range tm_mon is undefined behavior (C11 7.27.3.5 —
// newlib indexes the month-name table with it directly).
static inline struct tm date_format_clamped_tm(const struct tm *tm_now) {
    struct tm t = *tm_now;
    if (t.tm_mon < 0) { t.tm_mon = 0; } else if (t.tm_mon > 11) { t.tm_mon = 11; }
    if (t.tm_mday < 1) { t.tm_mday = 1; } else if (t.tm_mday > 31) { t.tm_mday = 31; }
    return t;
}

// strftime with the one failure mode terminated: on overflow it returns 0 and
// leaves the buffer indeterminate, which would send an unterminated array into
// strlen/graphics_draw_text downstream — clear it instead (unreachable while
// the English-name width bound above holds).
static inline void date_format_strftime(char *buf, size_t cap, const char *fmt,
                                        const struct tm *t) {
    if (cap == 0) { return; }
    if (strftime(buf, cap, fmt, t) == 0) { buf[0] = '\0'; }
}

// Month + year, for calendar views. Out of line, as date_format_full is: one copy serves both
// of date_format_slot's passes (inlined into its loop the two came out 80 B larger on basalt).
// `unused`: config.c includes this header for the enums alone.
__attribute__((noinline, unused))
static void date_format_month_year(char *buf, size_t cap, const struct tm *tm_now,
                                   uint8_t fmt) {
    struct tm t = date_format_clamped_tm(tm_now);
    int mon = t.tm_mon + 1;
    int year = t.tm_year + 1900;
    switch (fmt) {
        case DATE_MONTH_NAME:
            date_format_strftime(buf, cap, "%B %Y", &t);
            return;
        case DATE_MONTH_DOTS:
            snprintf(buf, cap, "%02d.%04d", mon, year);
            return;
        case DATE_MONTH_SLASH:
            snprintf(buf, cap, "%02d/%04d", mon, year);
            return;
        case DATE_MONTH_ISO:
            snprintf(buf, cap, "%04d-%02d", year, mon);
            return;
        case DATE_MONTH_DOTSYY:
            snprintf(buf, cap, "%02d.%02d", mon, year < 0 ? 0 : year % 100);
            return;
        case DATE_MONTH_NOYEAR:
            date_format_strftime(buf, cap, "%b", &t);
            return;
        default:
            date_format_strftime(buf, cap, "%b %Y", &t);
            return;
    }
}

// Full date, for no-calendar views.
__attribute__((noinline, unused))
static void date_format_full(char *buf, size_t cap, const struct tm *tm_now, uint8_t fmt,
                             bool month_first) {
    struct tm t = date_format_clamped_tm(tm_now);
    int mday = t.tm_mday;
    int mon = t.tm_mon + 1;
    int year = t.tm_year + 1900;
    int yy = year % 100;
    if (yy < 0) { yy = 0; }
    // The numeric formats' first and second numbers: month and day, or day and month.
    const int first = month_first ? mon : mday;
    const int second = month_first ? mday : mon;
    // The abbreviated month name, only for the two text formats.
    char mon_name[8] = "";
    if (fmt == DATE_FULL_TEXT || fmt == DATE_FULL_TEXTYEAR) {
        date_format_strftime(mon_name, sizeof(mon_name), "%b", &t);
    }
    switch (fmt) {
        case DATE_FULL_LONG:
            snprintf(buf, cap, "%02d.%02d.%04d", first, second, year);
            return;
        case DATE_FULL_NOYEAR:
            snprintf(buf, cap, "%d.%d.", first, second);
            return;
        case DATE_FULL_SLASH:
            snprintf(buf, cap, "%d/%d/%02d", first, second, yy);
            return;
        case DATE_FULL_ISO:
            snprintf(buf, cap, "%04d-%02d-%02d", year, mon, mday);
            return;
        case DATE_FULL_TEXT:
            if (month_first) { snprintf(buf, cap, "%s %d", mon_name, mday); }
            else { snprintf(buf, cap, "%d %s", mday, mon_name); }
            return;
        case DATE_FULL_TEXTYEAR:
            if (month_first) { snprintf(buf, cap, "%s %d, %04d", mon_name, mday, year); }
            else { snprintf(buf, cap, "%d. %s %04d", mday, mon_name, year); }
            return;
        default:
            snprintf(buf, cap, "%02d.%02d.%02d", first, second, yy);
            return;
    }
}

// The date slot's text into `buf`, in format `fmt` of its list (the full date where `full`,
// else month + year, day and month in the `month_first` order), and into `alt` its short form:
// the same date in the shorter format its format falls back to (date_format_month_short,
// date_format_full_short), "" where none is shorter. One call of each formatter, so the watch
// carries one copy of each (status_row.c format_status_date).
static inline void date_format_slot(char *buf, size_t cap, char *alt, size_t alt_cap,
                                    const struct tm *tm_now, bool full, uint8_t fmt,
                                    bool month_first) {
    // Two passes, the date and then its short form, through one call of each formatter.
    for (int pass = 0; pass < 2; pass++) {
        if (pass == 1) {
            fmt = full ? date_format_full_short(fmt) : date_format_month_short(fmt);
            buf = alt;
            cap = alt_cap;
            if (fmt == DATE_FORMAT_NONE) {
                if (cap > 0) { buf[0] = '\0'; }
                return;
            }
        }
        if (full) {
            date_format_full(buf, cap, tm_now, fmt, month_first);
        } else {
            date_format_month_year(buf, cap, tm_now, fmt);
        }
    }
}
