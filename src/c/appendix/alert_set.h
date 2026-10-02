#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "status_line.h"
#include "status_threshold.h"
#include "rain_countdown.h"   // RainCountdown (that header is SDK-free too)

// The weather alerts' texts: the metric alerts' entry set the phone baked, the text
// lanes its entries print, and the rain alert's countdown text. Pure code —
// deliberately no <pebble.h> (nor rain_tier.h, which pulls it in), so the module
// host-compiles (scripts/test-c.sh) like status_threshold.c. Where the items sit is
// On demand's business (appendix/on_demand.c lays them out); the SDK side — glyphs,
// text, paint — is layers/status_on_demand.c.
//
// NOT LINKED ON APLITE: On demand is aplite-absent (WW_ON_DEMAND in wscript), so the
// .c body sits behind that macro and compiles to an empty object there. These
// declarations stay visible everywhere (they emit nothing); every CALL site is
// guarded, or in a file aplite never compiles (status_row.c's lean twin replaces it).
//
// Where the alerts come from:
//  - the metric alerts are baked by the phone into their own weather tuple,
//    ALERT_ENTRIES_UINT8 (encoding below), which app_message.c checks with
//    alert_set_bytes_ok() and persists — alert_set_parse() reads them, in wire
//    order; each entry is the On demand item of its kind (alert_set_item), and the
//    item order is the priority;
//  - the rain alert is no entry: the watch resolves it from its own radar cache as
//    numbers (rain_countdown_get()), and alert_set_rain_text() prints them.

// The two macros gate different wire concerns (WW_THRESHOLD_HIGHLIGHT the thresholds
// blob and levels word, WW_ON_DEMAND the entries tuple), but On demand cannot stand
// without the first: its alert items are judged and painted by the threshold looks.
#if defined(WW_ON_DEMAND) && !defined(WW_THRESHOLD_HIGHLIGHT)
#error "WW_ON_DEMAND needs WW_THRESHOLD_HIGHLIGHT: the alert items paint the threshold looks"
#endif

#define ALERT_SET_MAX 5   // the five metric kinds

// A text lane's buffer: the longest lane is the rain alert's full text,
// "Downpour for +99'", + NUL.
#define ALERT_SET_LANE_CAP 18

// ALERT_ENTRIES_UINT8 (weather message, status category): one entry per ACTIVE
// metric alert, in the fixed order UV, wind, gust, AQI, pollen (the phone bakes
// only enabled alerts at warn or higher, for today or — when the alert looks
// ahead and nothing left today reaches warn — tomorrow: status-wire.js
// bakeAlerts; it tail-drops entries past ALERT_ENTRIES_MAX_BYTES, pollen first).
// Each entry:
//   header byte   bit 7     STATUS_ALERT_HEADER, set on every header and on no
//                           value byte (those are printable ASCII), so a value
//                           needs no length: it runs to the next header or the end
//                 bits 0-2  ThreshKind (AQI 0, pollen 1, wind 2, gust 3, UV 7 —
//                           status_threshold.h's ids, which fit 3 bits)
//                 bit 3     STATUS_ALERT_DANGER: danger when set, warn when clear
//                           (the phone bakes no other level)
//                 bits 4-6  the day: STATUS_ALERT_DAY_TODAY (0) for today's value,
//                           else tomorrow's, as its mark's code — STATUS_ALERT_MARK_*
//                           (the phone's ALERT_NEXT_DAY_MARKS order + 1); 6 and 7
//                           are unused and read as STATUS_ALERT_MARK_NONE
//   value bytes   0..STATUS_ALERT_LEN_MAX printable ASCII bytes — the number
//                 printed after the icon; none unless the kind's Look is 'value'
//                 on the phone. The mark is not in them: the watch draws it.
// The rain alert is NOT in here: the watch resolves it from its own radar cache.
// Zero active alerts = an empty array, which clears the stored entries. All five
// with values stay under the cap on either day (5 headers + at most 2 + 3 + 3 + 3
// + 3 value bytes, pollen's widest band being "2-3" = 19 B — a tomorrow entry costs
// no extra byte), so the 20-B cap drops nothing today; it bounds what the inbox has
// to budget for (test/inbox-size.test.js). The phone never sends the tuple to aplite.
#define ALERT_ENTRIES_MAX_BYTES 20
#define STATUS_ALERT_HEADER 0x80
#define STATUS_ALERT_KIND_MASK 0x07
#define STATUS_ALERT_DANGER 0x08
#define STATUS_ALERT_DAY_SHIFT 4
#define STATUS_ALERT_DAY_MASK 0x07
#define STATUS_ALERT_LEN_MAX 7
// The day codes (bits 4-6). Tomorrow's is the mark the alert's "Tomorrow's mark"
// picked on the phone, drawn with the entry's text lane (alert_set_lane): a prefix
// before the value ("»8", ">8", "+8"), a suffix after it ("8*"), or nothing — with
// the Icon look too.
#define STATUS_ALERT_DAY_TODAY 0
#define STATUS_ALERT_MARK_RAQUO 1    // "»" before the value
#define STATUS_ALERT_MARK_GT 2       // ">" before
#define STATUS_ALERT_MARK_PLUS 3     // "+" before
#define STATUS_ALERT_MARK_STAR 4     // "*" after
#define STATUS_ALERT_MARK_NONE 5     // tomorrow's, unmarked

typedef struct {
    uint8_t kind;          // ThreshKind: AQI, pollen, wind, gust or UV
    uint8_t level;         // ThreshLevel: WARN or DANGER
    uint8_t day;           // STATUS_ALERT_DAY_TODAY for today's value; a tomorrow
                           // entry's STATUS_ALERT_MARK_* code
    uint8_t value_len;     // bytes at `value`, 0..STATUS_ALERT_LEN_MAX
    const char *value;     // INTO the slot bytes, NOT NUL-terminated; NULL when
                           // value_len is 0 (the kind's Look is 'icon' on the phone)
} AlertEntry;

typedef struct {
    uint8_t count;
    AlertEntry entries[ALERT_SET_MAX];
} AlertSet;

// The StatusIconId a metric kind draws with; STATUS_ICON_NONE for a kind that is
// not an alert kind (the health trio, the bold-only kinds, out of range).
uint8_t alert_set_icon(int kind);

// The On demand item (an OdItem) a metric kind's entry is; -1 for a kind that is
// not an alert kind (alert_set_parse already skips those).
int alert_set_item(int kind);

// Whether slot `slot` of a bar (0 left, 1 middle, 2 right) merged a weather alert: an
// entry of the metric the slot shows (`kind`, the slot's ThreshKind,
// status_threshold_kind_for_slot — so Wind speed never takes a gust entry) whose item
// sits on that slot's side of the bar (`side`: each OdItem's OdSide there). The phone
// baked that slot's text as the two values once (status-lines.js), so the slot is
// drawn at the entry's level and the item stands in only where the layout hides the
// slot. The middle slot never merges, and an alert on the other side never does.
// Returns the entry's level (THRESH_LEVEL_WARN or _DANGER); 0 for none. A pure query:
// the item that merged is alert_set_item(kind) (one item per alert kind), which the
// On demand layout derives from the slot itself.
static inline uint8_t alert_set_merge(const AlertSet *set, const uint8_t side[OD_ITEM_COUNT],
                                      int slot, int kind) {
    if (slot == 1) { return 0; }
    for (int i = 0; i < set->count; i++) {
        const AlertEntry *e = &set->entries[i];
        if (e->kind == kind && side[alert_set_item(e->kind)] == (slot >> 1) + OD_SIDE_LEFT) {
            return e->level;
        }
    }
    return 0;
}

// Whether an ALERT_ENTRIES_UINT8 payload is well formed: at most
// ALERT_ENTRIES_MAX_BYTES, starting on a header (a value byte before any header
// belongs to no entry), every value byte printable ASCII (the phone prints digits
// and pollen bands like "2-3"; anything else is rejected here rather than reaching
// graphics_draw_text) and every value at most STATUS_ALERT_LEN_MAX bytes. Zero
// bytes is valid (nothing alerting). app_message.c drops a malformed tuple,
// keeping the last good entries.
bool alert_set_bytes_ok(const uint8_t *bytes, size_t len);

// Parse the stored alert entries (ALERT_ENTRIES_UINT8) into metric entries, in
// wire order. Every `value` points into `bytes`, so the set must not outlive the
// buffer.
// Tolerant, although alert_set_bytes_ok() already rejects malformed bytes: value
// bytes before the first header are skipped, an entry whose kind has no icon is
// skipped (its value bytes with it), an unused day code (6, 7) reads as
// STATUS_ALERT_MARK_NONE, and the parse stops at ALERT_SET_MAX. Returns out->count.
int alert_set_parse(const uint8_t *bytes, size_t len, AlertSet *out);

// A metric entry's text lane, what its item prints after its icon, into `out`
// (NUL-terminated; "" = none): the baked value while `values` (the lane's values flag,
// on_demand.h od_lane_look), wrapped in tomorrow's mark — the slot's "Tomorrow's peak
// mark" texts (status-pair.js NEXT_DAY_MARKS): "»8", ">8", "+8", "8*", or "8"
// unmarked. Today's entry prints its value alone. The mark is no value: it stays when
// `values` is off or the Look is Icon (no value bytes), so the lane is then the mark
// alone ("»", "*", or "" unmarked). "»" is U+00BB in UTF-8 — Latin-1, which the Gothic
// fonts carry, as the slot's own "»8" relies on. Each part is written whole or not at
// all, so a short `cap` never splits the "»" or prints a cut number; cap >= 10 fits
// every lane (a 2-byte mark + STATUS_ALERT_LEN_MAX value bytes + NUL). Returns the
// bytes written.
size_t alert_set_lane(const AlertEntry *e, bool values, char *out, size_t cap);

// The rain alert's text into `out` (NUL-terminated, cut at `cap`): the noun by the
// drops' bucket ("Drizzle", "Rain", "Downpour"), then "in" the minutes until it starts
// or "for" the minutes it keeps falling — "Rain in 12'", "Drizzle for 20'". With
// `minutes_only` (the Icon + minutes look, and the Text look's shorter lane) the
// minutes alone, marked "+" while it rains — "12'", "+20'". Past the 99-minute cap the
// count reads "+99'" (">99'" for an upcoming shower with `minutes_only`, so it never
// reads as rain falling now). ALERT_SET_LANE_CAP fits every text.
void alert_set_rain_text(const RainCountdown *rc, bool minutes_only, char *out, size_t cap);
