#pragma once
#include <pebble.h>
#include "../appendix/alert_set.h"

// The Alerts row's SDK half: the glyph cache, per-entry measuring and paint for an
// AlertSet (appendix/alert_set.h — the pure half: which entries, in which order, how
// many fit, which slots they take). The row is a per-bar takeover: while an alert is
// active it replaces the bar's left, middle or right slot (the bar's placement,
// status_row_set_alerts), plus one neighbour when it needs the room. status_row.c
// resolves the set, chooses the slots, runs the fit and hands the placed entries
// here.
//
// NOT LINKED ON APLITE: the row is aplite-absent (WW_ALERT_ROW in wscript) — the .c
// body sits behind the macro and compiles to an empty object there. Every call site
// is guarded; these declarations emit nothing.
//
// Each entry is a MINI STATUS SLOT, `[icon][gap][text?]`, styled like a highlighted
// slot of its kind at the entry's REAL level (alert_set_box) — the alert's own look,
// which the kind's slot 'Alert highlighting' switch does not touch (that switch styles only
// the slot):
//  - WARN   the kind's warn look (status_threshold_box — the slot's own rule):
//           none = no box, the icon alone is the alert; outline = a rounded-rect
//           OUTLINE in the kind's warn colour; fill = the DANGER look below, in
//           the warn colour;
//  - DANGER the box FILLED in the kind's danger colour + outline, the glyph
//           re-stroked and the text drawn gcolor_legible_over() the fill;
//  - rain   NO box: the drops drawn FILLED in the radar tier's colour (the look the
//           strip's rain alert always had), the text in the foreground.
// On B&W the escalation is polarity, as in the slots: an outline is fg, a filled
// box (danger, or a warn look of fill) is fg with the glyph and text in the
// background colour.
// Text lanes use the row's font; a metric value follows its kind's bold ladder at
// the entry's level (status_threshold_is_bold — danger bold, warn per the kind's
// Bold mode, 'Always'), the rain text never bolds.
//
// A boxed entry's footprint INCLUDES its box: STATUS_ALERTS_BOX_PAD_X px each side of
// the icon(+text) group, INSIDE the box — the outline's own pixel plus two of air,
// so the icon never touches the stroke (the owner's ask: padding from the icon to
// the border, not around the box). The widths the fit works on are therefore the
// ink the row paints — no box reaches into a neighbouring slot or past the span.
// Vertically the box is exactly the slots' font-derived extent (no extra rows —
// STATUS_ALERTS_BOX_PAD_Y stays 0 by the owner's call; the hook is kept so a band
// with room could grow it later). Entries sit STATUS_ALERTS_ENTRY_GAP px apart,
// footprint to footprint: two neighbouring boxes keep that much air between their
// strokes.
#define STATUS_ALERTS_BOX_PAD_X 3
#define STATUS_ALERTS_BOX_PAD_Y 0
#define STATUS_ALERTS_ENTRY_GAP 2

typedef struct StatusAlertsCache StatusAlertsCache;

// Allocate / free a row's glyph cache (up to ALERT_SET_MAX PDCs). create returns
// NULL on OOM; destroy takes NULL. The row creates one on the first paint with an
// entry while its bar has a placement, and destroys it when the placement goes Off
// and with the row.
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
// STATUS_ROW_ICON_TEXT_GAP + text : 0), plus 2 * STATUS_ALERTS_BOX_PAD_X for a boxed
// (metric) entry — whose group is measured by its ink (a last icon's one-column
// overhang in, a last text's trailing letter spacing out), so its air to the box
// stroke is equal on both sides — where the text is the entry's lane under
// `text` (a metric value when text->values, the rain minutes or full countdown per
// text->rain_display). 0 for an entry with neither a glyph nor text. Needs the
// glyphs, so status_alerts_ensure() runs first. Feed the widths to alert_set_fit().
void status_alerts_measure(StatusAlertsCache *cache, const AlertSet *set,
                           const StatusAlertsText *text, int16_t *widths_out);

// Where the row paints: absolute coordinates in the row's layer.
typedef struct {
    GRect band;            // the row's band — the highlight boxes clamp to it
    int16_t x;             // left edge of the first entry's footprint
    int16_t glyph_cy;      // the digits' cap centre (status_glyph_center_y)
    int16_t text_y;        // top of the text frame (the row's seated text y)
    int16_t content_h;     // the row font's content height (box sizing)
    bool top_strip;        // the strip's box floor (status_highlight_extent)
} StatusAlertsPlace;

// Paint the first `n` entries (alert_set_fit's answer) left to right from place->x,
// STATUS_ALERTS_ENTRY_GAP apart, at the widths status_alerts_measure() returned for
// the same `text` — zero-width entries are skipped with their gap, as
// alert_set_row_w() counts them. Paint-only: no allocation.
void status_alerts_draw(GContext *ctx, StatusAlertsCache *cache, const AlertSet *set,
                        int n, const int16_t *widths, const StatusAlertsText *text,
                        const StatusAlertsPlace *place);
