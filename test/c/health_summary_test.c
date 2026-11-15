// Host tests for health summary snapshot and display-resolution change detection,
// and for which HealthService reads a refresh makes: only the readings asked for, and
// sleep at most every HEALTH_SUMMARY_SLEEP_PERIOD_S.
#include <stdio.h>

#include "c/services/health_summary.h"

static int s_failures;
static int s_steps;
static int s_sleep;
static int s_hr;
static int s_distance;
// Reads per accessor: each one is a HealthService read on the watch.
static int s_steps_reads;
static int s_sleep_reads;
static int s_hr_reads;
static int s_distance_reads;

#define ALL (HEALTH_SUMMARY_STEPS | HEALTH_SUMMARY_DISTANCE | HEALTH_SUMMARY_SLEEP \
             | HEALTH_SUMMARY_HR)

static void expect_int(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

int health_steps_today(void) { s_steps_reads++; return s_steps; }
int health_sleep_today_seconds(void) { s_sleep_reads++; return s_sleep; }
int health_hr_current(void) { s_hr_reads++; return s_hr; }
int health_distance_today_m(void) { s_distance_reads++; return s_distance; }

static void reset_reads(void) {
    s_steps_reads = 0;
    s_sleep_reads = 0;
    s_hr_reads = 0;
    s_distance_reads = 0;
}

// A clock that moves a sleep period on between calls, so the sleep read is always due
// unless a test holds it still.
static time_t s_now = 1700000000;
static time_t later(void) { s_now += HEALTH_SUMMARY_SLEEP_PERIOD_S; return s_now; }

static void distance_snapshot_uses_unavailable_sentinel_before_refresh(void) {
    expect_int("summary.distance.before_refresh", health_summary_distance_m(), -1);
}

static void distance_changes_only_at_display_resolution(void) {
    s_steps = 1000;
    s_sleep = 3600;
    s_hr = 70;
    s_distance = 1000;
    expect_int("summary.distance.first_changed", health_summary_refresh(ALL, later()), true);
    expect_int("summary.distance.first_value", health_summary_distance_m(), 1000);

    s_distance = 1099;
    expect_int("summary.distance.same_tenth", health_summary_refresh(ALL, later()), false);
    expect_int("summary.distance.same_tenth_value", health_summary_distance_m(), 1099);

    s_distance = 1100;
    expect_int("summary.distance.next_tenth", health_summary_refresh(ALL, later()), true);
    expect_int("summary.distance.next_tenth_value", health_summary_distance_m(), 1100);
}

static void inaccessible_transition_changes_once(void) {
    s_distance = -1;
    expect_int("summary.distance.becomes_inaccessible", health_summary_refresh(ALL, later()), true);
    expect_int("summary.distance.inaccessible_value", health_summary_distance_m(), -1);
    expect_int("summary.distance.stays_inaccessible", health_summary_refresh(ALL, later()), false);
}

// A refresh reads exactly the readings it is asked for: a steps-only row costs one
// HealthService read a minute, not four, and the others keep their held values.
static void only_the_readings_asked_for_are_read(void) {
    s_steps = 2000;
    s_hr = 80;
    s_sleep = 7200;
    s_distance = 3000;
    reset_reads();
    expect_int("kinds.steps_changed", health_summary_refresh(HEALTH_SUMMARY_STEPS, later()), true);
    expect_int("kinds.steps_read", s_steps_reads, 1);
    expect_int("kinds.distance_not_read", s_distance_reads, 0);
    expect_int("kinds.sleep_not_read", s_sleep_reads, 0);
    expect_int("kinds.hr_not_read", s_hr_reads, 0);
    expect_int("kinds.steps_value", health_summary_steps(), 2000);
    expect_int("kinds.hr_held", health_summary_hr_bpm(), 70);
    expect_int("kinds.distance_held", health_summary_distance_m(), -1);

    // A reading nobody asked for cannot report a change.
    s_hr = 95;
    expect_int("kinds.unread_change_unseen", health_summary_refresh(HEALTH_SUMMARY_STEPS, later()),
               false);

    reset_reads();
    expect_int("kinds.hr_changed", health_summary_refresh(HEALTH_SUMMARY_HR, later()), true);
    expect_int("kinds.hr_read", s_hr_reads, 1);
    expect_int("kinds.hr_only", s_steps_reads + s_distance_reads + s_sleep_reads, 0);
    expect_int("kinds.hr_value", health_summary_hr_bpm(), 95);

    reset_reads();
    expect_int("kinds.distance_changed",
               health_summary_refresh(HEALTH_SUMMARY_DISTANCE, later()), true);
    expect_int("kinds.distance_read", s_distance_reads, 1);
    expect_int("kinds.distance_only", s_steps_reads + s_hr_reads + s_sleep_reads, 0);

    reset_reads();
    expect_int("kinds.none_no_change", health_summary_refresh(0, later()), false);
    expect_int("kinds.none_reads_nothing",
               s_steps_reads + s_hr_reads + s_sleep_reads + s_distance_reads, 0);
}

// Sleep is read at most once per HEALTH_SUMMARY_SLEEP_PERIOD_S: the firmware recomputes
// its sleep sessions every 15 minutes, so a read each minute mostly repeats itself.
static void sleep_is_read_at_most_every_period(void) {
    const time_t t0 = later();
    s_sleep = 9000;
    reset_reads();
    expect_int("sleep.first_read_changed", health_summary_refresh(HEALTH_SUMMARY_SLEEP, t0), true);
    expect_int("sleep.first_read", s_sleep_reads, 1);
    expect_int("sleep.value", health_summary_sleep_seconds(), 9000);

    s_sleep = 9600;
    expect_int("sleep.held_inside_period",
               health_summary_refresh(HEALTH_SUMMARY_SLEEP, t0 + 60), false);
    expect_int("sleep.held_inside_period.reads", s_sleep_reads, 1);
    health_summary_refresh(HEALTH_SUMMARY_SLEEP, t0 + HEALTH_SUMMARY_SLEEP_PERIOD_S - 1);
    expect_int("sleep.held_to_the_last_second", s_sleep_reads, 1);
    expect_int("sleep.held_value", health_summary_sleep_seconds(), 9000);

    expect_int("sleep.due_after_period",
               health_summary_refresh(HEALTH_SUMMARY_SLEEP, t0 + HEALTH_SUMMARY_SLEEP_PERIOD_S),
               true);
    expect_int("sleep.due_after_period.reads", s_sleep_reads, 2);
    expect_int("sleep.new_value", health_summary_sleep_seconds(), 9600);

    // Other readings asked with it are read every time.
    reset_reads();
    health_summary_refresh(HEALTH_SUMMARY_SLEEP | HEALTH_SUMMARY_STEPS,
                           t0 + HEALTH_SUMMARY_SLEEP_PERIOD_S + 60);
    expect_int("sleep.steps_still_every_call", s_steps_reads, 1);
    expect_int("sleep.sleep_still_held", s_sleep_reads, 0);

    // A clock set back does not wait for the old time to come round.
    health_summary_refresh(HEALTH_SUMMARY_SLEEP, t0 - 3600);
    expect_int("sleep.clock_set_back_reads", s_sleep_reads, 1);
}

int main(void) {
    distance_snapshot_uses_unavailable_sentinel_before_refresh();
    distance_changes_only_at_display_resolution();
    inaccessible_transition_changes_once();
    only_the_readings_asked_for_are_read();
    sleep_is_read_at_most_every_period();
    if (s_failures) {
        printf("%d health_summary failure(s)\n", s_failures);
        return 1;
    }
    printf("health_summary OK\n");
    return 0;
}
