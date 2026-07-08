#include "palette.h"
#include "theme.h"
#include "persist.h"
#include <string.h>

// Two independent channels. Legacy defaults (colour build / single black on
// B&W) render until each channel's first palette arrives.
static ChartColorStop s_bar_stops[PALETTE_MAX_STOPS];
static int s_bar_num_stops = 0;
static ChartColorStop s_radar_stops[PALETTE_MAX_STOPS];
static int s_radar_num_stops = 0;

static void fill_defaults(ChartColorStop *stops, int *num) {
    if (*num > 0) { return; }
    if (theme_is_bw()) {
        // B&W (real hardware, or the Black & White theme on a color build): single
        // theme_fg() stop; the watch pairs it with a theme_bg() 1px halo drawn
        // OUTSIDE the bar (chart.c's bar-separation halo, gated
        // theme_is_light() || theme_is_bw()) rather than a fg BAR_OUTLINED
        // silhouette on top, which would be fg-on-fg and invisible now. bw-dark:
        // white fill, black border. bw-light: black fill, white border, the
        // polarity mirror.
        stops[0] = (ChartColorStop){ 0, theme_fg() };
        *num = 1;
        return;
    }
    stops[0] = (ChartColorStop){ 0,   GColorLightGray };
    stops[1] = (ChartColorStop){ 140, GColorElectricBlue };
    stops[2] = (ChartColorStop){ 340, GColorGreen };
    stops[3] = (ChartColorStop){ 560, GColorYellow };
    stops[4] = (ChartColorStop){ 780, GColorSunsetOrange };
    *num = 5;
}

// Parse the packed blob (3 B/stop) into `out`. Returns count, or -1 if the
// length is not a positive multiple of 3 or holds more than PALETTE_MAX_STOPS.
static int parse_packed(const uint8_t *packed, int len, ChartColorStop *out) {
    if (len <= 0 || len % 3 != 0) { return -1; }
    int count = len / 3;
    if (count > PALETTE_MAX_STOPS) { return -1; }
    for (int i = 0; i < count; ++i) {
        const uint8_t *s = &packed[i * 3];
        out[i].from = (int16_t)(s[0] | (s[1] << 8));
        out[i].color = (GColor){ .argb = s[2] };   // byte is already GColor8
    }
    return count;
}

// A persist_get_bar/radar_palette accessor: fills the buffer, returns byte count
// (<=0 when the key is absent). Top-level const on the size param is not part of
// the function type, so the persist_get_* functions match this exactly.
typedef int (*PaletteReader)(uint8_t *buffer, const size_t buffer_size);

// Load a persisted packed palette into `store`. Returns true when a valid blob
// was read; false (store untouched) when the key is absent or malformed.
static bool load_persisted(ChartColorStop *store, int *store_num, PaletteReader get_fn) {
    uint8_t packed[PALETTE_MAX_STOPS * 3];
    int len = get_fn(packed, sizeof(packed));
    if (len <= 0) { return false; }
    int count = parse_packed(packed, len, store);
    if (count < 1) { return false; }
    *store_num = count;
    return true;
}

static bool apply(const uint8_t *packed, int len, ChartColorStop *store, int *store_num) {
    // Zero-init so the struct's 1-byte tail padding is deterministic: the
    // changed-check below memcmp's whole structs (incl. padding), and an
    // uninitialized pad byte could spuriously report a change — at most one
    // harmless extra redraw. (The static stores are .bss-zeroed already.)
    ChartColorStop next[PALETTE_MAX_STOPS] = {0};
    int count = parse_packed(packed, len, next);
    if (count < 1) { return false; }
    bool changed = (count != *store_num)
        || memcmp(next, store, sizeof(ChartColorStop) * count) != 0;
    if (changed) {
        memcpy(store, next, sizeof(ChartColorStop) * count);
        *store_num = count;
    }
    return changed;
}

bool palette_set_bar(const uint8_t *packed, int len) {
    bool changed = apply(packed, len, s_bar_stops, &s_bar_num_stops);
    if (changed) {
        persist_set_bar_palette((uint8_t*) packed, (size_t) len);
    }
    return changed;
}

bool palette_set_radar(const uint8_t *packed, int len) {
    bool changed = apply(packed, len, s_radar_stops, &s_radar_num_stops);
    if (changed) {
        persist_set_radar_palette((uint8_t*) packed, (size_t) len);
    }
    return changed;
}

const ChartColorStop *palette_bar_stops(int *num_stops) {
    if (s_bar_num_stops == 0
            && !load_persisted(s_bar_stops, &s_bar_num_stops, persist_get_bar_palette)) {
        fill_defaults(s_bar_stops, &s_bar_num_stops);
    }
    *num_stops = s_bar_num_stops;
    return s_bar_stops;
}

const ChartColorStop *palette_radar_stops(int *num_stops) {
    if (s_radar_num_stops == 0
            && !load_persisted(s_radar_stops, &s_radar_num_stops, persist_get_radar_palette)) {
        fill_defaults(s_radar_stops, &s_radar_num_stops);
    }
    *num_stops = s_radar_num_stops;
    return s_radar_stops;
}

GColor palette_radar_color(int tier) {
    int n = 0;
    const ChartColorStop *stops = palette_radar_stops(&n);
    if (tier <= 0 || n <= 0) { return theme_pick(GColorWhite, GColorBlack); }
    int idx = tier - 1;
    if (idx >= n) { idx = n - 1; }   // B&W: single stop catches every tier
    return stops[idx].color;
}
