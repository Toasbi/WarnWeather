#include "quick_view.h"

#if defined(WW_QUICK_VIEW)

static bool s_obstructed;
static int16_t s_full_h;              // full (unobstructed) screen height, cached at subscribe
static void (*s_on_change)(void);

static void notify(void) {
    if (s_on_change) { s_on_change(); }
}

// will_change fires BEFORE the overlay animates, carrying the FINAL unobstructed area.
// A bottom overlay shrinks the height below the full screen; equal height == clear.
// Using the final area sets the end state up front (the SDK-recommended pattern).
static void will_change_handler(GRect final_unobstructed_screen_area, void *context) {
    s_obstructed = (s_full_h > 0) && (final_unobstructed_screen_area.size.h < s_full_h);
    notify();
}

// did_change fires after the animation settles — repaint once more so the final frame
// is correct even if a redraw was coalesced during the transition.
static void did_change_handler(void *context) {
    notify();
}

void quick_view_subscribe(void (*on_change)(void)) {
    s_on_change = on_change;
    s_obstructed = false;
    // layer_get_bounds() is always the full layer bounds (the screen); the overlay only
    // affects layer_get_unobstructed_bounds(). Cache the full height to compare against.
    Window *top = window_stack_get_top_window();
    s_full_h = top ? layer_get_bounds(window_get_root_layer(top)).size.h : 0;
    unobstructed_area_service_subscribe((UnobstructedAreaHandlers) {
        .will_change = will_change_handler,
        .did_change = did_change_handler,
    }, NULL);
}

void quick_view_unsubscribe(void) {
    unobstructed_area_service_unsubscribe();
    s_on_change = NULL;
    s_obstructed = false;
}

bool quick_view_is_obstructed(void) {
    return s_obstructed;
}

#else
// aplite: Timeline Quick View is compiled out (WW_QUICK_VIEW undefined). Keep the
// translation unit non-empty so a -pedantic build never warns on an empty TU.
typedef int quick_view_disabled_on_aplite;
#endif  // WW_QUICK_VIEW
