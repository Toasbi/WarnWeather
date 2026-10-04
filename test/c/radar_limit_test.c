// Host tests for the radar notice's pure decisions (radar_limit.h,
// header-only): when the notice moves (radar_notice_move, called by
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

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

static void notice_moves(void) {
    // The notice alone stores what arrived (raised, or replaced by another line).
    expect_int("notice.stores", radar_notice_move(false, true), 1);
    // The arrays alone (a window or the clear) end it.
    expect_int("arrays.end", radar_notice_move(true, false), -1);
    // Both in one message (out of coverage: the clear and its notice; a dev
    // fixture's window and notice): the notice wins.
    expect_int("both.notice_wins", radar_notice_move(true, true), 1);
    // Neither (any other message, a partial or short radar payload): unchanged.
    expect_int("neither.leaves", radar_notice_move(false, false), 0);
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
    // The phone's notice beats every no-rain text: the built-in, a custom one, a cleared one.
    const char *limit = "Radar limit reached";
    const char *coverage = "DWD radar: Germany only";
    expect_text("notice.beats_builtin", radar_empty_text(limit, -1, ""), limit);
    expect_text("notice.beats_custom", radar_empty_text(coverage, 9, "Dry skies"), coverage);
    expect_text("notice.beats_cleared", radar_empty_text(limit, 0, ""), limit);
    // No notice: the no-rain rules as before.
    expect_text("norain.custom", radar_empty_text(NULL, 9, "Dry skies"), "Dry skies");
    expect_text("norain.never_set", radar_empty_text(NULL, -1, ""), "You're good :)");
    expect_text("norain.cleared", radar_empty_text(NULL, 0, ""), NULL);
}

int main(void) {
    notice_moves();
    has_view();
    empty_text();
    if (s_failures) {
        printf("radar_limit_test: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("radar_limit_test OK\n");
    return 0;
}
