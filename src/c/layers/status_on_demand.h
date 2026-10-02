#pragma once
#include <pebble.h>
#include "../appendix/alert_set.h"
#include "../appendix/on_demand.h"

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
//                 kind, drawn as a mini status slot at its real level. Where the
//                 status slot on its side of the bar shows the same metric, that
//                 slot shows it instead (alert_set_merge): the phone baked both
//                 values into its text, the row draws it at the entry's level, and
//                 the item stands in only where the layout hides the slot.
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
// thresholds settings blob, normalized: status_threshold_normalize), set
// row->assigned, and fold the items' inputs into the row's signature. The row signs
// the blob; this signs the rest the items paint from: the stored entries tuple and
// their live state. The rain alert is re-derived from the radar cache on every call
// (O(1), flash-free), which is why a bar with items is refreshed on the minute tick.
uint16_t status_on_demand_fold(StatusOnDemandRow *row, uint16_t sig, int bar,
                               const uint8_t blob[THRESH_SETTINGS_BYTES]);

// What the row hands the layout and the paint, in absolute coordinates in the row's
// layer.
typedef struct {
    GFont font;             // the row's regular font
    GFont bold;             // its bold companion
    const uint8_t *blob;    // thresholds settings blob, normalized (THRESH_SETTINGS_BYTES)
    GRect band;             // the row's band — the highlight boxes clamp to it
    int16_t x;              // left edge of the row's content (the slots' origin)
    int16_t glyph_cy;       // the digits' cap centre (status_glyph_center_y)
    int16_t text_y;         // top of the text frame (the row's seated text y)
    int16_t content_h;      // the row font's content height (box sizing)
    int16_t icon_h;         // the row's icon tier: the slot glyphs' target height
    int8_t bar;             // the row's ThreshBar (-1: none)
    int8_t bleed_left;      // px the left run may reach into the row margin
    bool top_strip;         // the strip's glyph set and box floor
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

// The entries and item states one pass resolves.
typedef struct {
    uint8_t bytes[ALERT_ENTRIES_MAX_BYTES];    // the stored ALERT_ENTRIES tuple
    AlertSet set;                              // the metric entries, in wire order
    RainCountdown rain;                        // the rain alert, while Rain is active
    int rain_display;                          // ThreshRainDisplay, from the blob
    uint8_t side[OD_ITEM_COUNT];               // OdSide of each item on this bar
    bool active[OD_ITEM_COUNT];
    uint8_t bt_key;                            // the Bluetooth glyph (0: none)
    uint8_t charge;                            // the charge in %, Battery assigned
    bool charging;
    bool battery_value;                        // Look Icon + value
} StatusOnDemandState;

// One draw's On demand pass, filled by status_on_demand_layout() and read by
// status_on_demand_paint(). Only status_on_demand.c reads the fields. It is too big
// for the app stack beside the rest of a row draw, so status_row.c keeps one
// file-scope pass that every row's draw reuses (draws are serialized).
typedef struct {
    StatusOnDemandState state;
    OdSideIn sides[2];
    OdLayout layout;
    bool any;                                  // items were laid out
} StatusOnDemandPass;

// Draw-time, first: which items of `bar` (a ThreshBar; -1 none) are active and what
// they show, into the pass, read from `blob` as status_on_demand_fold() reads it. A
// row with no item assigned collects nothing, so none of its slots merges an alert.
void status_on_demand_collect(const StatusOnDemandRow *row, StatusOnDemandPass *pass,
                              int bar, const uint8_t blob[THRESH_SETTINGS_BYTES]);

// After status_on_demand_collect(), for slot `i` (0 left, 1 middle, 2 right) of the
// draw, `kind` its ThreshKind: the level the slot is drawn at for the weather alert it
// merged (alert_set_merge) — the alert's, whatever the slot's own Alert highlighting
// says — and 0 for a slot that merged none. A query: status_on_demand_layout() derives
// which item merged from the slots it is given, whether or not this ran.
static inline uint8_t status_on_demand_merge(const StatusOnDemandPass *pass, int i,
                                             int kind) {
    return alert_set_merge(&pass->state.set, pass->state.side, i, kind);
}

// Draw-time, after status_on_demand_collect() and before any paint: lay the bar's three
// slots out into `places`. With an active item, through od_layout() — the slots make
// room as the ladder says, a merged alert stands in only where its slot hides, and a
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
