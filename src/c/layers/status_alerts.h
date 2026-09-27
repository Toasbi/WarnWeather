#pragma once
#include <pebble.h>
#include "../appendix/alert_set.h"

// The Alerts row's SDK half: the glyph cache, per-entry measuring and paint for an
// AlertSet (appendix/alert_set.h — the pure half: which entries, in which order, how
// many fit). The row lives inside a status slot of kind SLOT_ALERTS; status_row.c
// owns the slot, resolves the set, runs the fit/spill pass and hands the placed
// entries here.
//
// NOT LINKED ON APLITE: the row is aplite-absent (WW_ALERT_ROW in wscript) — the .c
// body sits behind the macro and compiles to an empty object there. Every call site
// is guarded; these declarations emit nothing.
//
// Each entry is a MINI STATUS SLOT, `[icon][gap][text?]`, in the slot code's own
// highlight vocabulary (status_row.c):
//  - WARN   a rounded-rect OUTLINE in the kind's warn colour. Unconditional here —
//           a slot at warn with no outline colour set shows bold text only, but an
//           icon has no "bold", so the 0x00 no-outline sentinel outlines in the
//           theme foreground instead of vanishing;
//  - DANGER the box FILLED in the kind's danger colour + outline, the glyph
//           re-stroked and the text drawn gcolor_legible_over() the fill;
//  - rain   NO box: the drops drawn FILLED in the radar tier's colour (the look the
//           strip's rain alert always had), the text in the foreground.
// On B&W the escalation is polarity, as in the slots: warn = fg outline, danger =
// fg box with the glyph and text in the background colour.
// Text lanes use the row's font; a metric entry follows its kind's bold ladder
// (status_threshold_is_bold — danger is always bold), the rain text never bolds.

typedef struct StatusAlertsCache StatusAlertsCache;

// Allocate / free a row's glyph cache (up to ALERT_SET_MAX PDCs). create returns
// NULL on OOM; destroy takes NULL. The row creates one only while it holds an
// alerts slot, and destroys it with the row.
StatusAlertsCache *status_alerts_create(void);
void status_alerts_destroy(StatusAlertsCache *cache);

// The rain drops' tint for a radar tier: the radar palette's colour on a colour
// theme, the foreground on B&W (palette_radar_color() hands B&W the strip's own
// background there, which would paint the drops invisibly). Pass it, with
// theme_is_light() as `rain_outline`, to status_alerts_ensure().
GColor status_alerts_rain_tint(int tier);

// Make the cache hold exactly the glyphs `set` needs: load each entry's PDC at
// `target_h` (the row's icon tier; metric icons through status_row_icons_load, the
// rain drops through status_row_icons_load_filled) and EVICT every cached glyph no
// longer in the set — the rain-glyph model: resident only while its alert is up, so
// an idle row holds no heap at all. `fg` (the metric icons' stroke), `rain_tint` and
// `rain_outline` are part of the cache key: a theme or tier change reloads just the
// glyphs it affects. Call before measure/draw on every pass; a steady state is all
// cache hits.
void status_alerts_ensure(StatusAlertsCache *cache, const AlertSet *set,
                          int target_h, bool top_strip, GColor fg,
                          GColor rain_tint, bool rain_outline);

// What the entries' text lanes print and in which font — shared by measure and
// draw, so an entry is always drawn in the font it was measured with.
typedef struct {
    GFont font;             // the row's regular font
    GFont bold;             // its bold companion
    const uint8_t *blob;    // thresholds settings blob: colours + bold modes
    size_t blob_len;
    int rain_display;       // ThreshRainDisplay: none / the minutes / the full text
    bool values;            // print the metric entries' baked values; the lane
                            // ladder (alert_set_degrade) turns it off
    const char *rain_text;  // rain_countdown_format()'s text; NULL when no rain
} StatusAlertsText;

// Width of every entry of `set` into widths_out[0..count-1]: icon + (text ?
// STATUS_ROW_ICON_TEXT_GAP + text : 0), where the text is the entry's lane under
// `text` (a metric value when text->values, the rain minutes or full countdown per
// text->rain_display). 0 for an entry with neither a glyph nor text. Needs the
// glyphs, so status_alerts_ensure() runs first. Feed the widths to alert_set_fit().
void status_alerts_measure(StatusAlertsCache *cache, const AlertSet *set,
                           const StatusAlertsText *text, int16_t *widths_out);

// Where the row paints: absolute coordinates in the row's layer.
typedef struct {
    GRect band;            // the row's band — the highlight boxes clamp to it
    int16_t x;             // left edge of the first entry
    int16_t glyph_cy;      // the digits' cap centre (status_glyph_center_y)
    int16_t text_y;        // top of the text frame (the row's seated text y)
    int16_t content_h;     // the row font's content height (box sizing)
    bool top_strip;        // the strip's box floor (status_highlight_extent)
} StatusAlertsPlace;

// Paint the first `n` entries (alert_set_fit's answer) left to right from place->x,
// STATUS_ROW_GROUP_GAP apart, at the widths status_alerts_measure() returned for
// the same `text` — zero-width entries are skipped with their gap, as
// alert_set_row_w() counts them. Paint-only: no allocation.
void status_alerts_draw(GContext *ctx, StatusAlertsCache *cache, const AlertSet *set,
                        int n, const int16_t *widths, const StatusAlertsText *text,
                        const StatusAlertsPlace *place);
