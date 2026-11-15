#include "quick_view.h"

#if defined(WW_QUICK_VIEW)

static void (*s_on_change)(void);

// The service only needs to TRIGGER a re-render once the overlay has appeared or
// retracted; the render path itself reads the live unobstructed bounds
// (quick_view_unobstructed_bounds) to decide the peek, so there is no obstruction state to
// cache here. did_change fires after the animation settles, with the bounds at their final
// area, and the firmware calls it whether or not a will_change handler is set. There is no
// will_change handler on purpose: the firmware sets the bounds from each event's current
// position, which for will_change is still the start, so a re-render there laid out the
// view already on screen, a whole render and refresh for nothing on every show and hide.
static void did_change_handler(void *context) {
    (void)context;
    if (s_on_change) { s_on_change(); }
}

void quick_view_subscribe(void (*on_change)(void)) {
    s_on_change = on_change;
    unobstructed_area_service_subscribe((UnobstructedAreaHandlers) {
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
