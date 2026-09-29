#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "status_line.h"
#include "status_threshold.h"

// The weather alerts' entry set: the metric alerts the phone baked, the rain alert
// the watch resolves, and the text lanes they print. Pure integer code —
// deliberately no <pebble.h> (nor rain_tier.h, which pulls it in), so the module
// host-compiles (scripts/test-c.sh) like status_threshold.c. Where the entries sit
// is On demand's business (appendix/on_demand.c lays the items out); the SDK side —
// glyphs, text, paint — is layers/status_on_demand.c.
//
// NOT LINKED ON APLITE: On demand is aplite-absent (WW_ON_DEMAND in wscript), so the
// .c body sits behind that macro and compiles to an empty object there. These
// declarations stay visible everywhere (they emit nothing); every CALL site is
// guarded, or in a file aplite never compiles (status_row.c's lean twin replaces it).
//
// Where the entries come from:
//  - the metric alerts are baked by the phone into their own weather tuple,
//    ALERT_ENTRIES_UINT8 (encoding below), which app_message.c checks with
//    alert_set_bytes_ok() and persists — alert_set_parse() reads them;
//  - the rain alert is resolved on the watch from its own radar cache
//    (rain_countdown_format() / rain_countdown_peak_tier()) — the SDK caller
//    collapses the tier to a bucket and hands both in to alert_set_prepend_rain().
// The set keeps rain first, then the metric entries in wire order; each entry
// becomes the On demand item of its kind, which orders the items by priority.

// The two macros gate different wire concerns (WW_THRESHOLD_HIGHLIGHT the thresholds
// blob and levels word, WW_ON_DEMAND the entries tuple), but On demand cannot stand
// without the first: its alert items are judged and painted by the threshold looks.
#if defined(WW_ON_DEMAND) && !defined(WW_THRESHOLD_HIGHLIGHT)
#error "WW_ON_DEMAND needs WW_THRESHOLD_HIGHLIGHT: the alert items paint the threshold looks"
#endif

#define ALERT_SET_MAX 6   // rain + the five metric kinds

// The rain entry's kind, in memory only (it never rides the tuple): no ThreshKind
// (all < THRESH_KIND_COUNT), so every accessor a kind reaches answers its
// out-of-range default — no icon (alert_set_icon), and at NORMAL no box, no bold
// and the fallback colour byte (status_threshold_look). It used to be kind 0 and so
// read AQI's settings: with AQI's Bold 'Always' its look value came out with bold
// set. The rain text never drew bold (lane_text keeps it regular), but no kind's
// settings should reach the rain entry at all.
#define ALERT_KIND_RAIN 0xFF

// ALERT_ENTRIES_UINT8 (weather message, status category): one entry per ACTIVE
// metric alert, in the fixed order UV, wind, gust, AQI, pollen (the phone bakes
// only enabled alerts at warn or higher, for today or — when the alert looks
// ahead and nothing left today reaches warn — tomorrow: status-thresholds.js
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
    uint8_t kind;          // ThreshKind of a metric entry (AQI, pollen, wind, gust,
                           // UV); ALERT_KIND_RAIN for the rain entry
    uint8_t level;         // ThreshLevel of a metric entry: WARN or DANGER
    uint8_t day;           // STATUS_ALERT_DAY_TODAY for today's value (and the rain
                           // entry); a tomorrow entry's STATUS_ALERT_MARK_* code
    uint8_t value_len;     // bytes at `value`, 0..STATUS_ALERT_LEN_MAX
    const char *value;     // INTO the slot bytes, NOT NUL-terminated; NULL when
                           // value_len is 0 (the kind's Look is 'icon' on the phone)
    bool rain;             // the watch-resolved rain entry: ALERT_KIND_RAIN at
                           // NORMAL (whose look draws no box), no value
    uint8_t rain_bucket;   // 1 drizzle, 2 rain, 3 downpour (rain_tier_to_bucket3)
    uint8_t rain_tier;     // radar tier 1..5 of the segment's peak — the drop's tint
} AlertEntry;

typedef struct {
    uint8_t count;
    AlertEntry entries[ALERT_SET_MAX];
} AlertSet;

// The StatusIconId a metric kind draws with; STATUS_ICON_NONE for a kind that is
// not an alert kind (the health trio, the bold-only kinds, out of range).
uint8_t alert_set_icon(int kind);

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

// Put the rain entry FIRST when `active`; a no-op otherwise. A full set drops its
// last entry to make room (rain outranks every metric alert). `bucket` is clamped
// to 1..3 — the caller passes rain_tier_to_bucket3(tier), which is 0 only for a
// tier-0 segment. Call once per parse.
void alert_set_prepend_rain(AlertSet *set, bool active, int bucket, int tier);

// One step down the text-lane ladder: the rain text shortens to its minutes first
// ("Rain in 12'" -> "12'"), then every lane goes (metric values off, rain icon
// only). A tomorrow entry's mark is not a value and stays (alert_set_lane), so a
// tomorrow alert never reads as today's. Returns false once there is nothing left
// to shorten. status_on_demand.c walks it to build each side's lanes (on_demand.h
// OD_LANES): the chosen looks, the rain text as minutes, the values off.
// `rain_display` is a ThreshRainDisplay; any value that is not ICON or MINUTES reads
// as TEXT, as status_threshold_rain_display would read it.
bool alert_set_degrade(int *rain_display, bool *values);

// A metric entry's text lane, what its item prints after its icon, into `out`
// (NUL-terminated; "" = none): the baked value while `values` (the lane ladder's
// flag), wrapped in tomorrow's mark — the slot's "Tomorrow's peak mark" texts
// (status-pair.js NEXT_DAY_MARKS): "»8", ">8", "+8", "8*", or "8" unmarked. Today's
// entry prints its value alone. The mark is no value: it stays when `values` is off
// or the Look is Icon (no value bytes), so the lane is then the mark alone ("»", "*",
// or "" unmarked). "»" is U+00BB in UTF-8 — Latin-1, which the Gothic fonts carry,
// as the slot's own "»8" relies on. Each part is written whole or not at all, so a
// short `cap` never splits the "»" or prints a cut number; cap >= 10 fits every lane
// (a 2-byte mark + STATUS_ALERT_LEN_MAX value bytes + NUL). The rain entry has no
// lane here (status_on_demand.c builds its countdown): it writes "". Returns the bytes
// written.
size_t alert_set_lane(const AlertEntry *e, bool values, char *out, size_t cap);

// The rain entry's MINUTES lane from rain_countdown_format()'s text: the minute
// token ("Rain in 12'" -> "12'"), marked "+" while it is raining now ("Rain for 20'"
// -> "+20'"). A count past rain_countdown's 99-minute cap ("+99'") reads ">99'" for
// an upcoming shower and "+99'" while it falls. Writes "" and returns
// false for a NULL/empty/token-less string. `out` NUL-terminated; cap >= 6 fits
// every token.
bool alert_set_rain_minutes(const char *countdown, char *out, size_t cap);
