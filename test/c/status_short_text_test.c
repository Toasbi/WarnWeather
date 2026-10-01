#include <stdio.h>
#include <string.h>
#include <time.h>
#include "c/appendix/date_format.h"
#include "c/appendix/on_demand.h"
#include "c/appendix/status_short_text.h"

// Host tests for the status slots' short forms (appendix/status_short_text.h,
// header-only): every row of the 1.24.0 spec's §5.6 table, as the whole family a slot
// switches through when On demand needs its room, widest first — status_short_member
// for v = 1, 2, … up to its first 0, as status_on_demand.c asks. A member prints as its
// text, then " -arrow" when it drops the wind arrow, " -lane" when it is the Watch
// battery glyph without its bolt lane, and " ~" when it is elastic (the layout may
// ellipsize it down to status_short_floor). `mday` is the day of the month outside a
// calendar view, 0 in one.

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

// The members of one slot's family (v = 1, 2, … up to the first 0), printed as above
// into got[] (at most `max`); returns how many.
static int members(uint8_t kind, uint8_t icon, uint8_t mday, const char *full, bool suffix,
                   bool charging, char got[][48], int max) {
    int n = 0;
    for (; n < max; n++) {
        char text[STATUS_SHORT_CAP];
        uint8_t flags = status_short_member(kind, icon, mday, full, suffix, charging,
                                            (uint8_t)(n + 1), text, sizeof(text));
        if (!flags) { break; }
        snprintf(got[n], 48, "%s%s%s%s", text, (flags & SST_NO_SUFFIX) ? " -arrow" : "",
                 (flags & SST_NO_LANE) ? " -lane" : "", (flags & SST_ELASTIC) ? " ~" : "");
    }
    return n;
}

// The family of one slot against `want` (NULL-terminated, widest first).
static void family(const char *name, uint8_t kind, uint8_t icon, uint8_t mday,
                   const char *full, bool suffix, bool charging, const char *const *want) {
    char got[8][48];
    int n = members(kind, icon, mday, full, suffix, charging, got, 8);
    int nwant = 0;
    while (want[nwant]) { nwant++; }
    if (n != nwant) {
        printf("FAIL %s: %d members, want %d\n", name, n, nwant);
        s_failures++;
        return;
    }
    for (int i = 0; i < n; i++) {
        char label[96];
        snprintf(label, sizeof(label), "%s [%d]", name, i);
        expect_str(label, got[i], want[i]);
    }
}

// A TEXT slot's family (the phone baked `full`), no arrow.
static void text_family(const char *name, uint8_t icon, const char *full,
                        const char *const *want) {
    family(name, SLOT_TEXT, icon, 0, full, false, false, want);
}

// A slot kind with no short form at all: not even a first member, outside a calendar
// view or in one.
static void no_family(const char *name, uint8_t kind, uint8_t icon, const char *full) {
    family(name, kind, icon, 7, full, false, false, NONE);
    family(name, kind, icon, 0, full, false, false, NONE);
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
        family(label, SLOT_TEXT, ICONS[k], 0, "12 / 30kph", true, false,
               FAMILY("12/30kph", "12/30", "12/30 -arrow"));
        snprintf(label, sizeof(label), "%s pair", name);
        family(label, SLOT_TEXT, ICONS[k], 0, "12 / 30kph", false, false,
               FAMILY("12/30kph", "12/30"));
        snprintf(label, sizeof(label), "%s now arrow", name);
        family(label, SLOT_TEXT, ICONS[k], 0, "12kph", true, false,
               FAMILY("12", "12 -arrow"));
        snprintf(label, sizeof(label), "%s mph", name);
        text_family(label, ICONS[k], "12mph", FAMILY("12"));
        snprintf(label, sizeof(label), "%s knots", name);
        text_family(label, ICONS[k], "12/30kn", FAMILY("12/30"));
        snprintf(label, sizeof(label), "%s tomorrow mark", name);
        text_family(label, ICONS[k], "12/30*kph", FAMILY("12/30*"));
        snprintf(label, sizeof(label), "%s unit off arrow", name);
        family(label, SLOT_TEXT, ICONS[k], 0, "12/30", true, false, FAMILY("12/30 -arrow"));
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
    // A battery number is whole or hidden: its % never drops (owner, 2026-09-30).
    no_family("phone battery", SLOT_TEXT, STATUS_ICON_PHONE_BATTERY, "31%");
    no_family("phone battery charging", SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_CHG, "100%");
    no_family("phone battery unknown", SLOT_TEXT, STATUS_ICON_PHONE_BATTERY, "--");
    no_family("phone battery no icon", SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_PLAIN, "31%");
}

static void live_kinds(void) {
    no_family("empty", SLOT_EMPTY, STATUS_ICON_NONE, "");
    no_family("week", SLOT_LIVE_WEEK, STATUS_ICON_NONE, "W40");
    family("steps", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, 0, "12.3k", false, false,
           FAMILY("12k"));
    family("steps small", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, 0, "1.9k", false, false,
           FAMILY("1k"));
    no_family("steps whole", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, "12k");
    no_family("steps under 1000", SLOT_LIVE_STEPS, STATUS_ICON_STEPS, "999");
    family("distance km", SLOT_LIVE_DISTANCE, STATUS_ICON_DISTANCE, 0, "3.4km", false,
           false, FAMILY("3.4"));
    family("distance mi", SLOT_LIVE_DISTANCE_MI, STATUS_ICON_DISTANCE, 0, "2.1mi", false,
           false, FAMILY("2.1"));
    no_family("distance missing", SLOT_LIVE_DISTANCE, STATUS_ICON_DISTANCE, "--");
    no_family("heart rate", SLOT_LIVE_HR, STATUS_ICON_HR, "72");
    family("sleep", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, 0, "7h32", false, false,
           FAMILY("7h"));
    family("sleep whole hour", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, 0, "7h00", false,
           false, FAMILY("7h"));
    no_family("sleep missing", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, "--");
    // Under an hour: "0h" would read as no sleep at all, so it hides at its turn.
    no_family("sleep under an hour", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, "0h45");
    family("sleep ten hours", SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, 0, "10h05", false,
           false, FAMILY("10h"));
    // The Watch battery glyph: its bolt lane goes while it is empty.
    family("battery glyph", SLOT_LIVE_BATTERY, STATUS_ICON_NONE, 0, "", false, false,
           FAMILY(" -lane"));
    family("battery glyph charging", SLOT_LIVE_BATTERY, STATUS_ICON_NONE, 0, "", false,
           true, NONE);
    // The Battery % is whole or hidden: its % never drops (owner, 2026-09-30).
    no_family("battery pct", SLOT_LIVE_BATTERY_PCT, STATUS_ICON_NONE, "82%");
    no_family("battery pct full", SLOT_LIVE_BATTERY_PCT, STATUS_ICON_NONE, "100%");
    no_family("battery pct low", SLOT_LIVE_BATTERY_PCT, STATUS_ICON_NONE, "8%");
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
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, 0, full, false, false,
                   FAMILY(CASES[i].year));
        } else {
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, 0, full, false, false, NONE);
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
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, 7, full, false, false,
                   FAMILY(CASES[i].year, "7"));
        } else {
            family(name, SLOT_LIVE_DATE, STATUS_ICON_NONE, 7, full, false, false,
                   FAMILY("7"));
        }
    }
    // The day number is the clock's (`mday`), never read out of the text.
    struct tm late = sample_tm(29);
    char full[STATUS_SHORT_CAP];
    date_format_full(full, sizeof(full), &late, DATE_FULL_LONG, false);
    family("date no-calendar 29", SLOT_LIVE_DATE, STATUS_ICON_NONE, 29, full, false, false,
           FAMILY("29.09.26", "29"));
}

// --- the city ----------------------------------------------------------------------

// CITY_VECTORS: the city's word ladder, one row per name: the name, then its
// abbreviated forms widest first, then NULL. The watch draws the ladder's first and
// last rung; the phone walks every rung before its 8-byte edge-slot cap
// (src/pkjs/city-ladder.js), and test/city-ladder.test.js parses this table and runs
// the twin over it: keep one row per line, in this shape, with plain UTF-8 in the
// strings.
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
    // Initials of 3- and 4-byte code points: the initial keeps its whole code point.
    { "서울 특별시", "서. 특별시", NULL },
    { "𠮷野 大市場", "𠮷. 大市場", NULL },
    // Already an initial (what the phone bakes into an edge slot, W12): it stays as it
    // is, so no member repeats the one before.
    { "B. Soden", NULL },
    { "Frankfurt a. Main", "Frankfurt a. M.", NULL },
    { "Ulm", NULL },
    { "--", NULL },
};

// Member `v` of a city slot's family (SLOT_TEXT without an icon): its flags.
static uint8_t city_member(const char *full, uint8_t v, char *out, size_t cap) {
    return status_short_member(SLOT_TEXT, STATUS_ICON_NONE, 0, full, false, false, v, out, cap);
}

static void city(void) {
    for (size_t r = 0; r < sizeof(CITY_VECTORS) / sizeof(CITY_VECTORS[0]); r++) {
        const char *full = CITY_VECTORS[r][0];
        int ladder = 0;
        while (CITY_VECTORS[r][1 + ladder]) { ladder++; }
        // The ladder's first rung, its last when it has more, then the elastic member
        // (the full name) when it has more than three code points to ellipsize.
        const char *want[4] = { NULL, NULL, NULL, NULL };
        int n = 0;
        if (ladder > 0) { want[n++] = CITY_VECTORS[r][1]; }
        if (ladder > 1) { want[n++] = CITY_VECTORS[r][ladder]; }
        char elastic[48];
        if (sst_cps(full, (int)strlen(full)) > STATUS_SHORT_FLOOR_CPS) {
            snprintf(elastic, sizeof(elastic), "%s ~", full);
            want[n++] = elastic;
        }
        char name[64];
        snprintf(name, sizeof(name), "city %s", full);
        family(name, SLOT_TEXT, STATUS_ICON_NONE, 0, full, false, false, want);
    }
    // As families: the ladder, then the elastic member last.
    text_family("city family", STATUS_ICON_NONE, "Frankfurt am Main",
                FAMILY("Frankfurt a. Main", "Frankfurt a. M.", "Frankfurt am Main ~"));
    text_family("city one word", STATUS_ICON_NONE, "Berlin", FAMILY("Berlin ~"));
    text_family("city two words", STATUS_ICON_NONE, "New York", FAMILY("N. York", "New York ~"));
    no_family("city short", SLOT_TEXT, STATUS_ICON_NONE, "Ulm");
    no_family("city missing", SLOT_TEXT, STATUS_ICON_NONE, "--");
    // A long name: its first rung (the shortest word), its last (all but the longest)
    // and the elastic member.
    text_family("city long", STATUS_ICON_NONE, "Bad Soden am Taunus",
                FAMILY("Bad Soden a. Taunus", "B. S. a. Taunus", "Bad Soden am Taunus ~"));
    // Every word is ranked, however many: eleven words, the first rung abbreviates the
    // leftmost of the shortest, and on the last only the longest (the eleventh) stays
    // whole. test/city-ladder.test.js pins the phone's twin to the same last form.
    // (Past any slot's cap, so a big buffer.)
    const char *eleven = "Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kkk";
    char many[48];
    expect_true("city eleven words first",
                city_member(eleven, 1, many, sizeof(many)) == SST_MEMBER);
    expect_str("city eleven words first", many, "A. Bb Cc Dd Ee Ff Gg Hh Ii Jj Kkk");
    expect_true("city eleven words", city_member(eleven, 2, many, sizeof(many)) == SST_MEMBER);
    expect_str("city eleven words", many, "A. B. C. D. E. F. G. H. I. J. Kkk");
    expect_true("city eleven words elastic",
                city_member(eleven, 3, many, sizeof(many)) == (SST_MEMBER | SST_ELASTIC));
    expect_str("city eleven words elastic", many, eleven);
    expect_true("city eleven words end", !city_member(eleven, 4, many, sizeof(many)));

    // The elastic floor: three code points and the ellipsis, UTF-8 safe.
    char floor[STATUS_SHORT_CAP];
    expect_true("floor frankfurt", status_short_floor("Frankfurt am Main", floor, sizeof(floor)));
    expect_str("floor frankfurt", floor, "Fra\xE2\x80\xA6");
    expect_true("floor new york", status_short_floor("New York", floor, sizeof(floor)));
    expect_str("floor new york", floor, "New\xE2\x80\xA6");
    expect_true("floor utf8", status_short_floor("Östra Göinge", floor, sizeof(floor)));
    expect_str("floor utf8", floor, "Öst\xE2\x80\xA6");
    expect_true("floor utf8 3-byte", status_short_floor("서울특별시", floor, sizeof(floor)));
    expect_str("floor utf8 3-byte", floor, "서울특\xE2\x80\xA6");
    expect_true("floor utf8 4-byte", status_short_floor("𠮷野家市", floor, sizeof(floor)));
    expect_str("floor utf8 4-byte", floor, "𠮷野家\xE2\x80\xA6");
    expect_true("floor bonn", status_short_floor("Bonn", floor, sizeof(floor)));
    expect_str("floor bonn", floor, "Bon\xE2\x80\xA6");
    expect_true("floor ulm", !status_short_floor("Ulm", floor, sizeof(floor)));
    expect_true("floor cap", !status_short_floor("Frankfurt", floor, 6));
}

// A member never outgrows its buffer: a 19-byte city (the middle slot's cap) whose
// member ("Halle-Neustadt S.", 17 bytes) fits a buffer of exactly its length + 1 and
// fails one byte short instead of overrunning; and a buffer too small fails.
static void caps(void) {
    char out[STATUS_SHORT_CAP];
    expect_true("cap slot", city_member("Halle-Neustadt Süd", 1, out, sizeof(out)));
    expect_str("cap slot", out, "Halle-Neustadt S.");
    char exact[sizeof("Halle-Neustadt S.")];
    expect_true("cap exact", city_member("Halle-Neustadt Süd", 1, exact, sizeof(exact)));
    expect_str("cap exact", exact, "Halle-Neustadt S.");
    expect_true("cap one short",
                !city_member("Halle-Neustadt Süd", 1, exact, sizeof(exact) - 1));
    char tiny[4];
    expect_true("cap tiny city", !city_member("New York", 1, tiny, sizeof(tiny)));
    expect_true("cap tiny year", !status_short_member(SLOT_LIVE_DATE, STATUS_ICON_NONE, 0,
                                                      "Sep 2026", false, false, 1, tiny,
                                                      sizeof(tiny)));
    expect_true("cap zero", !status_short_member(SLOT_TEXT, STATUS_ICON_TEMP, 0, "12 | 10",
                                                 false, false, 1, out, 0));
}

// --- the OD_VARIANTS bound -----------------------------------------------------------

// A slot's full form and its short members fill OdSlotIn.m (on_demand.h):
// status_on_demand.c measures members from v = 1 and stops at OD_VARIANTS, so a family
// with a member there would lose it without a word — a new wind step would drop the
// arrow-less member first. No family has one: every kind (and some past the enum) and
// every icon, over the table's texts and the city vectors, with and without the arrow
// and a charge, in and outside a calendar view. And the widest family fills the places
// exactly, so OD_VARIANTS is the families' own bound, not slack on the paint stack.
static void od_variants(void) {
    static const char *const TEXTS[] = {
        "12\xC2\xB0", "-3\xC2\xB0", "12 | 10", "12 (10)", "12 / 30kph", "12 / 30 kph",
        "12/30*kph", "12kph", "12mph", "12/30kn", "12/30", "1013hPa", "8\xC2\xB0", "3 / 7",
        ("3 / \xC2\xBB" "8"), "42 / 58", "2-3", "06:12", "6:12p", "12d", "now", "--", "31%",
        "100%", "", "W40", "12.3k", "1.9k", "12k", "999", "3.4km", "2.1mi", "72", "7h32",
        "10h05", "0h45", "82%", "Sep 2026", "September 2026", "09.2026", "09/2026", "2026-09",
        "07.09.26", "07.09.2026", "7.9.", "7/9/26", "2026-09-07", "7 Sep", "7. Sep 2026",
        "Sep 7, 2026",
    };
    const int ntexts = (int)(sizeof(TEXTS) / sizeof(TEXTS[0]));
    const int ncities = (int)(sizeof(CITY_VECTORS) / sizeof(CITY_VECTORS[0]));
    static const uint8_t MDAYS[3] = { 0, 7, 29 };
    int widest = 0;
    int over = 0;
    for (int t = 0; t < ntexts + ncities; t++) {
        const char *full = t < ntexts ? TEXTS[t] : CITY_VECTORS[t - ntexts][0];
        for (int kind = 0; kind < 16; kind++) {
            for (int icon = 0; icon < 36; icon++) {
                for (int c = 0; c < 12; c++) {
                    uint8_t mday = MDAYS[c / 4];
                    bool suffix = (c & 1) != 0;
                    bool charging = (c & 2) != 0;
                    char got[8][48];
                    int n = members((uint8_t)kind, (uint8_t)icon, mday, full, suffix, charging,
                                    got, 8);
                    if (n > widest) { widest = n; }
                    char out[STATUS_SHORT_CAP];
                    if (status_short_member((uint8_t)kind, (uint8_t)icon, mday, full, suffix,
                                            charging, OD_VARIANTS, out, sizeof(out))) {
                        if (over++ < 5) {
                            printf("FAIL variants: kind %d icon %d \"%s\" has a member at "
                                   "OD_VARIANTS\n", kind, icon, full);
                        }
                    }
                }
            }
        }
    }
    expect_true("variants.none_at_the_bound", over == 0);
    expect_true("variants.widest_fills_the_bound", widest == OD_VARIANTS - 1);
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
    od_variants();
    if (s_failures) {
        printf("%d status_short_text failure(s)\n", s_failures);
        return 1;
    }
    printf("status_short_text OK\n");
    return 0;
}
