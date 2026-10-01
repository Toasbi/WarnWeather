#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "../layers/status_row_layout.h"
#include "status_line.h"

// On demand: the items a status bar shows at its left and right edges only while
// they matter — Battery, Bluetooth, Quiet time and Sleep (System info), then the
// weather alerts (rain, gusts, UV, AQI, pollen, wind). This is the pure half: the
// two-side layout and its make-room ladder, which decides how a bar's three slots
// give way to the items. Deliberately no <pebble.h>, so the module host-compiles
// (scripts/test-c.sh) with the row layout it places slots through. The SDK half —
// which items are active, their glyphs, measures and paint — is
// layers/status_on_demand.c.
//
// NOT LINKED ON APLITE: On demand is aplite-absent (WW_ON_DEMAND in wscript), so the
// .c body sits behind that macro and compiles to an empty object there. These
// declarations emit nothing.

// The items, in priority order, which is also the wire order of the thresholds
// blob's item cells (status_threshold.h, THRESH_ON_DEMAND_OFFSET) and the order the
// phone's item list keeps. Inside a side the items run outermost first in this
// order, and the last one drops first.
typedef enum {
    OD_BATTERY = 0,
    OD_BLUETOOTH = 1,
    OD_QUIET_TIME = 2,
    OD_SLEEP = 3,
    OD_RAIN = 4,
    OD_GUST = 5,
    OD_UV = 6,
    OD_AQI = 7,
    OD_POLLEN = 8,
    OD_WIND = 9,
    OD_ITEM_COUNT = 10,
} OdItem;

// The form a slot takes. Numerically ordered by how much it gives up, so the
// harsher of two requests is the larger value.
typedef enum { OD_FULL = 0, OD_SHORT = 1, OD_HIDDEN = 2 } OdForm;

// The side of a bar an item sits on; also the value of its 2-bit wire cell.
typedef enum { OD_SIDE_NONE = 0, OD_SIDE_LEFT = 1, OD_SIDE_RIGHT = 2 } OdSide;

// Text lanes: 0 the chosen looks, 1 the rain Text shortened to its minutes, 2 the
// values off (a tomorrow alert keeps its mark).
#define OD_LANES 3
#define OD_SIDE_MAX OD_ITEM_COUNT
// The last row of the make-room ladder (STAGE[] in on_demand.c), which a side
// climbs once per look.
#define OD_LAST_STAGE 8
// A slot's members: [0] its full form, then its short family, widest first. The widest
// family has OD_VARIANTS - 1 members; test/c/status_short_text_test.c fails when one
// would have more.
#define OD_VARIANTS 4
// The air between two items: the row's group gap, or less beside a boxed alert
// (whose padding already sits inside its footprint).
#define OD_ITEM_GAP STATUS_ROW_GROUP_GAP
#define OD_PADDED_GAP 2
// A status glyph inks one column past its bounds: icon_load (status_row_icons.c)
// snaps its vertices to pixel centres 0.5 .. w + 0.5 px, and the 1-px stroke covers
// both end columns — w + 1 columns of ink for bounds w.
#define OD_GLYPH_INK_OVERHANG 1
// A text lane's measured width (graphics_text_layout_get_content_size) ends in the
// font's one blank column of letter spacing after its last glyph.
#define OD_TEXT_TRAIL_SPACING 1

// The pure decisions of the SDK half (layers/status_on_demand.c), header-inline so
// its calls cost what they did there, and here so the host tests pin them.

// A metric alert is boxed at its level, so its padding is part of its footprint;
// rain and the system items are never boxed.
static inline bool od_item_boxed(int item) {
    return item >= OD_GUST;
}

// The Rain item's look — bits 0-1 of the thresholds blob's alerts byte
// (status_threshold.h, status_threshold_rain_display). Here rather than there because
// the lane rule below reads it, and status_threshold.h includes this header.
typedef enum {
    THRESH_RAIN_DISPLAY_TEXT = 0,      // the full countdown, "Rain in 12'" (legacy)
    THRESH_RAIN_DISPLAY_ICON = 1,      // the drop alone
    THRESH_RAIN_DISPLAY_MINUTES = 2,   // the drop + "12'"
} ThreshRainDisplay;

// The looks of text lane `lane` (0..OD_LANES - 1), from the chosen rain look `chosen`
// (a ThreshRainDisplay): lane 0 as chosen; lane 1 the rain Text as its minutes (Icon
// and Icon + minutes keep theirs); lane 2 the rain icon alone. `values` (the metric
// alerts' values and the Battery's "8%") is off on lane 2 only — a tomorrow alert
// keeps its mark there (alert_set_lane). A chosen look that is neither Icon nor Icon +
// minutes reads as Text, as status_threshold_rain_display reads the reserved value 3.
static inline void od_lane_look(int chosen, int lane, int *rain_display, bool *values) {
    *values = lane < 2;
    *rain_display = lane <= 0 ? chosen
        : lane == 1 && chosen != THRESH_RAIN_DISPLAY_ICON ? THRESH_RAIN_DISPLAY_MINUTES
        : THRESH_RAIN_DISPLAY_ICON;
}

// Whether a slot of `kind` (a StatusSlotKind) shows the watch battery — the Watch
// battery glyph or the Battery % — and so counts in od_layout's `battery_slots`.
static inline bool od_slot_shows_battery(int kind) {
    return kind == SLOT_LIVE_BATTERY || kind == SLOT_LIVE_BATTERY_PCT;
}

// An item's footprint on one lane: its icon, then its text after
// STATUS_ROW_ICON_TEXT_GAP (no gap without an icon); 0 with nothing to draw. A boxed
// item (od_item_boxed) adds `pad` on both sides and is measured by its ink — a last
// icon's one-column overhang in, a last text's trailing letter spacing out — so its
// air to the box stroke is equal on both sides.
static inline int16_t od_item_footprint(int16_t icon_w, int16_t text_w, bool boxed,
                                        int16_t pad) {
    int16_t fw = (int16_t)(icon_w + (text_w > 0
        ? (icon_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0) + text_w : 0));
    if (fw > 0 && boxed) {
        fw = (int16_t)(fw + 2 * pad + (text_w > 0 ? -OD_TEXT_TRAIL_SPACING : OD_GLYPH_INK_OVERHANG));
    }
    return fw;
}

// One of the bar's three slots, as measured: m[0] its full form, then its short
// family widest first (status_short_text.h). n == 0 is an empty slot, n == 1 a slot
// with no short form. A member counts as short only while it is narrower than the
// slot's width in the plain layout.
typedef struct {
    StatusSlotMeasure m[OD_VARIANTS];
    uint8_t n;
    // When > 0 the last member is elastic (the city): its text may ellipsize down to
    // this many px, its floor ("Fra…"), and the ladder measures it there.
    int16_t floor_w;
} OdSlotIn;

// One side's items, outermost first (ascending OdItem, so rank[] rises).
typedef struct {
    uint8_t n;
    uint8_t rank[OD_SIDE_MAX];            // the item's OdItem
    int16_t w[OD_LANES][OD_SIDE_MAX];     // its footprint per lane (> 0)
    bool padded[OD_SIDE_MAX];             // a boxed alert: its padding is in w
} OdSideIn;

// The layout: each slot's member and place (content x), and per side the items
// kept, their lane and where they sit. A slot's form is in them: hidden where its
// place does not show, short where it draws a member past 0, else full. Side d draws
// its input items first[d] .. first[d] + n[d] - 1 (first is 1 only when the Battery
// item was left out beside a battery slot); item_x is indexed like the input. Index 0
// of every per-side array is the left side, 1 the right.
typedef struct {
    uint8_t variant[3];                    // the member drawn: 0 full, else short
    StatusSlotPlace place[3];              // its fit: an elastic member's text_w is
                                           // its ellipsized width
    uint8_t first[2];                      // the first input item kept
    uint8_t n[2];                          // items kept (0: no run)
    uint8_t lane[2];                       // their lane
    uint8_t stage[2];                      // the ladder row the side ends on, at its
                                           // look lane[] (after the relax)
    int16_t item_x[2][OD_SIDE_MAX];        // each kept item's left edge
} OdLayout;

// Lay a bar out: its three slots (`slots`, each with m[0] its full measure) and its
// two sides of items, in `content_w` px.
//  - With no item on either side the result IS status_row_layout() of the full
//    measures, byte for byte, and `bleed` is never read: a quiet bar draws as if On
//    demand did not exist.
//  - Otherwise each side climbs the make-room ladder (on_demand.c) while its own
//    claim is in the way: its slot slides inward and shortens, the middle shortens,
//    its slot hides, the middle leaves the centre, the middle hides (its slot trying
//    back beside it gone); only then does the side's look shorten (the rain Text to
//    its minutes, then the values off), and finally its lowest-priority item drops.
//    Where a look shortened, both sides climb again from their first rows at the
//    looks they have, so the slots and the middle it leaves room for come back. Once
//    both have settled, each side in turn takes back the longest look, then the
//    fullest slot and middle, where its own claim is not in the way; the other side
//    gives way for it through its own ladder where its claim is — a claim that stays
//    inside its half is never pushed, and a slot a side gave up only for the middle
//    is whole again while the middle is hidden. The middle never costs a look: where
//    it shows beside a shortened look that hiding it would give back, it hides, and
//    where that would push a slot whose side stays inside its half, the bar is laid
//    out without the middle, that slot whole. And a hidden middle comes back wherever
//    it fits at no cost to either side's items, looks or own slot. The far slot of a
//    side with no items keeps its place. The ladder measures a short slot at its
//    narrowest member (an elastic one at its floor); once it has settled, each short
//    slot draws the widest member its room allows, the middle first, then the left
//    slot, then the right.
// `bleed[d]` is how far side d's run may reach past the content edge into the row
// margin (the top strip's left run starts where the old indicator icons did). Slots
// never bleed. `battery_slots` (bit i: slot i shows the watch battery, the Watch
// battery glyph or the Battery %; nonzero only while the Battery item is on a side):
// the Battery item, whatever its Look, is left out while any of those slots shows,
// and stands in where the layout hides every one of them — a low charge shows the
// battery in a slot or in the item, never both. The ladder measures the item in
// wherever a row hides them all, so a battery slot hides only where the looks still
// fit beside the item: an item wider than the slot it replaces frees no room.
void od_layout(int16_t content_w, const OdSlotIn slots[3], const OdSideIn sides[2],
               const int8_t bleed[2], uint8_t battery_slots, OdLayout *out);
