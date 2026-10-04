#include <stdio.h>
#include "c/appendix/alert_set.h"

// Dumps the metric alert items' text lanes (appendix/alert_set.c alert_set_lane) for
// scripts/check-alert-lane-lockstep.js, which checks each one against the text the
// phone gives the day-max slot for the same peak (status-pair.js markNextDay): an
// alert active for tomorrow and a slot showing tomorrow's peak must print the same
// "»8", ">8", "+8", "8*" or "8". Every day code the phone sends, a spread of values
// (none = the Icon look), and the lane ladder's values flag on and off. Built with
// -DWW_ON_DEMAND -DWW_THRESHOLD_HIGHLIGHT like alert_set_test.c.
//
// One line per lane: <day code> <values 0|1> <value, '-' for none> <lane as hex, '-'
// for empty>. Hex, so the "»" bytes reach the checker exactly as the watch draws them.

int main(void) {
    static const char *const values[] = { "", "8", "11", "255", "2-3" };
    const int n_values = (int)(sizeof(values) / sizeof(values[0]));
    for (int day = STATUS_ALERT_DAY_TODAY; day <= STATUS_ALERT_MARK_NONE; day++) {
        for (int v = 0; v < n_values; v++) {
            for (int on = 0; on <= 1; on++) {
                uint8_t bytes[1 + STATUS_ALERT_LEN_MAX];
                size_t n = 0;
                bytes[n++] = (uint8_t)(STATUS_ALERT_HEADER | THRESH_UV
                    | (day << STATUS_ALERT_DAY_SHIFT));
                for (const char *p = values[v]; *p; p++) { bytes[n++] = (uint8_t)*p; }
                AlertSet set;
                if (alert_set_parse(bytes, n, &set) != 1) {
                    fprintf(stderr, "alert_lane_dump: day %d value '%s' did not parse\n",
                            day, values[v]);
                    return 1;
                }
                char lane[16];
                alert_set_lane(&set.entries[0], on == 1, lane, sizeof(lane));
                printf("%d %d %s ", day, on, values[v][0] ? values[v] : "-");
                if (lane[0] == '\0') { printf("-"); }
                for (const char *p = lane; *p; p++) { printf("%02x", (unsigned char)*p); }
                printf("\n");
            }
        }
    }
    return 0;
}
