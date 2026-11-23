#include "time_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/theme.h"
#include "c/layers/clock_glyphs.h"
#include "c/layers/clock_ink.h"
#include "c/layers/layer_util.h"
#include "c/services/watch_services.h"

// MT = Margin Top
#define MT_TIME 14
// The per-font vertical nudges that used to live here (MT_TIME_ROBOTO / _LECO / _BITHAM, all 2,
// applied on emery only) are gone. They were hand-measured versions of the same quantity
// windows/layout.c now takes as a parameter — layers/clock_ink.h's centre_off, measured for all
// six screen x font combinations rather than three on one platform. Leaving them here would
// apply the correction twice on emery; and applying it on emery alone was the omission that left
// the 144px watches' Leco and Bitham clocks off-centre in the first place.
//
// Nothing else about the seating below changed: this layer still centres its text inside
// whatever band it is handed, and the solver moves the band.
//
// The AM/PM label's two hand-tuned constants went the same way (MT_AM_PM 7, plus MT_AM_PM_LECO,
// a +2 emery/Leco nudge). Both were guesses at ONE thing — where the digits' first inked row
// falls — from a font-independent offset into the digits' line box, which is why they needed a
// per-platform, per-font exception and still left the label riding above the numerals on the
// other five combinations. That row is now read off the same measured ClockInk pair the band
// solver uses (clock_ink_top_in_band), and the label's own blank leading off the measured Gothic
// model in status_metrics.h (status_ink_top) — so the two ink tops meet by construction, on
// every font, band and platform, with nothing left to tune.
//
// Re-verify the same way clock_ink.h's table is re-verified, so this is a re-run and not an
// eyeball: fixtures/ampm-{roboto,leco,bitham}.json are the three faces in 12h with the label on
// at the WIDEST string ("12:34 PM", the one that fills the band), and ampm-roboto-941.json is
// the 4-glyph string the default leading-zero-off setting actually shows most of the day. Shoot
// with PLATFORMS="basalt emery" scripts/capture-screenshots.sh <label> <fixture> and row-scan
// the clock band: the label's first inked row must equal the digits' first inked row. MEASURED
// 2026-08-26, 8 of 8 combinations, all exact bar 144px Bitham on a digit set with no 0 and no 8
// — which is the ink-table caveat recorded in clock_ink.h, not this seating.

// The AM/PM label's font, the size that has to be kept in step with it, and the one number that
// genuinely follows.
//
// Nothing in C links a font key to its size — FONT_KEY_GOTHIC_18 is a resource name, not a
// number — so AM_PM_CONTENT_H is that 18 TRANSCRIBED BY HAND, and changing the face means
// changing both lines. Get it wrong and nothing complains: the build stays green, the label is
// seated by a leading measured for the wrong size, and the frame below is the wrong height, so
// the caps are mis-seated AND clipped. Only the emulator row-scan described above catches it.
//
// AM_PM_INK_TOP is the one that does follow. Gothic's measured content height is exactly its
// nominal size (verified on device at 14/18/24 — see status_content_h in layer_util.h), and
// status_ink_top() gives the blank rows such a line leaves above its capitals: 7 at Gothic 18.
// It is written as an expression rather than a literal and constant-folds because its argument
// is one — the same shape as layout_aplite.c's STATUS_LARGE_BAND_H, and for the same reason:
// aplite compiles this file, and its image is measured against a hard launch ceiling on every
// build (scripts/check-aplite-size.sh).
//
// It is not a coincidence that AM_PM_INK_TOP comes out at 7, the value the retired hand-tuned
// MT_AM_PM carried: that constant was measuring this same blank leading. What it got wrong was
// the row it counted from — the digits' line-box top rather than their ink.
#define AM_PM_FONT_KEY FONT_KEY_GOTHIC_18
#define AM_PM_CONTENT_H 18
#define AM_PM_INK_TOP status_ink_top(AM_PM_CONTENT_H)

// The label's box width, and it is LOAD-BEARING that this is a fixed number wider than the text
// rather than the measured width. The box is what time_layer_tick measures the
// string against, and the string changes under it at noon and midnight — "AM" is a pixel or two
// wider than "PM" — so a box sized to the previous string could make the next measurement wrap
// or ellipsize. 30 px clears either string in Gothic 18 on every platform; the surplus is empty
// because the text is left-aligned, and it clips harmlessly at the band edge. Only the MEASURED
// width (am_pm_text_w) is ever used to place anything.
#define AM_PM_BOX_W 30

// Air asked for between the digits and the label, ON TOP of the right side bearing the digits'
// advance box already carries. That bearing is what makes the gap look inconsistent today, and
// it is not a per-font constant — it belongs to whichever digit lands last. MEASURED, last
// digit "4": 0 px on Bitham, 1-2 px on Roboto, 3-4 px on Leco; last digit "1", whose narrow
// glyph sits in a full tabular advance: 10 px on 144px Roboto, 13 px on emery. So this is a
// FLOOR under the crowded end, not a way to make every face agree — nothing short of an ink
// bbox, which the SDK does not offer, could do that.
//
// It is spent out of leftover margin only (clock_label_x), so it never moves the clock: on the
// widest 12-hour string the roomier faces have no margin to give and simply keep the bearing
// they already had.
#define AM_PM_GAP 4


static Layer *s_container_layer;
static char s_time_text[8];
// What the container draws (container_update), set by time_layer_refresh (the font) and
// time_layer_tick (the text and the boxes), in the band's coordinates:
static GFont s_time_font;          // the digits' font, where they draw as text
static GRect s_time_box;           // the digits' box, where they draw as text
static const char *s_am_pm_text;   // the label, "AM" or "PM"; NULL while it is off
static GRect s_am_pm_box;          // the label's box

#if defined(PBL_COLOR)
// The anti-aliased digits (clock_glyphs.h), for the faces that have them. LECO draws as text.
// Which of the two renders depends only on the font, so time_layer_refresh() picks it; the
// tick seats the glyphs at s_glyph_origin.
static bool s_glyphs;            // true: the digits draw as glyphs, else as text
static GPoint s_glyph_origin;    // pen x of the first digit, and the digits' first inked row
#endif

// The clock draws in the container itself, which IS the band: main_window re-frames it per
// view, and it clips to it. The digits first (the glyphs, or the text in the active time font),
// then the AM/PM label over them, each in the ink the theme gives it at this draw. The text
// draws as a TextLayer would draw it: in its box, left-aligned, with a trailing ellipsis.
static void container_update(Layer *layer, GContext *ctx) {
    (void) layer;
    const GColor time_ink = theme_pick(config_get()->color_time, theme_fg());
#if defined(PBL_COLOR)
    if (s_glyphs) {
        clock_glyphs_draw(ctx, config_get()->time_font, s_time_text, s_glyph_origin, time_ink);
    } else
#endif
    {
        graphics_context_set_text_color(ctx, time_ink);
        graphics_draw_text(ctx, s_time_text, s_time_font, s_time_box,
                           GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    }
    if (s_am_pm_text) {
        graphics_context_set_text_color(ctx, theme_fg());
        graphics_draw_text(ctx, s_am_pm_text, fonts_get_system_font(AM_PM_FONT_KEY), s_am_pm_box,
                           GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    }
}

// The size `text` takes in `font` in a box of `w` x `h`, laid out as the clock draws it.
static GSize text_size(const char *text, GFont font, int w, int h) {
    return graphics_text_layout_get_content_size(text, font, GRect(0, 0, w, h),
                                                 GTextOverflowModeTrailingEllipsis,
                                                 GTextAlignmentLeft);
}

// The active time font's measured ink — where its digits sit inside their line box, which is
// what both the band solver and the AM/PM label are seated against.
static ClockInk time_layer_ink(void) {
#if defined(WW_CLOCK_INK)
    return clock_ink_for(config_get()->time_font);
#else
    // aplite links no ink table (WW_CLOCK_INK, see wscript), so it answers with the Roboto row
    // of clock_ink.c's 144px arm inlined as a literal: its default font, and the one every
    // anchor on that platform is already tuned to. Its other two fonts want -15 (leco) and -17
    // (bitham) for centre_off - ink_h/2 against Roboto's -17, so the label lands within 2 rows
    // on those — the same Roboto-tuned trade layout_aplite.c makes for the clock band itself.
    return (ClockInk){ 0, 35 };
#endif
}

void time_layer_create(Layer* parent_layer, GRect frame) {
    s_container_layer = layer_create(frame);
    layer_set_update_proc(s_container_layer, container_update);
    layer_add_child(parent_layer, s_container_layer);
    MEMORY_LOG_HEAP("after_time_layer_create");
}

Layer *time_layer_get_root(void) {
    return s_container_layer;
}

void time_layer_tick() {
    struct tm tick_time = watch_services_localtime();

    config_format_time(s_time_text, sizeof(s_time_text), &tick_time);

    const bool show_am_pm = config_get()->show_am_pm;
    s_am_pm_text = show_am_pm ? (tick_time.tm_hour < 12 ? "AM" : "PM") : NULL;

    GRect bounds = layer_get_bounds(s_container_layer);
    // The label is measured in its own box (AM_PM_BOX_W), never in the band.
    const int am_pm_text_w = show_am_pm
        ? text_size(s_am_pm_text, fonts_get_system_font(AM_PM_FONT_KEY),
                    AM_PM_BOX_W, AM_PM_CONTENT_H).w
        : 0;
    int text_left, digits_w;

#if defined(PBL_COLOR)
    if (s_glyphs) {
        // The glyphs carry their own metrics, so the digits are seated from the model directly:
        // the pen advance centres them exactly as the text's content width does below, and
        // the first inked row is the one the band solver was given (clock_ink_for reports these
        // faces' ink_h from the same glyphs), so the band's centring holds with no line box in
        // between to measure.
        digits_w = clock_glyphs_width(config_get()->time_font, s_time_text);
        text_left = clock_seat_x(bounds.size.w, digits_w, am_pm_text_w);
        s_glyph_origin = GPoint(text_left, clock_ink_top_in_band(bounds.size.h, time_layer_ink()));
    } else
#endif
    {
        const GSize time_size = text_size(s_time_text, s_time_font, bounds.size.w, bounds.size.h);
        digits_w = time_size.w;

        int text_h = time_size.h - MT_TIME; // Remove top margin, approximately
        int text_top = -MT_TIME + (bounds.size.h/2 - text_h/2);
        // The DIGITS carry the centring; the label rides in the margin left over beside them and
        // pushes the clock aside only when it would otherwise run off the band (clock_seat_x).
        text_left = clock_seat_x(bounds.size.w, digits_w, am_pm_text_w);

        // Height spans from text_top down to the band's bottom rather than time_size.h: the
        // measured content size is a LINE box, and a content-sized box has clipped the bottom
        // few px of round digits on the larger faces before. These are descenderless numeric
        // fonts and the band clips them, so extending the box downward only reclaims the
        // clipped glyph bottoms. The width runs to the band's right edge for the same reason, in
        // the other axis — the text is left-aligned, so the surplus costs nothing, and nothing
        // depends on this box ending at the digits.
        s_time_box = GRect(text_left, text_top, bounds.size.w - text_left, bounds.size.h - text_top);
    }
    if (show_am_pm) {
        // Seat the label's ink on the digits' ink: clock_label_seat_y takes the digits' first
        // inked row from the measured ClockInk pair, and backs off the label's own blank
        // leading. Nothing per-font or per-platform of its own — both halves are read from
        // models that already had to be right for the clock band and the status rows.
        int am_pm_y = clock_label_seat_y(bounds.size.h, time_layer_ink(), AM_PM_INK_TOP);
        int am_pm_x = clock_label_x(bounds.size.w, text_left + digits_w, AM_PM_GAP,
                                    am_pm_text_w);
        s_am_pm_box = GRect(am_pm_x, am_pm_y, AM_PM_BOX_W, AM_PM_CONTENT_H);
    }
    layer_mark_dirty(s_container_layer);
}

void time_layer_refresh() {
    s_time_font = config_time_font();
#if defined(PBL_COLOR)
    // Every font change arrives here (main_window_refresh) before the next redraw.
    s_glyphs = clock_glyphs_face(config_get()->time_font);
#endif
    time_layer_tick();  // Update the time text and the boxes
}

void time_layer_destroy() {
    MEMORY_LOG_HEAP("time_layer_destroy:before");
    layer_destroy(s_container_layer);
    MEMORY_LOG_HEAP("time_layer_destroy:after");
}
