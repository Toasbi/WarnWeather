#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "../layers/status_row_layout.h"

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
// The last row of the make-room ladder (STAGE[] in on_demand.c).
#define OD_LAST_STAGE 9
// A slot's members: [0] its full form, then its short family, widest first.
#define OD_VARIANTS 4
// The air between two items: the row's group gap, or less beside a boxed alert
// (whose padding already sits inside its footprint).
#define OD_ITEM_GAP STATUS_ROW_GROUP_GAP
#define OD_PADDED_GAP 2

// One of the bar's three slots, as measured. n == 0 is an empty slot, n == 1 a slot
// with no short form; every slot has n <= 1 until the short forms arrive.
typedef struct {
    StatusSlotMeasure m[OD_VARIANTS];
    uint8_t n;
} OdSlotIn;

// One side's items, outermost first (ascending OdItem, so rank[] rises).
typedef struct {
    uint8_t n;
    uint8_t rank[OD_SIDE_MAX];            // the item's OdItem
    int16_t w[OD_LANES][OD_SIDE_MAX];     // its footprint per lane (> 0)
    bool padded[OD_SIDE_MAX];             // a boxed alert: its padding is in w
} OdSideIn;

// The layout: each slot's form, member and place (content x), and per side the
// items kept, their lane and where they sit. Side d draws its input items
// first[d] .. first[d] + n[d] - 1 (first is 1 only when the stand-in Battery item
// was left out); item_x is indexed like the input. Index 0 of every per-side array
// is the left side, 1 the right.
typedef struct {
    uint8_t form[3];                       // OdForm, left / middle / right slot
    uint8_t variant[3];                    // the member drawn: 0 full, else short
    StatusSlotPlace place[3];
    uint8_t first[2];                      // the first input item kept
    uint8_t n[2];                          // items kept (0: no run)
    uint8_t lane[2];                       // their lane
    uint8_t stage[2];                      // the ladder row the side settled on
    int16_t x[2];                          // the run's span, content x ...
    int16_t w[2];                          // ... and width
    int16_t item_x[2][OD_SIDE_MAX];        // each kept item's left edge
} OdLayout;

// Lay a bar out: its three slots (`slots`, each with m[0] its full measure) and its
// two sides of items, in `content_w` px.
//  - With no item on either side the result IS status_row_layout() of the full
//    measures, byte for byte, and `bleed` is never read: a quiet bar draws as if On
//    demand did not exist.
//  - Otherwise each side climbs the make-room ladder (on_demand.c) while its own
//    claim is in the way: its slot slides inward, shortens, the looks shorten, the
//    middle leaves the centre, its slot hides, the middle hides, and finally its
//    lowest-priority item drops. The far slot of a side with no items keeps its
//    place.
// `bleed[d]` is how far side d's run may reach past the content edge into the row
// margin (the top strip's left run starts where the old indicator icons did). Slots
// never bleed. `battery_standin` (the top strip's Watch battery slot with the
// Battery item in its Icon look): the Battery item is left out while that slot
// still shows after the layout, and replaces it once the layout hides it — a low
// charge always shows exactly one battery.
void od_layout(int16_t content_w, const OdSlotIn slots[3], const OdSideIn sides[2],
               const int8_t bleed[2], bool battery_standin, OdLayout *out);
