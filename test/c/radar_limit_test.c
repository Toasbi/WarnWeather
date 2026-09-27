// Host tests for the radar limit notice's pure decisions (radar_limit.h,
// header-only): when the flag moves (radar_limited_after, called by
// app_message.c's handle_rain_radar), whether the radar has anything to show
// (radar_has_view, called by main_window.c's main_window_radar_has_data and
// rain_radar_layer.c's empty-state gate) and what the radar's empty state then
// says (radar_empty_text, called by radar_update_proc). No caller can be
// host-compiled, so these pins are the executable check.
#include <stdio.h>
#include <string.h>

#include "c/appendix/radar_limit.h"

static int s_failures = 0;

static void expect_bool(const char *name, bool got, bool want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, (int) got, (int) want);
        s_failures++;
    }
}

static void expect_text(const char *name, const char *got, const char *want) {
    if (got == NULL || want == NULL) {
        if (got != want) {
            printf("FAIL %s: got %s want %s\n", name, got ? got : "NULL", want ? want : "NULL");
            s_failures++;
        }
        return;
    }
    if (strcmp(got, want) != 0) {
        printf("FAIL %s: got \"%s\" want \"%s\"\n", name, got, want);
        s_failures++;
    }
}

static void flag_moves(void) {
    // The notice alone raises it, whatever it was.
    expect_bool("notice.raises", radar_limited_after(false, true, false), true);
    expect_bool("notice.keeps", radar_limited_after(false, true, true), true);
    // The arrays alone (a window or the clear) end it.
    expect_bool("arrays.end", radar_limited_after(true, false, true), false);
    expect_bool("arrays.stay_down", radar_limited_after(true, false, false), false);
    // Both in one message (only a dev fixture sends that): the notice wins.
    expect_bool("both.notice_wins", radar_limited_after(true, true, false), true);
    expect_bool("both.notice_wins_up", radar_limited_after(true, true, true), true);
    // Neither (any other message, a partial or short radar payload): unchanged.
    expect_bool("neither.keeps_up", radar_limited_after(false, false, true), true);
    expect_bool("neither.keeps_down", radar_limited_after(false, false, false), false);
}

static void has_view(void) {
    // A stored window shows, limited or not.
    expect_bool("view.window", radar_has_view(true, false), true);
    expect_bool("view.window_limited", radar_has_view(true, true), true);
    // The notice alone shows too: a limit hit before any window arrived (a fresh
    // install, or right after a clear) must not leave the radar silently absent.
    expect_bool("view.notice_without_window", radar_has_view(false, true), true);
    // Neither: no radar (the view resolves it away, no empty-state line).
    expect_bool("view.nothing", radar_has_view(false, false), false);
}

static void empty_text(void) {
    // The notice beats every no-rain text: the built-in, a custom one, a cleared one.
    expect_text("limited.beats_builtin", radar_empty_text(true, -1, ""), "Radar limit reached");
    expect_text("limited.beats_custom", radar_empty_text(true, 9, "Dry skies"), "Radar limit reached");
    expect_text("limited.beats_cleared", radar_empty_text(true, 0, ""), "Radar limit reached");
    // Not limited: the no-rain rules as before.
    expect_text("norain.custom", radar_empty_text(false, 9, "Dry skies"), "Dry skies");
    expect_text("norain.never_set", radar_empty_text(false, -1, ""), "You're good :)");
    expect_text("norain.cleared", radar_empty_text(false, 0, ""), NULL);
    // No longer than the longest custom line (24 bytes) the empty-state box is sized for.
    expect_bool("limited.fits_budget", strlen(RADAR_LIMIT_TEXT) <= 24, true);
}

int main(void) {
    flag_moves();
    has_view();
    empty_text();
    if (s_failures) {
        printf("radar_limit_test: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("radar_limit_test OK\n");
    return 0;
}
