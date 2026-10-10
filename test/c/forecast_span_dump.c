#include <stdio.h>
#include "c/appendix/forecast_span.h"

// Dumps the long span's whole hours (appendix/forecast_span.h forecast_span_whole) for
// scripts/check-forecast-span-lockstep.js, which checks each count against the settings
// page's label rule (src/pkjs/forecast-span-hours.js wholeHours): every feed the long class
// lays out (FORECAST_SPAN_DAY_SENT + 1 .. FORECAST_MAX_ENTRIES hours: OWM's 48, WU's 49, a
// full 68) on every plot width W_MIN .. W_MAX (the narrowest plot past any label strip the
// watch measures, graph_left 53, to the whole screen). Built with -DPBL_PLATFORM_EMERY, the
// only platform with the long class.
//
// A header line `W_MIN <w> W_MAX <w> N_MIN <n> N_MAX <n>`, then one line per cell: <w> <n>
// <whole>.
#define W_MIN 145
#define W_MAX 200
#define N_MIN (FORECAST_SPAN_DAY_SENT + 1)

int main(void) {
    printf("W_MIN %d W_MAX %d N_MIN %d N_MAX %d\n", W_MIN, W_MAX, N_MIN, FORECAST_MAX_ENTRIES);
    for (int w = W_MIN; w <= W_MAX; ++w) {
        for (int n = N_MIN; n <= FORECAST_MAX_ENTRIES; ++n) {
            printf("%d %d %d\n", w, n, forecast_span_whole(forecast_span(n, w), n, w));
        }
    }
    return 0;
}
