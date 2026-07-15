#include "quick_view.h"

#if defined(WW_QUICK_VIEW)

static void (*s_on_change)(void);

// The service only needs to TRIGGER a re-render when the overlay appears or retracts; the
// render path itself reads the live unobstructed bounds (quick_view_unobstructed_bounds)
// to decide the peek, so there is no obstruction state to cache here. Both handlers just
// notify. did_change fires after the animation settles (with the bounds updated); will_change
// fires before it, so notifying on both keeps the view responsive at either edge.
static void notify(void) {
    if (s_on_change) { s_on_change(); }
}

static void will_change_handler(GRect final_unobstructed_screen_area, void *context) {
    (void)final_unobstructed_screen_area;
    (void)context;
    notify();
}

static void did_change_handler(void *context) {
    (void)context;
    notify();
}

void quick_view_subscribe(void (*on_change)(void)) {
    s_on_change = on_change;
    unobstructed_area_service_subscribe((UnobstructedAreaHandlers) {
        .will_change = will_change_handler,
        .did_change = did_change_handler,
    }, NULL);
}

void quick_view_unsubscribe(void) {
    unobstructed_area_service_unsubscribe();
    s_on_change = NULL;
}

GRect quick_view_unobstructed_bounds(Layer *root) {
    return layer_get_unobstructed_bounds(root);
}

#else
// aplite: Timeline Quick View is compiled out (WW_QUICK_VIEW undefined). Keep the
// translation unit non-empty so a -pedantic build never warns on an empty TU.
typedef int quick_view_disabled_on_aplite;
#endif  // WW_QUICK_VIEW
