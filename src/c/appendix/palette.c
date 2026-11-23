#include "palette.h"
#include "theme.h"
#include "persist.h"
#include <string.h>

// One palette channel: its stops, and how many (0 until it is set, or read from
// persist). Two independent channels, the bars' and the radar's. Legacy defaults
// (colour build / single black on B&W) render until each channel's first palette
// arrives.
typedef struct {
    ChartColorStop stops[PALETTE_MAX_STOPS];
    int num;
} PaletteChannel;

static PaletteChannel s_bar;
static PaletteChannel s_radar;

// A persist_get_bar/radar_palette accessor: fills the buffer, returns byte count
// (<=0 when the key is absent). Top-level const on the size param is not part of
// the function type, so the persist_get_* functions match this exactly.
typedef int (*PaletteReader)(uint8_t *buffer, const size_t buffer_size);
// A persist_set_bar/radar_palette accessor: stores the packed blob.
typedef bool (*PaletteWriter)(uint8_t *data, const size_t size);

static void fill_defaults(PaletteChannel *c) {
    ChartColorStop *stops = c->stops;
    if (theme_is_bw()) {
        // B&W (real hardware, or the Black & White theme on a color build): single
        // theme_bg() stop; the watch pairs it with a theme_fg() outline
        // (chart.c's bar outline). bw-dark's theme_bg() is black — pixel-identical
        // to the literal-black stop this always returned before polarity existed.
        // bw-light's theme_bg() is white, the polarity mirror (white fill, black
        // outline).
        stops[0] = (ChartColorStop){ 0, theme_bg() };
        c->num = 1;
        return;
    }
    stops[0] = (ChartColorStop){ 0,   GColorLightGray };
    stops[1] = (ChartColorStop){ 140, GColorElectricBlue };
    stops[2] = (ChartColorStop){ 340, GColorGreen };
    stops[3] = (ChartColorStop){ 560, GColorYellow };
    stops[4] = (ChartColorStop){ 780, GColorSunsetOrange };
    c->num = 5;
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

// Set channel `c` from a packed blob, and persist the blob through `save` when it
// changed the channel. Returns whether it did; a malformed blob changes nothing.
static bool channel_set(PaletteChannel *c, const uint8_t *packed, int len, PaletteWriter save) {
    // Zero-init so the struct's 1-byte tail padding is deterministic: the
    // changed-check below memcmp's whole structs (incl. padding), and an
    // uninitialized pad byte could spuriously report a change — at most one
    // harmless extra redraw. (The static stores are .bss-zeroed already.)
    ChartColorStop next[PALETTE_MAX_STOPS] = {0};
    int count = parse_packed(packed, len, next);
    if (count < 1) { return false; }
    if (count == c->num && memcmp(next, c->stops, sizeof(ChartColorStop) * count) == 0) {
        return false;
    }
    memcpy(c->stops, next, sizeof(ChartColorStop) * count);
    c->num = count;
    save((uint8_t*) packed, (size_t) len);
    return true;
}

// Channel `c`'s stops: as set, else as persisted (read through `load`; a missing or
// malformed blob leaves the channel untouched), else the defaults.
static const ChartColorStop *channel_stops(PaletteChannel *c, int *num_stops,
                                           PaletteReader load) {
    if (c->num == 0) {
        uint8_t packed[PALETTE_MAX_STOPS * 3];
        const int len = load(packed, sizeof(packed));   // <= 0: no blob, parsed as malformed
        const int count = parse_packed(packed, len, c->stops);
        if (count >= 1) {
            c->num = count;
        } else {
            fill_defaults(c);
        }
    }
    *num_stops = c->num;
    return c->stops;
}

#if defined(PBL_PLATFORM_EMERY)
// emery: a graph style's own bar palette (graph_style.h), read per paint into the caller's
// stops. A wrapper, so parse_packed stays static (and inlined) on every other platform.
int palette_parse_stops(const uint8_t *packed, int len, ChartColorStop *out) {
    return parse_packed(packed, len, out);
}
#endif

bool palette_set_bar(const uint8_t *packed, int len) {
    return channel_set(&s_bar, packed, len, persist_set_bar_palette);
}

bool palette_set_radar(const uint8_t *packed, int len) {
    return channel_set(&s_radar, packed, len, persist_set_radar_palette);
}

const ChartColorStop *palette_bar_stops(int *num_stops) {
    return channel_stops(&s_bar, num_stops, persist_get_bar_palette);
}

const ChartColorStop *palette_radar_stops(int *num_stops) {
    return channel_stops(&s_radar, num_stops, persist_get_radar_palette);
}

GColor palette_radar_color(int tier) {
    int n = 0;
    const ChartColorStop *stops = palette_radar_stops(&n);
    if (tier <= 0 || n <= 0) { return theme_pick(GColorWhite, GColorBlack); }
    int idx = tier - 1;
    if (idx >= n) { idx = n - 1; }   // B&W: single stop catches every tier
    return stops[idx].color;
}
