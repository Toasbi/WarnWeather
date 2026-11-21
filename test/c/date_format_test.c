#include <stdio.h>
#include <string.h>
#include "c/appendix/date_format.h"

// Host tests for the pure date-slot formatters (date_format.h, header-only).
//
// Every format string is pinned LITERALLY against 7 September 2026 — the same
// sample date the settings screen's option labels show. This file pins only the
// C side; test/page/calendar/date-format-contract.test.js closes the loop by parsing these
// expect_str pins and asserting the UI's sample labels (blocks.js
// dateFullFormatOptions, the schema's month options) promise exactly these
// strings, and that the enum values match the JS wire codes. Month names come
// from strftime, which prints English on host ("C" locale) AND on the watch —
// the app never calls setlocale(), so the firmware language does not reach %b
// (see date_format.h's width-bound comment).
//
// AUTO cases double as the no-regression pin: they must reproduce the
// pre-setting output of status_row.c's original format_status_date
// byte-for-byte, for both day/month orders.

static int s_failures = 0;

static void expect_str(const char *name, const char *got, const char *want) {
    if (strcmp(got, want) != 0) {
        printf("FAIL %s: got \"%s\" want \"%s\"\n", name, got, want);
        s_failures++;
    }
}

static void expect_true(const char *name, bool ok) {
    if (!ok) {
        printf("FAIL %s\n", name);
        s_failures++;
    }
}

// 2026-09-07 (a Monday, though no format prints the weekday).
static struct tm sample_tm(void) {
    struct tm t;
    memset(&t, 0, sizeof(t));
    t.tm_year = 2026 - 1900;
    t.tm_mon = 8;    // September (0-based)
    t.tm_mday = 7;
    return t;
}

// The resolved slot text cap the callers pass (STATUS_TEXT_MID_MAX + 1 = 20).
#define CAP 20

static void month_year_formats(void) {
    struct tm t = sample_tm();
    char buf[CAP];
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_AUTO);
    expect_str("month auto", buf, "Sep 2026");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_NAME);
    expect_str("month name", buf, "September 2026");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_DOTS);
    expect_str("month dots", buf, "09.2026");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_SLASH);
    expect_str("month slash", buf, "09/2026");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_ISO);
    expect_str("month iso", buf, "2026-09");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_DOTSYY);
    expect_str("month dotsyy", buf, "09.26");
    // The two-digit year keeps its leading zero: 2005 prints 05, not 5.
    struct tm t2005 = t;
    t2005.tm_year = 2005 - 1900;
    date_format_month_year(buf, sizeof(buf), &t2005, DATE_MONTH_DOTSYY);
    expect_str("month dotsyy 2005", buf, "09.05");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_NOYEAR);
    expect_str("month noyear", buf, "Sep");
    // An unknown wire byte (a future phone build) renders Auto, never garbage.
    date_format_month_year(buf, sizeof(buf), &t, 250);
    expect_str("month unknown->auto", buf, "Sep 2026");
}

static void full_formats_day_first(void) {
    struct tm t = sample_tm();
    char buf[CAP];
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_AUTO, false);
    expect_str("full auto", buf, "07.09.26");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_LONG, false);
    expect_str("full long", buf, "07.09.2026");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_NOYEAR, false);
    expect_str("full noyear", buf, "7.9.");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_SLASH, false);
    expect_str("full slash", buf, "7/9/26");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_ISO, false);
    expect_str("full iso", buf, "2026-09-07");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_TEXT, false);
    expect_str("full text", buf, "7 Sep");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_TEXTYEAR, false);
    expect_str("full textyear", buf, "7. Sep 2026");
    date_format_full(buf, sizeof(buf), &t, 250, false);
    expect_str("full unknown->auto", buf, "07.09.26");
}

static void full_formats_month_first(void) {
    struct tm t = sample_tm();
    char buf[CAP];
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_AUTO, true);
    expect_str("full auto US", buf, "09.07.26");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_LONG, true);
    expect_str("full long US", buf, "09.07.2026");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_NOYEAR, true);
    expect_str("full noyear US", buf, "9.7.");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_SLASH, true);
    expect_str("full slash US", buf, "9/7/26");
    // ISO has one order — month_first must not reorder it.
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_ISO, true);
    expect_str("full iso US", buf, "2026-09-07");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_TEXT, true);
    expect_str("full text US", buf, "Sep 7");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_TEXTYEAR, true);
    expect_str("full textyear US", buf, "Sep 7, 2026");
}

static void torn_tm_is_clamped(void) {
    // The original formatter's boot-race defence: a zeroed tm must not print
    // "00.00." shapes. tm_mday 0 clamps to 1; tm_mon -1 (garbage) clamps to 1.
    struct tm t;
    memset(&t, 0, sizeof(t));
    t.tm_year = 2026 - 1900;
    t.tm_mday = 0;
    t.tm_mon = -1;
    char buf[CAP];
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_AUTO, false);
    expect_str("clamped auto", buf, "01.01.26");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_NOYEAR, false);
    expect_str("clamped noyear", buf, "1.1.");
    // The strftime paths get the same clamp (an out-of-range tm_mon handed to
    // strftime is UB — newlib indexes the month table with it directly), so the
    // torn tm resolves to January there too instead of month[-1] garbage.
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_TEXT, false);
    expect_str("clamped text", buf, "1 Jan");
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_TEXTYEAR, true);
    expect_str("clamped textyear", buf, "Jan 1, 2026");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_AUTO);
    expect_str("clamped month auto", buf, "Jan 2026");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_NAME);
    expect_str("clamped month name", buf, "January 2026");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_DOTSYY);
    expect_str("clamped month dotsyy", buf, "01.26");
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_NOYEAR);
    expect_str("clamped month noyear", buf, "Jan");
}

// Each format's short form, the shorter format of the list it falls back to where its slot
// cannot show it whole (date_format.h), as the watch prints it for the sample day: "" where
// none is shorter. test/page/calendar/date-format-contract.test.js holds the page's and the
// phone's copy (date-format.js) to these pins, both orders.
static void short_forms(void) {
    struct tm t = sample_tm();
    char buf[CAP];
    static const struct { uint8_t fmt; const char *name; const char *want; } MONTH[] = {
        { DATE_MONTH_AUTO, "short month auto", "Sep" },
        { DATE_MONTH_NAME, "short month name", "Sep" },
        { DATE_MONTH_DOTS, "short month dots", "09.26" },
        { DATE_MONTH_SLASH, "short month slash", "09.26" },
        { DATE_MONTH_ISO, "short month iso", "09.26" },
        { DATE_MONTH_DOTSYY, "short month dotsyy", "" },
        { DATE_MONTH_NOYEAR, "short month noyear", "" },
        { 250, "short month unknown->auto", "Sep" },
    };
    char alt[DATE_FORMAT_SHORT_MAX + 1];
    char whole[CAP];
    for (size_t i = 0; i < sizeof(MONTH) / sizeof(MONTH[0]); i++) {
        strcpy(alt, "x");
        date_format_slot(buf, sizeof(buf), alt, sizeof(alt), &t, false, MONTH[i].fmt, false);
        expect_str(MONTH[i].name, alt, MONTH[i].want);
        // The date itself as its format prints it.
        date_format_month_year(whole, sizeof(whole), &t, MONTH[i].fmt);
        expect_str("short month: the date", buf, whole);
    }
    static const struct {
        uint8_t fmt;
        bool month_first;
        const char *name;
        const char *want;
    } FULL[] = {
        { DATE_FULL_AUTO, false, "short full auto", "7.9." },
        { DATE_FULL_LONG, false, "short full long", "7.9." },
        { DATE_FULL_NOYEAR, false, "short full noyear", "" },
        { DATE_FULL_SLASH, false, "short full slash", "7.9." },
        { DATE_FULL_ISO, false, "short full iso", "7.9." },
        { DATE_FULL_TEXT, false, "short full text", "" },
        { DATE_FULL_TEXTYEAR, false, "short full textyear", "7 Sep" },
        { 250, false, "short full unknown->auto", "7.9." },
        { DATE_FULL_AUTO, true, "short full auto US", "9.7." },
        { DATE_FULL_LONG, true, "short full long US", "9.7." },
        { DATE_FULL_NOYEAR, true, "short full noyear US", "" },
        { DATE_FULL_SLASH, true, "short full slash US", "9.7." },
        { DATE_FULL_ISO, true, "short full iso US", "9.7." },
        { DATE_FULL_TEXT, true, "short full text US", "" },
        { DATE_FULL_TEXTYEAR, true, "short full textyear US", "Sep 7" },
    };
    for (size_t i = 0; i < sizeof(FULL) / sizeof(FULL[0]); i++) {
        strcpy(alt, "x");
        date_format_slot(buf, sizeof(buf), alt, sizeof(alt), &t, true, FULL[i].fmt,
                         FULL[i].month_first);
        expect_str(FULL[i].name, alt, FULL[i].want);
        date_format_full(whole, sizeof(whole), &t, FULL[i].fmt, FULL[i].month_first);
        expect_str("short full: the date", buf, whole);
    }
    // Every short form is a format of its own list, and none falls back again.
    for (int fmt = DATE_MONTH_AUTO; fmt <= DATE_MONTH_NOYEAR; fmt++) {
        const uint8_t to = date_format_month_short((uint8_t)fmt);
        expect_true("short month in the list", to == DATE_FORMAT_NONE || to <= DATE_MONTH_NOYEAR);
        expect_true("short month once", to == DATE_FORMAT_NONE
                    || date_format_month_short(to) == DATE_FORMAT_NONE);
    }
    for (int fmt = DATE_FULL_AUTO; fmt <= DATE_FULL_TEXTYEAR; fmt++) {
        const uint8_t to = date_format_full_short((uint8_t)fmt);
        expect_true("short full in the list", to == DATE_FORMAT_NONE || to <= DATE_FULL_TEXTYEAR);
        expect_true("short full once", to == DATE_FORMAT_NONE
                    || date_format_full_short(to) == DATE_FORMAT_NONE);
    }
    // The longest short form, every day of every month in both orders, fits the slot's
    // short form buffer (DATE_FORMAT_SHORT_MAX), formatted into a roomier one.
    size_t longest = 0;
    for (int fmt = DATE_FULL_AUTO; fmt <= DATE_FULL_TEXTYEAR; fmt++) {
        for (int c = 0; c < 2 * 12 * 31; c++) {
            struct tm d = sample_tm();
            d.tm_mday = 1 + c % 31;
            d.tm_mon = (c / 31) % 12;
            date_format_slot(whole, sizeof(whole), buf, sizeof(buf), &d, true, (uint8_t)fmt,
                             c >= 12 * 31);
            if (strlen(buf) > longest) { longest = strlen(buf); }
        }
    }
    for (int fmt = DATE_MONTH_AUTO; fmt <= DATE_MONTH_NOYEAR; fmt++) {
        for (int mon = 0; mon < 12; mon++) {
            struct tm d = sample_tm();
            d.tm_mon = mon;
            date_format_slot(whole, sizeof(whole), buf, sizeof(buf), &d, false, (uint8_t)fmt, false);
            if (strlen(buf) > longest) { longest = strlen(buf); }
        }
    }
    expect_true("the longest short form is DATE_FORMAT_SHORT_MAX", longest == DATE_FORMAT_SHORT_MAX);
}

static void longest_strings_fit_the_slot_cap(void) {
    // Widest outputs against the 20 B resolved-slot buffer: none may truncate.
    struct tm t = sample_tm();
    char buf[CAP];
    date_format_month_year(buf, sizeof(buf), &t, DATE_MONTH_NAME);
    expect_str("name fits", buf, "September 2026");   // 14 chars + NUL
    date_format_full(buf, sizeof(buf), &t, DATE_FULL_TEXTYEAR, false);
    expect_str("textyear fits", buf, "7. Sep 2026");  // 11 chars + NUL
}

int main(void) {
    month_year_formats();
    full_formats_day_first();
    full_formats_month_first();
    torn_tm_is_clamped();
    short_forms();
    longest_strings_fit_the_slot_cap();
    if (s_failures) { printf("%d failure(s)\n", s_failures); return 1; }
    printf("date_format_test OK\n");
    return 0;
}
