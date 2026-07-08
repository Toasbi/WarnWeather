// Lean aplite (Pebble Classic/Steel) twin of palette.c.
//
// Frozen fork of palette.c as of 493afea. FEATURE-FROZEN, NOT CODE-FROZEN: never
// add features here; hand-port bugfixes from palette.c (see
// `git log 493afea.. -- src/c/appendix/palette.c`); interface changes are forced
// by the aplite link error. See docs/adr/0001-aplite-frozen-lean-fork.md and
// CONTEXT.md ("Lean twin").
//
// Aplite is 1-bit: every colour collapses to black/white, so there is no palette
// to parse, store, or persist. Both channels render a single black stop (the
// watch pairs it with a white outline), incoming palettes are ignored, and the
// radar outline is always black. Omitting the parse/store/persist path leaves
// palette.c's helpers and the persist_*_palette getters/setters unreferenced on
// aplite, so --gc-sections strips them and app_message.c / persist.c are untouched.

#include "palette.h"
#include "theme.h"

// Single stop shared by both channels; `from == 0` covers the whole range. Not
// const: .color is set to theme_fg() by the accessors below on every call —
// theme_fg() reads g_config->theme at runtime, so it can't be a static
// initializer. Mirrors palette.c's fill_defaults() B&W branch (bw-dark: white
// fill; bw-light: black fill, the polarity mirror). The watch pairs this fill
// with a theme_bg() 1px halo drawn outside the bar (chart.c's bar-separation
// halo). No heap: same module-static instance, just mutated in place before
// each return.
static ChartColorStop s_bw_stop = { 0, GColorWhite };

bool palette_set_bar(const uint8_t *packed, int len) {
    (void) packed;
    (void) len;
    return false;   // aplite ignores incoming palettes; nothing to store.
}

bool palette_set_radar(const uint8_t *packed, int len) {
    (void) packed;
    (void) len;
    return false;
}

const ChartColorStop *palette_bar_stops(int *num_stops) {
    s_bw_stop.color = theme_fg();
    *num_stops = 1;
    return &s_bw_stop;
}

const ChartColorStop *palette_radar_stops(int *num_stops) {
    s_bw_stop.color = theme_fg();
    *num_stops = 1;
    return &s_bw_stop;
}

GColor palette_radar_color(int tier) {
    (void) tier;    // every tier collapses to the one stop on a 1-bit screen.
    // Bar FILL, not foreground/outline — mirrors theme_fg(), like palette.c's
    // color-build equivalent (bw-dark: white; bw-light: black). In practice
    // unreachable on aplite: radar is compiled out here (WW_RAIN_RADAR), and
    // this function's only other caller (top_status_layer.c's rain_glyph_color)
    // guards its use behind #ifdef PBL_COLOR. Kept polarity-consistent anyway
    // for palette.h interface parity with palette.c.
    return theme_fg();
}
