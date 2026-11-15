#include <stdio.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

// The resources are the watch build's; here any non-zero value stands in for one.
#define PX_RES(name) 1
#include "c/layers/status_pixel_icons.generated.h"

// Host test for the status icons' pixel drawings (status_icon_size.h, the tables
// scripts/pixel-icons/gen_watch_icons.js writes): the watch scales no icon, so every box a bar
// can ask for must have its own drawing, which carries the icon's size and seat. Built three times by scripts/test-c.sh: for
// the colour 144-px watch, with -DPBL_BW for the black and white ones (their own table: the pixel
// drawings) and with -DPBL_PLATFORM_EMERY for the Pebble Time 2. A failure here means an
// icon would draw a size smaller (the next smaller drawing), or not at all: draw the missing
// size in resources/pixel-icons.json (scripts/pixel-icons/README.md).

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d, want %d\n", name, got, want);
        s_failures++;
    }
}

// The heights a bar asks for (status_row.c icon_target_h): 6/9 of the text's content height in a
// bar, 5/9 in the top strip. Gothic 14 and 18 bars and the Gothic 18 top strip on the 144-px
// watches; Gothic 18 and 24 bars and the Gothic 24 top strip on the Pebble Time 2.
typedef struct { int target; bool top; } Tier;
#if defined(PBL_PLATFORM_EMERY)
static const Tier TIERS[] = { { 18 * 6 / 9, false }, { 24 * 5 / 9, true }, { 24 * 6 / 9, false } };
#define RAIN_BUCKETS 3   // emery: the only strip wide enough for the heavy bucket
#else
static const Tier TIERS[] = { { 14 * 6 / 9, false }, { 18 * 5 / 9, true }, { 18 * 6 / 9, false } };
#define RAIN_BUCKETS 2   // rain_tier_to_bucket3 folds heavy rain into rain here
#endif
#define TIER_COUNT ((int)(sizeof(TIERS) / sizeof(TIERS[0])))

#if defined(PBL_PLATFORM_EMERY)
#define FAMILY "emery"
#else
#define FAMILY "basalt"
#endif

// Every glyph a slot or an On demand item can ask for, and the ids that are text by contract.
#define DRAWN_IDS(X) \
    X(STATUS_ICON_TEMP) X(STATUS_ICON_UV) X(STATUS_ICON_WIND) X(STATUS_ICON_GUST) X(STATUS_ICON_STEPS) \
    X(STATUS_ICON_SLEEP) X(STATUS_ICON_HR) X(STATUS_ICON_DISTANCE) X(STATUS_ICON_AQI) X(STATUS_ICON_POLLEN) \
    X(STATUS_ICON_COUNTDOWN) X(STATUS_ICON_DEWPOINT) X(STATUS_ICON_PHONE_BATTERY) \
    X(STATUS_ICON_PHONE_BATTERY_CHG) X(STATUS_ICON_COND_SUN) X(STATUS_ICON_COND_MOON) \
    X(STATUS_ICON_COND_SUN_CLOUD) X(STATUS_ICON_COND_MOON_CLOUD) X(STATUS_ICON_COND_CLOUD) \
    X(STATUS_ICON_COND_FOG) X(STATUS_ICON_COND_HAZE) X(STATUS_ICON_COND_DRIZZLE) X(STATUS_ICON_COND_RAIN) \
    X(STATUS_ICON_COND_SLEET) X(STATUS_ICON_COND_SNOW) X(STATUS_ICON_COND_HAIL) X(STATUS_ICON_COND_THUNDER) \
    X(STATUS_ICON_COND_WIND) X(STATUS_ROW_ICON_QUIET) X(STATUS_ROW_ICON_BT) X(STATUS_ROW_ICON_BT_OFF)
#define AS_ID(id) id,
#define AS_NAME(id) #id,
static const uint8_t DRAWN[] = { DRAWN_IDS(AS_ID) };
static const char *const DRAWN_NAMES[] = { DRAWN_IDS(AS_NAME) };

// The rain alert's glyph for each bucket it can show here (status_rain_glyph): the condition's
// Drizzle and Rain, and on the Pebble Time 2 Heavy rain's own.
static const char *glyph_name(uint8_t id) {
    for (int i = 0; i < (int)sizeof(DRAWN); i++) {
        if (DRAWN[i] == id) { return DRAWN_NAMES[i]; }
    }
    return id == STATUS_ROW_ICON_HEAVY_RAIN ? "STATUS_ROW_ICON_HEAVY_RAIN" : "?";
}
static const uint8_t TEXT_ONLY[] = {
    STATUS_ICON_NONE, STATUS_ICON_DRAWN_SUN, STATUS_ICON_PRESSURE, STATUS_ICON_PHONE_BATTERY_PLAIN,
    STATUS_ICON_COND_TEXT,
};
#define RETIRED_ICON_ID 6   // STATUS_ICON_PRECIP's hole (status_line.h)

static bool in(const uint8_t *list, int n, int id) {
    for (int i = 0; i < n; i++) {
        if (list[i] == id) { return true; }
    }
    return false;
}

// The drawing at exactly `rows`, never the smaller fallback.
static bool has_exact(const StatusPixelIcon *table, int count, int key, int rows) {
    for (int i = 0; i < count; i++) {
        if (table[i].key == key && table[i].rows == rows) { return true; }
    }
    return false;
}

// Every id is either drawn or text by contract, so a new id cannot slip past this test.
static void every_id_classified(void) {
    int nd = (int)sizeof(DRAWN), nt = (int)sizeof(TEXT_ONLY);
    for (int id = 0; id <= STATUS_ROW_ICON_HEAVY_RAIN; id++) {
        if (id == RETIRED_ICON_ID) { continue; }
        char name[48];
        snprintf(name, sizeof(name), "classified.id%d", id);
        // Heavy rain is the rain alert's alone: the rain check below covers it.
        expect(name, in(DRAWN, nd, id) + in(TEXT_ONLY, nt, id) + (id == STATUS_ROW_ICON_HEAVY_RAIN), 1);
    }
}

// Every drawn icon has its exact drawing at every box a bar asks for.
static void every_height_drawn(void) {
    for (int i = 0; i < (int)sizeof(DRAWN); i++) {
        for (int t = 0; t < TIER_COUNT; t++) {
            int rows = status_icon_rows(TIERS[t].target);
            if (!has_exact(s_status_pixel_icons, STATUS_PIXEL_ICON_COUNT, DRAWN[i], rows)) {
                printf("FAIL drawn: icon %d has no %d-row drawing (icon height %d%s)\n",
                       DRAWN[i], rows, TIERS[t].target, TIERS[t].top ? ", top strip" : "");
                s_failures++;
            }
        }
    }
    for (int bucket = 1; bucket <= RAIN_BUCKETS; bucket++) {
        uint8_t glyph = status_rain_glyph((uint8_t)bucket);
        for (int t = 0; t < TIER_COUNT; t++) {
            int rows = status_icon_rows(TIERS[t].target);
            if (!has_exact(s_status_pixel_icons, STATUS_PIXEL_ICON_COUNT, glyph, rows)) {
                printf("FAIL rain: bucket %d (%s) has no %d-row drawing\n", bucket, glyph_name(glyph), rows);
                s_failures++;
            }
        }
    }
}

// The rain alert's buckets take the condition's Drizzle and Rain, and Heavy rain's own.
static void rain_buckets_take_their_glyphs(void) {
    expect("rain.light", status_rain_glyph(1), STATUS_ICON_COND_DRIZZLE);
    expect("rain.rain", status_rain_glyph(2), STATUS_ICON_COND_RAIN);
    expect("rain.heavy", status_rain_glyph(3), STATUS_ROW_ICON_HEAVY_RAIN);
}

// A text-only id never loads a glyph: its slot keeps no icon width.
static void text_only_ids_draw_nothing(void) {
    for (int i = 0; i < (int)sizeof(TEXT_ONLY); i++) {
        for (int t = 0; t < TIER_COUNT; t++) {
            expect("text_only", status_icon_drawing(s_status_pixel_icons, STATUS_PIXEL_ICON_COUNT,
                TEXT_ONLY[i], status_icon_rows(TIERS[t].target)), 0);
        }
    }
}

// A bar's box: the rows its icon height paints, always odd, the same for every icon; and a
// drawing's box centred on the cap centre, its middle row on it.
static void box_and_seat(void) {
    expect("box.even", status_icon_rows(12), 13);
    expect("box.odd", status_icon_rows(9), 11);
    expect("box.top_strip_144", status_icon_rows(10), 11);
    expect("box.none", status_icon_rows(0), 3);
    // bounds_h is one row short of the box: a 13-row box (bounds 12) puts row 6 on cap_cy.
    expect("seat.13", status_icon_top_y(40, 12) + 6, 40);
    expect("seat.17", status_icon_top_y(40, 16) + 8, 40);
}

// The lookup: the exact box, else the tallest drawing below it, else nothing.
static void lookup_falls_back_smaller(void) {
    const StatusPixelIcon table[] = { { 5, 11, 111 }, { 5, 15, 115 }, { 6, 13, 613 } };
    expect("lookup.exact", status_icon_drawing(table, 3, 5, 15), 115);
    expect("lookup.smaller", status_icon_drawing(table, 3, 5, 13), 111);
    expect("lookup.tallest_below", status_icon_drawing(table, 3, 5, 17), 115);
    expect("lookup.none_below", status_icon_drawing(table, 3, 5, 9), 0);
    expect("lookup.other_key", status_icon_drawing(table, 3, 7, 13), 0);
}

// The box every drawn icon and rain bucket is asked for at every tier, a line each:
// "<family> <icon id> <rows>", the rain alert's buckets by their glyphs' ids. scripts/check-icon-sizes.js holds them to the
// sizes resources/pixel-icons.json has drawings at, both ways.
static void print_sizes(void) {
    for (int i = 0; i < (int)sizeof(DRAWN); i++) {
        for (int t = 0; t < TIER_COUNT; t++) {
            printf("%s %s %d\n", FAMILY, DRAWN_NAMES[i], status_icon_rows(TIERS[t].target));
        }
    }
    for (int bucket = 1; bucket <= RAIN_BUCKETS; bucket++) {
        uint8_t glyph = status_rain_glyph((uint8_t)bucket);
        for (int t = 0; t < TIER_COUNT; t++) {
            printf("%s %s %d\n", FAMILY, glyph_name(glyph), status_icon_rows(TIERS[t].target));
        }
    }
}

int main(int argc, char **argv) {
    if (argc > 1 && strcmp(argv[1], "--sizes") == 0) {
        print_sizes();
        return 0;
    }
    every_id_classified();
    box_and_seat();
    every_height_drawn();
    rain_buckets_take_their_glyphs();
    text_only_ids_draw_nothing();
    lookup_falls_back_smaller();
    if (s_failures) {
        printf("%d status icon drawing failure(s)\n", s_failures);
        return 1;
    }
    printf("status icon drawings OK\n");
    return 0;
}
