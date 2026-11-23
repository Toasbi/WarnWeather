#pragma once
#include <pebble.h>
#include "../appendix/status_line.h"        // StatusSlotView, the slot text sizes
#include "../appendix/status_threshold.h"   // ThreshLook

// A slot's short form, at most this many bytes: the condition's as the phone baked it
// (STATUS_TEXT_ALT_MAX), or the date's, which the watch formats (date_format.h
// DATE_FORMAT_SHORT_MAX, the longer one; status_row.c checks the two against it).
#define STATUS_ROW_ALT_MAX 6

// One slot of a status row resolved to everything a pass needs that does NOT depend on
// measurement (status_row.c resolve_slot). The refresh pass signs these fields (the
// look through the blob it is read from), the draw pass measures and paints them, and
// On demand derives the slot's short family from them (status_on_demand_layout) and
// writes the member it picks over `text` — one resolution, every consumer. They used
// to be three hand-copied resolutions on eight parallel arrays, and one copy (the
// retired right-slot width query) silently omitted the threshold load (status_row.c
// load_pass).
//
// NO measurement here, deliberately: status_row.c measure_slot() reads the row's
// glyphs, which are only valid after its ensure_glyphs(), and a resolver that measured
// would drag PDC glyph loads onto every minute tick's refresh. The draw sets `font`
// from the look's bold bit, and measures with it: the same font it goes on to draw with.
typedef struct {
    StatusSlotView slot;                       // the packed slot
    GFont          font;                       // regular or bold: set by the draw only
    char    text[STATUS_TEXT_MID_MAX + 1];     // direction sentinel already stripped
    char    alt[STATUS_ROW_ALT_MAX + 1];       // its short form, if it brought one ("")
    int8_t  dir;                               // wind sector 0..15, -1 = none
    uint8_t level;                             // ThreshLevel, gated on the Highlight switch
    ThreshLook look;                           // box, bold bit, RAW accent byte at `level`
} StatusRowSlot;
