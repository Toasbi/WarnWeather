#pragma once
#include <pebble.h>
#include "c/appendix/slot_geometry.h"

// Chart layout primitives. Phase 2 introduced the frame; phase 3 adds
// TickConfig + SlotConfig and wraps everything into ChartConfig so each
// layer declares its visual shape in one block.

// --- Frame ----------------------------------------------------------

typedef struct {
    int    width;     // border thickness in px; 0 = no border on this side
    GColor color;
} Border;

typedef struct {
    Border left;
    Border right;
    Border top;
    Border bottom;
} GraphFrame;

// Borders sit inside the outer rect: a 1-px left border occupies the
// leftmost column of outer, a 1-px bottom border occupies the bottom row.
// outer.size shrinks accordingly — graph_frame_content_rect returns the
// rectangle inside the borders.
GRect graph_frame_content_rect(GraphFrame f, GRect outer);

// Paints each non-zero-width side as a single graphics_fill_rect.
// Sides with width == 0 are skipped (color is irrelevant for them).
void  graph_frame_draw(GContext *ctx, GraphFrame f, GRect outer);

// --- Ticks ----------------------------------------------------------

typedef struct {
    int    length;       // px perpendicular to the side; 0 = side disabled
    GColor color;
    int    big_length;   // length for "big" ticks (every big_every'th index)
    GColor big_color;
    int    big_every;    // every Nth tick is big; 0 = none are big
} TickSide;

typedef struct {
    int      tick_w;     // horizontal px the tick occupies at each slot
                         // boundary; shared across all sides — also feeds
                         // the SlotGeometry pitch
    TickSide left;
    TickSide right;
    TickSide top;
    TickSide bottom;
} TickConfig;

typedef enum {
    GRAPH_SIDE_LEFT,
    GRAPH_SIDE_RIGHT,
    GRAPH_SIDE_TOP,
    GRAPH_SIDE_BOTTOM,
} GraphSide;

// Default tick line drawer. Picks big vs small from idx % style.big_every;
// no-op when style.length == 0. Ticks extend outward from the border
// (away from the chart content) by `length` (or `big_length`) px.
// Callers needing bespoke behaviour (suppressing the tick, drawing a
// label in its place) write their own SlotTickFn and delegate here for
// the default case.
void tick_side_draw_at(GContext *ctx, GRect outer, GraphFrame frame,
                       GraphSide side, TickSide style, int idx, int tick_xy);

// --- Slot config ----------------------------------------------------

typedef struct {
    int pad;          // px on each side of a bar inside its slot
    int bar_w;        // bar width in px
    int num_slots;    // requested slot count
} SlotConfig;

// --- Bundle ---------------------------------------------------------

typedef struct {
    GraphFrame  frame;
    TickConfig  ticks;
    SlotConfig  slots;
} ChartConfig;

typedef struct {
    int          anchor_x;  // outer.origin.x — THE column anchor (engine v2)
    GRect        content;   // rect inside the frame's borders
    SlotGeometry slots;     // num_slots, pitch, bar_dx, bar_w, tick_w
} ChartGeometry;

// Compute the content rect + slot geometry from a static config and the
// caller's outer rect. Pitch math lives here exactly once. num_slots is
// passed explicitly (rather than read from cfg.slots) so callers with a
// runtime-dynamic count get a correct, immutable geometry without
// post-construction overrides.
ChartGeometry chart_compute(ChartConfig cfg, GRect outer, int num_slots);

// Convenience: paints the frame, then returns the derived geometry.
ChartGeometry chart_draw_frame(GContext *ctx, ChartConfig cfg, GRect outer);

// =====================================================================
// Chart engine v2 (spec: docs/superpowers/specs/2026-06-12-chart-engine-design.md)
// One public entry point: chart_draw(). A chart is a ChartDef (grid) plus
// an ordered list of ChartLayers — z-order IS array order, bottom first.
// A ChartLayer is NOT a Pebble Layer: no heap, no framebuffer, ~40 B of
// caller stack describing one draw pass.

#define CHART_MAX_SLOTS 32   // engine point-buffer cap; both charts use 24

typedef struct {
    int num_slots;
    int tick_w;        // horizontal px of a tick column (feeds pitch)
    int bar_pad;       // px each side of a bar inside its slot
    int bar_w;         // bar width px
    // Content insets: rows/cols of `outer` reserved for chart chrome
    // (the FRAME layer paints borders there). Plot height/baseline are
    // derived from the content rect, so these are grid geometry, not
    // frame styling.
    int inset_left, inset_right, inset_top, inset_bottom;
} ChartDef;

// Pitch math lives here exactly once; callers size their outer rect from
// it (e.g. forecast: outer.w = num_slots * pitch + 1).
static inline int chart_def_pitch(const ChartDef *d) {
    return d->tick_w + 2 * d->bar_pad + d->bar_w;
}

static inline int chart_slot_tick_x(const ChartGeometry *g, int i) {
    return g->anchor_x + i * g->slots.pitch;
}
static inline int chart_slot_bar_x(const ChartGeometry *g, int i) {
    return g->anchor_x + i * g->slots.pitch + g->slots.bar_dx;
}
static inline int chart_slot_mid_x(const ChartGeometry *g, int i) {
    return g->anchor_x + i * g->slots.pitch + g->slots.pitch / 2;
}

typedef struct {
    GContext       *ctx;
    const ChartDef *def;
    GRect           outer;
    ChartGeometry   geo;
} ChartRender;

typedef enum { TICK_NONE, TICK_SMALL, TICK_BIG } ChartTickKind;
typedef enum { ALIGN_START, ALIGN_MIDDLE }       ChartSlotAlign;

typedef struct {
    char          label[4];  // "" = no label
    ChartTickKind tick;
} ChartAxisSlot;

typedef struct {
    GraphFrame frame;
} ChartFrameLayer;

typedef struct {
    GraphSide            side;        // GRAPH_SIDE_BOTTOM / GRAPH_SIDE_TOP
    TickSide             style;       // small/big tick length+color (big_every ignored)
    const ChartAxisSlot *slots;       // exactly def->num_slots entries
    ChartSlotAlign       label_align; // text centered on slot start / middle
    ChartSlotAlign       tick_align;  // tick line on slot start / middle
} ChartAxisLayer;

typedef struct { int16_t from; GColor color; } ChartColorStop; // value-space threshold
typedef enum   { BAR_SOLID, BAR_OUTLINED } ChartBarStyle;      // OUTLINED: +1px white
                                                               // silhouette (B&W)
typedef struct {
    const int16_t        *values;
    int                   count;      // clamped to def->num_slots
    int                   lo, hi;     // linear range map; lo = baseline value
    const ChartColorStop *stops;      // >=1, ascending, stops[0].from == lo
    int                   num_stops;
    ChartBarStyle         style;
} ChartBarsLayer;

typedef struct {
    const int16_t *values;            // compute points from values...
    const GPoint  *points;            // ...OR consume precomputed points
    GPoint        *export_points;     // optional out: count points
    int            count;
    int            lo, hi;
    int            inset_y;           // vertical margins (temp line: 7)
    GColor         color;
    int            width;
} ChartLineLayer;

typedef struct {
    const int16_t *values;
    GPoint        *export_points;     // optional out: count + 2 points (closing pts)
    int            count;
    int            lo, hi;
    GColor         fill_color;
} ChartAreaLayer;

typedef struct {
    void (*fn)(const ChartRender *r, void *user);
    void  *user;
} ChartCustomLayer;

typedef enum { CHART_LAYER_FRAME, CHART_LAYER_AXIS, CHART_LAYER_BARS,
               CHART_LAYER_LINE, CHART_LAYER_AREA, CHART_LAYER_CUSTOM } ChartLayerType;

typedef struct {
    ChartLayerType type;
    union {
        ChartFrameLayer  frame;
        ChartAxisLayer   axis;
        ChartBarsLayer   bars;
        ChartLineLayer   line;
        ChartAreaLayer   area;
        ChartCustomLayer custom;
    };
} ChartLayer;

void chart_draw(GContext *ctx, const ChartDef *def, GRect outer,
                const ChartLayer *layers, int num_layers);
