#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "status_line.h"
#include "status_threshold.h"
#include "../layers/status_row_layout.h"

// The Alerts row's entry set: which alerts the row shows, in which order, how many
// of them fit, and which slots of its bar it takes over. Pure integer code — deliberately no <pebble.h> (nor rain_tier.h,
// which pulls it in), so the module host-compiles (scripts/test-c.sh) like
// status_threshold.c, linked with the row layout it asks where the slots go. The SDK
// side — glyphs, text, paint — is layers/status_alerts.c.
//
// NOT LINKED ON APLITE: the row is aplite-absent (WW_ALERT_ROW in wscript), so the
// .c body sits behind that macro and compiles to an empty object there. These
// declarations stay visible everywhere (they emit nothing); every CALL site is
// guarded.
//
// Where the entries come from:
//  - the metric alerts are baked by the phone into their own weather tuple,
//    ALERT_ENTRIES_UINT8 (encoding below), which app_message.c checks with
//    alert_set_bytes_ok() and persists — alert_set_parse() reads them;
//  - the rain alert is resolved on the watch from its own radar cache
//    (rain_countdown_format() / rain_countdown_peak_tier()) — the SDK caller
//    collapses the tier to a bucket and hands both in to alert_set_prepend_rain().
// Fixed order: rain, then the metric entries in wire order (UV, wind, gust, AQI,
// pollen — the phone's order), so the fit's tail-drop loses pollen first and rain
// never.

#define ALERT_SET_MAX 6   // rain + the five metric kinds

// ALERT_ENTRIES_UINT8 (weather message, status category): one entry per ACTIVE
// metric alert, in the fixed order UV, wind, gust, AQI, pollen (the phone bakes
// only enabled alerts at warn or higher — status-thresholds.js bakeAlerts — and
// tail-drops entries past ALERT_ENTRIES_MAX_BYTES, pollen first). Each entry:
//   header byte   bits 0-2  ThreshKind (AQI 0, pollen 1, wind 2, gust 3, UV 7 —
//                           status_threshold.h's ids, which fit 3 bits)
//                 bits 3-4  level (1 warn / 2 danger)
//                 bits 5-7  value length, 0-7
//   value bytes   that many ASCII bytes — the number printed after the icon;
//                 zero unless the kind's Look is 'value' on the phone
// The rain alert is NOT in here: the watch resolves it from its own radar cache.
// Zero active alerts = an empty array, which clears the stored entries. All five
// with values stay under the cap (5 headers + at most 2 + 3 + 3 + 3 + 3 value
// bytes, pollen's widest band being "2-3" = 19 B), so the 20-B cap drops nothing
// today; it bounds what the inbox has to budget for (test/inbox-size.test.js).
// The phone never sends the tuple to aplite.
#define ALERT_ENTRIES_MAX_BYTES 20
#define STATUS_ALERT_KIND_MASK 0x07
#define STATUS_ALERT_LEVEL_SHIFT 3
#define STATUS_ALERT_LEVEL_MASK 0x03
#define STATUS_ALERT_LEN_SHIFT 5
#define STATUS_ALERT_LEN_MAX 7

typedef struct {
    uint8_t kind;          // ThreshKind of a metric entry (AQI, pollen, wind, gust, UV)
    uint8_t level;         // ThreshLevel of a metric entry: WARN or DANGER
    uint8_t value_len;     // bytes at `value`, 0..STATUS_ALERT_LEN_MAX
    const char *value;     // INTO the slot bytes, NOT NUL-terminated; NULL when
                           // value_len is 0 (the kind's Look is 'icon' on the phone)
    bool rain;             // the watch-resolved rain entry: kind 0 at NORMAL (whose
                           // look draws no box — status_threshold_look), no value
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
// ALERT_ENTRIES_MAX_BYTES, every header's declared value length inside the
// bytes and the entries tiling them exactly (a length that runs past the end is
// a malformed tuple, never a truncated value), and every value byte printable
// ASCII (the phone prints digits and pollen bands like "2-3"; anything else is
// rejected here rather than reaching graphics_draw_text). Zero bytes is valid
// (nothing alerting). app_message.c drops a malformed tuple, keeping the last
// good entries.
bool alert_set_bytes_ok(const uint8_t *bytes, size_t len);

// Parse the stored alert entries (ALERT_ENTRIES_UINT8) into metric entries, in
// wire order. Every `value` points into `bytes`, so the set must not outlive the
// buffer.
// Tolerant, although alert_set_bytes_ok() already rejects malformed bytes: a
// declared value length that runs past `len` ends the parse there, an entry whose
// kind has no icon or whose level is NORMAL is skipped (its value bytes still
// consumed), a reserved level 3 reads as DANGER (status_threshold_weather_level's
// rule), and the parse stops at ALERT_SET_MAX. Returns out->count.
int alert_set_parse(const uint8_t *bytes, size_t len, AlertSet *out);

// Put the rain entry FIRST when `active`; a no-op otherwise. A full set drops its
// last entry to make room (rain outranks every metric alert). `bucket` is clamped
// to 1..3 — the caller passes rain_tier_to_bucket3(tier), which is 0 only for a
// tier-0 segment. Call once per parse.
void alert_set_prepend_rain(AlertSet *set, bool active, int bucket, int tier);

// Width of the first `n` entries laid out left to right: their widths plus `gap`
// between each pair of VISIBLE neighbours. A zero-width entry (a glyph that failed
// to load, with no text) takes no room and no gap — the draw skips it the same way.
int alert_set_row_w(const int16_t *widths, int n, int gap);

// How many entries fit `budget` px: the largest prefix whose alert_set_row_w() is
// within it — entries drop from the TAIL (pollen first, rain last). 0 when not even
// the first fits.
int alert_set_fit(const int16_t *widths, int n, int gap, int budget);

// The takeover: lay the bar out (`out`) without the slots the Alerts row replaces,
// and give the span [*x0, *x1) they leave it. Returns the slots taken as a bitmask
// over the slot indices (bit 0 left, 1 middle, 2 right — status_line.h's order).
//
// `place` is the bar's ThreshAlertsPlace, `need` the row's width at its full lanes
// (alert_set_row_w) and `m` the three slots' measures, left untouched. LEFT takes the
// left slot, RIGHT the right one, MIDDLE the middle one, and the rest lay out where
// they would anyway (the middle slot stays centred). When the row does not fit the
// span that leaves, it borrows ONE neighbour if that one still shows: LEFT and RIGHT
// the middle slot, MIDDLE the left one. An absent or squeezed-out slot frees nothing.
// Whatever still does not fit is the lane ladder's and the tail-drop's business.
// While the right slot shows the low-battery warning (`battery`, the top strip only)
// a RIGHT row lays out as a MIDDLE one, which never borrows the right slot, so the
// warning keeps the slot 'Show battery below 10%' promises it.
//
// The span runs from the nearest slot still showing left of the anchor (its ink end
// + the group gap; the row's left edge when none) to the nearest one right of it (its
// ink start - the gap; content_w when none), and never inverts. `need` <= 0 (no entry
// has any width) takes nothing: `out` is the plain layout, the span still the
// anchor's. Off takes nothing either, and its span is the whole row.
int alert_set_take(int place, bool battery, int need, int16_t content_w,
                   const StatusSlotMeasure m[3], StatusSlotPlace out[3], int *x0, int *x1);

// Left edge of a row `w` px wide inside the span [x0, x1): LEFT hugs x0, RIGHT
// hugs x1 (the entries keep their fixed order — rain first — but the group sits
// against the right edge), MIDDLE centres on the ROW's centre (content_w / 2, the
// middle slot's own rule) clamped into the span. `place` and `battery` as
// alert_set_take() reads them: a RIGHT row beside the battery warning centres. A
// row wider than its span starts at x0 — the fit has already cut it to the span, so
// this only guards rounding.
int alert_set_row_x(int place, bool battery, int x0, int x1, int content_w, int w);

// One step down the text-lane ladder, run before any entry is dropped: the rain
// text shortens to its minutes first ("Rain in 12'" -> "12'"), then every lane goes
// (metric values off, rain icon only). Returns false once there is nothing left to
// shorten — the caller then tail-drops. `rain_display` is a ThreshRainDisplay; any
// value that is not ICON or MINUTES reads as TEXT, as status_threshold_rain_display
// would read it.
bool alert_set_degrade(int *rain_display, bool *values);

// The rain entry's MINUTES lane from rain_countdown_format()'s text: the minute
// token ("Rain in 12'" -> "12'"), marked "+" while it is raining now ("Rain for 20'"
// -> "+20'"). A count past rain_countdown's 99-minute cap ("+99'") reads ">99'" for
// an upcoming shower and "+99'" while it falls. Writes "" and returns
// false for a NULL/empty/token-less string. `out` NUL-terminated; cap >= 6 fits
// every token.
bool alert_set_rain_minutes(const char *countdown, char *out, size_t cap);
