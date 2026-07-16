#include "rain_radar_layer.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"
#include "c/appendix/rain_tier.h"
#include "c/appendix/radar_axis.h"
#include "c/appendix/palette.h"
#include "c/appendix/hatch.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/slot_geometry.h"
#include "c/appendix/display_width.h"
#include "c/appendix/chart.h"
#include "c/appendix/snooze.h"
#include "c/appendix/theme.h"

// Layout constants. The axis area sits above the bar plot. Hour labels
// share a single vertical strip with the tick row: at hour-aligned slot
// positions the tick is suppressed and the hour digit is drawn centred
// on that column instead.
#define RADAR_AXIS_H            12
#define RADAR_NUM_SLOTS         24
// RADAR_SLOT_SECONDS comes from radar_axis.h (shared with the axis maths).
// Grace after a grid fetch boundary before the watch synthesizes an advance,
// giving PKJS time to deliver the real frame. 55s (not 60) so the gate clears
// strictly before the next minute tick, which then reliably redraws.
#define RADAR_ADVANCE_BUFFER_SECONDS 55

// Slot grid bar dimensions, bucketed by display width.
// pitch = tick_w + 2*pad + bar_w
//   144-bucket: 1 + 2 + 3 = 6 → 24*6 + 1 = 145 px (overflows 144 by 1 → 1 px clip)
//   200-bucket: 1 + 2 + 5 = 8 → 24*8 + 1 = 193 px (fits emery's 196)
#if defined(DISPLAY_WIDTH_200)
    #define RADAR_BAR_W 5
    #define RADAR_PAD   1
#elif defined(DISPLAY_WIDTH_144)
    #define RADAR_BAR_W 3
    #define RADAR_PAD   1
#endif

// Hatch line spacing for the 1km background bars. Matches the night-shading
// stride for visual consistency.
#define RADAR_HATCH_SPACING (theme_is_bw() ? 7 : 6)

// Hatch fill colour for the 1km nearby-rain shape. Matches the
// night-region hatch (DarkGray on colour, theme_fg() on B&W) so the fill
// reads as low-emphasis context; tier intensity is conveyed by the
// outline + the exact bars on top. theme_furniture() flattens the gray to
// black in the light theme (a midtone gray reads too close to white).
#define RADAR_AREA_HATCH_COLOR theme_pick(theme_furniture(GColorDarkGray), theme_fg())

// Chart config: no-border frame; top tick row sits in the axis strip
// above the bar plot. Small ticks every 5-min slot, big ticks on
// wall-clock quarter-hours. Outer for the radar is the bar plot rect —
// top ticks extend upward from there into the axis strip.
#define RADAR_TICK_COLOR theme_pick(theme_furniture(GColorLightGray), theme_fg())

// Breathing room around the snooze glyphs inside the layer bounds.
#define RADAR_SNOOZE_INSET 4

static const ChartDef RADAR_DEF = {
    .num_slots = RADAR_NUM_SLOTS,
    .tick_w    = 1,
    .bar_pad   = RADAR_PAD,
    .bar_w     = RADAR_BAR_W,
    // no borders, no insets — the radar plot fills its outer rect
};

// RADAR_TICK_COLOR is a runtime call (theme_pick/theme_furniture), so this can't
// be a static initializer — build it fresh on every redraw instead.
static TickSide radar_tick_style(void) {
    GColor c = RADAR_TICK_COLOR;
    return (TickSide){ .length = 2, .color = c, .big_length = 5, .big_color = c };
}

static Layer *s_radar_layer;

// Top-axis slots: small tick every 5-min slot, big on wall-clock
// quarter-hours; slots whose start lands on a whole hour inside the
// window carry the hour digit instead of a tick. The schedule lives in
// radar_axis.c (host-tested); only digit formatting happens here.
static void radar_fill_axis_slots(ChartAxisSlot *slots, time_t radar_start) {
    for (int i = 0; i < RADAR_NUM_SLOTS; ++i) {
        slots[i].label[0] = '\0';
        switch (radar_axis_slot_mark(radar_start, i)) {
            case RADAR_AXIS_TICK_BIG:   slots[i].tick = TICK_BIG;   continue;
            case RADAR_AXIS_TICK_SMALL: slots[i].tick = TICK_SMALL; continue;
            case RADAR_AXIS_HOUR_LABEL: break;
        }
        slots[i].tick = TICK_NONE;                   // digit replaces the tick
        const time_t t = radar_start + (time_t)i * RADAR_SLOT_SECONDS;
        struct tm *lt = localtime(&t);
        snprintf(slots[i].label, sizeof(slots[i].label), "%d",
                 config_axis_hour(lt->tm_hour));
    }
}

static inline int slot_height_px(uint8_t tenths, int16_t bar_plot_h) {
    return rain_tier_proportional_height((int) tenths, bar_plot_h);
}

// Per-slot outline colour: tier of the exact (foreground) bar at that
// slot — the border at column k matches the colour of the topmost slab
// of the exact bar in column k. Falls back to the area tier when the
// slot has no exact bar so the border still has a colour.
// B&W audit note: palette_radar_color() now returns a bar-FILL colour
// (theme_bg()) in bw themes, not an outline colour — but that's moot here.
// This result only reaches the screen via nearby_border_h_line/v_line below,
// which unconditionally override the stroke colour to theme_fg() whenever
// theme_is_bw() (both on B&W hardware and a color build's bw/bw-light theme),
// ignoring whatever this function returned. So in bw themes this call is dead
// for rendering purposes; only the effectively-color (!theme_is_bw()) path
// actually paints with it, where palette_radar_color()'s tier colours are
// exactly right for an outline. Left as the raw stop rather than a redundant
// theme_fg() guard here.
static GColor border_color_for_slot(uint8_t exact_t, uint8_t area_t) {
    int tier = rain_tier_of_tenths(exact_t);
    if (tier == 0) {
        tier = rain_tier_of_tenths(area_t);
    }
    return palette_radar_color(tier);
}

// Draw a dotted horizontal/vertical line segment for the nearby border on
// B&W devices (hardware or the color-build Black & White theme); fall back
// to a solid line on effectively-color devices.
static void nearby_border_h_line(GContext *ctx, int16_t x0, int16_t x1, int16_t y) {
#ifdef PBL_COLOR
    if (!theme_is_bw()) {
        graphics_draw_line(ctx, GPoint(x0, y), GPoint(x1, y));
        return;
    }
#endif
    graphics_context_set_stroke_color(ctx, theme_fg());
    if (x0 > x1) { int16_t t = x0; x0 = x1; x1 = t; }
    for (int16_t x = x0; x <= x1; x += 2) {
        graphics_draw_pixel(ctx, GPoint(x, y));
    }
}

static void nearby_border_v_line(GContext *ctx, int16_t x, int16_t y0, int16_t y1) {
#ifdef PBL_COLOR
    if (!theme_is_bw()) {
        graphics_draw_line(ctx, GPoint(x, y0), GPoint(x, y1));
        return;
    }
#endif
    graphics_context_set_stroke_color(ctx, theme_fg());
    if (y0 > y1) { int16_t t = y0; y0 = y1; y1 = t; }
    for (int16_t y = y0; y <= y1; y += 2) {
        graphics_draw_pixel(ctx, GPoint(x, y));
    }
}

// Pass 1: 1km background bars. Per slot with area > 0, hatch-fill a
// full-slot-width rect in the muted RADAR_AREA_HATCH_COLOR; tier
// intensity is conveyed by the outline + the exact bars on top.
// Contiguous runs of nonzero slots get a 1-px outline tracing the
// perimeter — the run's top edge plus the left/right verticals from
// plot_bottom up — with each segment coloured by its slot's exact tier.
static void draw_radar_area_bars(GContext *ctx, GRect bar_plot_rect,
                                  SlotGeometry slots,
                                  const uint8_t *area_tenths,
                                  const uint8_t *exact_tenths) {
    if (bar_plot_rect.size.w <= 0 || bar_plot_rect.size.h <= 0) {
        return;
    }
    const int16_t plot_x      = bar_plot_rect.origin.x;
    const int16_t plot_bottom = bar_plot_rect.origin.y + bar_plot_rect.size.h;
    const int16_t bar_h       = bar_plot_rect.size.h;

    graphics_context_set_stroke_width(ctx, 1);

    int i = 0;
    while (i < slots.num_slots) {
        // Skip zero-area runs.
        if (area_tenths[i] == 0) { ++i; continue; }

        int run_start = i;
        int run_end = i;
        while (run_end < slots.num_slots && area_tenths[run_end] != 0) {
            ++run_end;
        }

        // Hatch-fill each slot in the run.
        for (int s = run_start; s < run_end; ++s) {
            const int slot_h = slot_height_px(area_tenths[s], bar_h);
            if (slot_h <= 0) { continue; }
            const int16_t x_a = slot_geometry_tick_x(slots, s,     plot_x);
            const int16_t x_b = slot_geometry_tick_x(slots, s + 1, plot_x);
            const int16_t slot_w = x_b - x_a;
            const GRect r = GRect(x_a, plot_bottom - slot_h, slot_w, slot_h);
            hatch_fill_rect(ctx, r, RADAR_AREA_HATCH_COLOR, RADAR_HATCH_SPACING);
        }

        // Left vertical outline at the run's left edge.
        {
            const int h0 = slot_height_px(area_tenths[run_start], bar_h);
            const int16_t lx = slot_geometry_tick_x(slots, run_start, plot_x);
            graphics_context_set_stroke_color(ctx, border_color_for_slot(exact_tenths[run_start], area_tenths[run_start]));
            nearby_border_v_line(ctx, lx, plot_bottom - 1, plot_bottom - h0);
        }

        // Visible top edge across the run.
        for (int s = run_start; s < run_end; ++s) {
            const int h_s = slot_height_px(area_tenths[s], bar_h);
            if (h_s <= 0) { continue; }
            const int16_t x_a = slot_geometry_tick_x(slots, s,     plot_x);
            const int16_t x_b = slot_geometry_tick_x(slots, s + 1, plot_x);
            graphics_context_set_stroke_color(ctx, border_color_for_slot(exact_tenths[s], area_tenths[s]));
            nearby_border_h_line(ctx, x_a, x_b - 1, plot_bottom - h_s);
        }

        // Internal vertical steps where adjacent slot heights differ.
        for (int s = run_start; s + 1 < run_end; ++s) {
            const int h_a = slot_height_px(area_tenths[s],     bar_h);
            const int h_b = slot_height_px(area_tenths[s + 1], bar_h);
            if (h_a == h_b) { continue; }
            const int16_t bx = slot_geometry_tick_x(slots, s + 1, plot_x);
            const int min_h = (h_a > h_b) ? h_b : h_a;
            const int max_h = (h_a > h_b) ? h_a : h_b;
            graphics_context_set_stroke_color(ctx, border_color_for_slot(exact_tenths[s + 1], area_tenths[s + 1]));
            nearby_border_v_line(ctx, bx, plot_bottom - min_h, plot_bottom - max_h);
        }

        // Right vertical outline at the run's right edge.
        {
            const int h_last = slot_height_px(area_tenths[run_end - 1], bar_h);
            const int16_t rx = slot_geometry_tick_x(slots, run_end, plot_x) - 1;
            graphics_context_set_stroke_color(ctx, border_color_for_slot(exact_tenths[run_end - 1], area_tenths[run_end - 1]));
            nearby_border_v_line(ctx, rx, plot_bottom - 1, plot_bottom - h_last);
        }

        i = run_end;
    }
}

typedef struct {
    const uint8_t *exact_tenths;
    const uint8_t *area_tenths;
} RadarAreaCtx;

static void radar_area_bars_layer(const ChartRender *r, void *user) {
    const RadarAreaCtx *c = user;
    draw_radar_area_bars(r->ctx, r->geo.content, r->geo.slots,
                         c->area_tenths, c->exact_tenths);
}

static void radar_or_snooze_update_proc(Layer *layer, GContext *ctx) {
    MEMORY_LOG_HEAP("radar_update:enter");
    GRect bounds = layer_get_bounds(layer);

    if (persist_get_radar_snooze()) {
        // Sleep mode: big snooze glyphs instead of the chart. Latched on
        // sleep onset and released on the wake transition (see app_message.c).
        snooze_draw(ctx, grect_inset(bounds, GEdgeInsets(RADAR_SNOOZE_INSET)), RADAR_TICK_COLOR);
        MEMORY_LOG_HEAP("radar_update:exit");
        return;
    }

    // Zero-init: missing persist keys (fresh install) leave the buffers untouched.
    uint8_t exact_tenths[RADAR_NUM_SLOTS] = {0};
    uint8_t area_tenths[RADAR_NUM_SLOTS] = {0};
    persist_get_rain_radar_trend(exact_tenths, RADAR_NUM_SLOTS);
    persist_get_rain_radar_trend_area(area_tenths, RADAR_NUM_SLOTS);

    const GRect outer = GRect(bounds.origin.x,
                              bounds.origin.y + RADAR_AXIS_H,
                              bounds.size.w,
                              bounds.size.h - RADAR_AXIS_H);

    // Module-static scratch (not stack): aplite's small app stack overflows
    // otherwise (PC=0/LR=0). Safe — single layer instance, single-threaded,
    // both recomputed each redraw before use.
    static int16_t exact_pm[RADAR_NUM_SLOTS];
    rain_tier_fill_permille(exact_tenths, exact_pm, RADAR_NUM_SLOTS);
    static ChartAxisSlot axis_slots[RADAR_NUM_SLOTS];
    radar_fill_axis_slots(axis_slots, persist_get_rain_radar_start());
    RadarAreaCtx area_ctx = {
        .exact_tenths = exact_tenths,
        .area_tenths  = area_tenths,
    };

    int radar_num_stops = 0;
    const ChartColorStop *radar_stops = palette_radar_stops(&radar_num_stops);

    const ChartLayer layers[] = {
        { CHART_LAYER_AXIS, .axis = {
              .side = GRAPH_SIDE_TOP, .style = radar_tick_style(),
              .slots = axis_slots,
              .label_align = ALIGN_START, .tick_align = ALIGN_START } },
        { CHART_LAYER_CUSTOM, .custom = { radar_area_bars_layer, &area_ctx } },
        { CHART_LAYER_BARS, .bars = {
              .values = exact_pm, .count = RADAR_NUM_SLOTS, .lo = 0, .hi = 1000,
              .stops = radar_stops, .num_stops = radar_num_stops,
              .style = BAR_OUTLINED } },
    };
    chart_draw(ctx, &RADAR_DEF, outer, layers,
               (int)(sizeof(layers) / sizeof(layers[0])));

    MEMORY_LOG_HEAP("radar_update:exit");
}

void rain_radar_layer_create(Layer *parent, GRect frame) {
    s_radar_layer = layer_create(frame);
    layer_set_update_proc(s_radar_layer, radar_or_snooze_update_proc);
    layer_set_hidden(s_radar_layer, true);  // starts hidden; visibility owned by main_window apply_top_view()
    layer_add_child(parent, s_radar_layer);
    MEMORY_LOG_HEAP("after_rain_radar_layer_create");
}

void rain_radar_layer_refresh(void) {
    layer_mark_dirty(s_radar_layer);
}

bool rain_radar_layer_tick(time_t now) {
    const time_t start = persist_get_rain_radar_start();
    if (start <= 0) {
        return false;  // no radar window to advance
    }
    if (!connection_service_peek_pebble_app_connection()) {
        return false;  // Bluetooth down: freeze the last real window
    }

    int interval_min = (config_get() && config_get()->fetch_interval_min > 0)
                     ? config_get()->fetch_interval_min : 30;
    const time_t interval_sec = (time_t)interval_min * 60;

    // PKJS fetches on an aligned grid (index.js shouldFetch): the boundary that
    // should have delivered the current frame is floor(now/interval)*interval.
    // If the persisted window already starts there the real fetch landed, and
    // between grid boundaries no fetch was due — so we hold. The watch only
    // stands in for a fetch PKJS *skipped* (deduped), and a skip means PKJS
    // already validated the freshly-revealed tail slots are dry, so zero-padding
    // them on advance is correct.
    const time_t grid = (now / interval_sec) * interval_sec;
    if (start >= grid) {
        return false;  // current grid fetch already applied; no boundary to cover
    }
    // Grace past the boundary for PKJS to deliver before we stand in. Anchored to
    // the grid (not arrival time), so the cadence never drifts or compounds.
    if (now < grid + RADAR_ADVANCE_BUFFER_SECONDS) {
        return false;
    }

    // grid and start are both interval-grid (hence 5-min) aligned, so this is a
    // whole slot count: interval/5 slots per skipped fetch.
    int count = (int)((grid - start) / RADAR_SLOT_SECONDS);
    if (count <= 0) {
        return false;  // start not slot-aligned (corrupt persist) — don't shear
    }
    if (count > RADAR_NUM_SLOTS) {
        count = RADAR_NUM_SLOTS;  // window fully rolled to empty
    }

    uint8_t exact[RADAR_NUM_SLOTS] = {0};
    uint8_t area[RADAR_NUM_SLOTS] = {0};
    persist_get_rain_radar_trend(exact, RADAR_NUM_SLOTS);
    persist_get_rain_radar_trend_area(area, RADAR_NUM_SLOTS);

    uint8_t new_exact[RADAR_NUM_SLOTS] = {0};
    uint8_t new_area[RADAR_NUM_SLOTS] = {0};
    for (int i = 0; i + count < RADAR_NUM_SLOTS; i += 1) {
        new_exact[i] = exact[i + count];
        new_area[i] = area[i + count];
    }
    // Slots [RADAR_NUM_SLOTS - count .. ] stay zero (the zero-initialised tail).

    persist_set_rain_radar_trend(new_exact, RADAR_NUM_SLOTS);
    persist_set_rain_radar_trend_area(new_area, RADAR_NUM_SLOTS);
    persist_set_rain_radar_start(grid);
    rain_radar_layer_refresh();
    return true;
}

void rain_radar_layer_destroy(void) {
    layer_destroy(s_radar_layer);
}

Layer *rain_radar_layer_get_root(void) {
    return s_radar_layer;
}
