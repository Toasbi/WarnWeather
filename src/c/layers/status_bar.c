#include <pebble.h>

#include "status_bar.h"
#include "status_row.h"
#include "../appendix/status_line.h"
#include "../appendix/view_spec.h"

// See status_bar.h for what this module is and why its API is collective.

typedef struct {
    Layer *layer;
    StatusRow *row;
} StatusBar;

static StatusBar s_bars[STATUS_BAR_COUNT];

// The view facts every bar takes alike (the view spec's status tier and date density),
// held once. The pre-create tier is COMPACT, as it was in each of the three predecessors.
// Keep the explicit initialiser: defaulting it to 0 would silently make the pre-create
// tier FULL.
static uint8_t s_tier = LAYOUT_TIER_COMPACT;
static bool s_full_date;

#if defined(WW_VIEW_CYCLE)
// The bars the configured views show (status_bar_set_in_use), as a mask of
// (1 << StatusSource): the only bars ever read. Every bar until the first call, and again
// after status_bar_destroy_all.
#define STATUS_BAR_ALL_IN_USE 0xFFu
static uint8_t s_in_use = STATUS_BAR_ALL_IN_USE;
#endif

// ── Per-bar identity ─────────────────────────────────────────────────────────
// The bars are declared in the order of their sources (view_spec.h StatusSource,
// which starts at 1: 0 is "no bar") and of their lines (status_line.h, where the
// strip's line sits between the Radar bar's and the Health bar's), so both are
// arithmetic on the bar's id, and a single constant on aplite, where
// STATUS_BAR_COUNT is 1. The asserts below hold every bar a build has to that order.
#define BAR_SOURCE(id) ((int) (id) + (int) STATUS_SRC_FORECAST)
#define BAR_LINE(id)   ((int) (id) < (int) STATUS_LINE_TOP ? (int) (id) : (int) (id) + 1)
#define BAR_IS(id, source, line) \
    _Static_assert(BAR_SOURCE(id) == (int) (source) && BAR_LINE(id) == (int) (line), \
                   "status_bar.h's bars follow their sources and lines")
BAR_IS(STATUS_BAR_FORECAST, STATUS_SRC_FORECAST, STATUS_LINE_FORECAST);
#if defined(WW_RAIN_RADAR)
BAR_IS(STATUS_BAR_RADAR, STATUS_SRC_RADAR, STATUS_LINE_RADAR);
#endif
#if defined(PBL_HEALTH)
BAR_IS(STATUS_BAR_HEALTH, STATUS_SRC_HEALTH, STATUS_LINE_HEALTH);
#endif
#if defined(PBL_PLATFORM_EMERY)
// emery: bars 4 to 6
BAR_IS(STATUS_BAR_4, STATUS_SRC_BAR4, STATUS_LINE_BAR4);
BAR_IS(STATUS_BAR_5, STATUS_SRC_BAR5, STATUS_LINE_BAR5);
BAR_IS(STATUS_BAR_6, STATUS_SRC_BAR6, STATUS_LINE_BAR6);
#endif

static inline uint8_t bar_line(StatusBarId id) {
    return (uint8_t) BAR_LINE(id);
}

static inline uint8_t bar_source(StatusBarId id) {
    return (uint8_t) BAR_SOURCE(id);
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
#if defined(PBL_PLATFORM_EMERY)
// emery: bars 4 to 6.
static void bar_draw_4(Layer *layer, GContext *ctx) {
    (void) layer;
    status_row_draw(s_bars[STATUS_BAR_4].row, ctx);
}
static void bar_draw_5(Layer *layer, GContext *ctx) {
    (void) layer;
    status_row_draw(s_bars[STATUS_BAR_5].row, ctx);
}
static void bar_draw_6(Layer *layer, GContext *ctx) {
    (void) layer;
    status_row_draw(s_bars[STATUS_BAR_6].row, ctx);
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
#if defined(PBL_PLATFORM_EMERY)
        case STATUS_BAR_4:      return bar_draw_4;   // emery: bars 4 to 6
        case STATUS_BAR_5:      return bar_draw_5;
        case STATUS_BAR_6:      return bar_draw_6;
#endif
        default: return bar_draw_forecast;
    }
#else
    (void) id;
    return bar_draw_forecast;
#endif
}

// ── Seating ──────────────────────────────────────────────────────────────────

// Push this bar's bounds and the view facts into its row. Every bar's derived bounds ARE
// layer_get_bounds(), the band frame layout_status_band() picks, so any geometric
// change arrives through layer_set_frame(), which the SDK already marks dirty on a
// real move.
static void apply_row(StatusBarId id) {
    StatusBar *b = &s_bars[id];
    if (!b->row || !b->layer) { return; }
    status_row_apply(b->row, layer_get_bounds(b->layer), s_tier, s_full_date);
}

static void refresh_row(StatusBarId id) {
    StatusBar *b = &s_bars[id];
    if (!b->row) { return; }
#if defined(WW_VIEW_CYCLE)
    // A bar no configured view shows is never read (status_bar.h): every refresh path
    // comes through here, so its row stays empty, with no persist read, glyph or layout.
    if (!((s_in_use >> bar_source(id)) & 1u)) { return; }
#endif
    apply_row(id);
    if (status_row_refresh(b->row)) {
        layer_mark_dirty(b->layer);
    }
}

// ── External ─────────────────────────────────────────────────────────────────

void status_bar_create_all(Layer *parent, const ViewSpec *spec, const MainLayout *L) {
    // Seed the view facts BEFORE creating, so each row's first layout already uses the
    // boot view's tier and date density rather than a default.
    s_tier = spec->status_tier;
    s_full_date = layout_full_date(spec);
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        StatusBar *b = &s_bars[i];
        b->layer = layer_create(layout_status_band(spec, L, bar_source((StatusBarId) i)));
        layer_set_update_proc(b->layer, bar_proc((StatusBarId) i));
        layer_add_child(parent, b->layer);
        b->row = status_row_create(bar_line((StatusBarId) i));
        refresh_row((StatusBarId) i);   // seats the row (refresh_row applies first)
    }
}

#if defined(WW_VIEW_CYCLE)
void status_bar_set_in_use(uint8_t sources) {
    const uint8_t joined = (uint8_t) (sources & ~s_in_use);
    s_in_use = sources;
    // A bar that joins is read at once: its row stayed empty while it was out of use.
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        if ((joined >> bar_source((StatusBarId) i)) & 1u) { refresh_row((StatusBarId) i); }
    }
}
#endif

void status_bar_apply_view(const ViewSpec *spec, const MainLayout *L) {
    const bool full_date = layout_full_date(spec);
    const bool date_changed = full_date != s_full_date;
    // Change-gated: an unchanged view must not re-resolve a row, or a settings save
    // would re-read persist for rows whose content never moved.
    const bool view_changed = date_changed || spec->status_tier != s_tier;
    s_tier = spec->status_tier;
    s_full_date = full_date;

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
        const GRect frame = layer_get_frame(b->layer);
        const bool moved = !grect_equal(&band, &frame);
        layer_set_frame(b->layer, band);
        layer_set_hidden(b->layer, !layout_status_visible(spec, src));

        if (moved || view_changed) { refresh_row(id); }   // applies the view facts first
    }
}

void status_bar_refresh_all(void) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        if (!s_bars[i].row) { continue; }
        refresh_row((StatusBarId) i);
    }
}

#if defined(PBL_HEALTH)
// Visible = not hidden, as in status_bar_tick_on_demand: status_bar_apply_view wrote the
// flag from the view on screen, a Quick View peek's included.
uint8_t status_bar_visible_live_health(void) {
    uint8_t kinds = 0;
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        const StatusBar *b = &s_bars[i];
        if (b->row && !layer_get_hidden(b->layer)) { kinds |= status_row_live_health(b->row); }
    }
    return kinds;
}

void status_bar_refresh_live_health(void) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        const StatusBar *b = &s_bars[i];
        if (b->row && !layer_get_hidden(b->layer) && status_row_live_health(b->row)) {
            refresh_row((StatusBarId) i);
        }
    }
}
#endif

#if defined(WW_ON_DEMAND)
void status_bar_tick_on_demand(void) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        StatusBar *b = &s_bars[i];
        if (!b->row) { continue; }
        // Visible = not hidden: status_bar_apply_view wrote the flag from the view on
        // screen. refresh_row repaints only on a signature change, so a quiet minute
        // (no rain, or an icon-only rain look) costs the refresh and nothing else.
        if (status_row_uses_on_demand(b->row) && !layer_get_hidden(b->layer)) {
            refresh_row((StatusBarId) i);
        }
    }
}
#endif

void status_bar_destroy_all(void) {
    for (int i = 0; i < STATUS_BAR_COUNT; i++) {
        StatusBar *b = &s_bars[i];
        status_row_destroy(b->row);
        b->row = NULL;
        layer_destroy(b->layer);
        b->layer = NULL;
    }
#if defined(WW_VIEW_CYCLE)
    s_in_use = STATUS_BAR_ALL_IN_USE;
#endif
}
