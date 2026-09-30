#include <stdio.h>
#include <string.h>
#include <time.h>
#include "c/appendix/date_format.h"
#include "c/appendix/status_short_text.h"

// Host tests for the status slots' short forms (appendix/status_short_text.h,
// header-only): every row of the 1.24.0 spec's §5.6 table, as the whole family a slot
// switches through when On demand needs its room, widest first. A member prints as
// its text, then " -arrow" when it drops the wind arrow, " -lane" when it is the
// Watch battery glyph without its bolt lane, and " ~" when it is elastic (the layout
// may ellipsize it down to status_short_floor).

static int s_failures = 0;

static void expect_str(const char *name, const char *got, const char *want) {
    if (strcmp(got, want) != 0) {
        printf("FAIL %s: got \"%s\" want \"%s\"\n", name, got, want);
        s_failures++;
    }
}

static void expect_true(const char *name, int cond) {
    if (!cond) {
        printf("FAIL %s\n", name);
        s_failures++;
    }
}

#define FAMILY(...) ((const char *const[]) { __VA_ARGS__, NULL })
#define NONE ((const char *const[]) { NULL })

// The family of one slot against `want` (NULL-terminated, widest first).
static void family(const char *name, uint8_t kind, uint8_t icon, bool full_date, uint8_t mday,
                   const char *full, bool suffix, bool charging, const char *const *want) {
    StatusShortMember fam[STATUS_SHORT_MEMBERS];
    uint8_t n = status_short_family(kind, icon, full_date, mday, full, suffix, charging, fam);
    int nwant = 0;
    while (want[nwant]) { nwant++; }
    if (n != nwant) {
        printf("FAIL %s: %d members, want %d\n", name, n, nwant);
        s_failures++;
        return;
    }
    for (int i = 0; i < n; i++) {
        char text[STATUS_SHORT_CAP];
        if (fam[i].step == 0) {
            snprintf(text, sizeof(text), "%s", full);
        } else if (!status_short_text(kind, icon, full_date, mday, full, fam[i].step, text,
                                      sizeof(text))) {
            printf("FAIL %s: member %d has no text\n", name, i);
            s_failures++;
            return;
        }
        char got[48];
        snprintf(got, sizeof(got), "%s%s%s%s", text, fam[i].no_suffix ? " -arrow" : "",
                 fam[i].no_lane ? " -lane" : "", fam[i].elastic ? " ~" : "");
        char label[96];
        snprintf(label, sizeof(label), "%s [%d]", name, i);
        expect_str(label, got, want[i]);
    }
}

// A TEXT slot's family (the phone baked `full`), no arrow.
static void text_family(const char *name, uint8_t icon, const char *full,
                        const char *const *want) {
    family(name, SLOT_TEXT, icon, false, 7, full, false, false, want);
}

// A slot kind with no short form at all: no family, and status_short_text has no
// first member.
static void no_family(const char *name, uint8_t kind, uint8_t icon, const char *full) {
    char out[STATUS_SHORT_CAP];
    family(name, kind, icon, true, 7, full, false, false, NONE);
    expect_true(name, !status_short_text(kind, icon, true, 7, full, 1, out, sizeof(out)));
}

// --- the table, row by row --------------------------------------------------------

static void temperature(void) {
    text_family("temp degree", STATUS_ICON_TEMP, "12\xC2\xB0", FAMILY("12"));
    text_family("temp feels degree", STATUS_ICON_TEMP, "-3\xC2\xB0", FAMILY("-3"));
    no_family("temp no degree", SLOT_TEXT, STATUS_ICON_TEMP, "12");
    text_family("temp both spaced", STATUS_ICON_TEMP, "12 | 10", FAMILY("12|10"));
    text_family("temp both brackets", STATUS_ICON_TEMP, "12 (10)", FAMILY("12(10)"));
    no_family("temp both tight", SLOT_TEXT, STATUS_ICON_TEMP, "12|10");
    no_family("temp both negative", SLOT_TEXT, STATUS_ICON_TEMP, "-12|-10");
    no_family("temp missing", SLOT_TEXT, STATUS_ICON_TEMP, "--");
}

static void wind_and_gusts(void) {
    static const uint8_t ICONS[2] = { STATUS_ICON_WIND, STATUS_ICON_GUST };
    for (int k = 0; k < 2; k++) {
        const char *name = k ? "gust" : "wind";
        char label[64];
        snprintf(label, sizeof(label), "%s pair arrow", name);
        family(label, SLOT_TEXT, ICONS[k], false, 7, "12 / 30kph", true, false,
               FAMILY("12/30kph", "12/30", "12/30 -arrow"));
        snprintf(label, sizeof(label), "%s pair", name);
        family(label, SLOT_TEXT, ICONS[k], false, 7, "12 / 30kph", false, false,
               FAMILY("12/30kph", "12/30"));
        snprintf(label, sizeof(label), "%s now arrow", name);
        family(label, SLOT_TEXT, ICONS[k], false, 7, "12kph", true, false,
               FAMILY("12", "12 -arrow"));
        snprintf(label, sizeof(label), "%s mph", name);
        text_family(label, ICONS[k], "12mph", FAMILY("12"));
        snprintf(label, sizeof(label), "%s knots", name);
        text_family(label, ICONS[k], "12/30kn", FAMILY("12/30"));
        snprintf(label, sizeof(label), "%s tomorrow mark", name);
        text_family(label, ICONS[k], "12/30*kph", FAMILY("12/30*"));
        snprintf(label, sizeof(label), "%s unit off arrow", name);
        family(label, SLOT_TEXT, ICONS[k], false, 7, "12/30", true, false, FAMILY("12/30 -arrow"));
        snprintf(label, sizeof(label), "%s unit off", name);
        no_family(label, SLOT_TEXT, ICONS[k], "12/30");
        snprintf(label, sizeof(label), "%s missing", name);
        no_family(label, SLOT_TEXT, ICONS[k], "--");
    }
}

static void other_readings(void) {
    text_family("pressure", STATUS_ICON_PRESSURE, "1013hPa", FAMILY("1013"));
    no_family("pressure unit off", SLOT_TEXT, STATUS_ICON_PRESSURE, "1013");
    no_family("pressure missing", SLOT_TEXT, STATUS_ICON_PRESSURE, "--");
    text_family("dew", STATUS_ICON_DEWPOINT, "8\xC2\xB0", FAMILY("8"));
    no_family("dew no degree", SLOT_TEXT, STATUS_ICON_DEWPOINT, "8");
    // UV and AQI: only a spaced pair shortens, and a mark stays.
    text_family("uv pair spaced", STATUS_ICON_UV, "3 / 7", FAMILY("3/7"));
    text_family("uv tomorrow spaced", STATUS_ICON_UV, "3 / \xC2\xBB" "8", FAMILY("3/\xC2\xBB" "8"));
    no_family("uv pair tight", SLOT_TEXT, STATUS_ICON_UV, "3/\xC2\xBB" "8");
    no_family("uv now", SLOT_TEXT, STATUS_ICON_UV, "3");
    text_family("aqi pair spaced", STATUS_ICON_AQI, "42 / 58", FAMILY("42/58"));
    no_family("aqi now", SLOT_TEXT, STATUS_ICON_AQI, "42");
    no_family("pollen", SLOT_TEXT, STATUS_ICON_POLLEN, "2-3");
    // Sunrise/sunset stay whole: the leading zero and a/p included (§10.6).
    no_family("sun 24h", SLOT_TEXT, STATUS_ICON_DRAWN_SUN, "06:12");
    no_family("sun 12h", SLOT_TEXT, STATUS_ICON_DRAWN_SUN, "6:12p");
    text_family("countdown", STATUS_ICON_COUNTDOWN, "12d", FAMILY("12"));
    no_family("countdown now", SLOT_TEXT, STATUS_ICON_COUNTDOWN, "now");
    no_family("countdown unit off", SLOT_TEXT, STATUS_ICON_COUNTDOWN, "12");
    no_family("countdown passed", SLOT_TEXT, STATUS_ICON_COUNTDOWN, "--");
    text_family("phone battery", STATUS_ICON_PHONE_BATTERY, "31%", FAMILY("31"));
    text_family("phone battery charging", STATUS_ICON_PHONE_BATTERY_CHG, "100%", FAMILY("100"));
    no_family("phone battery unknown", SLOT_TEXT, STATUS_ICON_PHONE_BATTERY, "--");
    no_family("phone battery no icon", SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_PLAIN, "31%");
}

static void live_kinds(void) {
    no_family("empty", SLOT_EMPTY, STATUS_ICON_NONE, "");
    no_family("week", SLOT_LIVE_WEEK, STATUS_ICON_NONE, "W40");
    family("steps", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, false, 7, "12.3k", false, false,
           FAMILY("12k"));
    family("steps small", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, false, 7, "1.9k", false, false,
           FAMILY("1k"));
    no_family("steps whole", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, "12k");
    no_family("steps under 1000", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, "999");
    family("distance km", SLOT_LIVE_DISTANCE, STATUS_ICON_DISTANCE, false, 7, "3.4km", false,
           false, FAMILY("3.4"));
    family("distance mi", SLOT_LIVE_DISTANCE_MI, STATUS_ICON_DISTANCE, false, 7, "2.1mi", false,
           false, FAMILY("2.1"));
    no_family("distance missing", SLOT_LIVE_DISTANCE, STATUS_ICON_DISTANCE, "--");
    no_family("heart rate", SLOT_LIVE_HR, STATUS_ICON_HR, "72");
    family("sleep", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, false, 7, "7h32", false, false,
           FAMILY("7h"));
    family("sleep whole hour", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, false, 7, "7h00", false,
           false, FAMILY("7h"));
    no_family("sleep missing", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, "--");
    // The Watch battery glyph: its bolt lane goes while it is empty.
    family("battery glyph", SLOT_LIVE_BATTERY, STATUS_ICON_NONE, false, 7, "", false, false,
           FAMILY(" -lane"));
    family("battery glyph charging", SLOT_LIVE_BATTERY, STATUS_ICON_NONE, false, 7, "", false,
           true, NONE);
    family("battery pct", SLOT_LIVE_BATTERY_PCT, STATUS_ICON_NONE, false, 7, "82%", false,
           false, FAMILY("82"));
    family("battery pct full", SLOT_LIVE_BATTERY_PCT, STATUS_ICON_NONE, false, 7, "100%",
           false, false, FAMILY("100"));
}

// --- the date ------------------------------------------------------------------

// 7 September 2026, the date_format_test sample.
static struct tm sample_tm(int mday) {
    struct tm t;
    memset(&t, 0, sizeof(t));
    t.tm_year = 2026 - 1900;
    t.tm_mon = 8;
    t.tm_mday = mday;
    return t;
}

// A calendar view's month + year: only the year shortens, the month never (§10.6).
static void date_calendar(void) {
    static const struct {
        uint8_t fmt;
        const char *full;
        const char *year;   // NULL: no short form
    } CASES[] = {
        { DATE_MONTH_AUTO, "Sep 2026", "Sep '26" },
        { DATE_MONTH_NAME, "September 2026", "September '26" },
        { DATE_MONTH_DOTS, "09.2026", "09.26" },
        { DATE_MONTH_SLASH, "09/2026", "09/26" },
        { DATE_MONTH_ISO, "2026-09", NULL },
    };
    struct tm t = sample_tm(7);
    for (size_t i = 0; i < sizeof(CASES) / sizeof(CASES[0]); i++) {
        char full[STATUS_SHORT_CAP];
        date_format_month_year(full, sizeof(full), &t, CASES[i].fmt);
        char name[64];
        snprintf(name, sizeof(name), "date calendar %s", CASES[i].full);
        expect_str(name, full, CASES[i].full);
        if (CASES[i].year) {
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, false, 7, full, false, false,
                   FAMILY(CASES[i].year));
        } else {
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, false, 7, full, false, false, NONE);
        }
    }
}

// Outside a calendar view: a four-digit year shortens first (W11), then every format
// ends on the day of the month, in both day/month orders.
static void date_no_calendar(void) {
    static const struct {
        uint8_t fmt;
        bool month_first;
        const char *full;
        const char *year;   // NULL: no year member
    } CASES[] = {
        { DATE_FULL_AUTO, false, "07.09.26", NULL },
        { DATE_FULL_AUTO, true, "09.07.26", NULL },
        { DATE_FULL_LONG, false, "07.09.2026", "07.09.26" },
        { DATE_FULL_LONG, true, "09.07.2026", "09.07.26" },
        { DATE_FULL_NOYEAR, false, "7.9.", NULL },
        { DATE_FULL_NOYEAR, true, "9.7.", NULL },
        { DATE_FULL_SLASH, false, "7/9/26", NULL },
        { DATE_FULL_SLASH, true, "9/7/26", NULL },
        { DATE_FULL_ISO, false, "2026-09-07", NULL },
        { DATE_FULL_ISO, true, "2026-09-07", NULL },
        { DATE_FULL_TEXT, false, "7 Sep", NULL },
        { DATE_FULL_TEXT, true, "Sep 7", NULL },
        { DATE_FULL_TEXTYEAR, false, "7. Sep 2026", "7. Sep '26" },
        { DATE_FULL_TEXTYEAR, true, "Sep 7, 2026", "Sep 7, '26" },
    };
    struct tm t = sample_tm(7);
    for (size_t i = 0; i < sizeof(CASES) / sizeof(CASES[0]); i++) {
        char full[STATUS_SHORT_CAP];
        date_format_full(full, sizeof(full), &t, CASES[i].fmt, CASES[i].month_first);
        char name[64];
        snprintf(name, sizeof(name), "date no-calendar %s", CASES[i].full);
        expect_str(name, full, CASES[i].full);
        if (CASES[i].year) {
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, true, 7, full, false, false,
                   FAMILY(CASES[i].year, "7"));
        } else {
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, true, 7, full, false, false,
                   FAMILY("7"));
        }
    }
    // The day number is the clock's (`mday`), never read out of the text.
    struct tm late = sample_tm(29);
    char full[STATUS_SHORT_CAP];
    date_format_full(full, sizeof(full), &late, DATE_FULL_LONG, false);
    family("date no-calendar 29", SLOT_LIVE_DATE, STATUS_ICON_NONE, true, 29, full, false, false,
           FAMILY("29.09.26", "29"));
}

// --- the city ----------------------------------------------------------------------

// CITY_VECTORS: the city's word ladder, one row per name: the name, then its
// abbreviated members widest first, then NULL. The phone walks the same ladder before
// its 8-byte edge-slot cap (src/pkjs/city-ladder.js), and test/city-ladder.test.js
// parses this table and runs the twin over it: keep one row per line, in this shape,
// with plain UTF-8 in the strings.
static const char *const CITY_VECTORS[][5] = {
    { "New York", "N. York", NULL },
    { "Bad Berleburg", "B. Berleburg", NULL },
    { "Frankfurt am Main", "Frankfurt a. Main", "Frankfurt a. M.", NULL },
    { "Berlin", NULL },
    { "Bad Königshofen", "B. Königshofen", NULL },
    { "Östra Göinge", "Ö. Göinge", NULL },
    { "Wien 22 Donaustadt", "W. 22 Donaustadt", NULL },
    { "Halle-Neustadt Süd", "Halle-Neustadt S.", NULL },
    { "Castrop-Rauxel", NULL },
    { "Frankfurt (Oder)", NULL },
    { "Bad Soden", "B. Soden", NULL },
    { "Bad Soden am Taunus", "Bad Soden a. Taunus", "B. Soden a. Taunus", "B. S. a. Taunus", NULL },
    { "New York City", "N. York City", "N. Y. City", NULL },
    { "A Coruña", NULL },
    { "St. Gallen", "S. Gallen", NULL },
    { "Ulm", NULL },
    { "--", NULL },
};

static void city(void) {
    for (size_t v = 0; v < sizeof(CITY_VECTORS) / sizeof(CITY_VECTORS[0]); v++) {
        const char *full = CITY_VECTORS[v][0];
        int ladder = 0;
        while (CITY_VECTORS[v][1 + ladder]) { ladder++; }
        // The ladder, then the elastic member (the full name) when it has more than
        // three code points to ellipsize.
        bool elastic = sst_cps(full, (int)strlen(full)) > STATUS_SHORT_FLOOR_CPS;
        char name[64];
        snprintf(name, sizeof(name), "city %s", full);
        for (int s = 0; s < ladder; s++) {
            char out[STATUS_SHORT_CAP];
            bool ok = status_short_text(SLOT_TEXT, STATUS_ICON_NONE, false, 7, full,
                                        (uint8_t)(s + 1), out, sizeof(out));
            expect_true(name, ok);
            if (ok) { expect_str(name, out, CITY_VECTORS[v][1 + s]); }
        }
        char out[STATUS_SHORT_CAP];
        bool more = status_short_text(SLOT_TEXT, STATUS_ICON_NONE, false, 7, full,
                                      (uint8_t)(ladder + 1), out, sizeof(out));
        expect_true(name, more == elastic);
        if (more) { expect_str(name, out, full); }
        expect_true(name, !status_short_text(SLOT_TEXT, STATUS_ICON_NONE, false, 7, full,
                                             (uint8_t)(ladder + 2), out, sizeof(out)));
    }
    // As families: the ladder, then the elastic member last.
    text_family("city family", STATUS_ICON_NONE, "Frankfurt am Main",
                FAMILY("Frankfurt a. Main", "Frankfurt a. M.", "Frankfurt am Main ~"));
    text_family("city one word", STATUS_ICON_NONE, "Berlin", FAMILY("Berlin ~"));
    text_family("city two words", STATUS_ICON_NONE, "New York", FAMILY("N. York", "New York ~"));
    no_family("city short", SLOT_TEXT, STATUS_ICON_NONE, "Ulm");
    no_family("city missing", SLOT_TEXT, STATUS_ICON_NONE, "--");
    // A long name keeps its first member and its last ones (STATUS_SHORT_MEMBERS).
    text_family("city long", STATUS_ICON_NONE, "Bad Soden am Taunus",
                FAMILY("Bad Soden a. Taunus", "B. S. a. Taunus", "Bad Soden am Taunus ~"));

    // The elastic floor: three code points and the ellipsis, UTF-8 safe.
    char floor[STATUS_SHORT_CAP];
    expect_true("floor frankfurt", status_short_floor("Frankfurt am Main", floor, sizeof(floor)));
    expect_str("floor frankfurt", floor, "Fra\xE2\x80\xA6");
    expect_true("floor new york", status_short_floor("New York", floor, sizeof(floor)));
    expect_str("floor new york", floor, "New\xE2\x80\xA6");
    expect_true("floor utf8", status_short_floor("Östra Göinge", floor, sizeof(floor)));
    expect_str("floor utf8", floor, "Öst\xE2\x80\xA6");
    expect_true("floor bonn", status_short_floor("Bonn", floor, sizeof(floor)));
    expect_str("floor bonn", floor, "Bon\xE2\x80\xA6");
    expect_true("floor ulm", !status_short_floor("Ulm", floor, sizeof(floor)));
    expect_true("floor cap", !status_short_floor("Frankfurt", floor, 6));
}

// A member never outgrows its buffer: a 19-byte city (the middle slot's cap) at an
// exact 20-byte buffer, and a buffer too small fails instead of overrunning.
static void caps(void) {
    char out[STATUS_SHORT_CAP];
    expect_true("cap exact", status_short_text(SLOT_TEXT, STATUS_ICON_NONE, false, 7,
                                               "Halle-Neustadt Süd", 1, out, sizeof(out)));
    expect_str("cap exact", out, "Halle-Neustadt S.");
    char tiny[4];
    expect_true("cap tiny city", !status_short_text(SLOT_TEXT, STATUS_ICON_NONE, false, 7,
                                                    "New York", 1, tiny, sizeof(tiny)));
    expect_true("cap tiny year", !status_short_text(SLOT_LIVE_DATE, STATUS_ICON_NONE, false, 7,
                                                    "Sep 2026", 1, tiny, sizeof(tiny)));
    expect_true("cap zero", !status_short_text(SLOT_TEXT, STATUS_ICON_TEMP, false, 7, "12 | 10", 1,
                                               out, 0));
}

int main(void) {
    temperature();
    wind_and_gusts();
    other_readings();
    live_kinds();
    date_calendar();
    date_no_calendar();
    city();
    caps();
    if (s_failures) {
        printf("%d status_short_text failure(s)\n", s_failures);
        return 1;
    }
    printf("status_short_text OK\n");
    return 0;
}
