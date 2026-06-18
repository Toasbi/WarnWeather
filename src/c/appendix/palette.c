#include "palette.h"
#include <string.h>

// Legacy defaults — used until the first palette arrives so a fresh watch
// still renders. Colour build; B&W collapses via the palette PKJS sends.
static ChartColorStop s_rain_stops[PALETTE_MAX_STOPS];
static int s_rain_num_stops = 0;

static void ensure_defaults(void) {
    if (s_rain_num_stops > 0) { return; }
#ifdef PBL_COLOR
    s_rain_stops[0] = (ChartColorStop){ 0,   GColorLightGray };
    s_rain_stops[1] = (ChartColorStop){ 140, GColorElectricBlue };
    s_rain_stops[2] = (ChartColorStop){ 340, GColorGreen };
    s_rain_stops[3] = (ChartColorStop){ 560, GColorYellow };
    s_rain_stops[4] = (ChartColorStop){ 780, GColorSunsetOrange };
    s_rain_num_stops = 5;
#else
    // B&W: single black stop; the watch pairs it with the white outline.
    s_rain_stops[0] = (ChartColorStop){ 0, GColorBlack };
    s_rain_num_stops = 1;
#endif
}

bool palette_set_rain(const int16_t *from, const int32_t *rgb, int count) {
    if (count < 1 || count > PALETTE_MAX_STOPS) { return false; }
    ChartColorStop next[PALETTE_MAX_STOPS];
    for (int i = 0; i < count; ++i) {
        next[i].from = from[i];
        next[i].color = GColorFromHEX(rgb[i]);
    }
    bool changed = (count != s_rain_num_stops)
        || memcmp(next, s_rain_stops, sizeof(ChartColorStop) * count) != 0;
    if (changed) {
        memcpy(s_rain_stops, next, sizeof(ChartColorStop) * count);
        s_rain_num_stops = count;
    }
    return changed;
}

const ChartColorStop *palette_rain_stops(int *num_stops) {
    ensure_defaults();
    *num_stops = s_rain_num_stops;
    return s_rain_stops;
}
