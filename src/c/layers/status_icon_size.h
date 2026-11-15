#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "../appendix/status_line.h"

// The status icons' drawings (scripts/pixel-icons/README.md): which one the watch draws for an
// icon at a row's icon height, and where. Every icon is drawn pixel by pixel, once for every box
// a bar asks for, and shown 1:1: nothing is scaled. Deliberately no <pebble.h>, so
// scripts/test-c.sh host-compiles this with the generated tables
// (status_pixel_icons.generated.h) and checks that every box a bar can ask for has its
// drawing (test/c/status_icon_drawings_test.c).
//
// NOT BUILT ON APLITE: its lean status row (status_row_aplite.c) draws bit masks.

// Glyph ids for the On demand items' own drawings (layers/status_on_demand.c). In memory only,
// never on the wire: right after every StatusIconId (STATUS_ICON_MAX), below the city's glyph
// bit (STATUS_ICON_CITY_GLYPH).
#define STATUS_ROW_ICON_QUIET (STATUS_ICON_MAX + 1)    // Quiet time: the muted speaker
#define STATUS_ROW_ICON_BT (STATUS_ICON_MAX + 2)       // Bluetooth connected: the rune
#define STATUS_ROW_ICON_BT_OFF (STATUS_ICON_MAX + 3)   // Bluetooth disconnected: crossed out
#define STATUS_ROW_ICON_HEAVY_RAIN (STATUS_ICON_MAX + 4)   // the rain alert's heavy bucket
_Static_assert(STATUS_ROW_ICON_HEAVY_RAIN < STATUS_ICON_CITY_GLYPH,
               "the in-memory glyph ids stay below the city's glyph bit");

// The rain alert's glyph for its bucket (rain_tier.c rain_tier_to_bucket3: 1 light, 2 rain,
// 3 heavy): the weather condition's Drizzle and Rain drawings, and Heavy rain's own, which
// only the Pebble Time 2 asks for (the other watches fold heavy rain into rain).
static inline uint8_t status_rain_glyph(uint8_t bucket) {
    switch (bucket) {
        case 1: return STATUS_ICON_COND_DRIZZLE;
        case 3: return STATUS_ROW_ICON_HEAVY_RAIN;
        default: return STATUS_ICON_COND_RAIN;
    }
}

// One drawing in the generated tables: 4 bytes, since a Pebble app's image, the tables
// included, is loaded into its RAM.
typedef struct {
    uint8_t key;        // an icon id (status_line.h, above), or a rain alert bucket
    uint8_t rows;       // the box it is drawn for: the rows a bar's icon height paints
    uint16_t resource;  // its RESOURCE_ID_* (an id past 65535 fails the build: -Woverflow)
} StatusPixelIcon;

// A drawing carries its own size and seat (scripts/pixel-icons/README.md): it is drawn for a box,
// the rows a bar's icon height paints, and the watch centres its box on the text. How tall its ink
// is inside the box is the icon's size; its blank rows above and below are its seat. Both are set
// in the icon creator, so nothing here knows one icon from another.

// The rows an icon height h paints, the box the drawings are looked up by: h + 1 for an even h,
// h + 2 for an odd one, so a box always has a middle row.
static inline int status_icon_painted_rows(int h) { return (h & 1) ? h + 2 : h + 1; }

// The box a bar whose icon height is `target_h` draws its icons in.
static inline int status_icon_rows(int target_h) {
    return status_icon_painted_rows(target_h < 1 ? 1 : target_h);
}

// Where to draw a status glyph: the y of its bounds box, for gdraw_command_image_draw(), with
// its box centred on `cap_cy`, the digits' cap centre (status_glyph_center_y). `bounds_h` is
// gdraw_command_image_get_bounds_size().h, one row short of the drawing's box
// (status_row_icons.c icon_load_pixels), so a box of an odd number of rows sits with its middle
// row on cap_cy.
static inline int status_icon_top_y(int cap_cy, int bounds_h) { return cap_cy - bounds_h / 2; }

// The drawing `table` holds for `key` at the box `rows`; where it has none, its tallest drawing
// for a smaller box, so a row squeezed below every bar's box still draws the icon crisp, a size
// smaller; 0 when `key` has no drawing at all (a text-only id: NONE, PRESSURE, the plain phone
// battery, the condition's Text look).
static inline uint16_t status_icon_drawing(const StatusPixelIcon *table, int count, uint8_t key,
                                           int rows) {
    uint16_t smaller = 0;
    int smaller_rows = 0;
    for (int i = 0; i < count; i++) {
        if (table[i].key != key) { continue; }
        if (table[i].rows == rows) { return table[i].resource; }
        if (table[i].rows < rows && table[i].rows > smaller_rows) {
            smaller = table[i].resource;
            smaller_rows = table[i].rows;
        }
    }
    return smaller;
}
