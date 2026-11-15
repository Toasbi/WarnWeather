// Host test for src/c/services/quick_view.c: a Timeline Quick View show or hide re-renders
// the face once, after the overlay has settled (did_change). Nothing renders at will_change,
// where the firmware still reports the start area, so a render there only repeated the view
// already on screen. The firmware's event order is faked below: will_change, one change per
// animation frame, did_change.
#include <stdio.h>
#include <string.h>

#include "c/services/quick_view.h"

static int s_failures;
static void expect_int(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

// --- Fake UnobstructedArea service --------------------------------------------
static UnobstructedAreaHandlers s_handlers;

void unobstructed_area_service_subscribe(UnobstructedAreaHandlers handlers, void *context) {
    (void) context;
    s_handlers = handlers;
}
void unobstructed_area_service_unsubscribe(void) { memset(&s_handlers, 0, sizeof s_handlers); }
GRect layer_get_unobstructed_bounds(const Layer *layer) {
    (void) layer;
    return GRect(0, 0, 144, 168);
}

static int s_renders;
static void count_render(void) { s_renders++; }

// One overlay animation as the firmware delivers it to a subscriber.
static void animate(GRect final_area, int frames) {
    if (s_handlers.will_change) { s_handlers.will_change(final_area, NULL); }
    for (int i = 1; i <= frames; i++) {
        if (s_handlers.change) {
            s_handlers.change((AnimationProgress) (ANIMATION_NORMALIZED_MAX * i / frames), NULL);
        }
    }
    if (s_handlers.did_change) { s_handlers.did_change(NULL); }
}

int main(void) {
    quick_view_subscribe(count_render);
    animate(GRect(0, 0, 144, 117), 8);   // the overlay appears
    expect_int("show.one_render", s_renders, 1);
    animate(GRect(0, 0, 144, 168), 8);   // and retracts
    expect_int("hide.one_render", s_renders, 2);

    quick_view_unsubscribe();
    animate(GRect(0, 0, 144, 117), 8);
    expect_int("unsubscribed.no_render", s_renders, 2);

    if (s_failures) { printf("%d quick_view failure(s)\n", s_failures); return 1; }
    printf("quick_view OK\n");
    return 0;
}
