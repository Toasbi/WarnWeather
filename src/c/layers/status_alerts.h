#pragma once
#include <pebble.h>
#include "../appendix/alert_set.h"
#include "../appendix/rain_countdown.h"   // RAIN_COUNTDOWN_TEXT_CAP

// The alert row's SDK half: resolving the entries, the glyph cache, the takeover,
// per-entry measuring and paint for an AlertSet (appendix/alert_set.h — the pure
// half: which entries, in which order, how many fit, which slots they take). The row
// is a per-bar takeover: while an alert is active it replaces the bar's left, middle
// or right slot (the bar's placement, which status_row.c reads from the thresholds
// blob), plus one neighbour when it needs the room. status_row.c makes three calls —
// status_alerts_fold() on every refresh, status_alerts_layout() and
// status_alerts_paint() on every draw — and everything in between happens here.
//
// NOT LINKED ON APLITE: the row is aplite-absent (WW_ALERT_ROW in wscript) — the .c
// body sits behind the macro and compiles to an empty object there. Its one caller,
// status_row.c, is never compiled on aplite (wscript builds status_row_aplite.c
// instead); these declarations emit nothing.
//
// Each entry is a MINI STATUS SLOT, `[icon][gap][text?]`, styled like a highlighted
// slot of its kind at the entry's REAL level (status_threshold_look) — the alert's own
// look, which the kind's slot 'Alert highlighting' switch does not touch (that switch
// styles only the slot):
//  - WARN   the kind's warn look (the slot's own rule):
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
// the entry's level (the look's bold bit — danger bold, warn per the kind's Bold
// mode, 'Always'), the rain text never bolds. A TOMORROW entry is the same mini slot
// at tomorrow's level, its text lane carrying the alert's mark around the value
// ("»8", "8*" — alert_set_lane): the mark alone with the Icon look, and it outlasts
// the lane ladder's values-off step, so a tomorrow alert never reads as today's.
//
// A boxed entry's footprint INCLUDES its box: STATUS_ALERTS_BOX_PAD_X px each side of
// the icon(+text) group, INSIDE the box — the outline's own pixel plus two of air,
// so the icon never touches the stroke (the owner's ask: padding from the icon to
// the border, not around the box). The widths the fit works on are therefore the
// ink the row paints — no box reaches into a neighbouring slot or past the span.
// Vertically the box is exactly the slots' font-derived extent
// (status_highlight_extent), no extra rows. Entries sit STATUS_ALERTS_ENTRY_GAP px
// apart, footprint to footprint: two neighbouring boxes keep that much air between
// their strokes.
#define STATUS_ALERTS_BOX_PAD_X 3
#define STATUS_ALERTS_ENTRY_GAP 2

typedef struct StatusAlertsCache StatusAlertsCache;

// A status row's alert row, embedded in the row.
typedef struct {
    // The glyph cache (up to ALERT_SET_MAX PDCs): created by the first draw that has an
    // entry to show, freed by status_alerts_release() — the row calls it when a refresh
    // finds the placement Off, and with the row. Its glyphs come and go with their
    // alerts, so an idle alert row keeps only the cache struct.
    StatusAlertsCache *cache;
    uint8_t place;   // ThreshAlertsPlace, which the row derives on every refresh
} StatusAlertsRow;

// Free the row's glyph cache and every glyph it holds (NULL-safe); the next draw
// with an entry creates a new one.
void status_alerts_release(StatusAlertsRow *row);

// Refresh-time: fold everything the row paints into the row's content signature, so
// a changed set is a content change — which entries, their levels, days (today's, or
// tomorrow's with its mark) and baked values, the look each one reads from `blob`
// (the thresholds settings blob, already judged: len 0 = none) at its level, the rain
// look, the drop's bucket and tier, and the countdown text while a look prints it.
// Folds nothing while the placement is Off.
// The rain entry is re-derived from the radar cache on every call (O(1), flash-free),
// which is why a row whose placement is not Off is refreshed on the minute tick.
uint16_t status_alerts_fold(const StatusAlertsRow *row, uint16_t sig,
                            const uint8_t *blob, size_t len);

// What the entries' text lanes print and in which font — shared by measure and
// paint, so an entry is always drawn in the font it was measured with.
typedef struct {
    GFont font;             // the row's regular font
    GFont bold;             // its bold companion
    const uint8_t *blob;    // thresholds settings blob: colours + bold modes
    size_t blob_len;
    int rain_display;       // ThreshRainDisplay: none / the minutes / the full text
    bool values;            // print the metric entries' baked values; the lane
                            // ladder (alert_set_degrade) turns it off — tomorrow's
                            // marks stay
    const char *rain_text;  // rain_countdown_format()'s text; NULL when no rain
} StatusAlertsText;

// The entries resolved for one pass: the metric alerts from the stored tuple, the
// watch-resolved rain entry in front. The metric entries' values point into `bytes`,
// so the set lives exactly as long as the struct.
typedef struct {
    uint8_t bytes[ALERT_ENTRIES_MAX_BYTES];    // the stored ALERT_ENTRIES tuple
    AlertSet set;
    char rain_text[RAIN_COUNTDOWN_TEXT_CAP];   // countdown text; "" = no rain entry
    int rain_display;                          // ThreshRainDisplay, from the blob
} StatusAlertsEntries;

// One entry's measured parts, kept beside its footprint so the paint places the
// entry from the numbers the fit judged instead of working them back out of it.
typedef struct {
    int16_t icon_w;   // the glyph's bounds width; 0 = no glyph
    int16_t text_w;   // the lane's measured width; 0 = no text
    uint8_t pad;      // air each side inside the box: STATUS_ALERTS_BOX_PAD_X, rain 0
} StatusAlertsCell;

// The alert row's share of one draw, on the caller's stack: status_alerts_layout()
// fills it, status_alerts_paint() reads it. Only status_alerts.c reads the fields.
typedef struct {
    StatusAlertsEntries r;
    StatusAlertsText text;             // the lanes after the ladder
    int16_t widths[ALERT_SET_MAX];     // each entry's footprint at those lanes
    StatusAlertsCell cells[ALERT_SET_MAX];   // and the parts it was summed from
    int n;                             // entries that fit (alert_set_fit); 0 = none
    int16_t x;                         // left edge of the row inside the content
} StatusAlertsPass;

// What the row hands the layout and the paint: its fonts, icon tier and geometry, in
// absolute coordinates in the row's layer.
typedef struct {
    GFont font;             // the row's regular font
    GFont bold;             // its bold companion
    const uint8_t *blob;    // thresholds settings blob, already judged (len 0 = none)
    size_t blob_len;
    GRect band;             // the row's band — the highlight boxes clamp to it
    int16_t x;              // left edge of the row's content (the slots' origin)
    int16_t glyph_cy;       // the digits' cap centre (status_glyph_center_y)
    int16_t text_y;         // top of the text frame (the row's seated text y)
    int16_t content_h;      // the row font's content height (box sizing)
    int16_t icon_h;         // the row's icon tier: the slot glyphs' target height
    bool top_strip;         // the strip's glyph set and box floor
    bool battery;           // the low-battery warning holds the right slot
} StatusAlertsEnv;

// Draw-time, before any paint: lay the bar's three slots out into `places`, with the
// takeover (spec 4.1) while the placement is not Off, an alert is active and at least
// one entry fits — otherwise exactly status_row_layout(content_w, m, places), so a
// row without alerts lays out as it would without the feature. Fills `pass` for
// status_alerts_paint(), and keeps the glyph cache holding exactly the glyphs the
// entries need (created on the first draw with an entry, evicting what the set no
// longer holds, so an idle row holds no glyph heap).
void status_alerts_layout(StatusAlertsRow *row, StatusAlertsPass *pass,
                          const StatusAlertsEnv *env, const StatusSlotMeasure m[3],
                          StatusSlotPlace places[3], int16_t content_w);

// Paint the entries status_alerts_layout() fitted, left to right from the row's
// place in the content, STATUS_ALERTS_ENTRY_GAP apart; nothing when none fit. Call it
// after the slots' highlight boxes and before their content, so the z-order is boxes,
// entries, content. Paint-only: no allocation.
void status_alerts_paint(GContext *ctx, const StatusAlertsRow *row,
                         const StatusAlertsPass *pass, const StatusAlertsEnv *env);
