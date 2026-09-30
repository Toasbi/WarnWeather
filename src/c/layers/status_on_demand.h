#pragma once
#include <pebble.h>
#include "../appendix/alert_set.h"
#include "../appendix/on_demand.h"
#include "../appendix/rain_countdown.h"   // RAIN_COUNTDOWN_TEXT_CAP

// On demand's SDK half: which items of a bar are active, their glyphs, measures and
// paint, and the slots' short forms measured. The layout — how the bar's slots make
// room for them — is the pure appendix/on_demand.c. status_row.c makes three calls:
// status_on_demand_fold() on every refresh, status_on_demand_layout() and
// status_on_demand_paint() on every draw; everything in between happens here.
//
// NOT LINKED ON APLITE: On demand is aplite-absent (WW_ON_DEMAND in wscript) — the .c
// body sits behind the macro and compiles to an empty object there. Its one caller,
// status_row.c, is never compiled on aplite (wscript builds status_row_aplite.c
// instead); these declarations emit nothing.
//
// Which items sit on which side of which bar is the thresholds blob's On demand cells
// (status_threshold_on_demand_side — the compiled defaults until the phone sends
// them). An item draws while it is active:
//  - Battery      the charge is at or below the Battery item's warn level; the
//                 procedural battery (battery_item.c), "8%" beside it with the Look
//                 Icon + value. While a slot of the bar shows the watch battery (the
//                 Watch battery glyph or the Battery %, in any position), it stands
//                 in for that slot only once the layout hides it, whatever its Look
//                 (on_demand.h, battery_slots).
//  - Bluetooth    connected with Show "Connected" on, or disconnected with Show
//                 "Disconnected" on — the rune, or the rune crossed out, in the
//                 Bluetooth colours (PictonBlue / red on a dark colour theme).
//  - Quiet time   quiet_time_is_active(): the muted speaker.
//  - Sleep        the phone's Battery saver hours (IS_SLEEPING): the Z's.
//  - Rain         the watch-resolved rain countdown: the drops tinted by the radar
//                 tier, the text per the rain look.
//  - the metric alerts (gust, UV, AQI, pollen, wind): an ALERT_ENTRIES entry of the
//                 kind, drawn as a mini status slot at its real level.
// Each metric alert draws as a MINI STATUS SLOT, `[icon][gap][text?]`, styled like a
// highlighted slot of its kind at the entry's level (status_threshold_look) — the
// kind's warn look at WARN (none, outline or fill), filled at DANGER with the glyph
// and text legible over the fill; on B&W the escalation is polarity. A metric value
// follows its kind's bold ladder at the entry's level; the rain text never bolds. A
// TOMORROW entry carries the alert's mark around its value ("»8", "8*"), which
// outlasts the values-off lane, so a tomorrow alert never reads as today's.
//
// A boxed entry's footprint INCLUDES its box: STATUS_ON_DEMAND_BOX_PAD_X px each side of
// the icon(+text) group, inside the box — the outline's own pixel plus two of air.
// The widths the layout works on are therefore the ink the item paints. Vertically
// the box is exactly the slots' font-derived extent (status_highlight_extent). Next
// to a boxed entry the items keep OD_PADDED_GAP (2) px apart, OD_ITEM_GAP (4)
// otherwise.
#define STATUS_ON_DEMAND_BOX_PAD_X 3

typedef struct StatusOnDemandCache StatusOnDemandCache;

// A status row's On demand state, embedded in the row.
typedef struct {
    // The glyph cache (Quiet time, one Bluetooth variant, rain and the five metric
    // glyphs): created by the first draw with an item to show, freed by
    // status_on_demand_release() — when a refresh finds nothing assigned to the bar,
    // and with the row. Its glyphs come and go with their items, so an idle bar keeps
    // only the cache struct.
    StatusOnDemandCache *cache;
    bool assigned;   // an item sits on a side of this bar, as of the last refresh
} StatusOnDemandRow;

// Free the glyph cache and every glyph it holds (NULL-safe).
void status_on_demand_release(StatusOnDemandRow *row);

// Refresh-time: read which items sit on `bar` (a ThreshBar) from `blob` (the
// thresholds settings blob, already judged: len 0 = none stored), set
// row->assigned, and fold everything the items paint into the row's signature — the
// bar's cells, the Battery warn level and Look, each assigned item's state (the
// charge, plugged and "at or below" for Battery; the Bluetooth variant; Quiet time;
// Sleep) and the weather alerts (entries, levels, days, values, looks, the rain look
// and the countdown text while a look prints it). The rain entry is re-derived from
// the radar cache on every call (O(1), flash-free), which is why a bar with items is
// refreshed on the minute tick.
uint16_t status_on_demand_fold(StatusOnDemandRow *row, uint16_t sig, int bar,
                               const uint8_t *blob, size_t len);

// What the row hands the layout and the paint, in absolute coordinates in the row's
// layer.
typedef struct {
    GFont font;             // the row's regular font
    GFont bold;             // its bold companion
    const uint8_t *blob;    // thresholds settings blob, already judged (len 0 = none)
    size_t blob_len;
    GRect band;             // the row's band — the highlight boxes clamp to it
    int16_t x;              // left edge of the row's content (the slots' origin)
    int16_t glyph_cy;       // the digits' cap centre (status_glyph_center_y)
    int16_t text_y;         // top of the text frame (the row's seated text y)
    int16_t content_h;      // the row font's content height (box sizing)
    int16_t icon_h;         // the row's icon tier: the slot glyphs' target height
    int8_t bar;             // the row's ThreshBar (-1: none)
    int8_t bleed_left;      // px the left run may reach into the row margin
    bool top_strip;         // the strip's glyph set and box floor
    bool full_date;         // a date slot prints the full date (no calendar on screen)
} StatusOnDemandEnv;

// One of the row's slots as the row resolved it: what its short family
// (status_short_text.h) is derived from.
typedef struct {
    uint8_t kind;           // StatusSlotKind
    uint8_t icon;           // StatusIconId
    GFont font;             // the font it measures and draws in
    char *text;             // its full text; the layout writes the member it drew
    size_t cap;             // over it, in a buffer of this size
} StatusOnDemandSlot;

// One item's measured parts.
typedef struct {
    int16_t icon_w;             // the glyph's width; 0 = no glyph
    int16_t text_w[OD_LANES];   // the text lane's width per On demand lane; 0 = none
    uint8_t pad;                // air each side inside a box: STATUS_ON_DEMAND_BOX_PAD_X
} StatusOnDemandCell;

// The entries and item states one pass resolves.
typedef struct {
    uint8_t bytes[ALERT_ENTRIES_MAX_BYTES];    // the stored ALERT_ENTRIES tuple
    AlertSet set;                              // metric entries, rain in front
    char rain_text[RAIN_COUNTDOWN_TEXT_CAP];   // countdown text; "" = no rain entry
    int rain_display;                          // ThreshRainDisplay, from the blob
    uint8_t side[OD_ITEM_COUNT];               // OdSide of each item on this bar
    bool active[OD_ITEM_COUNT];
    uint8_t entry[OD_ITEM_COUNT];              // a weather item's entry in `set`
    uint8_t bt_key;                            // the Bluetooth glyph (0: none)
    uint8_t charge;                            // the charge in %, Battery assigned
    uint8_t level;                             // the Battery item's warn level
    bool charging;
    bool battery_value;                        // Look Icon + value
} StatusOnDemandState;

// One draw's On demand pass, filled by status_on_demand_layout() and read by
// status_on_demand_paint(). Only status_on_demand.c reads the fields. It is too big
// for the app stack beside the rest of a row draw, so status_row.c keeps one
// file-scope pass that every row's draw reuses (draws are serialized).
typedef struct {
    StatusOnDemandState state;
    StatusOnDemandCell cells[OD_ITEM_COUNT];
    OdSideIn sides[2];
    OdLayout layout;
    bool any;                                  // items were laid out
} StatusOnDemandPass;

// Draw-time, before any paint: lay the bar's three slots out into `places`. With an
// active item, through od_layout() — the slots make room as the ladder says, and a
// slot that takes a short form gets that member's measure in `m` (the wind arrow or
// the battery's bolt lane dropped) and its text over `slots[i].text`. Without one,
// exactly status_row_layout(content_w, m, places) with `m` and the texts untouched,
// so a quiet bar lays out as it would without the feature, and measures no short
// form. Keeps the glyph cache holding exactly the glyphs the active items need.
void status_on_demand_layout(StatusOnDemandRow *row, StatusOnDemandPass *pass,
                             const StatusOnDemandEnv *env, const StatusOnDemandSlot slots[3],
                             StatusSlotMeasure m[3], StatusSlotPlace places[3],
                             int16_t content_w);

// Paint the items status_on_demand_layout() kept. Call it after the slots' highlight
// boxes and before their content, so the z-order is boxes, items, content.
// Paint-only: no allocation.
void status_on_demand_paint(GContext *ctx, const StatusOnDemandRow *row,
                            const StatusOnDemandPass *pass, const StatusOnDemandEnv *env);
