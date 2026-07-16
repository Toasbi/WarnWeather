// Host tests for health summary snapshot and display-resolution change detection.
#include <stdio.h>

#include "c/services/health_summary.h"

static int s_failures;
static int s_steps;
static int s_sleep;
static int s_hr;
static int s_distance;

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

int health_steps_today(void) { return s_steps; }
int health_sleep_today_seconds(void) { return s_sleep; }
int health_hr_current(void) { return s_hr; }
int health_distance_today_m(void) { return s_distance; }

static void distance_snapshot_uses_unavailable_sentinel_before_refresh(void) {
    expect_int("summary.distance.before_refresh", health_summary_distance_m(), -1);
}

static void distance_changes_only_at_display_resolution(void) {
    s_steps = 1000;
    s_sleep = 3600;
    s_hr = 70;
    s_distance = 1000;
    expect_int("summary.distance.first_changed", health_summary_refresh(), true);
    expect_int("summary.distance.first_value", health_summary_distance_m(), 1000);

    s_distance = 1099;
    expect_int("summary.distance.same_tenth", health_summary_refresh(), false);
    expect_int("summary.distance.same_tenth_value", health_summary_distance_m(), 1099);

    s_distance = 1100;
    expect_int("summary.distance.next_tenth", health_summary_refresh(), true);
    expect_int("summary.distance.next_tenth_value", health_summary_distance_m(), 1100);
}

static void inaccessible_transition_changes_once(void) {
    s_distance = -1;
    expect_int("summary.distance.becomes_inaccessible", health_summary_refresh(), true);
    expect_int("summary.distance.inaccessible_value", health_summary_distance_m(), -1);
    expect_int("summary.distance.stays_inaccessible", health_summary_refresh(), false);
}

int main(void) {
    distance_snapshot_uses_unavailable_sentinel_before_refresh();
    distance_changes_only_at_display_resolution();
    inaccessible_transition_changes_once();
    if (s_failures) {
        printf("%d health_summary failure(s)\n", s_failures);
        return 1;
    }
    printf("health_summary OK\n");
    return 0;
}
