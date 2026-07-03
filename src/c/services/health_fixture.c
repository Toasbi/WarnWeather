#include "health.h"

// Screenshot/showcase twin of services/health.c. Selected by the wscript ONLY when
// WW_HEALTH_FIXTURE is set in the environment (see the source-selection block), and
// never on aplite — so it never ships in a normal build. Where health.c reads live
// values from HealthService, this returns one canned, deterministic set so captured
// frames show stable, realistic health numbers instead of the emulator's arbitrary
// (and low) simulated data. Feature-frozen mirror of health.c's interface: if health.h
// changes, this must be hand-ported (the link error on a showcase build forces it).
//
// The four showcase scenes only use the status-bar accessors (steps / sleep / HR); the
// hourly fills carry a plain canned daily pattern so the twin is still a complete
// drop-in should a future scene show the health graph.
#if defined(PBL_HEALTH)

#define HOUR_SECS 3600

// Canned "today so far" totals shown in the health status bar.
#define FIXTURE_STEPS_TODAY   8432
#define FIXTURE_SLEEP_SECONDS (7 * HOUR_SECS + 12 * 60)   // 7 h 12 m
#define FIXTURE_HR_CURRENT    72

// Per-hour-of-day canned curves for the hourly fills (graph). Indexed by tm_hour.
static const int16_t s_step_curve[24] = {
    0, 0, 0, 0, 0, 0, 120, 300, 650, 500, 400, 700,
    900, 600, 450, 500, 800, 1200, 700, 300, 150, 60, 0, 0,
};
static const int16_t s_hr_curve[24] = {
    58, 56, 55, 54, 55, 57, 62, 70, 75, 72, 74, 78,
    80, 76, 72, 74, 79, 85, 78, 72, 68, 64, 60, 59,
};

bool health_available(void) {
    return true;
}

int health_steps_today(void) {
    return FIXTURE_STEPS_TODAY;
}

int health_sleep_today_seconds(void) {
    return FIXTURE_SLEEP_SECONDS;
}

int health_hr_current(void) {
    return FIXTURE_HR_CURRENT;
}

// Map each trailing bucket to its local hour-of-day and read the canned curve, matching
// health.c's out[0]=oldest .. out[count-1]=hour ending at end_hour ordering.
void health_fill_hourly_steps(int16_t *out, int count, time_t end_hour) {
    for (int i = 0; i < count; ++i) {
        time_t t = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        struct tm *lt = localtime(&t);
        out[i] = s_step_curve[lt->tm_hour % 24];
    }
}

void health_fill_hourly_hr(int16_t *out, int count, time_t end_hour) {
    for (int i = 0; i < count; ++i) {
        time_t t = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        struct tm *lt = localtime(&t);
        out[i] = s_hr_curve[lt->tm_hour % 24];
    }
}

void health_fill_hourly_sleep(uint8_t *state_out, int count, time_t end_hour) {
    // Canned last-night sleep: 23:00–06:59 asleep, alternating light/deep; awake by day.
    for (int i = 0; i < count; ++i) {
        time_t t = end_hour - (time_t)(count - 1 - i) * HOUR_SECS;
        struct tm *lt = localtime(&t);
        int h = lt->tm_hour;
        if (h >= 23 || h < 7) {
            state_out[i] = (h % 2) ? HEALTH_SLEEP_LIGHT : HEALTH_SLEEP_DEEP;
        } else {
            state_out[i] = HEALTH_SLEEP_AWAKE;
        }
    }
}

#endif  // PBL_HEALTH
