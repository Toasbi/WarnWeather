#include <stdio.h>
#include <stdbool.h>
#include <stdint.h>

// The resources are the watch build's; here any non-zero value stands in for one.
#define PX_RES(name) 1
#include "c/layers/status_pixel_icons.generated.h"

// Host test for the status icons' pixel drawings (status_icon_size.h, the tables
// scripts/pixel-icons/gen_watch_icons.js writes): the watch scales no icon any more, so every
// height a bar can ask for must have its own drawing. Built three times by scripts/test-c.sh: for
// the colour 144-px watch, with -DPBL_BW for the black and white ones (their own table: the pixel
// drawings) and with -DPBL_PLATFORM_EMERY for the Pebble Time 2. A failure here means an
// icon would draw a size smaller (the next smaller drawing), or not at all: draw the missing
// size in the pixel icon editor (scripts/pixel-icons/README.md).

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

// Every glyph a slot or an On demand item can ask for, and the ids that are text by contract.
static const uint8_t DRAWN[] = {
    STATUS_ICON_TEMP, STATUS_ICON_UV, STATUS_ICON_WIND, STATUS_ICON_GUST, STATUS_ICON_STEPS,
    STATUS_ICON_SLEEP, STATUS_ICON_HR, STATUS_ICON_DISTANCE, STATUS_ICON_AQI, STATUS_ICON_POLLEN,
    STATUS_ICON_COUNTDOWN, STATUS_ICON_DEWPOINT, STATUS_ICON_PHONE_BATTERY,
    STATUS_ICON_PHONE_BATTERY_CHG, STATUS_ICON_COND_SUN, STATUS_ICON_COND_MOON,
    STATUS_ICON_COND_SUN_CLOUD, STATUS_ICON_COND_MOON_CLOUD, STATUS_ICON_COND_CLOUD,
    STATUS_ICON_COND_FOG, STATUS_ICON_COND_HAZE, STATUS_ICON_COND_DRIZZLE, STATUS_ICON_COND_RAIN,
    STATUS_ICON_COND_SLEET, STATUS_ICON_COND_SNOW, STATUS_ICON_COND_HAIL, STATUS_ICON_COND_THUNDER,
    STATUS_ICON_COND_WIND, STATUS_ROW_ICON_QUIET, STATUS_ROW_ICON_BT, STATUS_ROW_ICON_BT_OFF,
};
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
    for (int id = 0; id <= STATUS_ROW_ICON_BT_OFF; id++) {
        if (id == RETIRED_ICON_ID) { continue; }
        char name[48];
        snprintf(name, sizeof(name), "classified.id%d", id);
        expect(name, in(DRAWN, nd, id) + in(TEXT_ONLY, nt, id), 1);
    }
}

// Every drawn icon has its exact drawing at every height a bar asks for.
static void every_height_drawn(void) {
    for (int i = 0; i < (int)sizeof(DRAWN); i++) {
        for (int t = 0; t < TIER_COUNT; t++) {
            int rows = status_icon_rows(DRAWN[i], TIERS[t].target, TIERS[t].top);
            if (!has_exact(s_status_pixel_icons, STATUS_PIXEL_ICON_COUNT, DRAWN[i], rows)) {
                printf("FAIL drawn: icon %d has no %d-row drawing (icon height %d%s)\n",
                       DRAWN[i], rows, TIERS[t].target, TIERS[t].top ? ", top strip" : "");
                s_failures++;
            }
        }
    }
    for (int bucket = 1; bucket <= RAIN_BUCKETS; bucket++) {
        for (int t = 0; t < TIER_COUNT; t++) {
            int rows = status_icon_painted_rows(TIERS[t].target);
            if (!has_exact(s_status_pixel_rain, STATUS_PIXEL_RAIN_COUNT, bucket, rows)) {
                printf("FAIL rain: bucket %d has no %d-row drawing\n", bucket, rows);
                s_failures++;
            }
        }
    }
}

// A text-only id never loads a glyph: its slot keeps no icon width.
static void text_only_ids_draw_nothing(void) {
    for (int i = 0; i < (int)sizeof(TEXT_ONLY); i++) {
        for (int t = 0; t < TIER_COUNT; t++) {
            expect("text_only", status_icon_drawing(s_status_pixel_icons, STATUS_PIXEL_ICON_COUNT,
                TEXT_ONLY[i], status_icon_rows(TEXT_ONLY[i], TIERS[t].target, TIERS[t].top)), 0);
        }
    }
}

// The lookup: the exact height, else the tallest drawing below it, else nothing.
static void lookup_falls_back_smaller(void) {
    const StatusPixelIcon table[] = { { 5, 11, 111 }, { 5, 15, 115 }, { 6, 13, 613 } };
    expect("lookup.exact", status_icon_drawing(table, 3, 5, 15), 115);
    expect("lookup.smaller", status_icon_drawing(table, 3, 5, 13), 111);
    expect("lookup.tallest_below", status_icon_drawing(table, 3, 5, 17), 115);
    expect("lookup.none_below", status_icon_drawing(table, 3, 5, 9), 0);
    expect("lookup.other_key", status_icon_drawing(table, 3, 7, 13), 0);
}

int main(void) {
    every_id_classified();
    every_height_drawn();
    text_only_ids_draw_nothing();
    lookup_falls_back_smaller();
    if (s_failures) {
        printf("%d status icon drawing failure(s)\n", s_failures);
        return 1;
    }
    printf("status icon drawings OK\n");
    return 0;
}
