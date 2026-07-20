#include <stdbool.h>
#include <stdio.h>

#include "c/layers/top_status_indicators.h"

static int s_failures;

static void expect_case(const char *name,
                        bool quiet_time, bool bluetooth, bool snooze,
                        int count,
                        TopStatusIndicator slot_1,
                        TopStatusIndicator slot_2) {
    TopStatusIndicators got = top_status_indicators_resolve(
        quiet_time, bluetooth, snooze);
    if (got.count != count || got.slots[0] != slot_1 || got.slots[1] != slot_2) {
        printf("FAIL %s: count=%d slots=%d,%d want=%d,%d,%d\n",
               name, got.count, got.slots[0], got.slots[1],
               count, slot_1, slot_2);
        s_failures++;
    }
}

int main(void) {
    expect_case("none", false, false, false, 0,
                TOP_STATUS_INDICATOR_NONE, TOP_STATUS_INDICATOR_NONE);
    expect_case("snooze-only", false, false, true, 1,
                TOP_STATUS_INDICATOR_SNOOZE, TOP_STATUS_INDICATOR_NONE);
    expect_case("bluetooth-only", false, true, false, 1,
                TOP_STATUS_INDICATOR_BLUETOOTH, TOP_STATUS_INDICATOR_NONE);
    expect_case("quiet-only", true, false, false, 1,
                TOP_STATUS_INDICATOR_QUIET_TIME, TOP_STATUS_INDICATOR_NONE);
    expect_case("bluetooth-snooze", false, true, true, 2,
                TOP_STATUS_INDICATOR_BLUETOOTH, TOP_STATUS_INDICATOR_SNOOZE);
    expect_case("quiet-snooze", true, false, true, 2,
                TOP_STATUS_INDICATOR_QUIET_TIME, TOP_STATUS_INDICATOR_SNOOZE);
    expect_case("quiet-bluetooth", true, true, false, 2,
                TOP_STATUS_INDICATOR_QUIET_TIME, TOP_STATUS_INDICATOR_BLUETOOTH);
    expect_case("all-snooze-wins-slot-two", true, true, true, 2,
                TOP_STATUS_INDICATOR_QUIET_TIME, TOP_STATUS_INDICATOR_SNOOZE);

    TopStatusIndicators all = top_status_indicators_resolve(true, true, true);
    if (!top_status_indicators_contains(all, TOP_STATUS_INDICATOR_QUIET_TIME)
            || !top_status_indicators_contains(all, TOP_STATUS_INDICATOR_SNOOZE)
            || top_status_indicators_contains(all, TOP_STATUS_INDICATOR_BLUETOOTH)) {
        printf("FAIL contains\n");
        s_failures++;
    }

    if (s_failures) {
        printf("%d top_status_indicators failure(s)\n", s_failures);
        return 1;
    }
    printf("top_status_indicators OK\n");
    return 0;
}
