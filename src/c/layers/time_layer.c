#include "time_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/theme.h"
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
// rather than the measured width. The box is what text_layer_get_content_size() measures the
// string against, and the string changes under it at noon and midnight — "AM" is a pixel or two
// wider than "PM" — so a box sized to the previous string could make the next measurement wrap
// or ellipsize. 30 px clears either string in Gothic 18 on every platform; the surplus is empty
// because the text is left-aligned, and it clips harmlessly at the band edge. Only the MEASURED
// width (am_pm_size.w) is ever used to place anything.
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
static TextLayer *s_time_layer;
static TextLayer *s_am_pm_layer;

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
    s_time_layer = text_layer_create(GRect(0, 0, frame.size.w, frame.size.h));
    s_am_pm_layer = text_layer_create(GRect(0, 0, AM_PM_BOX_W, frame.size.h));

    // Main time formatting
    text_layer_set_background_color(s_time_layer, GColorClear);
    text_layer_set_text(s_time_layer, "00:00");
    text_layer_set_text_alignment(s_time_layer, GTextAlignmentLeft);

    // AM/PM formatting
    text_layer_set_font(s_am_pm_layer, fonts_get_system_font(AM_PM_FONT_KEY));
    text_layer_set_background_color(s_am_pm_layer, GColorClear);
    text_layer_set_text_color(s_am_pm_layer, theme_fg());
    text_layer_set_text(s_am_pm_layer, "PM");
    text_layer_set_text_alignment(s_am_pm_layer, GTextAlignmentLeft);

    // Both text layers are children of the CONTAINER, i.e. siblings. The label used to hang off
    // the digits' layer, which forced that frame to be grown to contain it and made the
    // digits-plus-label width the thing that got centred — the lean this change removes. Both of
    // the label's seats are BAND-relative now (clock_label_seat_y / clock_label_x), so as
    // siblings each layer is placed in exactly the coordinate system its seat is computed in;
    // as a child, every tick would have to subtract the digits' own origin back out again.
    // Not a clipping question either way: the digits' frame runs to the band's right edge and
    // bottom (see time_layer_tick), so it would contain the label's ink whichever way round.
    layer_add_child(s_container_layer, text_layer_get_layer(s_time_layer));
    layer_add_child(s_container_layer, text_layer_get_layer(s_am_pm_layer));
    layer_add_child(parent_layer, s_container_layer);
    MEMORY_LOG_HEAP("after_time_layer_create");

}

Layer *time_layer_get_root(void) {
    return s_container_layer;
}

void time_layer_tick() {
    struct tm tick_time = watch_services_localtime();

    static char s_buffer[8];
    config_format_time(s_buffer, sizeof(s_buffer), &tick_time);

    bool show_am_pm = config_get()->show_am_pm;
    text_layer_set_text(s_time_layer, s_buffer);
    if (show_am_pm)
        text_layer_set_text(s_am_pm_layer, tick_time.tm_hour < 12 ? "AM" : "PM");

    GRect bounds = layer_get_bounds(s_container_layer);
    text_layer_move_frame(s_time_layer, GRect(0, 0, bounds.size.w, bounds.size.h)); // Reset for size calculation
    GSize time_size = text_layer_get_content_size(s_time_layer);
    GSize am_pm_size = text_layer_get_content_size(s_am_pm_layer);

    int text_h = time_size.h - MT_TIME; // Remove top margin, approximately
    int text_top = -MT_TIME + (bounds.size.h/2 - text_h/2);
    // The DIGITS carry the centring; the label rides in the margin left over beside them and
    // pushes the clock aside only when it would otherwise run off the band (clock_seat_x).
    int text_left = clock_seat_x(bounds.size.w, time_size.w, show_am_pm ? am_pm_size.w : 0);

    // Update layer positions and visibility. Height spans from text_top down to the
    // container bottom rather than time_size.h: text_layer_get_content_size() under-reports
    // the line box of the enlarged custom TTF fonts (e.g. ~58px for the size-58 Montserrat
    // whose real ascent+descent is ~68px), so a content-sized frame clips the bottom few px
    // of round digits. These are descenderless numeric fonts and the container clips us, so
    // extending the frame downward only reclaims the clipped glyph bottoms. The width runs to
    // the band's right edge for the same reason, in the other axis — the text is left-aligned,
    // so the surplus costs nothing, and nothing depends on this frame ending at the digits.
    text_layer_move_frame(s_time_layer, GRect(text_left, text_top,
                                              bounds.size.w - text_left, bounds.size.h - text_top));
    if (show_am_pm) {
        // Seat the label's ink on the digits' ink: clock_label_seat_y takes the digits' first
        // inked row from the measured ClockInk pair, and backs off the label's own blank
        // leading. Nothing per-font or per-platform of its own — both halves are read from
        // models that already had to be right for the clock band and the status rows.
        int am_pm_y = clock_label_seat_y(bounds.size.h, time_layer_ink(), AM_PM_INK_TOP);
        int am_pm_x = clock_label_x(bounds.size.w, text_left + time_size.w, AM_PM_GAP,
                                    am_pm_size.w);
        text_layer_move_frame(s_am_pm_layer,
                              GRect(am_pm_x, am_pm_y, AM_PM_BOX_W, AM_PM_CONTENT_H));
    }
    layer_set_hidden(text_layer_get_layer(s_am_pm_layer), !show_am_pm);
}

void time_layer_refresh() {
    text_layer_set_font(s_time_layer, config_time_font());
    text_layer_set_text_color(s_time_layer, theme_pick(config_get()->color_time, theme_fg()));
    text_layer_set_text_color(s_am_pm_layer, theme_fg());  // re-apply: create-time value goes stale on a live theme flip
    time_layer_tick();  // Update main time text and layer positions
}

void time_layer_destroy() {
    MEMORY_LOG_HEAP("time_layer_destroy:before");
    text_layer_destroy(s_am_pm_layer);
    text_layer_destroy(s_time_layer);
    layer_destroy(s_container_layer);
    MEMORY_LOG_HEAP("time_layer_destroy:after");
}
