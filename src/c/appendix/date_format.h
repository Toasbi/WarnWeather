#pragma once

// Pure date-slot formatters for SLOT_LIVE_DATE — header-only (static inline, no
// .c file), like status_icon_weight.h: plain libc string composition with no SDK
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
// with MONTH_FORMAT_CODES in src/pkjs/date-format.js (index = wire value),
// machine-checked by test/date-format-contract.test.js.
enum DateMonthFormat {
    DATE_MONTH_AUTO = 0,   // "Sep 2026" (%b %Y) — the pre-setting behavior
    DATE_MONTH_NAME = 1,   // "September 2026" (%B %Y)
    DATE_MONTH_DOTS = 2,   // "09.2026"
    DATE_MONTH_SLASH = 3,  // "09/2026"
    DATE_MONTH_ISO = 4,    // "2026-09"
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

// Month + year, for calendar views.
static inline void date_format_month_year(char *buf, size_t cap,
                                          const struct tm *tm_now, uint8_t fmt) {
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
        default:
            date_format_strftime(buf, cap, "%b %Y", &t);
            return;
    }
}

// Full date, for no-calendar views.
static inline void date_format_full(char *buf, size_t cap, const struct tm *tm_now,
                                    uint8_t fmt, bool month_first) {
    struct tm t = date_format_clamped_tm(tm_now);
    int mday = t.tm_mday;
    int mon = t.tm_mon + 1;
    int year = t.tm_year + 1900;
    int yy = year % 100;
    if (yy < 0) { yy = 0; }
    // The abbreviated month name, only for the two text formats.
    char mon_name[8] = "";
    if (fmt == DATE_FULL_TEXT || fmt == DATE_FULL_TEXTYEAR) {
        date_format_strftime(mon_name, sizeof(mon_name), "%b", &t);
    }
    switch (fmt) {
        case DATE_FULL_LONG:
            if (month_first) { snprintf(buf, cap, "%02d.%02d.%04d", mon, mday, year); }
            else { snprintf(buf, cap, "%02d.%02d.%04d", mday, mon, year); }
            return;
        case DATE_FULL_NOYEAR:
            if (month_first) { snprintf(buf, cap, "%d.%d.", mon, mday); }
            else { snprintf(buf, cap, "%d.%d.", mday, mon); }
            return;
        case DATE_FULL_SLASH:
            if (month_first) { snprintf(buf, cap, "%d/%d/%02d", mon, mday, yy); }
            else { snprintf(buf, cap, "%d/%d/%02d", mday, mon, yy); }
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
            if (month_first) { snprintf(buf, cap, "%02d.%02d.%02d", mon, mday, yy); }
            else { snprintf(buf, cap, "%02d.%02d.%02d", mday, mon, yy); }
            return;
    }
}
