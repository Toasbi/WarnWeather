#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "status_line.h"
#include "status_threshold.h"

// The Alerts row's entry set: which alerts the row shows, in which order, and how
// many of them fit. Pure integer code — deliberately no <pebble.h> (nor rain_tier.h,
// which pulls it in), so the module host-compiles (scripts/test-c.sh) like
// status_threshold.c. The SDK side — glyphs, text, paint — is layers/status_alerts.c.
//
// NOT LINKED ON APLITE: the row is aplite-absent (WW_ALERT_ROW in wscript), so the
// .c body sits behind that macro and compiles to an empty object there. These
// declarations stay visible everywhere (they emit nothing); every CALL site is
// guarded.
//
// Where the entries come from:
//  - the metric alerts are baked by the phone into the SLOT_ALERTS slot's value
//    bytes (encoding in status_line.h) — alert_set_parse() reads them;
//  - the rain alert is resolved on the watch from its own radar cache
//    (rain_countdown_format() / rain_countdown_peak_tier()) — the SDK caller
//    collapses the tier to a bucket and hands both in to alert_set_prepend_rain().
// Fixed order: rain, then the metric entries in wire order (UV, wind, gust, AQI,
// pollen — the phone's order), so the fit's tail-drop loses pollen first and rain
// never.

#define ALERT_SET_MAX 6   // rain + the five metric kinds

typedef struct {
    uint8_t kind;          // ThreshKind of a metric entry (AQI, pollen, wind, gust, UV)
    uint8_t level;         // ThreshLevel of a metric entry: WARN or DANGER
    uint8_t value_len;     // bytes at `value`, 0..STATUS_ALERT_LEN_MAX
    const char *value;     // INTO the slot bytes, NOT NUL-terminated; NULL when
                           // value_len is 0 (the kind's Look is 'icon' on the phone)
    bool rain;             // the watch-resolved rain entry; kind/level/value unused
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

// Parse an alerts slot's value bytes (StatusSlotView value/value_len) into metric
// entries, in wire order. Every `value` points into `bytes`, so the set must not
// outlive the buffer — the same contract as the StatusSlotView it came from.
// Tolerant, although the walker (status_line.c) already rejects malformed bytes: a
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

// The spill decision for an EDGE alerts slot: `need` px against the span it would
// have beside the mid slot (`span_shared`) and the span with the mid slot gone
// (`span_full`). True = displace the mid slot for this paint and budget span_full
// (which then also bounds the fit when even that is too narrow); false = the normal
// three-slot layout. A mid alerts slot never calls this: it never displaces an edge.
bool alert_set_spill(int span_full, int span_shared, int need);

// One step down the text-lane ladder, run before any entry is dropped: the rain
// text shortens to its minutes first ("Rain in 12'" -> "12'"), then every lane goes
// (metric values off, rain icon only). Returns false once there is nothing left to
// shorten — the caller then tail-drops. `rain_display` is a ThreshRainDisplay; any
// value that is not ICON or MINUTES reads as TEXT, as status_threshold_rain_display
// would read it.
bool alert_set_degrade(int *rain_display, bool *values);

// The rain entry's MINUTES lane from rain_countdown_format()'s text: the minute
// token ("Rain in 12'" -> "12'"), marked "+" while it is raining now ("Rain for 20'"
// -> "+20'"). A count already capped at "+99'" stays "+99'". Writes "" and returns
// false for a NULL/empty/token-less string. `out` NUL-terminated; cap >= 6 fits
// every token.
bool alert_set_rain_minutes(const char *countdown, char *out, size_t cap);
