// Host tests for services/disconnect_vibe.h: a Bluetooth drop buzzes once while the vibe
// setting is on and Quiet Time is off; Quiet Time, the setting off and a reconnect keep the
// watch quiet. The Quiet Time and vibe calls are faked below.
#include <stdio.h>

#include "c/services/disconnect_vibe.h"

static int s_failures;
static void expect_int(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

static bool s_quiet;
static int s_vibes;

bool quiet_time_is_active(void) { return s_quiet; }
void vibes_double_pulse(void) { s_vibes++; }

// The buzzes one connection event makes.
static int buzzes(bool connected, bool vibe_on, bool quiet) {
    s_quiet = quiet;
    s_vibes = 0;
    disconnect_vibe_on_connection(connected, vibe_on);
    return s_vibes;
}

int main(void) {
    expect_int("drop.buzzes_once", buzzes(false, true, false), 1);
    expect_int("drop.quiet_time_keeps_quiet", buzzes(false, true, true), 0);
    expect_int("drop.setting_off", buzzes(false, false, false), 0);
    expect_int("reconnect.never_buzzes", buzzes(true, true, false), 0);
    expect_int("reconnect.quiet_time", buzzes(true, true, true), 0);
    if (s_failures) { printf("%d disconnect_vibe failure(s)\n", s_failures); return 1; }
    printf("disconnect_vibe OK\n");
    return 0;
}
