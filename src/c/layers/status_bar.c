#include <pebble.h>

#include "status_bar.h"
#include "status_row.h"
#include "../appendix/status_line.h"
#include "../windows/layout.h"

// See status_bar.h for what this module is and why its API is collective.

// The health row's nudge away from the calendar/radar in the dual-row compact
// view, which delegates LAYOUT_TIER_FULL to both rows. The true full view must
// stay unshifted, which is what s_full_mode distinguishes.
#if defined(PBL_HEALTH)
#define HEALTH_TALL_BAND_MIN 16
#define HEALTH_SECTION_DROP 2
#endif

typedef struct {
    Layer *layer;
    StatusRow *row;
    uint8_t tier;
    bool full_date;
} StatusBar;

// The pre-create tier is COMPACT, as it was in each of the three predecessors.
// Keep the explicit initialiser: defaulting it to 0 would silently make the
// pre-create tier FULL. (It moves the struct from .bss to .data; the aplite image
// check sums text+data+bss, so the total is unchanged.)
static StatusBar s_bars[STATUS_BAR_COUNT] = {
    [STATUS_BAR_FORECAST] = { .tier = LAYOUT_TIER_COMPACT },
#if defined(WW_RAIN_RADAR)
    [STATUS_BAR_RADAR]    = { .tier = LAYOUT_TIER_COMPACT },
#endif
#if defined(PBL_HEALTH)
    [STATUS_BAR_HEALTH]   = { .tier = LAYOUT_TIER_COMPACT },
#endif
};

#if defined(PBL_HEALTH)
// Health-only state, deliberately FILE-SCOPE rather than members of StatusBar:
// there is exactly one health bar, so per-bar copies would be dead weight on every
// platform and — since the fields are guarded away entirely on aplite — the
// single-bar aplite build must not carry the storage at all.
static bool s_full_mode;
static GRect s_applied_bounds;
static bool s_has_applied_bounds;

static bool bounds_equal(GRect a, GRect b) {
    return a.origin.x == b.origin.x && a.origin.y == b.origin.y
        && a.size.w == b.size.w && a.size.h == b.size.h;
}
#endif

// ── Per-bar identity ─────────────────────────────────────────────────────────
// Each of these is a switch on evolving platforms and a single constant on
// aplite, where STATUS_BAR_COUNT is 1. The #if tests the capability macros
// directly rather than STATUS_BAR_COUNT, which is an enum constant and therefore
// invisible to the preprocessor.

static inline uint8_t bar_line(StatusBarId id) {
#if defined(WW_RAIN_RADAR) || defined(PBL_HEALTH)
    switch (id) {
#if defined(WW_RAIN_RADAR)
        case STATUS_BAR_RADAR:  return STATUS_LINE_RADAR;
#endif
#if defined(PBL_HEALTH)
        case STATUS_BAR_HEALTH: return STATUS_LINE_HEALTH;
#endif
        default: return STATUS_LINE_FORECAST;
    }
#else
    (void) id;
    return STATUS_LINE_FORECAST;
#endif
}

static inline uint8_t bar_source(StatusBarId id) {
#if defined(WW_RAIN_RADAR) || defined(PBL_HEALTH)
    switch (id) {
#if defined(WW_RAIN_RADAR)
        case STATUS_BAR_RADAR:  return STATUS_SRC_RADAR;
#endif
#if defined(PBL_HEALTH)
        case STATUS_BAR_HEALTH: return STATUS_SRC_HEALTH;
#endif
        default: return STATUS_SRC_FORECAST;
    }
#else
    (void) id;
    return STATUS_SRC_FORECAST;
#endif
}

// ── Update procs ─────────────────────────────────────────────────────────────
// One trampoline per bar, selected by a switch that folds to a constant on
// aplite. Deliberately NOT a table (an extra .rodata array plus an indirect load)
// and deliberately not a linear search of s_bars for a matching Layer*.

static void bar_draw_forecast(Layer *layer, GContext *ctx) {
    (void) layer;
    status_row_draw(s_bars[STATUS_BAR_FORECAST].row, ctx);
}
#if defined(WW_RAIN_RADAR)
static void bar_draw_radar(Layer *layer, GContext *ctx) {
    (void) layer;
    status_row_draw(s_bars[STATUS_BAR_RADAR].row, ctx);
}
#endif
#if defined(PBL_HEALTH)
static void bar_draw_health(Layer *layer, GContext *ctx) {
    (void) layer;
    status_row_draw(s_bars[STATUS_BAR_HEALTH].row, ctx);
}
#endif

static inline LayerUpdateProc bar_proc(StatusBarId id) {
#if defined(WW_RAIN_RADAR) || defined(PBL_HEALTH)
    switch (id) {
#if defined(WW_RAIN_RADAR)
        case STATUS_BAR_RADAR:  return bar_draw_radar;
#endif
#if defined(PBL_HEALTH)
        case STATUS_BAR_HEALTH: return bar_draw_health;
#endif
        default: return bar_draw_forecast;
    }
#else
    (void) id;
    return bar_draw_forecast;
#endif
}

// ── Seating ──────────────────────────────────────────────────────────────────

// Push this bar's bounds/tier/line into its row. Returns whether the DERIVED
// bounds moved since the last apply — which only the health bar can do without
// its layer frame moving, because only it adjusts the bounds after reading them.
// Every other bar's derived bounds ARE layer_get_bounds(), and the SDK already
// marks a layer dirty when layer_set_frame() changes it, so tracking them would
// buy nothing.
static bool apply_row(StatusBarId id) {
    StatusBar *b = &s_bars[id];
    if (!b->row || !b->layer) { return false; }
    GRect bounds = layer_get_bounds(b->layer);
    bool geometry_changed = false;
#if defined(PBL_HEALTH)
    if (id == STATUS_BAR_HEALTH) {
        if (b->tier == LAYOUT_TIER_FULL
                && bounds.size.h > HEALTH_TALL_BAND_MIN
                && !s_full_mode) {
            bounds.origin.y += HEALTH_SECTION_DROP;
            bounds.size.h -= HEALTH_SECTION_DROP;
        }
        geometry_changed = !s_has_applied_bounds
            || !bounds_equal(bounds, s_applied_bounds);
        s_applied_bounds = bounds;
        s_has_applied_bounds = true;
    }
#endif
    status_row_apply(b->row, bounds, b->tier, bar_line(id));
    return geometry_changed;
}

static void refresh_row(StatusBarId id) {
    StatusBar *b = &s_bars[id];
    bool geometry_changed = apply_row(id);
    if (!b->row) { return; }
    if (status_row_refresh(b->row) || geometry_changed) {
        layer_mark_dirty(b->layer);
    }
}

static bool frame_equal(GRect a, GRect b) {
    return a.origin.x == b.origin.x && a.origin.y == b.origin.y
        && a.size.w == b.size.w && a.size.h == b.size.h;
}

// ── External ─────────────────────────────────────────────────────────────────

void status_bar_create_all(Layer *parent, const ViewSpec *spec, const MainLayout *L) {
    // Seed the per-view facts BEFORE creating, so each row's first layout already
    // uses the boot view's tier and date density rather than a default.
    const uint8_t tier = spec->status_tier;
    const bool full_date = (spec->calendar_rows == 0);
#if defined(PBL_HEALTH)
    s_full_mode = (spec->calendar_rows == 3);
#endif
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        StatusBar *b = &s_bars[i];
        b->tier = tier;
        b->full_date = full_date;
        b->layer = layer_create(layout_status_band(spec, L, bar_source((StatusBarId) i)));
        layer_set_update_proc(b->layer, bar_proc((StatusBarId) i));
        layer_add_child(parent, b->layer);
        b->row = status_row_create(bar_line((StatusBarId) i));
        status_row_set_full_date(b->row, full_date);
        apply_row((StatusBarId) i);
        refresh_row((StatusBarId) i);
    }
}

void status_bar_apply_view(const ViewSpec *spec, const MainLayout *L) {
    const uint8_t tier = spec->status_tier;
    const bool full_date = (spec->calendar_rows == 0);
#if defined(PBL_HEALTH)
    const bool full_mode = (spec->calendar_rows == 3);
    const bool full_mode_changed = (s_full_mode != full_mode);
    s_full_mode = full_mode;
#endif

    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        StatusBar *b = &s_bars[i];
        if (!b->layer) { continue; }
        const StatusBarId id = (StatusBarId) i;
        const uint8_t src = bar_source(id);

        // FRAME FIRST, then seat. apply_row() derives its bounds from the layer, so
        // pushing the view facts before the reframe would seat the row in the band
        // it is LEAVING. The predecessors got away with that ordering only because
        // every render_active_view() caller happened to follow it with a whole-window
        // refresh, which re-applied the rows against the new frames; relying on that
        // pairing is exactly the implicit coupling this module exists to remove.
        // Frame every bar, hidden ones included, so a later un-hide lands right.
        const GRect band = layout_status_band(spec, L, src);
        const bool moved = !frame_equal(band, layer_get_frame(b->layer));
        layer_set_frame(b->layer, band);
        layer_set_hidden(b->layer, !layout_status_visible(spec, src));

        // Change-gated: an unchanged view must not re-resolve a row, or a settings
        // save would re-read persist for rows whose content never moved.
        bool changed = moved;
        if (b->tier != tier) { b->tier = tier; changed = true; }
        if (b->full_date != full_date) {
            b->full_date = full_date;
            status_row_set_full_date(b->row, full_date);
            changed = true;
        }
#if defined(PBL_HEALTH)
        // full_mode only moves the health bar's derived bounds (the nudge).
        if (id == STATUS_BAR_HEALTH && full_mode_changed) { changed = true; }
#endif
        if (changed) { refresh_row(id); }
    }
}

void status_bar_refresh_all(void) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        if (s_bars[i].row) { refresh_row((StatusBarId) i); }
    }
}

bool status_bar_any_uses_live_health(void) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        if (status_row_uses_live_health(s_bars[i].row)) { return true; }
    }
    return false;
}

void status_bar_refresh_live_health(const ViewSpec *spec) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        StatusBar *b = &s_bars[i];
        if (!b->row) { continue; }
        const uint8_t src = bar_source((StatusBarId) i);
        // See status_bar.h: the health row refreshed on VISIBILITY, the others on
        // whether they actually carry a live health slot. Both halves are needed.
        if (status_row_uses_live_health(b->row)
                || (src == STATUS_SRC_HEALTH && layout_status_visible(spec, src))) {
            refresh_row((StatusBarId) i);
        }
    }
}

void status_bar_destroy_all(void) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        StatusBar *b = &s_bars[i];
        status_row_destroy(b->row);
        b->row = NULL;
        layer_destroy(b->layer);
        b->layer = NULL;
    }
#if defined(PBL_HEALTH)
    s_has_applied_bounds = false;
#endif
}
